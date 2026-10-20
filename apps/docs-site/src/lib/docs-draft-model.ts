// Docs edits in the local draft, as pure functions. The Library page's edit mode (?edit=1) writes a
// component's docs.json into the same draft as token edits (localStorage bridge.draft.v1), as an edit of kind "docs".
// Proposing turns the docs edits into one pull request: Tier 1 under the shared classifier, a patch changeset.
import type { Draft, DraftEdit } from './editor-model';

export type DocsEdit = Extract<DraftEdit, { kind: 'docs' }>;

export const isDocsEdit = (e: DraftEdit): e is DocsEdit => e.kind === 'docs';
export const docsEdits = (d: Draft): DocsEdit[] => d.edits.filter(isDocsEdit);
export const tokenEdits = (d: Draft): DraftEdit[] => d.edits.filter((e) => !isDocsEdit(e));

/**
 * Puts a component's docs into the draft: replaces its earlier docs edit, and drops it when the text is back to the
 * original (nothing left to propose). Returns a new draft.
 */
export function setDocsEdit(draft: Draft, e: Omit<DocsEdit, 'kind' | 'id'> & { id?: string }): Draft {
  const rest = draft.edits.filter((x) => !(isDocsEdit(x) && x.path === e.path));
  if (e.before !== null && e.before === e.after) return { ...draft, edits: rest };
  const prev = draft.edits.find((x): x is DocsEdit => isDocsEdit(x) && x.path === e.path);
  return { ...draft, edits: [...rest, { kind: 'docs', id: e.id ?? prev?.id ?? Math.random().toString(36).slice(2, 10), path: e.path, component: e.component, slug: e.slug, before: e.before, after: e.after }] };
}

export const dropDocsEdits = (draft: Draft, paths?: string[]): Draft => ({ ...draft, edits: draft.edits.filter((e) => !isDocsEdit(e) || (paths && !paths.includes(e.path))) });

/** "2 token edits and 1 docs edit", for the Changes draft strip and the editor status. */
export function draftSummary(d: Draft): string {
  const t = tokenEdits(d).length;
  const docs = docsEdits(d).length;
  const parts = [t ? `${t} token ${t === 1 ? 'edit' : 'edits'}` : '', docs ? `${docs} docs ${docs === 1 ? 'edit' : 'edits'}` : ''].filter(Boolean);
  return parts.join(' and ') || 'no edits';
}

// Validation, cleaning and the proposal itself live in @bridge-ds/core (docs-proposal.ts), shared with the MCP server
// and the CLI, so docs saved from Claude pass the same rules as the Library editor.
export { cleanDocs, docsFileText, docsProposal, docsText, validateDocs, type DocsIssue, type DocsProposal } from '@bridge-ds/core';

/**
 * The docs side of a token change, for its pull request body: one changelog line per component that paints with a
 * changed token (the same line the docs pre-fill writes), so reviewers know which guidance pages to look at.
 */
export function docsNotesForTokens(paths: string[], usedBy: (path: string) => string[], max = 12): string {
  const byComponent = new Map<string, string[]>();
  for (const p of paths) for (const c of usedBy(p)) (byComponent.get(c) ?? byComponent.set(c, []).get(c)!).push(p);
  if (!byComponent.size) return '';
  const lines = [...byComponent.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([c, ps]) => `- ${c}: ${ps.length === 1 ? `token ${ps[0]} changed` : `${ps.length} tokens changed (${ps.slice(0, 3).join(', ')}${ps.length > 3 ? ', ...' : ''})`}.`);
  const more = lines.length > max ? [`- And ${lines.length - max} more components.`] : [];
  return ['## Docs to check', '', 'Components that paint with a changed token. Their guidance pages may need a new screenshot or a sentence.', '', ...lines.slice(0, max), ...more].join('\n');
}
