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
  type DraftPollerOptions,
  type DraftScope,
  type DraftText,
  type DraftVariableRow,
  type GitHubClient,
  type PendingDrafts,
  type RequestChange,
  type RequestKind,
  DRAFT_POLL_INTERVAL_MS,
  DRAFT_POLL_TIMEOUT_MS,
  REQUESTS_BRANCH,
  composePendingDrafts,
  createPendingDrafts,
  deletePendingDrafts,
  draftImagePath,
  newDraftSessionId,
} from '@bridge-ds/core';
import { ensureRequestsBranch, requestImageUrl } from './requests';

export { DRAFT_PHRASE, DraftPoller } from '@bridge-ds/core';
export const POLL_INTERVAL_MS = DRAFT_POLL_INTERVAL_MS;
export const POLL_TIMEOUT_MS = DRAFT_POLL_TIMEOUT_MS;

export interface MyClaudeTarget {
  scope: Exclude<DraftScope, 'docs'>;
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

/** The poller lives in @bridge-ds/core (Bridge Studio polls docs drafts the same way). */
export type PollerOptions = DraftPollerOptions;

// ---------------------------------------------------------------------------------------------
// Setup shown in Settings, "Claude (optional)"

/** The Bridge MCP server from npm: no clone, no build. */
export const MCP_PACKAGE = '@bridge-ds/mcp';

/** What the setup shows in place of the token: the token itself is never rendered. */
export const TOKEN_PLACEHOLDER = 'your-github-token';

/**
 * The Claude Desktop config and the Claude Code command for this repo. On screen the token is a placeholder; the
 * copied text carries the token saved in Settings (`token`), so nobody has to find a token that is never shown again.
 */
export function mcpSnippets(repo: string, token?: string | undefined): { desktop: string; code: string } {
  const r = repo.trim() || 'owner/name';
  const t = token?.trim() || TOKEN_PLACEHOLDER;
  const desktop = JSON.stringify({ mcpServers: { bridge: { command: 'npx', args: ['-y', MCP_PACKAGE, '--repo', r], env: { GITHUB_TOKEN: t } } } }, null, 2);
  const code = `claude mcp add bridge -s user -e GITHUB_TOKEN=${t} -- npx -y ${MCP_PACKAGE} --repo ${r}`;
  return { desktop, code };
}

/** Said when the token cannot write contents: Claude's drafts go through a file in the repository. */
export const MY_CLAUDE_NEEDS_WRITE =
  'Drafting with your Claude plan needs "Contents" set to "Read and write" on your GitHub token: Claude reads and writes the drafts in a file of the repository. Edit the token on GitHub, then try again.';

/**
 * Checked before anything is written or waited for: can this token write to the repository? The message to show when
 * it cannot, undefined when it can or when GitHub does not say (the write then reports its own error at once).
 */
export async function myClaudeAccess(client: Pick<GitHubClient, 'getRepo'>): Promise<string | undefined> {
  const info = await client.getRepo().catch(() => undefined);
  return info?.permissions && info.permissions.push === false ? MY_CLAUDE_NEEDS_WRITE : undefined;
}

