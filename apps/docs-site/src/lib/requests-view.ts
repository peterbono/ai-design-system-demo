// Studio Changes > Requests, the Components "Request a change" form, the Settings Integrations card and the Overview
// line: the pure rules behind component change requests. No DOM, no fetch: unit tested in requests-view.test.ts.
//
// Variables are pull requests people approve. Components need code, so a component change is a request: a GitHub
// issue labeled component-change (packages/core/src/requests.ts) that a pull request closes ("Closes #n").
// Color only says status: requested waits (violet), done is green, in progress and declined stay grey.
import {
  closingIssueNumbers,
  fromPlain,
  getEntry,
  parseJson,
  parseRequestIssue,
  REQUEST_KINDS,
  REQUEST_LABEL,
  REQUEST_STATUS_LABEL,
  requestStatus,
  serializeJson,
  validateIntegrations,
  type ComponentChangeRequest,
  type IntegrationsConfig,
  type JiraIntegration,
  type JsonObject,
  type RequestChange,
  type RequestKind,
  type RequestStatus,
} from '@bridge-ds/core';
import { GROUP_TONE, type StatusGroup } from './changes';

/** The fields of a GitHub issue the Requests view reads (REST list or get). */
export interface IssueLike {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: 'open' | 'closed' | string;
  state_reason?: string | null;
  labels: ({ name?: string } | string)[];
  user?: { login: string } | null;
  /** Who picked the request up on GitHub, when someone is assigned. */
  assignees?: { login: string }[] | null;
  created_at: string;
  updated_at?: string;
  pull_request?: unknown;
}

/** The fields of a pull request used to link it to the requests it closes. */
export interface PullLike {
  number: number;
  body?: string | null;
  state: 'open' | 'closed' | string;
  merged_at?: string | null;
  html_url: string;
  title?: string;
  user?: { login: string } | null;
}

export interface LinkedPull {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  /** Who wrote the change that closes the request. */
  author: string | null;
}

export interface RequestRow {
  number: number;
  url: string;
  component: string;
  kind: RequestKind | null;
  kindLabel: string;
  /** The request's own title ("Add a danger ghost variant"), or the issue title when the body has no Bridge block. */
  title: string;
  status: RequestStatus;
  statusLabel: string;
  /** Pill class: requested violet, done green, the rest grey. */
  tone: string;
  requester: string;
  /** GitHub logins assigned to the issue. */
  assignees: string[];
  createdAt: string;
  prs: LinkedPull[];
  /** Jira issue key, from the `jira: KEY-12` label the Jira Action adds. */
  jiraKey: string | null;
  /** The parsed request, when the issue body carries one. */
  request: ComponentChangeRequest | null;
}

const labelName = (l: { name?: string } | string) => (typeof l === 'string' ? l : (l.name ?? ''));

/** Jira key from the issue labels: "jira: DS-12" gives "DS-12". */
export function jiraKeyFrom(labels: IssueLike['labels']): string | null {
  for (const l of labels) {
    const m = /^jira:\s*([A-Z][A-Z0-9_]+-\d+)$/i.exec(labelName(l).trim());
    if (m) return m[1]!.toUpperCase();
  }
  return null;
}

/** Issue number -> pull requests whose body closes it ("Closes #12"). Scans PR bodies already fetched: no request. */
export function linkPulls(pulls: PullLike[]): Map<number, LinkedPull[]> {
  const out = new Map<number, LinkedPull[]>();
  const seen = new Set<number>();
  for (const p of pulls) {
    if (seen.has(p.number)) continue;
    seen.add(p.number);
    for (const n of closingIssueNumbers(p.body)) {
      const list = out.get(n) ?? [];
      list.push({ number: p.number, url: p.html_url, state: p.state === 'open' ? 'open' : 'closed', merged: Boolean(p.merged_at), author: p.user?.login ?? null });
      out.set(n, list);
    }
  }
  return out;
}

const KIND_LABEL = new Map(REQUEST_KINDS.map((k) => [k.value, k.label]));
const kindFromLabels = (labels: IssueLike['labels']): RequestKind | null => {
  for (const l of labels) {
    const m = /^request:\s*(.+)$/.exec(labelName(l));
    if (m && KIND_LABEL.has(m[1] as RequestKind)) return m[1] as RequestKind;
  }
  return null;
};

export const REQUEST_GROUP: Record<RequestStatus, StatusGroup> = { requested: 'waiting', 'in-progress': 'neutral', done: 'ready', declined: 'neutral' };
export const requestTone = (s: RequestStatus) => GROUP_TONE[REQUEST_GROUP[s]];

/** True for an issue labeled component-change (and not a pull request). */
export const isRequestIssue = (i: IssueLike) => !i.pull_request && i.labels.some((l) => labelName(l) === REQUEST_LABEL);

/** One row of the Requests list. */
export function requestRow(issue: IssueLike, linked: Map<number, LinkedPull[]>): RequestRow {
  const request = parseRequestIssue(issue.body) ?? null;
  const prs = linked.get(issue.number) ?? [];
  const status = requestStatus({ state: issue.state === 'open' ? 'open' : 'closed', stateReason: issue.state_reason, linkedPrs: prs });
  const kind = request?.kind ?? kindFromLabels(issue.labels);
  // Without a Bridge block the issue title "Button: add a variant" still names the component.
  const split = /^([^:]{1,60}):\s*(.+)$/.exec(issue.title);
  const component = request?.component ?? split?.[1]?.trim() ?? 'Component';
  const title = request?.title ?? (split ? split[2]! : issue.title);
  return {
    number: issue.number,
    url: issue.html_url,
    component,
    kind,
    kindLabel: kind ? (KIND_LABEL.get(kind) ?? 'Other') : 'Other',
    title,
    status,
    statusLabel: REQUEST_STATUS_LABEL[status],
    tone: requestTone(status),
    requester: request?.requestedBy ?? issue.user?.login ?? '',
    assignees: (issue.assignees ?? []).map((a) => a.login).filter(Boolean),
    createdAt: issue.created_at,
    prs,
    jiraKey: jiraKeyFrom(issue.labels),
    request,
  };
}

const ORDER: Record<RequestStatus, number> = { requested: 0, 'in-progress': 1, done: 2, declined: 3 };

/** Rows for the list: waiting first, then in progress, done, declined; newest first inside each. */
export function requestRows(issues: IssueLike[], pulls: PullLike[]): RequestRow[] {
  const linked = linkPulls(pulls);
  return issues
    .filter(isRequestIssue)
    .map((i) => requestRow(i, linked))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
}

export interface RequestCounts {
  requested: number;
  inProgress: number;
  done: number;
  declined: number;
}

export function countRequests(rows: Pick<RequestRow, 'status'>[]): RequestCounts {
  return {
    requested: rows.filter((r) => r.status === 'requested').length,
    inProgress: rows.filter((r) => r.status === 'in-progress').length,
    done: rows.filter((r) => r.status === 'done').length,
    declined: rows.filter((r) => r.status === 'declined').length,
  };
}

/** "3 requests waiting, 1 in progress." Summary first: open work only; closed ones are counted after. */
export function requestsSummary(rows: Pick<RequestRow, 'status'>[]): string {
  const c = countRequests(rows);
  if (!rows.length) return 'No component change request yet.';
  const open = [c.requested ? `${c.requested} ${c.requested === 1 ? 'request' : 'requests'} waiting` : '', c.inProgress ? `${c.inProgress} in progress` : ''].filter(Boolean);
  const closed = c.done + c.declined;
  if (!open.length) return `Nothing waits. ${closed} ${closed === 1 ? 'request is' : 'requests are'} done or declined.`;
  const first = open.join(', ');
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}.`;
}

/** The Overview line, or null when no request waits: "2 component requests waiting". */
export function overviewRequestsLine(rows: Pick<RequestRow, 'status'>[]): string | null {
  const n = countRequests(rows).requested;
  return n ? `${n} component ${n === 1 ? 'request' : 'requests'} waiting` : null;
}

/**
 * Who is on a request: the issue assignee, else the author of the change that closes it (open first, then merged),
 * else nobody yet. Read from GitHub only, never guessed.
 */
export function requestOwner(r: Pick<RequestRow, 'assignees' | 'prs'>): string | null {
  const pr = r.prs.find((p) => p.state === 'open' && p.author) ?? r.prs.find((p) => p.merged && p.author);
  return r.assignees[0] ?? pr?.author ?? null;
}

/** The "who is on it" words of a row: "@ana is on it", "Not started", "Done by @ana"; empty when declined (the pill says it). */
export function onItLabel(r: Pick<RequestRow, 'status' | 'assignees' | 'prs'>): string {
  const who = requestOwner(r);
  if (r.status === 'done') return who ? `Done by @${who}` : 'Done';
  if (r.status === 'declined') return '';
  return who ? `@${who} is on it` : 'Not started';
}

/** The one-sentence status of a request detail, in a designer's words. */
export function requestStateLine(r: Pick<RequestRow, 'status' | 'assignees' | 'prs'>): string {
  const who = requestOwner(r);
  if (r.status === 'done') return who ? `Done by @${who}.` : 'Done.';
  if (r.status === 'declined') return 'Declined: closed on GitHub without a change.';
  if (who) return `In progress by @${who}.`;
  return 'Waiting for a developer to pick it up.';
}

/** Where the change that builds a request stands, for its section header: "Not started", "In review", "Shipped". */
export function buildState(r: Pick<RequestRow, 'prs'>): string {
  if (r.prs.some((p) => p.state === 'open')) return 'In review';
  if (r.prs.some((p) => p.merged)) return 'Shipped';
  return r.prs.length ? 'Closed' : 'Not started';
}

/**
 * The pictures of a request. Requests sent from Figma carry the baseline first, then the frame now in Figma: with two
 * images they read as a before and after pair. One image is shown on its own. `thumb` is the first image, for the row.
 */
export function requestImages(r: Pick<RequestRow, 'request'>): { pair: { before: string; after: string } | null; single: string[]; thumb: string | null } {
  const images = (r.request?.images ?? []).filter((u) => /^https:\/\//.test(u));
  if (images.length === 2) return { pair: { before: images[0]!, after: images[1]! }, single: [], thumb: images[0]! };
  return { pair: null, single: images, thumb: images[0] ?? null };
}

/** What Claude runs to implement a request. */
export const implementCommand = (n: number) => `bridge request implement ${n}`;

// ---------------------------------------------------------------------------------------------------------------
// Session cache: the request list for 10 minutes, so switching views or pages does not spend anonymous reads.

export const REQUESTS_TTL_MS = 10 * 60 * 1000;
export const requestsCacheKey = (repo: string, what: 'issues' | 'closed-pulls') => `bridge.requests:${repo}:${what}`;

export interface CachedList<T> {
  at: number;
  data: T[];
}

export function freshList<T>(entry: CachedList<T> | null | undefined, now: number, ttl = REQUESTS_TTL_MS): entry is CachedList<T> {
  return Boolean(entry && Array.isArray(entry.data) && now - entry.at >= 0 && now - entry.at < ttl);
}

// ---------------------------------------------------------------------------------------------------------------
// Request a change (Studio Components drawer)

export interface RequestForm {
  kind: string;
  title: string;
  summary: string;
  changes: { field: string; before: string; after: string }[];
}

/** Problems that block the submit, as sentences that say how to fix them. */
export function requestFormProblems(f: RequestForm): string[] {
  const out: string[] = [];
  if (!REQUEST_KINDS.some((k) => k.value === f.kind)) out.push('Pick what kind of change you need.');
  if (!f.title.trim()) out.push('Add a title, for example "Add a danger ghost variant".');
  if (!f.summary.trim()) out.push('Say what should change and why.');
  return out;
}

/** The request the form describes. Empty change rows are dropped; empty cells become undefined. */
export function requestFromForm(component: string, f: RequestForm, requestedBy?: string): ComponentChangeRequest {
  const changes: RequestChange[] = f.changes
    .filter((c) => c.field.trim())
    .map((c) => ({ field: c.field.trim(), before: c.before.trim() || undefined, after: c.after.trim() || undefined }));
  return { component, kind: f.kind as RequestKind, title: f.title.trim(), summary: f.summary.trim(), changes, source: 'studio', ...(requestedBy ? { requestedBy } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Settings > Integrations

/** "a, b , c" -> ["a", "b", "c"]; "@florian" -> "florian" for assignees. */
export function parseList(s: string, opts: { logins?: boolean } = {}): string[] {
  return [
    ...new Set(
      s
        .split(/[,\n]/)
        .map((x) => x.trim())
        .map((x) => (opts.logins ? x.replace(/^@/, '') : x))
        .filter(Boolean),
    ),
  ];
}

export interface IntegrationsForm {
  baseUrl: string;
  project: string;
  issueType: string;
  jiraLabels: string;
  requestLabels: string;
  assignees: string;
}

/** The integrations block a form describes. Jira is left out when both its site and key are empty. */
export function integrationsFromForm(f: IntegrationsForm): IntegrationsConfig {
  const out: IntegrationsConfig = {};
  const labels = parseList(f.requestLabels);
  const assignees = parseList(f.assignees, { logins: true });
  if (labels.length || assignees.length) out.requests = { ...(labels.length ? { labels } : {}), ...(assignees.length ? { assignees } : {}) };
  const baseUrl = f.baseUrl.trim().replace(/\/+$/, '');
  const project = f.project.trim().toUpperCase();
  if (baseUrl || project) {
    const jira: JiraIntegration = { baseUrl, project };
    const type = f.issueType.trim();
    if (type && type !== 'Task') jira.issueType = type;
    const jl = parseList(f.jiraLabels);
    if (jl.length) jira.labels = jl;
    out.jira = jira;
  }
  return out;
}

/** validateIntegrations, plus the one thing it cannot see: a Jira block with only half of its fields. */
export function integrationsProblems(i: IntegrationsConfig): string[] {
  const out = validateIntegrations(i);
  if (!i.jira && !i.requests) out.push('Fill the Jira site and project key, or request labels or assignees.');
  return out;
}

/**
 * bridge.config.json with `integrations` replaced, in the file's own style: the rest of the file stays byte for
 * byte (format-preserving AST from @bridge-ds/core), so the pull request diff is the integrations block only.
 */
export function withIntegrations(configText: string, integrations: IntegrationsConfig): string {
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('bridge.config.json is not a JSON object.');
  const root = doc.root as JsonObject;
  const existing = getEntry(root, 'integrations');
  const node = fromPlain(integrations, existing?.value);
  if (existing) existing.value = node;
  else root.entries.push({ key: 'integrations', value: node });
  root.raw = undefined;
  return serializeJson(doc);
}

export interface IntegrationsProposal {
  branch: string;
  title: string;
  body: string;
  message: string;
}

/** Branch, title, body and commit message of the pull request that edits `integrations`. */
export function integrationsProposal(i: IntegrationsConfig, opts: { date: Date; prefix?: string; tierLabel: string; workflowUrl: string; secretsUrl: string }): IntegrationsProposal {
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const what = i.jira ? `Jira ${i.jira.project}` : 'request labels and assignees';
  const lines = [
    '## Integrations',
    '',
    `Edits \`integrations\` in \`bridge.config.json\`: ${i.jira ? `component change requests mirror to Jira project ${i.jira.project} on ${i.jira.baseUrl}` : 'labels and assignees on every component change request'}.`,
    '',
    ...(i.jira
      ? [
          `- Jira issue type: ${i.jira.issueType ?? 'Task'}${i.jira.labels?.length ? `, labels ${i.jira.labels.join(', ')}` : ''}.`,
          `- Secrets JIRA_EMAIL and JIRA_API_TOKEN go in the repository settings, never in this file: ${opts.secretsUrl}`,
          `- The Jira workflow: ${opts.workflowUrl}`,
        ]
      : []),
    ...(i.requests?.labels?.length ? [`- Request labels: ${i.requests.labels.join(', ')}.`] : []),
    ...(i.requests?.assignees?.length ? [`- Request assignees: @${i.requests.assignees.join(', @')}.`] : []),
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio Settings.',
  ];
  return {
    branch: `${opts.prefix ?? ''}integrations-${i.jira ? 'jira' : 'requests'}-${stamp}`,
    title: `chore(config): connect ${what} for component change requests`,
    body: lines.join('\n'),
    message: `chore(config): connect ${what} for component change requests\n\nProposed from Bridge Studio Settings.`,
  };
}
