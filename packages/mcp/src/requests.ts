// Component change requests: GitHub issues labeled component-change that people (or Claude) implement in a pull
// request that says "Closes #n". The issue format, status rules and the brief are @bridge-ds/core's (requests.ts);
// this file only reads and writes them through the context's GitHub client, for the MCP tools and the CLI.
import {
  closingIssueNumbers,
  composeRequestIssue,
  parseRequestIssue,
  REQUEST_KINDS,
  REQUEST_LABEL,
  requestBrief,
  requestStatus,
  type ComponentChangeRequest,
  type GitHubClient,
  type IssueSummary,
  type PullRequestSummary,
  type RequestChange,
  type RequestKind,
  type RequestSource,
  type RequestStatus,
} from '@bridge-ds/core';
import { listComponentNames } from './components.js';
import type { BridgeContext } from './context.js';

export type RequestStatusFilter = RequestStatus | 'all';

export interface LinkedPr {
  number: number;
  title: string;
  /** "open", "closed" or "merged". */
  state: string;
  url: string;
}

export interface RequestRow {
  number: number;
  component: string;
  kind: RequestKind;
  title: string;
  status: RequestStatus;
  url: string;
  linkedPrs: LinkedPr[];
}

const KINDS = new Set<string>(REQUEST_KINDS.map((k) => k.value));

async function requireGitHub(ctx: BridgeContext): Promise<GitHubClient> {
  const gh = await ctx.github();
  if (!gh) throw new Error('No GitHub repo known: set "repo" in bridge.config.json or add an origin remote. Requests are GitHub issues.');
  return gh;
}

/** Pull requests (open and closed) by the issue numbers their body closes. A failed listing links nothing. */
async function linkedPullRequests(gh: GitHubClient): Promise<Map<number, LinkedPr[]>> {
  let pulls: PullRequestSummary[] = [];
  try {
    pulls = await gh.listPullRequests('all');
  } catch {
    pulls = [];
  }
  const out = new Map<number, LinkedPr[]>();
  for (const p of pulls) {
    for (const n of closingIssueNumbers(p.body)) {
      const list = out.get(n) ?? [];
      list.push({ number: p.number, title: p.title, state: p.state, url: p.url });
      out.set(n, list);
    }
  }
  return out;
}

/**
 * The request in an issue: the hidden Bridge block, or, for an issue someone labeled component-change by hand, what
 * the title ("Button: add a ghost variant"), the request labels and the body tell.
 */
export function requestFromIssue(issue: Pick<IssueSummary, 'title' | 'body' | 'labels'>): ComponentChangeRequest {
  const parsed = parseRequestIssue(issue.body);
  if (parsed) return parsed;
  const m = /^\s*([^:]{1,60}):\s*(.+)$/.exec(issue.title);
  const kindLabel = issue.labels.map((l) => /^request:\s*(.+)$/.exec(l)?.[1]?.trim()).find((k) => k && KINDS.has(k));
  const sourceLabel = issue.labels.map((l) => /^source:\s*(.+)$/.exec(l)?.[1]?.trim()).find((s) => s === 'figma' || s === 'studio' || s === 'cli' || s === 'mcp');
  return {
    component: m ? m[1]!.trim() : 'Unknown',
    kind: (kindLabel ?? 'other') as RequestKind,
    title: m ? m[2]!.trim() : issue.title,
    summary: issue.body.trim() || issue.title,
    changes: [],
    source: (sourceLabel ?? 'studio') as RequestSource,
  };
}

function statusOf(issue: Pick<IssueSummary, 'state' | 'stateReason'>, prs: LinkedPr[]): RequestStatus {
  return requestStatus({
    state: issue.state,
    stateReason: issue.stateReason,
    linkedPrs: prs.map((p) => ({ state: p.state === 'open' ? 'open' : 'closed', merged: p.state === 'merged' })),
  });
}

function toRow(issue: IssueSummary, linked: Map<number, LinkedPr[]>): RequestRow {
  const r = requestFromIssue(issue);
  const prs = linked.get(issue.number) ?? [];
  return { number: issue.number, component: r.component, kind: r.kind, title: r.title, status: statusOf(issue, prs), url: issue.url, linkedPrs: prs };
}

export async function listRequests(ctx: BridgeContext, a: { status?: RequestStatusFilter; component?: string; limit?: number }) {
  const gh = await requireGitHub(ctx);
  const status = a.status ?? 'all';
  const state = status === 'requested' || status === 'in-progress' ? 'open' : status === 'done' || status === 'declined' ? 'closed' : 'all';
  const [issues, linked] = await Promise.all([gh.listIssues({ label: REQUEST_LABEL, state, perPage: 100 }), linkedPullRequests(gh)]);
  let rows = issues.map((i) => toRow(i, linked));
  if (status !== 'all') rows = rows.filter((r) => r.status === status);
  if (a.component) {
    const c = a.component.toLowerCase();
    rows = rows.filter((r) => r.component.toLowerCase() === c);
  }
  const total = rows.length;
  rows = rows.slice(0, a.limit ?? 100);
  return { repo: gh.fullName, label: REQUEST_LABEL, status, total, requests: rows };
}

export async function getRequest(ctx: BridgeContext, a: { number: number }) {
  const gh = await requireGitHub(ctx);
  const [issue, linked] = await Promise.all([gh.getIssue(a.number), linkedPullRequests(gh)]);
  const isRequest = issue.labels.includes(REQUEST_LABEL) || Boolean(parseRequestIssue(issue.body));
  if (!isRequest) throw new Error(`Issue #${a.number} is not a component change request: it has no "${REQUEST_LABEL}" label and no Bridge request block.`);
  const request = requestFromIssue(issue);
  const prs = linked.get(issue.number) ?? [];
  const { config } = await ctx.config();
  const dir = config.components?.dir;
  const entry = dir ? (await listComponentNames(ctx.source, config)).find((c) => c.name.toLowerCase() === request.component.toLowerCase()) : undefined;
  const files = entry?.files ?? [];
  const agentsFile = config.docs.guidelines ?? 'AGENTS.md';
  const brief = requestBrief(request, { issue: issue.number, issueUrl: issue.url, files, agentsFile });
  return {
    number: issue.number,
    url: issue.url,
    state: issue.state,
    status: statusOf(issue, prs),
    labels: issue.labels,
    author: issue.author,
    request,
    linkedPrs: prs,
    component: { name: entry?.name ?? request.component, exists: Boolean(entry), dir: dir ? `${dir}/${entry?.name ?? request.component}` : undefined, files },
    agentsFile,
    brief,
    next: `Implement it on a branch named agent/request-${issue.number} and open a pull request whose body says "Closes #${issue.number}".`,
  };
}

export interface CreateRequestInput {
  component: string;
  kind: RequestKind;
  title: string;
  summary: string;
  changes?: RequestChange[] | undefined;
  figmaUrl?: string | undefined;
  source?: RequestSource | undefined;
  dryRun?: boolean | undefined;
}

export async function createRequest(ctx: BridgeContext, a: CreateRequestInput) {
  const component = a.component.trim();
  const title = a.title.trim();
  const summary = a.summary.trim();
  if (!component) throw new Error('A request needs a component name, like Button (or the name of the new component).');
  if (!KINDS.has(a.kind)) throw new Error(`Unknown kind "${a.kind}". Use one of: ${REQUEST_KINDS.map((k) => k.value).join(', ')}.`);
  if (!title) throw new Error('A request needs a one-line title, like "Add a danger ghost variant".');
  if (!summary) throw new Error('A request needs a summary: what should change and why.');
  const { config } = await ctx.config();
  const req: ComponentChangeRequest = {
    component,
    kind: a.kind,
    title,
    summary,
    changes: (a.changes ?? []).filter((c) => c.field.trim()),
    ...(a.figmaUrl ? { figma: { url: a.figmaUrl } } : {}),
    source: a.source ?? 'mcp',
  };
  const settings = config.integrations?.requests;
  const issue = composeRequestIssue(req, { labels: settings?.labels ?? [], assignees: settings?.assignees ?? [] });
  if (a.dryRun) return { status: 'dry-run' as const, issue };
  const gh = await requireGitHub(ctx);
  if (!ctx.canWriteRemote) throw new Error('Creating a request needs GITHUB_TOKEN (issues: write on this repository). Without it Bridge is read-only.');
  const created = await gh.createIssue(issue);
  return {
    status: 'created' as const,
    number: created.number,
    url: created.url,
    title: created.title,
    labels: created.labels.length ? created.labels : issue.labels,
    next: `Implement it with bridge_get_request {"number": ${created.number}} (or \`bridge request implement ${created.number}\`).`,
  };
}
