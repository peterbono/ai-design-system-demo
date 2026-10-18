// Docs drafted with Claude, in place on a Library component page. Two ways, both the designer's own:
// - 'api-key': one Messages API call straight from this browser with their Anthropic API key. The key is kept only in
//   this browser's localStorage and is only ever sent to api.anthropic.com.
// - 'my-claude': their own Claude (Claude Code or Desktop with the Bridge MCP server) writes the sections through the
//   draft exchange: Studio writes a pending session on the requests branch with the GitHub token the site already
//   uses, the designer says "Draft my Bridge changes", and Studio polls the file until the answer is there.
// Results are always proposals: the caller shows them as "Drafted by Claude" (applyDraft marks draftedSections) and
// the designer reviews them. The pure logic is in ../lib/docs-ai-model.ts and @bridge-ds/core.
import {
  type ComponentDocsJson,
  DRAFT_PHRASE,
  type DocsSections,
  type DraftResult,
  DraftPoller,
  type ProseKey,
  applyDocsSections,
  createDocsDraftSession,
  deletePendingDrafts,
  missingProse,
} from '@bridge-ds/core';
import {
  type DocsAiContext,
  type DraftAvailability,
  type DraftDocsResult,
  type DraftScope,
  type DraftWay,
  apiErrorMessage,
  availability,
  docsApiRequest,
  isEmptyTask,
  outdatedFromDates,
  resultFromExchange,
  resultFromReply,
  scopeTask,
  taskPrompt,
} from '../lib/docs-ai-model';
import { getToken, hasWorkingToken, readRepo, studioClient } from './github-session';

export type { DraftAvailability, DraftDocsResult, DraftScope, DraftWay } from '../lib/docs-ai-model';
export { DRAFT_PHRASE };

const API_KEY_KEY = 'bridge.anthropic.key';
const MODEL_KEY = 'bridge.anthropic.model';

function readApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Saves (or with null, forgets) the designer's Anthropic API key in this browser only. */
export function saveApiKey(key: string | null): void {
  try {
    if (key?.trim()) localStorage.setItem(API_KEY_KEY, key.trim());
    else localStorage.removeItem(API_KEY_KEY);
  } catch {
    /* private mode: no key is kept */
  }
  document.dispatchEvent(new CustomEvent('bridge:docs-ai', { detail: draftAvailability() }));
}

/** True when an API key is saved in this browser (never returns the key itself). */
export const hasApiKey = (): boolean => Boolean(readApiKey());

function model(): string | undefined {
  try {
    return localStorage.getItem(MODEL_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** The ways open here: an API key saved in this browser and/or a working GitHub token for the draft exchange. */
export function draftAvailability(): DraftAvailability {
  return availability({ apiKey: hasApiKey(), exchange: hasWorkingToken() });
}

const contexts = new Map<string, Promise<DocsAiContext>>();

/** The facts from the code and the conventions of a component (/docs-ai/<slug>.json, built with the site). */
export function docsContext(slug: string): Promise<DocsAiContext> {
  let p = contexts.get(slug);
  if (!p) {
    p = fetch(`/docs-ai/${encodeURIComponent(slug)}.json`).then((r) => {
      if (!r.ok) throw new Error(`The drafting context of ${slug} is missing (${r.status}). Reload the page.`);
      return r.json() as Promise<DocsAiContext>;
    });
    p.catch(() => contexts.delete(slug));
    contexts.set(slug, p);
  }
  return p;
}

const repoName = () => {
  const r = readRepo();
  return { full: `${r.owner}/${r.repo}`, branch: r.defaultBranch };
};

/**
 * Prose sections that are empty or older than the component code: last commit of the tsx and the css against the last
 * commit of docs.json on the default branch (GitHub API). Only the empty ones when GitHub cannot be read.
 */
export async function outdatedSections(slug: string, docs: Partial<ComponentDocsJson>): Promise<ProseKey[]> {
  try {
    const ctx = await docsContext(slug);
    const { full, branch } = repoName();
    const gh = studioClient(full, getToken());
    const last = async (path: string) => (await gh.listCommits({ sha: branch, path, perPage: 1 }))[0]?.date ?? null;
    const [tsx, css, written] = await Promise.all([last(ctx.files.tsx), last(ctx.files.css), last(ctx.files.docs)]);
    return outdatedFromDates(docs, { code: [tsx, css], docs: written });
  } catch {
    return missingProse(docs);
  }
}

/** The docs with drafted sections applied and marked for review (draftedBy, needsReview, draftedSections). */
export function applyDraft<T extends Partial<ComponentDocsJson>>(docs: T, sections: DraftDocsResult['sections']): T {
  return applyDocsSections(docs, sections as DocsSections);
}

const aborted = () => new DOMException('Drafting was cancelled.', 'AbortError');

async function viaApiKey(prompt: string, signal: AbortSignal | undefined): Promise<unknown> {
  const key = readApiKey();
  if (!key) throw new Error('Add your Anthropic API key first. It stays in this browser.');
  const req = docsApiRequest(key, prompt, model());
  let res: Response;
  try {
    res = await fetch(req.url, { ...req.init, ...(signal ? { signal } : {}) });
  } catch (err) {
    if (signal?.aborted) throw aborted();
    throw new Error(apiErrorMessage('network'), { cause: err });
  }
  if (!res.ok) throw new Error(apiErrorMessage(res.status));
  return res.json();
}

async function viaMyClaude(
  input: { slug: string; name: string; path: string; task: Parameters<typeof resultFromExchange>[0]; prompt: string },
  signal: AbortSignal | undefined,
  onStatus: ((s: string) => void) | undefined,
): Promise<DraftResult> {
  if (!hasWorkingToken()) throw new Error('Connect GitHub first: your own Claude answers through the repo.');
  const { full, branch } = repoName();
  const gh = studioClient(full, getToken());
  onStatus?.('Sending the request to your Claude');
  const session = await createDocsDraftSession(gh, { component: input.name, slug: input.slug, path: input.path, task: input.task, prompt: input.prompt, baseBranch: branch });
  const cleanup = () => deletePendingDrafts(gh, session.sessionId).catch(() => false);
  onStatus?.(`Waiting for your Claude. Say "${DRAFT_PHRASE}" in Claude Code or Claude Desktop with the Bridge MCP server.`);
  return new Promise<DraftResult>((resolve, reject) => {
    const done = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      void cleanup();
      fn();
    };
    const poller = new DraftPoller({
      client: gh,
      sessionId: session.sessionId,
      onResults: (results) => {
        const r = results.find((x) => x.id === session.items[0]!.id);
        done(() => (r ? resolve(r) : reject(new Error('Your Claude answered without the docs. Try again.'))));
      },
      onTimeout: () => done(() => reject(new Error(`No answer from your Claude after 10 minutes. Say "${DRAFT_PHRASE}" to it, then try again.`))),
      onGone: () => done(() => reject(new Error('The request was removed before your Claude answered. Try again.'))),
      onError: () => onStatus?.('Still waiting for your Claude (GitHub did not answer, retrying)'),
    });
    const onAbort = () => {
      poller.stop();
      done(() => reject(aborted()));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    poller.start();
  });
}

/**
 * Drafts docs for a scope, the designer's own way. Sections scopes return the drafted sections and `checked`: written
 * sections page-fill checked against newer code and Claude left unchanged ("Still accurate"); a checked section in
 * `sections` was fixed ("Updated"). page-fill returns nothing, without calling Claude, when nothing is empty or
 * outdated. Selection returns `replacement` only. Nothing is
 * saved: the caller shows the result as "Drafted by Claude" for review. Rejects with an AbortError on `signal`.
 */
export async function draftDocs(input: {
  slug: string;
  name: string;
  docs: Partial<ComponentDocsJson>;
  scope: DraftScope;
  way: DraftWay;
  signal?: AbortSignal;
  onStatus?: (s: string) => void;
}): Promise<{ sections: Partial<Record<ProseKey, ComponentDocsJson[ProseKey]>>; replacement?: string; checked?: ProseKey[] }> {
  const { slug, docs, scope, way, signal, onStatus } = input;
  if (signal?.aborted) throw aborted();
  onStatus?.('Reading the component code');
  const ctx = await docsContext(slug);
  const outdated = scope.kind === 'page-fill' ? await outdatedSections(slug, docs) : undefined;
  const task = scopeTask(scope, docs, outdated);
  if (isEmptyTask(task)) {
    onStatus?.('Every section is written and up to date');
    return { sections: {}, checked: [] };
  }
  const prompt = taskPrompt(ctx, docs, task);
  if (signal?.aborted) throw aborted();
  if (way === 'api-key') {
    onStatus?.('Claude is drafting');
    const body = await viaApiKey(prompt, signal);
    const result = resultFromReply(task, body);
    onStatus?.('Drafted by Claude. Review it before you propose it.');
    return result;
  }
  const r = await viaMyClaude({ slug, name: input.name || ctx.name, path: ctx.files.docs, task, prompt }, signal, onStatus);
  const result = resultFromExchange(task, r);
  onStatus?.('Drafted by Claude. Review it before you propose it.');
  return result;
}
