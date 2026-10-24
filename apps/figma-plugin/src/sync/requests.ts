// Sending a component change request from Figma: optional image on the requests branch, then one GitHub issue.
// In suggest mode the image goes up only when the token can write contents; otherwise the Figma node link stands in.
// Independent of the DOM and of figma.* (the UI wires it to both). Never writes code and never opens a pull request:
// components need code, so people (or Claude) implement the issue in their own pull request.

import {
  type BridgeConfig,
  type ComponentChangeRequest,
  type GitHubClient,
  type IssueSummary,
  REQUESTS_BRANCH,
  composeBuildRequestIssue,
  composeRequestIssue,
  isMissingPermission,
  ensureRequestsBranch,
  requestImagePath,
} from '@bridge-ds/core';
import { codedComponentNames } from './components';

export interface SendRequestInput {
  request: ComponentChangeRequest;
  /** PNG exports (base64) to attach, committed to the requests branch. */
  images?: string[] | undefined;
  /**
   * Image URLs of what code draws now (the variant's published code image). With them the request is a build request
   * with before and after: these, then the attached exports.
   */
  before?: string[] | undefined;
  /** Branch the requests branch starts from when it does not exist yet (the default branch). */
  baseBranch: string;
  /** bridge.config.json of the repo: integrations.requests.labels and assignees, components.dir. */
  config?: BridgeConfig | undefined;
  /** Whether the component already exists in code (adds a link to its folder). */
  coded?: boolean | undefined;
  /**
   * Suggest mode: images are stored only when the token can write contents (the bridge-requests branch). A read-only
   * token sends the request with its Figma node link instead of failing. Direct mode (false): an upload error fails.
   */
  imagesNeedWrite?: boolean | undefined;
  now?: Date | undefined;
}

export interface SendRequestResult {
  issue: IssueSummary;
  images: string[];
  /** Images were not stored: the token cannot write contents (suggest mode only). The Figma link stands in. */
  imagesSkipped?: boolean | undefined;
}

/** Public URL of a file on the requests branch, as GitHub serves it to an issue body. */
export const requestImageUrl = (client: Pick<GitHubClient, 'owner' | 'name'>, path: string) =>
  `https://github.com/${client.owner}/${client.name}/blob/${REQUESTS_BRANCH}/${path}?raw=true`;

/** Creates the requests branch from the head of `baseBranch` when it is missing (shared with Bridge Studio). */
export { ensureRequestsBranch } from '@bridge-ds/core';

export async function sendComponentRequest(client: GitHubClient, input: SendRequestInput): Promise<SendRequestResult> {
  const r = input.request;
  if (!r.component.trim()) throw new Error('Pick the component this request is about.');
  if (!r.title.trim()) throw new Error('Add a title.');
  if (!r.summary.trim()) throw new Error('Add a summary: say what should change and why.');
  const up = { component: r.component, images: input.images, baseBranch: input.baseBranch, now: input.now };
  const { urls, skipped } = input.imagesNeedWrite ? await uploadImagesIfAllowed(client, up) : { urls: await uploadImages(client, up), skipped: false };
  const request: ComponentChangeRequest = { ...r, ...(urls.length ? { images: [...(r.images ?? []), ...urls] } : {}) };
  const opts = input.config?.integrations?.requests;
  const dir = input.config?.components?.dir ?? DEFAULT_COMPONENTS_DIR;
  const componentUrl = input.coded && dir ? `https://github.com/${client.owner}/${client.name}/tree/${input.baseBranch}/${dir}/${r.component}` : undefined;
  const issueOpts = { labels: opts?.labels ?? [], assignees: opts?.assignees ?? [], ...(componentUrl ? { componentUrl } : {}) };
  // What code draws now next to the design: a build request, read with its before and after in Studio's Being built.
  // An exploration request stays a plain request: it is built on the exploration, not tracked as library work.
  const before = !r.exploration && urls.length ? (input.before ?? []) : [];
  const issue = before.length
    ? composeBuildRequestIssue({ ...r, figma: r.figma ?? {}, images: { before, after: urls } }, issueOpts)
    : composeRequestIssue(request, issueOpts);
  const created = await client.createIssue(issue);
  return { issue: created, images: urls, ...(skipped ? { imagesSkipped: true } : {}) };
}

/**
 * uploadImages when the token can write contents; with a read-only token (GitHub refuses the branch or the file
 * for a missing permission) nothing is written and `skipped` says so: the Figma node links stand in for the images.
 * Other errors (network, a rejected token) still fail.
 */
export async function uploadImagesIfAllowed(client: GitHubClient, input: Parameters<typeof uploadImages>[1]): Promise<{ urls: string[]; skipped: boolean }> {
  if (!input.images?.length) return { urls: [], skipped: false };
  try {
    return { urls: await uploadImages(client, input), skipped: false };
  } catch (err) {
    if (isMissingPermission(err)) return { urls: [], skipped: true };
    throw err;
  }
}

/**
 * Commits PNG exports (base64) to the requests branch (created from the head of `baseBranch` when missing, never moved)
 * and returns their public URLs, for a request issue or the spec of a library branch from Figma.
 */
export async function uploadImages(client: GitHubClient, input: { component: string; images?: string[] | undefined; baseBranch: string; now?: Date | undefined }): Promise<string[]> {
  const urls: string[] = [];
  if (!input.images?.length) return urls;
  const now = input.now ?? new Date();
  await ensureRequestsBranch(client, input.baseBranch);
  for (let i = 0; i < input.images.length; i++) {
    // One second apart so several images of one component never share a path.
    const path = requestImagePath(input.component, new Date(now.getTime() + i * 1000));
    await client.putBase64File({ path, base64: input.images[i]!, branch: REQUESTS_BRANCH, message: `Image for the ${input.component} change from Figma` });
    urls.push(requestImageUrl(client, path));
  }
  return urls;
}

/** Components that exist in code: folders under components.dir (bridge.config.json) at a tree. */
export async function loadCodedComponents(client: GitHubClient, treeSha: string, config: BridgeConfig | undefined): Promise<string[]> {
  const dir = config?.components?.dir ?? DEFAULT_COMPONENTS_DIR;
  const { entries } = await client.getTree(treeSha, true);
  return codedComponentNames(entries.filter((e) => e.type === 'blob').map((e) => e.path), dir);
}

/** Where components live when the repo has no bridge.config.json (this repo's layout). */
export const DEFAULT_COMPONENTS_DIR = 'packages/react/src/components';
