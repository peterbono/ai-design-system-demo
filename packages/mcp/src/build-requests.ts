// Build requests (docs/BUILD-REQUESTS.md): structure changes pushed from Figma, which developers build in GitHub or Jira.
// Read only: Bridge never writes to a build request after filing it. The list, the status rules and the brief are
// @bridge-ds/core's (build-requests.ts); this file reads them through the context's GitHub client for the MCP tools
// (bridge_list_build_requests, bridge_get_build_request) and the CLI (`bridge build list|show`).
import {
  BUILD_FILTER_LABEL,
  buildRequestBrief,
  buildSummaryLine,
  figmaChangeOnGitHub,
  listBuildRequestsOnGitHub,
  matchesBuildFilter,
  parseBuildRequestIssue,
  parseBuildSpec,
  type BuildFilter,
  type BuildRequestView,
  type GitHubClient,
} from '@bridge-ds/core';
import { listComponentNames } from './components.js';
import type { BridgeContext } from './context.js';
import { requestFromIssue } from './requests.js';
import { say } from './say.js';

export const BUILD_FILTERS = Object.keys(BUILD_FILTER_LABEL) as BuildFilter[];

async function requireGitHub(ctx: BridgeContext): Promise<GitHubClient> {
  const gh = await ctx.github();
  if (!gh) throw new Error('No GitHub repo known: set "repo" in bridge.config.json or add an origin remote. Build requests are GitHub issues.');
  return gh;
}

/** One row as the tools return it: the status in words, who builds it, how old, the links developers use. */
function row(v: BuildRequestView) {
  return {
    number: v.number,
    kind: v.kind === 'issue' ? ('issue' as const) : ('library branch' as const),
    component: v.component,
    title: v.title,
    status: v.status,
    statusLabel: v.label,
    said: v.sentence,
    builders: v.builders,
    ageDays: v.ageDays,
    stale: v.stale,
    ...(v.shippedAt ? { shippedAt: v.shippedAt } : {}),
    url: v.url,
    ...(v.pull ? { pull: v.pull } : {}),
    ...(v.jira ? { jira: v.jira } : {}),
    ...(v.figmaUrl ? { figma: v.figmaUrl } : {}),
  };
}

export async function listBuildRequests(ctx: BridgeContext, a: { filter?: BuildFilter | undefined; component?: string | undefined; limit?: number | undefined } = {}) {
  const gh = await requireGitHub(ctx);
  const filter = a.filter ?? 'all';
  if (!BUILD_FILTERS.includes(filter)) throw new Error(`Unknown filter "${filter}". Use one of: ${BUILD_FILTERS.join(', ')}.`);
  const now = Date.now();
  const all = await listBuildRequestsOnGitHub(gh, { now });
  let views = all.filter((v) => matchesBuildFilter(v, filter, now));
  if (a.component) {
    const c = a.component.toLowerCase();
    views = views.filter((v) => v.component.toLowerCase() === c);
  }
  const total = views.length;
  return {
    repo: gh.fullName,
    filter,
    summary: buildSummaryLine(all) ?? 'Nothing is being built.',
    total,
    buildRequests: views.slice(0, a.limit ?? 100).map(row),
  };
}

/**
 * One build request, ready to build: what was sent (the request, before and after images, props needed, the spec when
 * the issue keeps it), the status timeline, the linked pull request, the Jira key and `brief`, the prompt for Claude.
 * A library branch from Figma waiting for a developer (direct mode) gives the spec and brief of that branch.
 */
export async function getBuildRequest(ctx: BridgeContext, a: { number: number }) {
  const gh = await requireGitHub(ctx);
  const views = await listBuildRequestsOnGitHub(gh);
  const v = views.find((x) => x.number === a.number);
  if (!v) throw new Error(`#${a.number} is not a build request: no component-change or bridge-build issue, and no library branch from Figma with that number. ${say(ctx, 'bridge_list_build_requests', '`bridge build list`')} lists them.`);
  const { config } = await ctx.config();
  const componentsDir = config.components?.dir;
  const agentsFile = config.docs.guidelines ?? 'AGENTS.md';
  const status = { status: v.status, label: v.label, said: v.sentence, builders: v.builders, ageDays: v.ageDays, stale: v.stale, timeline: v.timeline };
  const links = { url: v.url, ...(v.pull ? { pull: v.pull } : {}), ...(v.jira ? { jira: v.jira } : {}), ...(v.figmaUrl ? { figma: v.figmaUrl } : {}) };
  if (v.kind === 'pull') {
    const f = await figmaChangeOnGitHub(gh, v.number, { componentsDir }).catch(() => null);
    return {
      number: v.number,
      kind: 'library branch' as const,
      component: v.component,
      title: v.title,
      ...status,
      ...links,
      ...(f?.spec ? { spec: f.spec } : {}),
      brief: f?.brief ?? null,
      next: `Build it on the branch of #${v.number} (${say(ctx, `bridge_get_figma_change { pr: ${v.number} }`, `\`bridge figma show ${v.number}\``)}), then mark it drafted.`,
    };
  }
  const issue = await gh.getIssue(v.number);
  const request = parseBuildRequestIssue(issue.body) ?? { ...requestFromIssue(issue), build: { v: 1 as const } };
  const entry = componentsDir ? (await listComponentNames(ctx.source, config)).find((c) => c.name.toLowerCase() === request.component.toLowerCase()) : undefined;
  const files = entry?.files ?? [];
  const spec = parseBuildSpec(issue.body);
  const brief = buildRequestBrief(request, { issue: v.number, issueUrl: issue.url, componentsDir, agentsFile, files });
  return {
    number: v.number,
    kind: 'issue' as const,
    component: v.component,
    title: v.title,
    ...status,
    ...links,
    request,
    ...(spec !== undefined ? { spec } : {}),
    componentFiles: files,
    agentsFile,
    brief,
    next:
      v.status === 'shipped' || v.status === 'not-planned'
        ? `${v.label}: nothing to build.`
        : `Build it on a branch named agent/build-${v.number} and open a pull request whose body says "Closes #${v.number}". Assign yourself on GitHub so the designer sees who is on it.`,
  };
}
