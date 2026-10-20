// Component docs (docs.json) proposed as a reviewable change, shared by the Library edit mode in Bridge Studio, the MCP
// server and the CLI: what blocks a docs.json (validateDocs), the editor's cleaning, and one pull request per set of
// docs edits (Tier 1 under the shared classifier, a patch changeset). The GitHub writes use the core client.
import { formatDocsJson, missingProse, patchDocsJson, type ComponentDocsJson } from './docs-draft';
import type { GitHubClient } from './github-client';
import { classifyRisk, type RiskResult } from './risk';
import { branchWithJiraKey, titleWithJiraKey } from './jira';

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
  footer: 'Proposed with the Bridge docs editor by a person (no AI involved in this text unless the docs say "draftedBy").',
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

/** One pull request for the docs edits of a draft: branch, title, body, files with a patch changeset, the tier. */
export function docsProposal(
  edits: DocsFileEdit[],
  opts: { title?: string | undefined; notes?: string | undefined; date: Date; packageName?: string | undefined; changesetDir?: string | undefined; origin?: DocsOrigin | undefined },
): DocsProposal {
  const origin = opts.origin ?? DOCS_EDITOR_ORIGIN;
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
    `Usage guidance for ${list}, written ${origin.where}.`,
    '',
    ...rows,
    '',
    `**Risk:** ${risk.label}. Docs only: the published components do not change. Changeset: patch.`,
    '',
    opts.notes?.trim() ? `## Notes\n\n${opts.notes.trim()}\n` : '',
    '---',
    origin.footer,
  ]
    .filter((x, i, a) => !(x === '' && a[i - 1] === ''))
    .join('\n');
  return { branch, title, body, files, risk, bump: 'patch', labels: ['docs', origin.label, `tier-${risk.tier}`] };
}


/**
 * Opens one pull request with the docs edits from the default branch, the Jira key first in the title and the branch
 * name (Jira's GitHub integration links them). Returns its number, link and branch. Labels are best effort.
 */
export async function proposeDocsOnGitHub(
  gh: GitHubClient,
  edits: DocsFileEdit[],
  opts: { base: string; title?: string | undefined; notes?: string | undefined; jira?: string | null | undefined; date?: Date | undefined; origin?: DocsOrigin | undefined; extraLabels?: string[] | undefined; commitNote?: string | undefined },
): Promise<{ number: number; url: string; branch: string; title: string }> {
  const p = docsProposal(edits, { title: opts.title, notes: opts.notes, date: opts.date ?? new Date(), origin: opts.origin });
  const prTitle = titleWithJiraKey(p.title, opts.jira ?? null);
  const branch = branchWithJiraKey(p.branch, opts.jira ?? null);
  const mainSha = await gh.getBranchSha(opts.base);
  if (!mainSha) throw new Error(`Branch ${opts.base} not found.`);
  const tree = await gh.createTree(await gh.getCommitTree(mainSha), p.files.map((f) => ({ path: f.path, content: f.content })));
  const commit = await gh.createCommit(`${prTitle}\n\n${opts.commitNote ?? 'Proposed with the Bridge docs editor.'}`, tree, [mainSha]);
  await gh.createBranch(branch, commit);
  const pr = await gh.createPullRequest({ title: prTitle, head: branch, base: opts.base, body: p.body, draft: false });
  await gh.addLabels(pr.number, [...p.labels, ...(opts.extraLabels ?? [])]).catch(() => false);
  return { number: pr.number, url: pr.url, branch, title: prTitle };
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
