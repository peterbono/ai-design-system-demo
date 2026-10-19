// Docs changes that go to GitHub from the browser, with the reader's own token: propose the docs edits of the draft
// as a pull request (Tier 1, patch changeset), commit an edited docs.json to an open pull request's branch, and
// accept a Claude draft there (needsReview false). Pure parts live in lib/docs-draft-model.ts and @bridge-ds/core.
import { acceptDocsText, classifyAuth, friendlyMessage, GitHubError } from '@bridge-ds/core';
import { docsProposal, type DocsEdit } from '../lib/docs-draft-model';
import { getToken, prefersSignIn, readRepo, studioClient, studioFetch } from './github-session';
import { ghVerb } from '../lib/gh-wording';
import { branchWithJiraKey, titleWithJiraKey } from '../lib/vocabulary';

const API = 'https://api.github.com';

function client() {
  const token = getToken();
  if (!token) throw new Error(`${ghVerb(prefersSignIn())} first.`);
  const r = readRepo();
  return { token, repo: r, gh: studioClient(`${r.owner}/${r.repo}`, token) };
}

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await studioFetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? `GitHub answered ${res.status}`;
    const info = classifyAuth(res.status, msg, { path, acceptedPermissions: res.headers?.get('x-accepted-github-permissions') });
    if (info.auth) throw new GitHubError(res.status, friendlyMessage(res.status, msg, info), msg, info);
    throw new Error(res.status === 403 || res.status === 404 ? `GitHub refused it (${res.status}): your token needs write access to this repository.` : msg);
  }
  return (await res.json()) as T;
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

/** Opens one pull request with the docs edits. Returns its number. */
export async function proposeDocs(edits: DocsEdit[], title = '', notes = '', jira: string | null = null): Promise<number> {
  const { gh, repo } = client();
  const p = docsProposal(edits, { title, notes, date: new Date() });
  // The Jira key goes first in the title and the branch name, so Jira's GitHub integration links them.
  const prTitle = titleWithJiraKey(p.title, jira);
  const branch = branchWithJiraKey(p.branch, jira);
  const mainSha = await gh.getBranchSha(repo.defaultBranch);
  if (!mainSha) throw new Error(`Branch ${repo.defaultBranch} not found.`);
  const tree = await gh.createTree(await gh.getCommitTree(mainSha), p.files.map((f) => ({ path: f.path, content: f.content })));
  const commit = await gh.createCommit(`${prTitle}\n\nProposed with the Bridge docs editor.`, tree, [mainSha]);
  await gh.createBranch(branch, commit);
  const pr = await gh.createPullRequest({ title: prTitle, head: branch, base: repo.defaultBranch, body: p.body, draft: false });
  await gh.addLabels(pr.number, p.labels).catch(() => false);
  return pr.number;
}

/** Reads a file on a branch with its blob sha (needed to update it). */
async function readOnBranch(token: string, owner: string, name: string, path: string, branch: string) {
  const r = await api<{ sha: string; content: string }>(token, 'GET', `/repos/${owner}/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
  return { sha: r.sha, text: unb64(r.content) };
}

async function writeOnBranch(path: string, branch: string, message: string, next: (text: string) => string): Promise<string> {
  const { token, repo } = client();
  const cur = await readOnBranch(token, repo.owner, repo.repo, path, branch);
  const content = next(cur.text);
  if (content === cur.text) return '';
  const r = await api<{ commit: { sha: string } }>(token, 'PUT', `/repos/${repo.owner}/${repo.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    message,
    content: b64(content),
    branch,
    sha: cur.sha,
  });
  return r.commit.sha;
}

/** Commits an edited docs.json to an open pull request's branch. */
export const commitDocsToBranch = (path: string, branch: string, component: string, text: string) =>
  writeOnBranch(path, branch, `docs(${component.toLowerCase()}): edit usage guidance in the Bridge docs editor`, () => text);

/** Accepts the Claude draft of a docs.json on a pull request's branch: needsReview becomes false, in one commit. */
export const acceptDocsOnBranch = (path: string, branch: string, component: string) =>
  writeOnBranch(path, branch, `docs(${component.toLowerCase()}): accept the Claude draft after review`, acceptDocsText);
