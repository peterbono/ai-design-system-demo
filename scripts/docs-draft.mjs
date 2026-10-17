#!/usr/bin/env node
// docs-draft: the GitHub Action step that drafts missing or stale component docs (docs.json prose) with Claude on a
// pull request. Optional by design:
//   - without the ANTHROPIC_API_KEY secret it posts (or updates) one PR comment saying drafts are off, and exits 0;
//   - with it, for each component the PR touches whose docs are missing, incomplete or older than its code, it gets
//     the deterministic pre-fill and the prompt from `bridge docs draft <Name> --json`, asks Claude for the prose,
//     keeps what code decides (anatomy), marks the file "draftedBy": "claude", "needsReview": true, commits it to the
//     PR branch and updates the comment. A reviewer accepts the draft in Bridge Studio (Changes, Docs).
// No dependency: fetch and child_process only. Every side effect is injectable for the tests.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- bridge-docs-draft -->';
export const OFF_MESSAGE = 'AI doc drafts are off. Add ANTHROPIC_API_KEY to enable.';
export const MODEL = 'claude-sonnet-5-5';
export const COMMIT_PREFIX = 'docs(';
export const COMMIT_SUFFIX = '): draft usage guidance with Claude, needs review';
const COMPONENTS_DIR = 'packages/react/src/components';
const PROSE_KEYS = ['summary', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines'];
// Same order as formatDocsJson in @bridge-ds/core (packages/core/src/docs-draft.ts).
const KEY_ORDER = ['summary', 'category', 'status', 'preview', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines', 'anatomy', 'draftedBy', 'needsReview'];

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

/** Prose keys a docs.json leaves empty (all of them when there is no file). */
export const missingProse = (docs) => PROSE_KEYS.filter((k) => isEmpty(docs?.[k]));

/** docs.json text the way the repo writes it (two spaces, Button.docs.json key order, trailing newline). */
export function formatDocs(d) {
  const out = {};
  for (const k of KEY_ORDER) if (d[k] !== undefined) out[k] = d[k];
  for (const [k, v] of Object.entries(d)) if (!(k in out) && v !== undefined) out[k] = v;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Components to draft. A component counts when the PR touches its folder and its docs.json is missing, has empty
 * prose, or its code (tsx or css) changed while its docs.json did not. A token-only change adds every component
 * with missing docs or empty prose.
 *   changed   repo-relative paths changed by the PR
 *   readDocs  name -> parsed docs.json or null
 *   all       every component name (for token-only changes)
 */
export function selectTargets({ changed, readDocs, all = [] }) {
  const touched = new Map();
  for (const p of changed) {
    const m = new RegExp(`^${COMPONENTS_DIR}/([A-Z]\\w*)/(.+)$`).exec(p);
    if (!m) continue;
    const files = touched.get(m[1]) ?? new Set();
    files.add(m[2]);
    touched.set(m[1], files);
  }
  const out = [];
  for (const [name, files] of touched) {
    const docs = readDocs(name);
    const docsChanged = files.has(`${name}.docs.json`);
    const codeChanged = files.has(`${name}.tsx`) || [...files].some((f) => f.endsWith('.css'));
    if (!docs) out.push({ name, reason: 'no docs.json yet' });
    else if (missingProse(docs).length && !docsChanged) out.push({ name, reason: `missing ${missingProse(docs).join(', ')}` });
    else if (codeChanged && !docsChanged) out.push({ name, reason: 'code changed, docs did not' });
  }
  if (changed.some((p) => p.startsWith('packages/tokens/src/'))) {
    for (const name of all) {
      if (touched.has(name)) continue;
      const docs = readDocs(name);
      if (!docs) out.push({ name, reason: 'no docs.json yet' });
      else if (missingProse(docs).length) out.push({ name, reason: `missing ${missingProse(docs).join(', ')}` });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The first JSON object in a model reply (plain, or inside a ```json fence). Throws when there is none. */
export function parseReply(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The reply holds no JSON object.');
  const json = JSON.parse(body.slice(start, end + 1));
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The reply is not a docs.json object.');
  return json;
}

/**
 * The docs.json to commit: Claude's prose on top of the pre-fill draft, with what code decides kept from the
 * pre-fill (anatomy), existing prose kept where Claude returned nothing, and the review marks set.
 */
export function mergeDraft(prefillDraft, reply) {
  const merged = { ...prefillDraft };
  for (const k of PROSE_KEYS) if (!isEmpty(reply[k]) && isEmpty(prefillDraft[k])) merged[k] = reply[k];
  if (reply.preview && !prefillDraft.preview) merged.preview = reply.preview;
  merged.anatomy = prefillDraft.anatomy;
  merged.draftedBy = 'claude';
  merged.needsReview = true;
  return merged;
}

// --- GitHub -----------------------------------------------------------------------------------------------

function gh(fetchImpl, token) {
  return async (method, url, body) => {
    const res = await fetchImpl(`https://api.github.com${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${url}: ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
}

/** Creates the one docs-draft comment on the PR, or updates it when the marker is already there. */
export async function upsertComment({ fetchImpl = fetch, token, repo, pr, body }) {
  const call = gh(fetchImpl, token);
  const text = `${MARKER}\n${body}`;
  const comments = (await call('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100`)) ?? [];
  const mine = comments.find((c) => typeof c.body === 'string' && c.body.includes(MARKER));
  if (mine) {
    await call('PATCH', `/repos/${repo}/issues/comments/${mine.id}`, { body: text });
    return { action: 'updated', id: mine.id };
  }
  const made = await call('POST', `/repos/${repo}/issues/${pr}/comments`, { body: text });
  return { action: 'created', id: made?.id };
}

// --- Anthropic ----------------------------------------------------------------------------------------------

/** One Messages API call; returns the text of the reply. Raw HTTP: the repo takes no SDK dependency for one call. */
export async function askClaude({ fetchImpl = fetch, apiKey, prompt }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // A declined request is re-run on a fallback model inside the same call.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, fallbacks: 'default', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const msg = await res.json();
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to draft this one.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The reply was cut off (max_tokens).');
  return (msg.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// --- run ------------------------------------------------------------------------------------------------------

/**
 * One run of the Action. Returns the exit code (always 0 unless the setup is broken: drafts never block a PR).
 * deps: env, fetchImpl, readFile, writeFile, exists, exec (cmd, args) -> stdout, log.
 */
export async function run(deps) {
  const { env, fetchImpl = fetch, log = console.log } = deps;
  const readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const writeFile = deps.writeFile ?? ((p, t) => writeFileSync(p, t));
  const exists = deps.exists ?? existsSync;
  const exec = deps.exec ?? ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token || !repo || !env.GITHUB_EVENT_PATH) {
    log('docs-draft: not running in a pull_request workflow (GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH). Nothing to do.');
    return 0;
  }
  const event = JSON.parse(readFile(env.GITHUB_EVENT_PATH));
  const pull = event.pull_request;
  if (!pull) {
    log('docs-draft: no pull_request in the event. Nothing to do.');
    return 0;
  }
  const pr = pull.number;

  if (!env.ANTHROPIC_API_KEY) {
    const r = await upsertComment({ fetchImpl, token, repo, pr, body: OFF_MESSAGE });
    log(`docs-draft: ${OFF_MESSAGE} (comment ${r.action})`);
    return 0;
  }
  if (pull.head?.repo?.full_name && pull.head.repo.full_name !== repo) {
    log('docs-draft: pull request from a fork, no write access. Skipped.');
    return 0;
  }
  const lastSubject = exec('git', ['log', '-1', '--format=%s']).trim();
  if (lastSubject.startsWith(COMMIT_PREFIX) && lastSubject.endsWith(COMMIT_SUFFIX)) {
    log('docs-draft: the last commit is a docs draft. Skipped, to avoid a loop.');
    return 0;
  }

  const changed = exec('git', ['diff', '--name-only', `${pull.base.sha}...HEAD`]).split('\n').filter(Boolean);
  const docsPath = (name) => join(COMPONENTS_DIR, name, `${name}.docs.json`);
  const readDocs = (name) => {
    if (!exists(docsPath(name))) return null;
    try {
      return JSON.parse(readFile(docsPath(name)));
    } catch {
      return null;
    }
  };
  const all = exec('git', ['ls-files', `${COMPONENTS_DIR}/*/*.tsx`])
    .split('\n')
    .map((p) => /\/([A-Z]\w*)\/\1\.tsx$/.exec(p)?.[1])
    .filter(Boolean);
  const targets = selectTargets({ changed, readDocs, all: [...new Set(all)] });
  if (!targets.length) {
    log('docs-draft: every touched component has its docs. Nothing to draft.');
    return 0;
  }

  const drafted = [];
  const failed = [];
  for (const t of targets) {
    try {
      const out = JSON.parse(exec('node', ['packages/cli/dist/index.js', 'docs', 'draft', t.name, '--json']));
      const reply = await askClaude({ fetchImpl, apiKey: env.ANTHROPIC_API_KEY, prompt: out.prompt });
      const docs = mergeDraft(out.prefill.draft, parseReply(reply));
      writeFile(out.path, formatDocs(docs));
      exec('git', ['add', out.path]);
      exec('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-q', '-m', `${COMMIT_PREFIX}${t.name.toLowerCase()}${COMMIT_SUFFIX}`, '-m', `Drafted by ${MODEL} from the code (${t.reason}). Review it in Bridge Studio, Changes, Docs.`]);
      drafted.push(t);
    } catch (e) {
      failed.push({ ...t, error: e.message });
    }
  }
  if (drafted.length) exec('git', ['push', 'origin', `HEAD:${pull.head.ref}`]);
  const lines = [
    drafted.length ? `Claude drafted usage guidance for ${drafted.length} component${drafted.length > 1 ? 's' : ''}. Each file says "needsReview": true until a reviewer accepts it in Bridge Studio (Changes, Docs).` : 'No draft was committed.',
    ...drafted.map((t) => `- ${t.name}: ${t.reason}`),
    ...(failed.length ? ['', 'Not drafted:', ...failed.map((t) => `- ${t.name}: ${t.error}`)] : []),
  ];
  await upsertComment({ fetchImpl, token, repo, pr, body: lines.join('\n') });
  log(`docs-draft: drafted ${drafted.map((t) => t.name).join(', ') || 'nothing'}${failed.length ? `, failed ${failed.map((t) => t.name).join(', ')}` : ''}.`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run({ env: process.env }).then(
    (code) => (process.exitCode = code),
    (e) => {
      // Drafts never block a pull request: report and exit 0.
      console.error(`docs-draft: ${e.message}`);
      process.exitCode = 0;
    },
  );
}
