// Docs edits in the local draft, as pure functions. The Library page's edit mode (?edit=1) writes a
// component's docs.json into the same draft as token edits (localStorage bridge.draft.v1), as an edit of kind "docs".
// Proposing turns the docs edits into one pull request: Tier 1 under the shared classifier, a patch changeset.
import { classifyRisk, formatDocsJson, missingProse, patchDocsJson, type ComponentDocsJson, type RiskResult } from '@bridge-ds/core';
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

export interface DocsIssue {
  field: string;
  message: string;
}

const EM_DASH = /—/;

/** What blocks proposing a docs.json: a summary, no empty list items, no em dash (Bridge voice). */
export function validateDocs(d: ComponentDocsJson): DocsIssue[] {
  const out: DocsIssue[] = [];
  if (!d.summary.trim()) out.push({ field: 'summary', message: 'Add a summary: one or two sentences on what it is for.' });
  const lists = ['whenToUse', 'whenNotToUse', 'accessibility', 'contentGuidelines'] as const;
  for (const k of lists) (d[k] ?? []).forEach((x, i) => !x.trim() && out.push({ field: `${k}.${i}`, message: 'Fill or remove the empty item.' }));
  for (const k of ['dos', 'donts'] as const) d[k].forEach((g, i) => (!g.title.trim() || !g.text.trim()) && out.push({ field: `${k}.${i}`, message: 'Give every item a title and a sentence.' }));
  const prose = JSON.stringify([d.summary, d.whenToUse, d.whenNotToUse, d.dos, d.donts, d.accessibility, d.contentGuidelines ?? [], d.anatomy ?? {}]);
  if (EM_DASH.test(prose)) out.push({ field: 'voice', message: 'Replace the em dashes with a colon, a comma or two sentences.' });
  return out;
}

/** Drops empty list items and trims text, the way the editor saves. */
export function cleanDocs(d: ComponentDocsJson): ComponentDocsJson {
  const list = (xs: string[] | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean);
  const guide = (xs: ComponentDocsJson['dos']) => xs.map((g) => ({ ...g, title: g.title.trim(), text: g.text.trim() })).filter((g) => g.title || g.text);
  return {
    ...d,
    summary: d.summary.trim(),
    whenToUse: list(d.whenToUse),
    whenNotToUse: list(d.whenNotToUse),
    dos: guide(d.dos),
    donts: guide(d.donts),
    accessibility: list(d.accessibility),
    contentGuidelines: list(d.contentGuidelines),
    anatomy: Object.fromEntries(Object.entries(d.anatomy ?? {}).filter(([k, v]) => k.trim() && v.trim())),
  };
}

/** docs.json in the editor's canonical form: cleaned, in the Button.docs.json key order. Used to compare. */
export const docsText = (d: ComponentDocsJson) => formatDocsJson(cleanDocs(d));

/** docs.json text the editor writes: cleaned, as a minimal diff of the file on main (or the branch) when there is one. */
export const docsFileText = (d: ComponentDocsJson, original: string | null) => patchDocsJson(original, cleanDocs(d));

export interface DocsProposal {
  branch: string;
  title: string;
  body: string;
  files: { path: string; content: string }[];
  risk: RiskResult;
  bump: 'patch';
  labels: string[];
}

const slugDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** One pull request for the docs edits of a draft: branch, title, body, files with a patch changeset, the tier. */
export function docsProposal(edits: DocsEdit[], opts: { title?: string; notes?: string; date: Date; packageName?: string; changesetDir?: string }): DocsProposal {
  if (!edits.length) throw new Error('No docs edits in the draft.');
  const names = edits.map((e) => e.component);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const title = opts.title?.trim() || `docs(${names.length === 1 ? edits[0]!.slug : 'components'}): usage guidance for ${list}`;
  const slug = `${names.length === 1 ? edits[0]!.slug : `${edits[0]!.slug}-and-${names.length - 1}-more`}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40);
  const branch = `docs/${slug}-${slugDate(opts.date)}-${opts.date.getTime().toString(36).slice(-4)}`;
  const csPath = `${opts.changesetDir ?? '.changeset'}/docs-${slug}-${opts.date.getTime().toString(36)}.md`;
  const pkg = opts.packageName ?? '@bridge-ds/react';
  const changeset = `---\n"${pkg}": patch\n---\n\nUsage guidance for ${list}.\n`;
  const files = [...edits.map((e) => ({ path: e.path, content: e.after })), { path: csPath, content: changeset }];
  const risk = classifyRisk({ files: files.map((f) => ({ path: f.path, status: 'modified' })) });
  const rows = edits.map((e) => {
    let state = 'edited';
    try {
      const d = JSON.parse(e.after) as ComponentDocsJson;
      const gaps = missingProse(d);
      state = gaps.length ? `still missing: ${gaps.join(', ')}` : 'every section filled';
    } catch {
      state = 'not valid JSON';
    }
    return `- \`${e.path}\` (${e.before === null ? 'new' : 'changed'}, ${state})`;
  });
  const body = [
    `## Docs change`,
    '',
    `Usage guidance for ${list}, written in the Bridge docs editor.`,
    '',
    ...rows,
    '',
    `**Risk:** ${risk.label}. Docs only: the published components do not change. Changeset: patch.`,
    '',
    opts.notes?.trim() ? `## Notes\n\n${opts.notes.trim()}\n` : '',
    '---',
    'Proposed with the Bridge docs editor by a person (no AI involved in this text unless the docs say "draftedBy").',
  ]
    .filter((x, i, a) => !(x === '' && a[i - 1] === ''))
    .join('\n');
  return { branch, title, body, files, risk, bump: 'patch', labels: ['docs', 'source: bridge-web', `tier-${risk.tier}`] };
}

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
