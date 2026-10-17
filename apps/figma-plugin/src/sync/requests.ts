// Sending a component change request from Figma: optional image on the requests branch, then one GitHub issue.
// Independent of the DOM and of figma.* (the UI wires it to both). Never writes code and never opens a pull request:
// components need code, so people (or Claude) implement the issue in their own pull request.

import {
  type BridgeConfig,
  type ComponentChangeRequest,
  type GitHubClient,
  type IssueSummary,
  REQUESTS_BRANCH,
  composeRequestIssue,
  requestImagePath,
} from '@bridge-ds/core';
import { codedComponentNames } from './components';

export interface SendRequestInput {
  request: ComponentChangeRequest;
  /** PNG exports (base64) to attach, committed to the requests branch. */
  images?: string[] | undefined;
  /** Branch the requests branch starts from when it does not exist yet (the default branch). */
  baseBranch: string;
  /** bridge.config.json of the repo: integrations.requests.labels and assignees, components.dir. */
  config?: BridgeConfig | undefined;
  /** Whether the component already exists in code (adds a link to its folder). */
  coded?: boolean | undefined;
  now?: Date | undefined;
}

export interface SendRequestResult {
  issue: IssueSummary;
  images: string[];
}

/** Public URL of a file on the requests branch, as GitHub serves it to an issue body. */
export const requestImageUrl = (client: Pick<GitHubClient, 'owner' | 'name'>, path: string) =>
  `https://github.com/${client.owner}/${client.name}/blob/${REQUESTS_BRANCH}/${path}?raw=true`;

/** Creates the requests branch from the head of `baseBranch` when it is missing. Never moves an existing branch. */
export async function ensureRequestsBranch(client: GitHubClient, baseBranch: string): Promise<void> {
  if (await client.getBranchSha(REQUESTS_BRANCH)) return;
  const head = await client.getBranchSha(baseBranch);
  if (!head) throw new Error(`Branch "${baseBranch}" was not found, so the ${REQUESTS_BRANCH} branch for images cannot start from it.`);
  await client.createBranch(REQUESTS_BRANCH, head);
}

export async function sendComponentRequest(client: GitHubClient, input: SendRequestInput): Promise<SendRequestResult> {
  const r = input.request;
  if (!r.component.trim()) throw new Error('Pick the component this request is about.');
  if (!r.title.trim()) throw new Error('Add a title.');
  if (!r.summary.trim()) throw new Error('Add a summary: say what should change and why.');
  const now = input.now ?? new Date();
  const urls: string[] = [];
  if (input.images?.length) {
    await ensureRequestsBranch(client, input.baseBranch);
    for (let i = 0; i < input.images.length; i++) {
      // One second apart so several images of one request never share a path.
      const path = requestImagePath(r.component, new Date(now.getTime() + i * 1000));
      await client.putBase64File({ path, base64: input.images[i]!, branch: REQUESTS_BRANCH, message: `Image for the ${r.component} request from Figma` });
      urls.push(requestImageUrl(client, path));
    }
  }
  const request: ComponentChangeRequest = { ...r, ...(urls.length ? { images: [...(r.images ?? []), ...urls] } : {}) };
  const opts = input.config?.integrations?.requests;
  const dir = input.config?.components?.dir ?? DEFAULT_COMPONENTS_DIR;
  const componentUrl = input.coded && dir ? `https://github.com/${client.owner}/${client.name}/tree/${input.baseBranch}/${dir}/${r.component}` : undefined;
  const issue = composeRequestIssue(request, { labels: opts?.labels ?? [], assignees: opts?.assignees ?? [], ...(componentUrl ? { componentUrl } : {}) });
  const created = await client.createIssue(issue);
  return { issue: created, images: urls };
}

/** Components that exist in code: folders under components.dir (bridge.config.json) at a tree. */
export async function loadCodedComponents(client: GitHubClient, treeSha: string, config: BridgeConfig | undefined): Promise<string[]> {
  const dir = config?.components?.dir ?? DEFAULT_COMPONENTS_DIR;
  const { entries } = await client.getTree(treeSha, true);
  return codedComponentNames(entries.filter((e) => e.type === 'blob').map((e) => e.path), dir);
}

/** Where components live when the repo has no bridge.config.json (this repo's layout). */
export const DEFAULT_COMPONENTS_DIR = 'packages/react/src/components';
