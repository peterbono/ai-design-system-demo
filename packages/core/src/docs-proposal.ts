// Component docs (docs.json) proposed as a reviewable change, shared by the Library edit mode in Bridge Studio, the MCP
// server and the CLI: what blocks a docs.json (validateDocs), the editor's cleaning, and one pull request per set of
// docs edits (Tier 1 under the shared classifier, a patch changeset), at most one open per component (a new send
// continues the open one), and an author line that says who wrote the text. In suggest mode the same edits are filed
// as a suggestion (an issue with the cleaned docs, applied by a developer) instead. The GitHub writes use the core client.
import type { ChangesMode } from './config';
import { formatDocsJson, missingProse, patchDocsJson, type ComponentDocsJson } from './docs-draft';
import type { GitHubClient, PullRequestSummary } from './github-client';
import type { RequestSource } from './requests';
import { classifyRisk, type RiskResult } from './risk';
import { branchWithJiraKey, titleWithJiraKey } from './jira';
import { createSuggestionOnGitHub } from './suggestions-github';
import { gitBlobSha, SUGGESTION_SCHEMA, type SuggestionPayloadV1 } from './suggestions';

/** One component's docs.json, before (null: a new file) and after, at its repo path. */
export interface DocsFileEdit {
  path: string;
  component: string;
  slug: string;
  before: string | null;
  after: string;
}

/** Who wrote the docs, for the pull request body and its source label. */
export interface DocsOrigin {
  /** "in the Bridge docs editor". */
  where: string;
  footer: string;
  label: string;
}

export const DOCS_EDITOR_ORIGIN: DocsOrigin = {
  where: 'in the Bridge docs editor',
  footer: 'Written by a person in the Bridge docs editor. No AI involved in this text.',
  label: 'source: bridge-web',
};

export const DOCS_MCP_ORIGIN: DocsOrigin = {
  where: 'with Claude through the Bridge MCP server',
  footer: 'Proposed with the Bridge MCP server on behalf of a person. Docs Claude drafted say "draftedBy": "claude" until a reviewer accepts them.',
  label: 'source: mcp',
};

export interface DocsIssue {
  field: string;
  message: string;
}

const EM_DASH = /\u2014/;

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

/** The branch slug of a component's docs: "visually-hidden" for VisuallyHidden or visually-hidden, at most 40 characters. */
export const docsSlug = (nameOrSlug: string) =>
  nameOrSlug
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 40);

/* ------------------------------------------------------------------------------------------------------------------ */
/* Who wrote the text                                                                                                  */

/** Section names (as the editor shows them) by who wrote their text in this send. */
export interface DocsAuthorship {
  /** Drafted by Claude, kept as Claude wrote it after review. */
  claude: string[];
  /** Drafted by Claude, then edited by the person. */
  edited: string[];
  /** Written by the person, no Claude draft involved. */
  written: string[];
  /** Drafted by Claude, not reviewed yet (they go out marked for review). */
  pending: string[];
}

const listOf = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The author line of a docs proposal: "by a person, no AI" only when no Claude draft is in the text; "drafted by
 * Claude AI, reviewed and sent by @ana" when the person kept Claude's text as is; "drafted by Claude AI, edited by
 * @ana" with the edited sections when they changed parts of it.
 */
export function docsAuthorLine(a: DocsAuthorship, who: string | null | undefined, where = 'the Bridge docs editor'): string {
  const w = who?.trim() ? `@${who.trim().replace(/^@/, '')}` : 'a person';
  if (!a.claude.length && !a.edited.length && !a.pending.length) return `Written by ${w} in ${where}. No AI involved in this text.`;
  const head = a.edited.length
    ? `Drafted by Claude AI, edited by ${w} in ${where}.`
    : a.claude.length
      ? `Drafted by Claude AI, reviewed and sent by ${w} in ${where}.`
      : `Drafted by Claude AI, sent by ${w} in ${where} before review.`;
  const mixed = [a.edited, a.written, a.pending].some((x) => x.length);
  return [
    head,
    a.edited.length ? `Edited by ${w}: ${listOf(a.edited)}.` : '',
    a.claude.length && mixed ? `As Claude drafted them: ${listOf(a.claude)}.` : '',
    a.written.length ? `Written by ${w}: ${listOf(a.written)}.` : '',
    a.pending.length && (a.claude.length || a.edited.length || a.written.length) ? `Not reviewed yet: ${listOf(a.pending)}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Without an author line from the editor: the docs' own record ("draftedBy": "claude") decides, never "no AI" over it. */
export function defaultDocsFooter(edits: Pick<DocsFileEdit, 'after'>[], origin: DocsOrigin): string {
  if (origin.label !== DOCS_EDITOR_ORIGIN.label) return origin.footer;
  const claude = edits.some((e) => {
    try {
      return (JSON.parse(e.after) as ComponentDocsJson).draftedBy === 'claude';
    } catch {
      return false;
    }
  });
  return claude ? `Drafted by Claude AI (the docs say "draftedBy": "claude"), sent by a person ${origin.where}.` : origin.footer;
}

/** The body with its author line (the text after the last "---" line) replaced, or added when it has none. */
export function withAuthorLine(body: string, line: string): string {
  const i = body.lastIndexOf('\n---\n');
  return i < 0 ? `${body.trimEnd()}\n\n---\n${line}` : `${body.slice(0, i + 5)}${line}`;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* One open proposal per component                                                                                     */

/** The open docs proposal of a component: the one a new send continues instead of opening a second one. */
export interface OpenDocsProposal {
  number: number;
  url: string;
  branch: string;
  author: string;
  title: string;
  updatedAt: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `branch` is a docs proposal branch of this component: docs/<slug>-<yyyymmdd>-<id>, with an optional Jira
 * key before the slug (docs/DS-42-button-...). "button" does not match docs/button-group-... branches. Older MCP
 * branches used the lowercased name (docs/visuallyhidden-...): they match too.
 */
export function isDocsProposalBranch(branch: string, component: { name: string; slug?: string | undefined }): boolean {
  const slugs = new Set([docsSlug(component.slug ?? component.name), docsSlug(component.name), docsSlug(component.name.toLowerCase())]);
  return [...slugs].some((s) => new RegExp(`^docs/(?:[A-Z][A-Z0-9]*-\\d+-)?${escapeRe(s)}-\\d{8}-[a-z0-9]+$`).test(branch));
}

type PullLike = Pick<PullRequestSummary, 'number' | 'state' | 'headRef' | 'author' | 'title' | 'url' | 'updatedAt'> & { baseRef?: string | undefined };

/** The most recently updated open docs proposal of the component (into `base` when given), or null. */
export function findOpenDocsProposal(pulls: PullLike[], component: { name: string; slug?: string | undefined }, base?: string): OpenDocsProposal | null {
  const hit = pulls
    .filter((p) => p.state === 'open' && isDocsProposalBranch(p.headRef, component) && (!base || !p.baseRef || p.baseRef === base))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return hit ? { number: hit.number, url: hit.url, branch: hit.headRef, author: hit.author, title: hit.title, updatedAt: hit.updatedAt } : null;
}

/** Reads the open pull requests and returns the component's open docs proposal, or null. */
export async function findOpenDocsProposalOnGitHub(gh: GitHubClient, component: { name: string; slug?: string | undefined }, base?: string): Promise<OpenDocsProposal | null> {
  return findOpenDocsProposal(await gh.listPullRequests('open'), component, base);
}

/**
 * Adds a send to the open proposal: one commit with the docs.json on its branch (nothing when the text is the same),
 * and the author line of its description brought up to date. Returns the commit sha, or '' when nothing changed.
 */
export async function continueDocsProposalOnGitHub(
  gh: GitHubClient,
  open: Pick<OpenDocsProposal, 'number' | 'branch'>,
  edit: Pick<DocsFileEdit, 'path' | 'component' | 'after'>,
  opts: { authorLine?: string | undefined; message?: string | undefined } = {},
): Promise<string> {
  const message = opts.message ?? `docs(${docsSlug(edit.component)}): edit usage guidance in the Bridge docs editor`;
  const cur = await gh.getFile(edit.path, open.branch);
  if (cur?.text === edit.after) return '';
  const sha = await gh.putFile({ path: edit.path, content: edit.after, branch: open.branch, message, sha: cur?.sha });
  if (opts.authorLine) {
    const line = opts.authorLine;
    await gh
      .getPullRequest(open.number)
      .then((pr) => gh.updatePullRequest(open.number, { body: withAuthorLine(pr.body, line) }))
      .catch(() => undefined);
  }
  return sha;
}

/** One pull request for the docs edits of a draft: branch, title, body, files with a patch changeset, the tier. */
export function docsProposal(
  edits: DocsFileEdit[],
  opts: { title?: string | undefined; notes?: string | undefined; date: Date; packageName?: string | undefined; changesetDir?: string | undefined; origin?: DocsOrigin | undefined; authorLine?: string | undefined },
): DocsProposal {
  const origin = opts.origin ?? DOCS_EDITOR_ORIGIN;
  if (!edits.length) throw new Error('No docs edits in the draft.');
  const names = edits.map((e) => e.component);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const title = opts.title?.trim() || `docs(${names.length === 1 ? edits[0]!.slug : 'components'}): usage guidance for ${list}`;
  const slug = docsSlug(names.length === 1 ? edits[0]!.slug : `${edits[0]!.slug}-and-${names.length - 1}-more`);
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
    `Usage guidance for ${list}, written ${origin.where}.`,
    '',
    ...rows,
    '',
    `**Risk:** ${risk.label}. Docs only: the published components do not change. Changeset: patch.`,
    '',
    opts.notes?.trim() ? `## Notes\n\n${opts.notes.trim()}\n` : '',
    '---',
    opts.authorLine?.trim() || defaultDocsFooter(edits, origin),
  ]
    .filter((x, i, a) => !(x === '' && a[i - 1] === ''))
    .join('\n');
  return { branch, title, body, files, risk, bump: 'patch', labels: ['docs', origin.label, `tier-${risk.tier}`] };
}


export interface ProposeDocsOptions {
  base: string;
  title?: string | undefined;
  notes?: string | undefined;
  jira?: string | null | undefined;
  date?: Date | undefined;
  origin?: DocsOrigin | undefined;
  extraLabels?: string[] | undefined;
  commitNote?: string | undefined;
  /** Who wrote the text (docsAuthorLine). Without it, the origin's footer, never "no AI" over a Claude draft. */
  authorLine?: string | undefined;
  /** Default true: continue the component's open proposal. False always opens a new one. Direct mode only. */
  continueOpen?: boolean | undefined;
  /**
   * "direct" (default here, so existing callers keep their behaviour): a branch and a pull request. "suggest": a
   * suggestion issue with the cleaned docs, no branch. Callers pass changesMode(config).
   */
  mode?: ChangesMode | undefined;
  /** Suggest mode: where it was sent from (default from the origin: Studio, or MCP) and who sent it. */
  source?: RequestSource | undefined;
  suggestedBy?: string | undefined;
  /** Suggest mode: commit sha of `base`, when the caller already read it. */
  baseSha?: string | undefined;
}

export interface ProposedDocs {
  status: 'opened' | 'continued';
  number: number;
  url: string;
  branch: string;
  title: string;
  continued: boolean;
  unchanged: boolean;
}

export interface SuggestedDocs {
  status: 'suggested';
  /** The suggestion issue. */
  number: number;
  url: string;
  title: string;
  /** sha256 of the payload: what approvals bind to. */
  sha: string;
  warnings: string[];
}

/** The source a docs origin stands for, as suggestions name it. */
const docsSource = (origin: DocsOrigin): RequestSource => (origin.label === DOCS_MCP_ORIGIN.label ? 'mcp' : 'studio');

/**
 * The suggestion payload (bridge.suggestion/1, kind docs) of a set of docs edits: the cleaned docs object of each
 * component (re-written at apply time as a minimal diff of the current file) and the patch changeset. Pure.
 */
export function docsSuggestionPayload(
  edits: DocsFileEdit[],
  opts: {
    base: { ref: string; sha: string };
    title?: string | undefined;
    notes?: string | undefined;
    date?: Date | undefined;
    origin?: DocsOrigin | undefined;
    source?: RequestSource | undefined;
    suggestedBy?: string | undefined;
    packageName?: string | undefined;
    changesetDir?: string | undefined;
  },
): SuggestionPayloadV1 {
  const origin = opts.origin ?? DOCS_EDITOR_ORIGIN;
  const date = opts.date ?? new Date();
  const p = docsProposal(edits, { title: opts.title, date, origin, packageName: opts.packageName, changesetDir: opts.changesetDir });
  const names = edits.map((e) => e.component);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const docs = edits.map((e) => {
    let after: ComponentDocsJson;
    try {
      after = JSON.parse(e.after) as ComponentDocsJson;
    } catch {
      throw new Error(`${e.path} is not valid JSON: fix it before sending.`);
    }
    return { component: e.component, path: e.path, after: cleanDocs(after) };
  });
  const docPaths = new Set(edits.map((e) => e.path));
  const files = p.files.filter((f) => !docPaths.has(f.path)).map((f) => ({ path: f.path, beforeSha: null, afterSha: gitBlobSha(f.content), content: f.content }));
  const by = opts.suggestedBy?.replace(/^@/, '');
  return {
    schema: SUGGESTION_SCHEMA,
    kind: 'docs',
    title: opts.title?.trim() || (names.length === 1 ? 'Usage guidance' : `Usage guidance for ${list}`),
    summary: [`Usage guidance for ${list}, written ${origin.where}.`, opts.notes?.trim() ?? ''].filter(Boolean).join('\n\n'),
    source: opts.source ?? docsSource(origin),
    ...(by ? { suggestedBy: by } : {}),
    createdAt: date.toISOString(),
    base: opts.base,
    tier: { tier: p.risk.tier, bump: 'patch' },
    docs,
    files,
    checks: { newErrors: 0, contrast: [], blocked: null, impact: 0 },
  };
}

/**
 * Files docs edits as a suggestion (suggest mode): one issue with the cleaned docs of each component and the patch
 * changeset, the author line in its description, labelled docs. Needs Issues write only.
 */
async function suggestDocsOnGitHub(gh: GitHubClient, edits: DocsFileEdit[], opts: ProposeDocsOptions): Promise<SuggestedDocs> {
  if (!edits.length) throw new Error('No docs edits in the draft.');
  const sha = opts.baseSha ?? (await gh.getBranchSha(opts.base));
  if (!sha) throw new Error(`Branch ${opts.base} not found.`);
  const origin = opts.origin ?? DOCS_EDITOR_ORIGIN;
  const payload = docsSuggestionPayload(edits, { base: { ref: opts.base, sha }, title: opts.title, notes: opts.notes, date: opts.date, origin, source: opts.source, suggestedBy: opts.suggestedBy });
  const p = docsProposal(edits, { date: opts.date ?? new Date(), origin });
  const rows = p.body.split('\n').filter((l) => l.startsWith('- `'));
  const details = [...rows, '', opts.authorLine?.trim() || defaultDocsFooter(edits, origin)].join('\n');
  const created = await createSuggestionOnGitHub(gh, payload, { labels: ['docs', ...(opts.extraLabels ?? [])], details });
  return { status: 'suggested', number: created.number, url: created.url, title: payload.title, sha: created.sha, warnings: created.warnings };
}

/**
 * Opens one pull request with the docs edits from the default branch, the Jira key first in the title and the branch
 * name (Jira's GitHub integration links them). Returns its number, link and branch. Labels are best effort.
 * One open proposal per component: when the component already has one, the edit goes there as a new commit
 * (`continued`; `unchanged` when it already says this) instead of a second pull request.
 * In suggest mode (`mode: 'suggest'`) it files a suggestion instead: no branch, no pull request (`status: 'suggested'`).
 */
export function proposeDocsOnGitHub(gh: GitHubClient, edits: DocsFileEdit[], opts: ProposeDocsOptions & { mode?: 'direct' | undefined }): Promise<ProposedDocs>;
export function proposeDocsOnGitHub(gh: GitHubClient, edits: DocsFileEdit[], opts: ProposeDocsOptions): Promise<ProposedDocs | SuggestedDocs>;
export async function proposeDocsOnGitHub(gh: GitHubClient, edits: DocsFileEdit[], opts: ProposeDocsOptions): Promise<ProposedDocs | SuggestedDocs> {
  if (opts.mode === 'suggest') return suggestDocsOnGitHub(gh, edits, opts);
  if (opts.continueOpen !== false && edits.length === 1) {
    const e = edits[0]!;
    // A failed read does not block the send: it opens a new proposal, as before.
    const open = await findOpenDocsProposalOnGitHub(gh, { name: e.component, slug: e.slug }, opts.base).catch(() => null);
    if (open) {
      const sha = await continueDocsProposalOnGitHub(gh, open, e, { authorLine: opts.authorLine?.trim() || defaultDocsFooter(edits, opts.origin ?? DOCS_EDITOR_ORIGIN) });
      return { status: 'continued', number: open.number, url: open.url, branch: open.branch, title: open.title, continued: true, unchanged: !sha };
    }
  }
  const p = docsProposal(edits, { title: opts.title, notes: opts.notes, date: opts.date ?? new Date(), origin: opts.origin, authorLine: opts.authorLine });
  const prTitle = titleWithJiraKey(p.title, opts.jira ?? null);
  const branch = branchWithJiraKey(p.branch, opts.jira ?? null);
  const mainSha = await gh.getBranchSha(opts.base);
  if (!mainSha) throw new Error(`Branch ${opts.base} not found.`);
  const tree = await gh.createTree(await gh.getCommitTree(mainSha), p.files.map((f) => ({ path: f.path, content: f.content })));
  const commit = await gh.createCommit(`${prTitle}\n\n${opts.commitNote ?? 'Proposed with the Bridge docs editor.'}`, tree, [mainSha]);
  await gh.createBranch(branch, commit);
  const pr = await gh.createPullRequest({ title: prTitle, head: branch, base: opts.base, body: p.body, draft: false });
  await gh.addLabels(pr.number, [...p.labels, ...(opts.extraLabels ?? [])]).catch(() => false);
  return { status: 'opened', number: pr.number, url: pr.url, branch, title: prTitle, continued: false, unchanged: false };
}

/**
 * Rewrites one file on an open branch in one commit (`next` gets the current text). Returns the commit sha, or ''
 * when nothing changed. The Library editor saves an edited docs.json and accepts a Claude draft this way.
 */
export async function commitFileOnGitHub(gh: GitHubClient, input: { path: string; branch: string; message: string; next: (text: string) => string }): Promise<string> {
  const cur = await gh.getFile(input.path, input.branch);
  if (!cur) throw new Error(`${input.path} is not on ${input.branch}. Check the component name and the branch.`);
  const content = input.next(cur.text);
  if (content === cur.text) return '';
  return gh.putFile({ path: input.path, content, branch: input.branch, message: input.message, sha: cur.sha });
}
