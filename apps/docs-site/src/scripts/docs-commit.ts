// Docs changes that go to GitHub from the browser, with the reader's own token: propose the docs edits of the draft
// as a pull request (Tier 1, patch changeset), commit an edited docs.json to an open pull request's branch, and
// accept a Claude draft there (needsReview false). The rules and the writes live in @bridge-ds/core (docs-proposal.ts),
// shared with the MCP server and the CLI; this file only brings the page's GitHub session.
import { acceptDocsText, commitFileOnGitHub, proposeDocsOnGitHub } from '@bridge-ds/core';
import type { DocsEdit } from '../lib/docs-draft-model';
import { getToken, prefersSignIn, readRepo, studioClient } from './github-session';
import { ghVerb } from '../lib/gh-wording';

function client() {
  const token = getToken();
  if (!token) throw new Error(`${ghVerb(prefersSignIn())} first.`);
  const r = readRepo();
  return { repo: r, gh: studioClient(`${r.owner}/${r.repo}`, token) };
}

/** Opens one pull request with the docs edits. Returns its number. */
export async function proposeDocs(edits: DocsEdit[], title = '', notes = '', jira: string | null = null): Promise<number> {
  const { gh, repo } = client();
  return (await proposeDocsOnGitHub(gh, edits, { base: repo.defaultBranch, title, notes, jira })).number;
}

/** Commits an edited docs.json to an open pull request's branch. */
export const commitDocsToBranch = (path: string, branch: string, component: string, text: string) =>
  commitFileOnGitHub(client().gh, { path, branch, message: `docs(${component.toLowerCase()}): edit usage guidance in the Bridge docs editor`, next: () => text });

/** Accepts the Claude draft of a docs.json on a pull request's branch: needsReview becomes false, in one commit. */
export const acceptDocsOnBranch = (path: string, branch: string, component: string) =>
  commitFileOnGitHub(client().gh, { path, branch, message: `docs(${component.toLowerCase()}): accept the Claude draft after review`, next: acceptDocsText });
