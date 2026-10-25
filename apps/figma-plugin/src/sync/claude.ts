// What a draft by Claude is made of, for "Draft with my Claude" (sync/my-claude.ts): the designer's own Claude app,
// with Bridge as a connector. Bridge never calls Anthropic and holds no API key: there is no other way to draft.

import type { DraftLine, DraftResultLine, RequestChange, RequestKind } from '@bridge-ds/core';

/** Shown under a field Claude filled, until the designer edits it. */
export const DRAFTED_NOTE = 'Drafted by Claude, review before sending';

export interface ClaudeDraftInput {
  /** "request": one component change request. "push": the Push description (pull request and requests). */
  target: 'request' | 'push';
  component?: string | undefined;
  kind?: RequestKind | undefined;
  changes: RequestChange[];
  /** Components the push also sends requests for. */
  components?: string[] | undefined;
  /** The deterministic draft, as a starting point. */
  draft?: { title: string; summary: string } | undefined;
  /** What the designer already typed: their intent, kept in the answer. */
  notes?: string | undefined;
  /** PNG base64 (no data: prefix): the component at its baseline and now. Skipped when missing. */
  before?: string | undefined;
  after?: string | undefined;
  /** Component changes to write one line each for (by id), with the deterministic line as a starting point. */
  lines?: DraftLine[] | undefined;
  /** Push: before and after images per change line, when the item has several components. */
  lineImages?: { id: string; before?: string | undefined; after?: string | undefined }[] | undefined;
}

export interface ClaudeDraft {
  title: string;
  summary: string;
  /** One sentence per change line (by DraftLine id), with its request title. Missing or empty when Claude wrote none. */
  lines?: DraftResultLine[] | undefined;
}
