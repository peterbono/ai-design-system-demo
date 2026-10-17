// "Draft with my Claude": the designer's own Claude (Claude Desktop or Claude Code on their own plan) writes the text,
// through the Bridge MCP server. Third-party apps cannot use a Claude plan and Bridge has no backend, so the channel is
// the GitHub repo both already reach with the designer's token (protocol: @bridge-ds/core draft-exchange.ts):
//
// 1. start: upload the before and after PNGs and write `.bridge/drafts/<sessionId>.json` on the requests branch.
// 2. The designer says "Draft my Bridge changes" to their Claude; the MCP server writes the results into that file.
// 3. poll: read the file every 5 seconds while the plugin is open, stop after 10 minutes ("Check again" restarts).
// 4. fill: fields the designer did not edit since the request get Claude's text; edited ones get an offer instead.
// 5. finish: delete the file (and its images) once the request or push is sent, or cancelled.
//
// Independent of the DOM and of figma.*: the UI wires it, tests drive it with a fake GitHub and fake timers.

import {
  type DraftImage,
  type DraftItem,
  type DraftLine,
  type DraftResult,
  type DraftScope,
  type DraftText,
  type DraftVariableRow,
  type GitHubClient,
  type PendingDrafts,
  type RequestChange,
  type RequestKind,
  REQUESTS_BRANCH,
  composePendingDrafts,
  createPendingDrafts,
  deletePendingDrafts,
  draftImagePath,
  newDraftSessionId,
  readPendingDrafts,
} from '@bridge-ds/core';
import { ensureRequestsBranch, requestImageUrl } from './requests';

export { DRAFT_PHRASE } from '@bridge-ds/core';
export const POLL_INTERVAL_MS = 5_000;
export const POLL_TIMEOUT_MS = 10 * 60_000;

export interface MyClaudeTarget {
  scope: DraftScope;
  component?: string | undefined;
  kind?: RequestKind | undefined;
  changes: RequestChange[];
  variables?: DraftVariableRow[] | undefined;
  components?: string[] | undefined;
  notes?: string | undefined;
  draft: DraftText;
  /** PNG base64 (no data: prefix), uploaded next to the session so Claude can see them. */
  images?: { before?: string | undefined; after?: string | undefined } | undefined;
  /** Component changes Claude writes one line each for (the row line and the request's first line). */
  lines?: DraftLine[] | undefined;
  /** Push: images per change line (by line id), when the push requests several components. */
  lineImages?: { id: string; before?: string | undefined; after?: string | undefined }[] | undefined;
}

type ExchangeClient = Pick<GitHubClient, 'owner' | 'name' | 'getBranchSha' | 'createBranch' | 'putBase64File' | 'getFile' | 'putFile' | 'deleteFile' | 'listDirectory'>;

/** Uploads the images and writes the pending drafts file. Returns the session the plugin then polls. */
export async function startMyClaudeDrafts(client: ExchangeClient, input: { targets: MyClaudeTarget[]; baseBranch: string; now?: Date | undefined; random?: (() => number) | undefined }): Promise<PendingDrafts> {
  if (!input.targets.length) throw new Error('Nothing to draft yet.');
  await ensureRequestsBranch(client as GitHubClient, input.baseBranch);
  const sessionId = newDraftSessionId(input.random);
  const items: DraftItem[] = [];
  for (const [n, t] of input.targets.entries()) {
    const id = `item-${n + 1}`;
    const images: DraftImage[] = [];
    for (const label of ['before', 'after'] as const) {
      const data = t.images?.[label]?.replace(/^data:image\/png;base64,/, '');
      if (!data) continue;
      const path = draftImagePath(sessionId, id, label);
      await client.putBase64File({ path, base64: data, branch: REQUESTS_BRANCH, message: `Image for Claude drafts from Figma (${label})` });
      images.push({ label, path, url: requestImageUrl(client, path) });
    }
    for (const [k, x] of (t.lineImages ?? []).entries()) {
      for (const label of ['before', 'after'] as const) {
        const data = x[label]?.replace(/^data:image\/png;base64,/, '');
        if (!data) continue;
        const path = draftImagePath(sessionId, `${id}-change-${k + 1}`, label);
        await client.putBase64File({ path, base64: data, branch: REQUESTS_BRANCH, message: `Image for Claude drafts from Figma (${label})` });
        images.push({ label, path, url: requestImageUrl(client, path), line: x.id });
      }
    }
    items.push({
      id,
      scope: t.scope,
      ...(t.component ? { component: t.component } : {}),
      ...(t.kind ? { kind: t.kind } : {}),
      changes: t.changes,
      ...(t.variables?.length ? { variables: t.variables } : {}),
      ...(t.components?.length ? { components: t.components } : {}),
      ...(t.notes?.trim() ? { notes: t.notes.trim() } : {}),
      ...(images.length ? { images } : {}),
      draft: t.draft,
      ...(t.lines?.length ? { lines: t.lines } : {}),
    });
  }
  return createPendingDrafts(client, composePendingDrafts({ items, sessionId, now: input.now }));
}

/** Deletes the session once it was sent or cancelled. Never throws: cleanup must not hide what was sent. */
export async function finishMyClaudeDrafts(client: ExchangeClient, sessionId: string): Promise<boolean> {
  try {
    return await deletePendingDrafts(client, sessionId);
  } catch {
    return false;
  }
}

export type DraftField = 'title' | 'summary';

/**
 * What to do with Claude's text: fill the fields the designer did not edit since the request, and offer the rest
 * ("Use Claude's draft") instead of overwriting what they typed.
 */
export function planFill(result: Pick<DraftResult, 'title' | 'summary'>, edited: Partial<Record<DraftField, boolean>>): { fill: Partial<DraftText>; offer: Partial<DraftText> } {
  const fill: Partial<DraftText> = {};
  const offer: Partial<DraftText> = {};
  for (const f of ['title', 'summary'] as const) {
    const v = result[f]?.trim();
    if (!v) continue;
    if (edited[f]) offer[f] = v;
    else fill[f] = v;
  }
  return { fill, offer };
}

export interface PollerOptions {
  client: Pick<GitHubClient, 'getFile'>;
  sessionId: string;
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
  /** Claude answered every item. Polling has stopped. */
  onResults: (results: DraftResult[], drafts: PendingDrafts) => void;
  /** No answer within the timeout. Polling has stopped; start() polls again. */
  onTimeout: () => void;
  /** The file is gone (sent or cancelled elsewhere). Polling has stopped. */
  onGone?: (() => void) | undefined;
  /** A read failed; polling goes on. */
  onError?: ((message: string) => void) | undefined;
}

/** Reads the session every 5 seconds until Claude answers, the file goes away, or 10 minutes pass. */
export class DraftPoller {
  private handle: unknown;
  private startedAt = 0;
  private running = false;
  private busy = false;

  constructor(private readonly o: PollerOptions) {}

  get active(): boolean {
    return this.running;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private schedule(): void {
    const set = this.o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.handle = set(() => void this.tick(), this.o.intervalMs ?? POLL_INTERVAL_MS);
  }

  /** Starts (or restarts, after a timeout) polling; the timeout counts from now. */
  start(): void {
    this.stop();
    this.running = true;
    this.startedAt = this.now();
    this.schedule();
  }

  stop(): void {
    if (this.handle !== undefined) (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.handle);
    this.handle = undefined;
    this.running = false;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    this.handle = undefined;
    const done = await this.check();
    if (done || !this.running) return;
    if (this.now() - this.startedAt >= (this.o.timeoutMs ?? POLL_TIMEOUT_MS)) {
      this.stop();
      this.o.onTimeout();
      return;
    }
    this.schedule();
  }

  /** Reads the file once. True when polling is over (answered or gone). */
  async check(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const cur = await readPendingDrafts(this.o.client, this.o.sessionId);
      if (!cur) {
        this.stop();
        this.o.onGone?.();
        return true;
      }
      if (cur.drafts.status === 'drafted' && cur.drafts.results?.length) {
        this.stop();
        this.o.onResults(cur.drafts.results, cur.drafts);
        return true;
      }
      return false;
    } catch (err) {
      this.o.onError?.(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this.busy = false;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Setup shown in Settings, "Claude (optional)"

/** Where the Bridge MCP server runs from until it is on npm: a clone of the Bridge repo, built once. */
/** The Bridge MCP server from npm: no clone, no build. */
export const MCP_PACKAGE = '@bridge-ds/mcp';

/** The Claude Desktop config and the Claude Code command for this repo. The token stays a placeholder: never copied. */
export function mcpSnippets(repo: string): { desktop: string; code: string } {
  const r = repo.trim() || 'owner/name';
  const desktop = JSON.stringify({ mcpServers: { bridge: { command: 'npx', args: ['-y', MCP_PACKAGE, '--repo', r], env: { GITHUB_TOKEN: 'your GitHub token' } } } }, null, 2);
  const code = `claude mcp add bridge -s user -e GITHUB_TOKEN=your-github-token -- npx -y ${MCP_PACKAGE} --repo ${r}`;
  return { desktop, code };
}

