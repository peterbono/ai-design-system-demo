// Component change requests: a designer asks for a new component or a change to a coded one (variant, prop, structure,
// visual, token binding, bug) from Figma or Studio. Variable edits never become requests: they are pull requests
// people approve (tokens are data). Components need code, so they become requests. Code stays the source of truth, so a request never rewrites React: it lands as
// a GitHub issue that people (or Claude, through the MCP server or the CLI) implement in a pull request that closes it.
// Shared by the Figma plugin, Studio, the MCP server, the CLI and the Jira Action, so a request reads the same
// everywhere. The issue body is plain Markdown for people plus one hidden JSON block for tools.

import { EXPLORATION_LABEL, explorationRules } from './explorations';

export type RequestKind = 'new-component' | 'new-variant' | 'prop-change' | 'structure' | 'visual' | 'token-binding' | 'bug' | 'other';
export type RequestSource = 'figma' | 'studio' | 'cli' | 'mcp';
export type RequestStatus = 'requested' | 'in-progress' | 'done' | 'declined';

export const REQUEST_KINDS: { value: RequestKind; label: string; hint: string }[] = [
  { value: 'new-component', label: 'New component', hint: 'A component the design system does not have yet.' },
  { value: 'new-variant', label: 'New variant', hint: 'A size, tone or state the component does not have yet.' },
  { value: 'prop-change', label: 'Option change (prop)', hint: 'Add, rename or change an option (a prop in code) or its default.' },
  { value: 'structure', label: 'Structure change', hint: 'A part was added, removed or moved.' },
  { value: 'visual', label: 'Visual change', hint: 'Spacing, radius, layout or icon placement.' },
  { value: 'token-binding', label: 'Token change', hint: 'The component should paint with another token.' },
  { value: 'bug', label: 'Bug', hint: 'It looks or behaves differently from the guidance.' },
  { value: 'other', label: 'Other', hint: 'Anything else.' },
];

/** Every request issue carries this label; tools list requests by it. */
export const REQUEST_LABEL = 'component-change';

export interface RequestChange {
  /** What changes: a prop, a variant axis, a token, a part ("radius", "size", "color.action.primary.bg"). */
  field: string;
  before?: string | undefined;
  after?: string | undefined;
}

export interface ComponentChangeRequest {
  /** Component name as exported ("Button"), or the proposed name of a new component. */
  component: string;
  kind: RequestKind;
  /** One line, sentence case: "Add a danger ghost variant". */
  title: string;
  /** What and why, in the requester's words. */
  summary: string;
  /**
   * What changed for developers in one sentence ("Icon added after the label in primary sm: Pencil, 16px"): written
   * by Claude from the before and after images, or drafted from the detected changes. Optional.
   */
  line?: string | undefined;
  changes: RequestChange[];
  /** Where the design lives, when it comes from Figma. */
  figma?: { fileKey?: string | undefined; nodeId?: string | undefined; nodeName?: string | undefined; url?: string | undefined } | undefined;
  /** Image URLs (Figma exports committed to the requests branch, or links). */
  images?: string[] | undefined;
  source: RequestSource;
  /** GitHub login, when known. */
  requestedBy?: string | undefined;
  /**
   * Exploration branch (`explore/<slug>`) to implement it on instead of a pull request to main. The issue gets the
   * `exploration` label and the brief says to work on that branch (docs/EXPLORATIONS.md).
   */
  exploration?: string | undefined;
}

export interface RequestIssue {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
}

const MARK = 'bridge-request';
const kindLabel = (k: RequestKind) => REQUEST_KINDS.find((x) => x.value === k)?.label ?? 'Other';
const kindSlug = (k: RequestKind) => `request: ${k}`;

/** Issue title: "Button: add a danger ghost variant". */
export function requestIssueTitle(r: Pick<ComponentChangeRequest, 'component' | 'title'>): string {
  const t = r.title.trim().replace(/\.$/, '');
  return `${r.component}: ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

/** The GitHub issue for a request: readable Markdown, the labels tools filter on, and a hidden JSON block. */
export function composeRequestIssue(r: ComponentChangeRequest, opts: { labels?: string[]; assignees?: string[]; componentUrl?: string } = {}): RequestIssue {
  const rows = r.changes.length
    ? ['| What | Now | Requested |', '| --- | --- | --- |', ...r.changes.map((c) => `| ${cell(c.field)} | ${cell(c.before ?? '')} | ${cell(c.after ?? '')} |`)]
    : [];
  const figma = r.figma?.url ? `[${r.figma.nodeName ?? 'Open in Figma'}](${r.figma.url})` : r.figma?.nodeName ? r.figma.nodeName : '';
  const body = [
    r.kind === 'new-component' ? `## New component request: ${r.component}` : `## ${kindLabel(r.kind)} request for ${r.component}`,
    '',
    r.summary.trim(),
    '',
    ...(r.line?.trim() ? [`**What changes:** ${r.line.trim()}`, ''] : []),
    ...(rows.length ? [...rows, ''] : []),
    ...(r.images?.length ? [...r.images.map((u, i) => `![${r.component} design ${i + 1}](${u})`), ''] : []),
    ...(figma ? [`**Design:** ${figma}`, ''] : []),
    ...(opts.componentUrl ? [`**Component:** ${opts.componentUrl}`, ''] : []),
    ...(r.exploration ? [`**Exploration:** \`${r.exploration}\`. Implement it on that branch, not in a pull request to main: it ships to product staging as a snapshot and is promoted to review only when the idea is validated.`, ''] : []),
    '## How to implement',
    '',
    r.exploration
      ? `Commit the change to \`${r.exploration}\` (its draft pull request is the place). With Claude: \`bridge request implement <number>\` (CLI) or the \`bridge_get_request\` MCP tool. Promoting the exploration closes this request when it merges.`
      : `Code is the source of truth: change the component in a pull request that says \`Closes #<this issue>\`, so this request closes when it merges. With Claude: \`bridge request implement <number>\` (CLI) or the \`bridge_get_request\` MCP tool.`,
    '',
    `<sub>Requested from ${sourceLabel(r.source)}${r.requestedBy ? ` by @${r.requestedBy}` : ''} with Bridge.</sub>`,
    '',
    `<!-- ${MARK} ${JSON.stringify(r)} -->`,
  ].join('\n');
  const labels = [...new Set([REQUEST_LABEL, kindSlug(r.kind), `source: ${r.source}`, ...(r.exploration ? [EXPLORATION_LABEL] : []), ...(opts.labels ?? [])])];
  return { title: requestIssueTitle(r), body, labels, assignees: opts.assignees ?? [] };
}

/** The request inside an issue body, or undefined when the body has no valid Bridge block. */
export function parseRequestIssue(body: string | null | undefined): ComponentChangeRequest | undefined {
  if (!body) return undefined;
  const m = new RegExp(`<!-- ${MARK} (\\{[\\s\\S]*?\\}) -->`).exec(body);
  if (!m) return undefined;
  try {
    const r = JSON.parse(m[1]!) as ComponentChangeRequest;
    return r && typeof r.component === 'string' && typeof r.title === 'string' ? { ...r, changes: Array.isArray(r.changes) ? r.changes : [] } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The issue body with the request linked to an exploration branch: the hidden block gets `exploration` (what the
 * Explorations view, the MCP server and the CLI read) and the readable part says where to implement it. The rest of the
 * body stays as people wrote it. Undefined when the body has no Bridge block (nothing to link).
 */
export function withRequestExploration(body: string | null | undefined, branch: string): string | undefined {
  const r = parseRequestIssue(body);
  if (!r || !body) return undefined;
  const block = new RegExp(`<!-- ${MARK} \\{[\\s\\S]*?\\} -->`);
  let out = body.replace(block, () => `<!-- ${MARK} ${JSON.stringify({ ...r, exploration: branch })} -->`);
  const line = `**Exploration:** \`${branch}\`. Implement it on that branch, not in a pull request to main: it ships to product staging as a snapshot and is promoted to review only when the idea is validated.`;
  if (/^\*\*Exploration:\*\* .*$/m.test(out)) out = out.replace(/^\*\*Exploration:\*\* .*$/m, () => line);
  else if (out.includes('\n## How to implement')) out = out.replace('\n## How to implement', () => `\n${line}\n\n## How to implement`);
  else out = out.replace(block, (m) => `${line}\n\n${m}`);
  return out;
}

/** Problems with a decline reason, as sentences that say how to fix them. */
export function declineReasonProblems(reason: string): string[] {
  const r = reason.trim();
  if (!r) return ['Say why, in one or two sentences: the requester reads it.'];
  if (r.length < 10) return ['Say a bit more, so the requester knows why: at least 10 characters.'];
  return [];
}

/** The comment posted on a declined request: who declined it and why, in the decliner's words. */
export function declineComment(reason: string, by?: string | null): string {
  const quote = reason
    .trim()
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
  return [`Declined${by ? ` by @${by.replace(/^@/, '')}` : ''} in Bridge Studio.`, '', quote, '', '<sub>Closed as not planned. Reopen the issue if things change.</sub>'].join('\n');
}

/**
 * Where a request stands: open with no linked pull request = requested; open with an open linked pull request =
 * in progress; closed as completed or by a merged pull request = done; closed otherwise = declined.
 */
export function requestStatus(issue: { state: 'open' | 'closed'; stateReason?: string | null | undefined; linkedPrs?: { state: 'open' | 'closed'; merged?: boolean }[] }): RequestStatus {
  const prs = issue.linkedPrs ?? [];
  if (issue.state === 'open') return prs.some((p) => p.state === 'open') ? 'in-progress' : 'requested';
  if (prs.some((p) => p.merged) || issue.stateReason === 'completed') return 'done';
  return 'declined';
}

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { requested: 'Requested', 'in-progress': 'In progress', done: 'Done', declined: 'Declined' };

/** Issue numbers a pull request body closes ("Closes #42", "fixes #7", "resolves #3"). */
export function closingIssueNumbers(body: string | null | undefined): number[] {
  const out = new Set<number>();
  for (const m of (body ?? '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) out.add(Number(m[1]));
  return [...out];
}

/** Path of a Figma image attached to a request, on the requests branch. */
export const REQUESTS_BRANCH = 'bridge-requests';
export function requestImagePath(component: string, date: Date): string {
  const slug = component.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'component';
  return `.bridge/requests/${slug}-${date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}.png`;
}

/**
 * The brief Claude gets to implement a request (CLI `bridge request implement`, MCP `bridge_get_request`): the request,
 * the component's files, the repo rules, and how to open the pull request so it closes the issue.
 */
export function requestBrief(r: ComponentChangeRequest, ctx: { issue: number; issueUrl?: string; files?: string[]; agentsFile?: string; exploration?: string | undefined }): string {
  const exploration = ctx.exploration ?? r.exploration;
  return [
    `Implement Bridge component change request #${ctx.issue}${ctx.issueUrl ? ` (${ctx.issueUrl})` : ''}.`,
    '',
    `Component: ${r.component}`,
    `Kind: ${kindLabel(r.kind)}`,
    `Request: ${r.title}`,
    ...(r.line?.trim() ? [`What changes: ${r.line.trim()}`] : []),
    '',
    r.summary.trim(),
    '',
    ...(r.changes.length ? ['Changes asked:', ...r.changes.map((c) => `- ${c.field}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`), ''] : []),
    ...(r.figma?.url ? [`Design: ${r.figma.url}`, ''] : []),
    ...(r.images?.length ? ['Images:', ...r.images.map((u) => `- ${u}`), ''] : []),
    ...(ctx.files?.length ? ['Files of this component:', ...ctx.files.map((f) => `- ${f}`), ''] : []),
    'Rules:',
    `- Follow ${ctx.agentsFile ?? 'AGENTS.md'}: tokens only in component CSS, Base UI for behavior, states, tests, story, docs.json, changeset.`,
    '- A new component, prop or variant is Tier 2: open the pull request as a draft (new component: follow the new component checklist). A token add or rename is Tier 3: describe it, do not invent values.',
    ...(exploration
      ? [`- This request is part of the exploration ${exploration}.`, ...explorationRules(exploration), `- Reference the request in the commit message ("Refs #${ctx.issue}"). Promoting the exploration closes it.`]
      : [`- Work on a branch named agent/request-${ctx.issue}. The pull request body must contain "Closes #${ctx.issue}".`]),
    '- If the request is unclear or conflicts with the guidance, comment on the issue instead of guessing.',
  ].join('\n');
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const sourceLabel = (s: RequestSource) => (s === 'figma' ? 'Figma' : s === 'studio' ? 'Bridge Studio' : s === 'cli' ? 'the CLI' : 'Claude (MCP)');

// ---------------------------------------------------------------------------------------------
// Integrations (bridge.config.json "integrations"): where requests go besides the GitHub issue.

export interface JiraIntegration {
  /** Jira site, e.g. "https://acme.atlassian.net". The token lives in the repo secrets, never in config. */
  baseUrl: string;
  /** Project key, e.g. "DS". */
  project: string;
  /** Issue type, default "Task". */
  issueType?: string | undefined;
  labels?: string[] | undefined;
}

export interface IntegrationsConfig {
  requests?: { labels?: string[] | undefined; assignees?: string[] | undefined } | undefined;
  /** Mirror each request to Jira through the bridge-jira GitHub Action. */
  jira?: JiraIntegration | undefined;
}

/** Problems in an integrations block, as sentences that say how to fix them. Empty when valid. */
export function validateIntegrations(i: IntegrationsConfig | undefined): string[] {
  const out: string[] = [];
  if (!i?.jira) return out;
  if (!/^https:\/\/[^/]+/.test(i.jira.baseUrl ?? '')) out.push('Jira site must start with https://, for example https://acme.atlassian.net.');
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(i.jira.project ?? '')) out.push('Jira project key is 2 to 10 capital letters or digits, like DS.');
  return out;
}

/** The Jira issue fields the Action sends for a request (Jira Cloud REST v3, Atlassian document format). */
export function jiraIssueFields(r: ComponentChangeRequest, jira: JiraIntegration, issueUrl: string): Record<string, unknown> {
  const text = (t: string) => ({ type: 'text', text: t });
  const para = (...c: unknown[]) => ({ type: 'paragraph', content: c });
  return {
    project: { key: jira.project },
    issuetype: { name: jira.issueType ?? 'Task' },
    summary: requestIssueTitle(r),
    labels: [...new Set(['bridge', REQUEST_LABEL, ...(jira.labels ?? [])])].map((l) => l.replace(/\s+/g, '-')),
    description: {
      type: 'doc',
      version: 1,
      content: [
        para(text(r.summary.trim() || r.title)),
        ...(r.line?.trim() ? [para(text(r.line.trim()))] : []),
        ...r.changes.map((c) => para(text(`${c.field}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`))),
        para({ type: 'text', text: 'GitHub request', marks: [{ type: 'link', attrs: { href: issueUrl } }] }),
      ],
    },
  };
}
