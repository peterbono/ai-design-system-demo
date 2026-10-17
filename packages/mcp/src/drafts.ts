// Draft exchange with the DS Bridge Figma plugin: the designer clicks "Draft with my Claude" in Figma, the plugin writes
// a pending drafts file on the requests branch, and the designer's own Claude (Claude Desktop or Claude Code, on their
// own plan) reads it here, looks at the before and after images and writes the texts back. The file format, the voice
// and the contract are @bridge-ds/core's (draft-exchange.ts); this file reads and writes them with the context's token.
// Bridge Studio writes "docs" items to the same branch (component docs from the Library page): their brief holds the
// whole prompt (facts from the code, voice, shapes) and the result carries the sections or the rewritten passage.
import {
  DRAFT_OUTPUT_CONTRACT,
  DRAFT_PHRASE,
  DRAFT_VOICE_RULES,
  REQUESTS_BRANCH,
  draftItemBrief,
  listPendingDrafts,
  readPendingDrafts,
  writeDraftResults,
  type DraftResultInput,
  type GitHubClient,
  type PendingDrafts,
} from '@bridge-ds/core';
import type { BridgeContext } from './context.js';

/** Images larger than this are linked, not inlined (bytes of PNG). */
export const IMAGE_INLINE_MAX = 750_000;
/** At most this many images inlined per call, so the answer stays small. */
export const IMAGES_PER_CALL = 8;

async function requireGitHub(ctx: BridgeContext): Promise<GitHubClient> {
  const gh = await ctx.github();
  if (!gh) throw new Error('No GitHub repo known: start the server with --repo owner/name (or set "repo" in bridge.config.json). Drafts from Figma live on the repo\'s bridge-requests branch.');
  // The requests branch is not an agent branch: drop the branch prefix, keep the protected-branch guard.
  return gh.withBranchPrefix(undefined);
}

export interface InlineImage {
  sessionId: string;
  itemId: string;
  label: 'before' | 'after';
  /** The change line this image shows (push items with several components). */
  line?: string | undefined;
  base64: string;
}

export interface PendingDraftsAnswer {
  repo: string;
  branch: string;
  phrase: string;
  sessions: (Pick<PendingDrafts, 'sessionId' | 'createdAt' | 'status' | 'items'> & { briefs: string[] })[];
  voice: string[];
  contract: string[];
  next: string;
}

/** Pending sessions (newest first) or one session, with a brief per item and the images to inline. */
export async function pendingDrafts(ctx: BridgeContext, a: { sessionId?: string | undefined; images?: boolean | undefined }): Promise<{ answer: PendingDraftsAnswer; images: InlineImage[] }> {
  const gh = await requireGitHub(ctx);
  let sessions: PendingDrafts[];
  if (a.sessionId) {
    const one = await readPendingDrafts(gh, a.sessionId);
    if (!one) throw new Error(`No drafts for session ${a.sessionId}: it was sent or cancelled in Figma. Call bridge_pending_drafts without a session id for the current ones.`);
    sessions = [one.drafts];
  } else {
    sessions = await listPendingDrafts(gh, { status: 'pending' });
  }
  const images: InlineImage[] = [];
  if (a.images !== false) {
    for (const s of sessions) {
      for (const item of s.items) {
        for (const img of item.images ?? []) {
          if (images.length >= IMAGES_PER_CALL || !img.path) continue;
          const f = await gh.getFileBase64(img.path, REQUESTS_BRANCH).catch(() => undefined);
          if (f && f.size <= IMAGE_INLINE_MAX) images.push({ sessionId: s.sessionId, itemId: item.id, label: img.label, ...(img.line ? { line: img.line } : {}), base64: f.base64 });
        }
      }
    }
  }
  const answer: PendingDraftsAnswer = {
    repo: gh.fullName,
    branch: REQUESTS_BRANCH,
    phrase: DRAFT_PHRASE,
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, createdAt: s.createdAt, status: s.status, items: s.items, briefs: s.items.map(draftItemBrief) })),
    voice: DRAFT_VOICE_RULES,
    contract: DRAFT_OUTPUT_CONTRACT,
    next: sessions.length
      ? sessions.some((s) => s.items.some((i) => i.scope === 'docs'))
        ? `For each change item write a title, a summary and one line per change line; for each docs item follow its brief and send "docs" (the sections it asks for) or "replacement" (a selected passage). Then call bridge_write_drafts with the sessionId and one result per item id. The designer reviews them in Figma or on the Library page.`
        : `Write a title and a summary for each item, and one line per change line it lists, then call bridge_write_drafts with the sessionId and one result per item id. The designer reviews them in Figma.`
      : `Nothing is waiting. In the DS Bridge Figma plugin, click "Draft with my Claude" on a request or on the Push description, or pick "My Claude" when drafting docs on a Library page, then say "${DRAFT_PHRASE}" again.`,
  };
  return { answer, images };
}

/** Writes Claude's texts into a session (sanitized, status "drafted" once every item has one), retrying on 409. */
export async function writeDrafts(ctx: BridgeContext, a: { sessionId: string; results: DraftResultInput[] }) {
  if (!a.results.length) throw new Error('Send at least one result: {"id", "title", "summary"} per change item, {"id", "docs"} or {"id", "replacement"} per docs item.');
  const gh = await requireGitHub(ctx);
  if (!ctx.canWriteRemote) throw new Error('Writing drafts needs GITHUB_TOKEN (contents: read and write on this repository), the same token as the Figma plugin. Without it Bridge is read-only.');
  const out = await writeDraftResults(gh, a.sessionId, a.results);
  const waiting = out.items.filter((i) => !(out.results ?? []).some((r) => r.id === i.id)).map((i) => i.id);
  return {
    sessionId: out.sessionId,
    status: out.status,
    results: out.results ?? [],
    ...(waiting.length ? { waiting } : {}),
    next: waiting.length
      ? `Still waiting for ${waiting.join(', ')}: call bridge_write_drafts again with those ids.`
      : out.source === 'studio'
        ? 'Done. The docs show up on the Library page within a few seconds, marked "Drafted by Claude". Tell the designer to review them there before proposing.'
        : 'Done. The text shows up in the Figma plugin within a few seconds, marked "Drafted by Claude, review before sending". Tell the designer to review it there.',
  };
}
