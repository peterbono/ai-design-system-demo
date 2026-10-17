// bridge request: list, show, implement and create component change requests (GitHub issues labeled
// component-change), and the jira-sync step of the optional bridge-jira GitHub Action.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { REQUEST_KINDS, REQUEST_STATUS_LABEL, type RequestKind } from '@bridge-ds/core';
import { BridgeContext, requests } from '@bridge-ds/mcp';
import { jiraSync } from './jira-sync.js';

export interface RequestArgs {
  _: string[];
  flags: Record<string, string[]>;
}

export interface RequestIO {
  print(s: string): void;
  error(s: string): void;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch | undefined;
  /** GitHub token from the gh CLI, when it is installed and signed in. */
  ghToken(): string | undefined;
  /** Whether the `claude` binary is on PATH. */
  hasClaude(): boolean;
  /** Runs `claude <prompt>` in the repo, attached to the terminal; returns its exit code. */
  runClaude(prompt: string, cwd: string): number;
}

export const REQUEST_HELP = `bridge request: component change requests (GitHub issues labeled component-change)

Usage:
  bridge request list [--status requested|in-progress|done|declined|all] [--component Button] [--json]
  bridge request show <number> [--json]
  bridge request implement <number> [--claude]
                     print the brief Claude needs to implement the request; --claude starts Claude Code with it
  bridge request create --component Button --kind new-variant --title "Add a danger ghost variant"
                     --summary "..." [--change field=before:after ...] [--figma url] [--dry-run] [--json]
  bridge request jira-sync
                     GitHub Action step: mirror a request issue to Jira (see docs/REQUESTS.md)

Kinds: ${REQUEST_KINDS.map((k) => k.value).join(', ')}
GitHub token: GITHUB_TOKEN or BRIDGE_GITHUB_TOKEN, else \`gh auth token\`. Reading a public repo works without one.
Exit codes: 0 ok, 1 not a request or Claude Code not found, 2 usage or setup error.`;

export class RequestUsageError extends Error {}

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

export const defaultIO = (): RequestIO => ({
  print: (s) => process.stdout.write(`${s}\n`),
  error: (s) => process.stderr.write(`${s}\n`),
  env: process.env,
  ghToken() {
    try {
      return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || undefined;
    } catch {
      return undefined;
    }
  },
  hasClaude() {
    const r = spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 10000 });
    return !r.error && r.status === 0;
  },
  runClaude(prompt, cwd) {
    const r = spawnSync('claude', [prompt], { cwd, stdio: 'inherit' });
    return r.status ?? 1;
  },
});

function tokenFrom(io: RequestIO): string | undefined {
  return io.env.BRIDGE_GITHUB_TOKEN || io.env.GITHUB_TOKEN || io.ghToken();
}

async function context(root: string, io: RequestIO, needToken: boolean): Promise<BridgeContext> {
  const token = tokenFrom(io);
  if (needToken && !token) throw new RequestUsageError('Creating a request needs a GitHub token: set GITHUB_TOKEN, or sign in with `gh auth login`.');
  return BridgeContext.create({ root, ...(token ? { token } : {}), ...(io.fetch ? { fetch: io.fetch } : {}) });
}

function issueNumber(a: RequestArgs, usage: string): number {
  const raw = (a._[2] ?? '').replace(/^#/, '');
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n <= 0) throw new RequestUsageError(`Usage: ${usage}`);
  return n;
}

/** `--change size=md:lg`, `--change radius=:pill` (no before), `--change icon` (field only). */
export function parseChange(s: string): { field: string; before?: string; after?: string } {
  const eq = s.indexOf('=');
  if (eq < 0) return { field: s.trim() };
  const field = s.slice(0, eq).trim();
  const rest = s.slice(eq + 1);
  const colon = rest.indexOf(':');
  const before = colon < 0 ? '' : rest.slice(0, colon).trim();
  const after = (colon < 0 ? rest : rest.slice(colon + 1)).trim();
  return { field, ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/** The request, or undefined (message on stderr) when the issue is not one: exit 1, not a setup error. */
async function getOrExplain(ctx: BridgeContext, n: number, io: RequestIO) {
  try {
    return await requests.getRequest(ctx, { number: n });
  } catch (e) {
    if (/is not a component change request/.test((e as Error).message)) {
      io.error(`bridge: ${(e as Error).message}`);
      return undefined;
    }
    throw e;
  }
}

export async function runRequest(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (!sub || sub === 'help' || has(a, 'help')) {
    io.print(REQUEST_HELP);
    return sub || has(a, 'help') ? 0 : 2;
  }
  switch (sub) {
    case 'list': {
      const status = flag(a, 'status') ?? 'all';
      if (!['requested', 'in-progress', 'done', 'declined', 'all'].includes(status)) throw new RequestUsageError(`--status takes requested, in-progress, done, declined or all, got "${status}"`);
      const ctx = await context(root, io, false);
      const component = flag(a, 'component');
      const r = await requests.listRequests(ctx, { status: status as requests.RequestStatusFilter, ...(component ? { component } : {}) });
      if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
      if (!r.requests.length) return io.print(`No ${status === 'all' ? '' : `${status} `}component change request in ${r.repo}${component ? ` for ${component}` : ''}.`), 0;
      const w = Math.max(...r.requests.map((x) => x.component.length));
      for (const x of r.requests) {
        const prs = x.linkedPrs.length ? `  PR ${x.linkedPrs.map((p) => `#${p.number} ${p.state}`).join(', ')}` : '';
        io.print(`#${String(x.number).padEnd(5)} ${REQUEST_STATUS_LABEL[x.status].padEnd(11)} ${x.component.padEnd(w)}  ${x.kind.padEnd(13)} ${x.title}${prs}`);
      }
      return 0;
    }
    case 'show': {
      const n = issueNumber(a, 'bridge request show <number>');
      const ctx = await context(root, io, false);
      const r = await getOrExplain(ctx, n, io);
      if (!r) return 1;
      if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
      const q = r.request;
      io.print(`#${r.number} ${q.component}: ${q.title}`);
      io.print(`${REQUEST_STATUS_LABEL[r.status]}, ${q.kind}, from ${q.source}${q.requestedBy ? ` by @${q.requestedBy}` : ''}`);
      io.print(r.url);
      io.print(`\n${q.summary}`);
      if (q.changes.length) {
        io.print('\nChanges:');
        for (const c of q.changes) io.print(`  ${c.field}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`);
      }
      if (q.figma?.url) io.print(`\nDesign: ${q.figma.url}`);
      io.print(`\nComponent: ${r.component.exists ? `${r.component.files.length} file(s) in ${r.component.dir}` : `not in the repo yet${r.component.dir ? ` (${r.component.dir})` : ''}`}`);
      if (r.linkedPrs.length) {
        io.print('Pull requests:');
        for (const p of r.linkedPrs) io.print(`  #${p.number} ${p.state}  ${p.title}  ${p.url}`);
      }
      io.print(`\nNext: bridge request implement ${r.number} --claude`);
      return 0;
    }
    case 'implement': {
      const n = issueNumber(a, 'bridge request implement <number> [--claude]');
      const ctx = await context(root, io, false);
      const r = await getOrExplain(ctx, n, io);
      if (!r) return 1;
      if (!has(a, 'claude')) return io.print(r.brief), 0;
      if (!io.hasClaude()) {
        io.print(r.brief);
        io.error(`\nClaude Code is not installed (no \`claude\` on PATH). Install it (npm install -g @anthropic-ai/claude-code), then run:\n  claude "$(bridge request implement ${n})"`);
        return 1;
      }
      return io.runClaude(r.brief, ctx.root ?? root);
    }
    case 'create': {
      const component = flag(a, 'component');
      const kind = flag(a, 'kind');
      const title = flag(a, 'title');
      const summary = flag(a, 'summary');
      const usage = 'bridge request create --component Button --kind new-variant --title "Add a danger ghost variant" --summary "..."';
      if (!component || !kind || !title || !summary) throw new RequestUsageError(`Usage: ${usage}`);
      if (!REQUEST_KINDS.some((k) => k.value === kind)) throw new RequestUsageError(`--kind takes ${REQUEST_KINDS.map((k) => k.value).join(', ')}, got "${kind}"`);
      const dryRun = has(a, 'dry-run');
      const ctx = await context(root, io, !dryRun);
      const figma = flag(a, 'figma');
      const r = await requests.createRequest(ctx, {
        component,
        kind: kind as RequestKind,
        title,
        summary,
        changes: (a.flags.change ?? []).map(parseChange),
        ...(figma ? { figmaUrl: figma } : {}),
        source: 'cli',
        dryRun,
      });
      if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
      if (r.status === 'dry-run') {
        io.print(`Dry run, nothing created.\n\nTitle: ${r.issue.title}\nLabels: ${r.issue.labels.join(', ')}${r.issue.assignees.length ? `\nAssignees: ${r.issue.assignees.join(', ')}` : ''}\n\n${r.issue.body}`);
        return 0;
      }
      io.print(`Created request #${r.number}: ${r.url}`);
      io.print(`Next: bridge request implement ${r.number} --claude`);
      return 0;
    }
    case 'jira-sync': {
      const eventPath = io.env.GITHUB_EVENT_PATH;
      let event: unknown = {};
      if (eventPath) {
        try {
          event = JSON.parse(await readFile(eventPath, 'utf8'));
        } catch {
          throw new RequestUsageError(`Could not read the GitHub event at ${eventPath}.`);
        }
      }
      const r = await jiraSync({ root, env: io.env, event: event as never, log: io.print, ...(io.fetch ? { fetch: io.fetch } : {}) });
      return r.status === 'error' ? 1 : 0;
    }
    default:
      throw new RequestUsageError(`Unknown request command "${sub}".\n\n${REQUEST_HELP}`);
  }
}
