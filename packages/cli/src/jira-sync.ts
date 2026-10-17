// The step of the optional bridge-jira GitHub Action (`bridge request jira-sync`). Runs in the user's repo with the
// user's own secrets: Bridge has no backend. Off (one notice, exit 0) without the JIRA_EMAIL and JIRA_API_TOKEN
// secrets or without integrations.jira in bridge.config.json.
//   opened / labeled component-change: create the Jira issue, comment "Jira: KEY-12 <url>" on the GitHub issue and
//     label it "jira: KEY-12". Idempotent: an issue that already has a jira: label is left alone.
//   closed: comment on the Jira issue "Closed in GitHub (#n), completed|not planned". No workflow transition:
//     transition names differ per Jira site.
import { GitHubClient, jiraIssueFields, REQUEST_LABEL, validateIntegrations, type FetchLike, type JiraIntegration } from '@bridge-ds/core';
import { BridgeContext, requests } from '@bridge-ds/mcp';

export interface IssuesEvent {
  action?: string;
  label?: { name?: string } | null;
  issue?: { number?: number; state_reason?: string | null } | null;
  repository?: { full_name?: string } | null;
}

export interface JiraSyncInput {
  root: string;
  env: NodeJS.ProcessEnv;
  event: IssuesEvent;
  log(line: string): void;
  fetch?: typeof fetch | undefined;
}

export type JiraSyncResult =
  | { status: 'off'; reason: string }
  | { status: 'skipped'; reason: string }
  | { status: 'created'; key: string; url: string }
  | { status: 'commented'; key: string }
  | { status: 'error'; reason: string };

const JIRA_LABEL = /^jira:\s*([A-Z][A-Z0-9_]*-\d+)$/;

async function readJiraConfig(root: string): Promise<JiraIntegration | undefined> {
  try {
    const ctx = await BridgeContext.create({ root });
    return (await ctx.config()).config.integrations?.jira;
  } catch {
    return undefined;
  }
}

export async function jiraSync(input: JiraSyncInput): Promise<JiraSyncResult> {
  const { env, event, log } = input;
  const f = input.fetch ?? fetch;
  const off = (reason: string): JiraSyncResult => {
    log(`::notice::Bridge Jira sync is off: ${reason}`);
    return { status: 'off', reason };
  };
  const skip = (reason: string): JiraSyncResult => {
    log(`Bridge Jira sync: ${reason}`);
    return { status: 'skipped', reason };
  };
  const fail = (reason: string): JiraSyncResult => {
    log(`::error::Bridge Jira sync: ${reason}`);
    return { status: 'error', reason };
  };

  if (!env.JIRA_EMAIL || !env.JIRA_API_TOKEN) return off('add the JIRA_EMAIL and JIRA_API_TOKEN repository secrets to turn it on.');
  const jira = await readJiraConfig(input.root);
  if (!jira) return off('bridge.config.json has no integrations.jira (baseUrl and project).');
  const problems = validateIntegrations({ jira });
  if (problems.length) return off(`integrations.jira needs a fix. ${problems.join(' ')}`);

  const action = event.action ?? '';
  const n = event.issue?.number;
  const repo = event.repository?.full_name ?? env.GITHUB_REPOSITORY;
  if (!n || !repo) return skip('not an issues event.');
  if (!['opened', 'labeled', 'closed'].includes(action)) return skip(`nothing to do on "${action}".`);
  if (action === 'labeled' && event.label?.name !== REQUEST_LABEL) return skip(`label "${event.label?.name ?? ''}" is not ${REQUEST_LABEL}.`);
  if (!env.GITHUB_TOKEN) return fail('GITHUB_TOKEN is missing: pass secrets.GITHUB_TOKEN to the step.');

  const ghFetch: FetchLike = (url, init) => f(url, init as RequestInit) as ReturnType<FetchLike>;
  const gh = new GitHubClient(repo, env.GITHUB_TOKEN, ghFetch);
  // Fresh labels, not the event's: the opened and labeled runs of one new issue must not both create a Jira issue.
  const issue = await gh.getIssue(n);
  if (!issue.labels.includes(REQUEST_LABEL)) return skip(`#${n} is not labeled ${REQUEST_LABEL}.`);
  const key = issue.labels.map((l) => JIRA_LABEL.exec(l)?.[1]).find(Boolean);

  const base = jira.baseUrl.replace(/\/+$/, '');
  const headers = {
    Authorization: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const jiraError = async (res: Response) => {
    let detail = '';
    try {
      const j = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
      detail = [...(j.errorMessages ?? []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`)].join(' ');
    } catch {
      detail = '';
    }
    const hint = res.status === 401 || res.status === 403 ? ' Check JIRA_EMAIL and JIRA_API_TOKEN (an API token from id.atlassian.com, for an account that can create issues in the project).' : '';
    return `Jira answered ${res.status}${detail ? `: ${detail}` : ''}.${hint}`;
  };

  if (action === 'closed') {
    if (!key) return skip(`#${n} has no linked Jira issue.`);
    const outcome = event.issue?.state_reason === 'not_planned' || issue.stateReason === 'not_planned' ? 'not planned' : 'completed';
    const text = `Closed in GitHub (#${n}), ${outcome}`;
    const body = { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href: issue.url } }] }] }] } };
    const res = await f(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) return fail(await jiraError(res));
    log(`Bridge Jira sync: commented on ${key}: ${text}.`);
    return { status: 'commented', key };
  }

  if (key) return skip(`#${n} is already linked to ${key}.`);
  const request = requests.requestFromIssue(issue);
  const res = await f(`${base}/rest/api/3/issue`, { method: 'POST', headers, body: JSON.stringify({ fields: jiraIssueFields(request, jira, issue.url) }) });
  if (!res.ok) return fail(await jiraError(res));
  const created = (await res.json()) as { key: string };
  const url = `${base}/browse/${created.key}`;
  await gh.addComment(n, `Jira: ${created.key} ${url}`);
  await gh.addLabels(n, [`jira: ${created.key}`]);
  log(`Bridge Jira sync: created ${created.key} for #${n}: ${url}`);
  return { status: 'created', key: created.key, url };
}
