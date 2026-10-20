// Docs changes that go to GitHub from the browser, with the reader's own token: propose the docs edits of the draft
// as a pull request (Tier 1, patch changeset), or add them to the component's open proposal (one open proposal per
// component), commit an edited docs.json to an open pull request's branch, and accept a Claude draft there
// (needsReview false). The rules and the writes live in @bridge-ds/core (docs-proposal.ts), shared with the MCP
// server and the CLI; this file only brings the page's GitHub session.
import { acceptDocsText, commitFileOnGitHub, continueDocsProposalOnGitHub, findOpenDocsProposalOnGitHub, proposeDocsOnGitHub, type OpenDocsProposal } from '@bridge-ds/core';
import type { DocsEdit } from '../lib/docs-draft-model';
import { getToken, prefersSignIn, readRepo, studioClient } from './github-session';
import { ghVerb } from '../lib/gh-wording';

function client() {
  const token = getToken();
  if (!token) throw new Error(`${ghVerb(prefersSignIn())} first.`);
  const r = readRepo();
  return { repo: r, gh: studioClient(`${r.owner}/${r.repo}`, token) };
}

/** The component's open docs proposal, or null (also when GitHub cannot be read: the editor then starts from main). */
export async function findOpenDocs(component: string, slug: string): Promise<OpenDocsProposal | null> {
  const r = readRepo();
  return findOpenDocsProposalOnGitHub(studioClient(`${r.owner}/${r.repo}`, getToken()), { name: component, slug }, r.defaultBranch).catch(() => null);
}

/** Opens one pull request with the docs edits, or adds them to the component's open one. */
export async function proposeDocs(edits: DocsEdit[], title = '', notes = '', jira: string | null = null, authorLine?: string): Promise<{ number: number; continued: boolean; unchanged: boolean }> {
  const { gh, repo } = client();
  const r = await proposeDocsOnGitHub(gh, edits, { base: repo.defaultBranch, title, notes, jira, authorLine });
  return { number: r.number, continued: r.continued, unchanged: r.unchanged };
}

/** Adds the edited docs.json to the open proposal (one commit) and brings its author line up to date. */
export const continueDocs = (open: { number: number; branch: string }, path: string, component: string, text: string, authorLine: string) =>
  continueDocsProposalOnGitHub(client().gh, open, { path, component, after: text }, { authorLine });

/** Commits an edited docs.json to an open pull request's branch. */
export const commitDocsToBranch = (path: string, branch: string, component: string, text: string) =>
  commitFileOnGitHub(client().gh, { path, branch, message: `docs(${component.toLowerCase()}): edit usage guidance in the Bridge docs editor`, next: () => text });

/** Accepts the Claude draft of a docs.json on a pull request's branch: needsReview becomes false, in one commit. */
export const acceptDocsOnBranch = (path: string, branch: string, component: string) =>
  commitFileOnGitHub(client().gh, { path, branch, message: `docs(${component.toLowerCase()}): accept the Claude draft after review`, next: acceptDocsText });
