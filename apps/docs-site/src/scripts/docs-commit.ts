// Docs changes that go to GitHub from the browser, with the reader's own token: propose the docs edits of the draft
// as a pull request (Tier 1, patch changeset), or add them to the component's open proposal (one open proposal per
// component), commit an edited docs.json to an open pull request's branch, and accept a Claude draft there
// (needsReview false). In suggest mode (bridge.config.json "changes") the edits go out as one suggestion instead, and
// the branch writes refuse (scripts/changes-mode.ts). The rules and the writes live in @bridge-ds/core
// (docs-proposal.ts), shared with the MCP server and the CLI; this file only brings the page's GitHub session.
import { acceptDocsText, commitFileOnGitHub, continueDocsProposalOnGitHub, findOpenDocsProposalOnGitHub, proposeDocsOnGitHub, type OpenDocsProposal } from '@bridge-ds/core';
import type { DocsEdit } from '../lib/docs-draft-model';
import { currentViewer, getToken, prefersSignIn, readRepo, studioClient } from './github-session';
import { assertBranchWrites, changesModeOnPage } from './changes-mode';
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

/** What a docs send made: a pull request (direct mode), or a suggestion and its link (suggest mode). */
export type SentDocs = { kind: 'branch'; number: number; continued: boolean; unchanged: boolean } | { kind: 'suggestion'; number: number; url: string; continued: false; unchanged: false };

/**
 * Direct mode: opens one pull request with the docs edits, or adds them to the component's open one. Suggest mode:
 * files them as one suggestion (no branch), with the mode passed to core explicitly (core defaults to direct).
 */
export async function proposeDocs(edits: DocsEdit[], title = '', notes = '', jira: string | null = null, authorLine?: string): Promise<SentDocs> {
  const { gh, repo } = client();
  const mode = changesModeOnPage();
  if (mode === 'suggest') {
    const r = await proposeDocsOnGitHub(gh, edits, { base: repo.defaultBranch, title, notes, jira, authorLine, mode, source: 'studio', suggestedBy: currentViewer()?.login });
    if (r.status === 'suggested') return { kind: 'suggestion', number: r.number, url: r.url, continued: false, unchanged: false };
    throw new Error('Bridge started a change in suggest mode. Tell your DS lead.');
  }
  const r = await proposeDocsOnGitHub(gh, edits, { base: repo.defaultBranch, title, notes, jira, authorLine, mode });
  return { kind: 'branch', number: r.number, continued: r.continued, unchanged: r.unchanged };
}

/** Adds the edited docs.json to the open proposal (one commit) and brings its author line up to date. */
export const continueDocs = (open: { number: number; branch: string }, path: string, component: string, text: string, authorLine: string) => {
  assertBranchWrites('add to open proposals', 'Send your edits as a suggestion instead.');
  return continueDocsProposalOnGitHub(client().gh, open, { path, component, after: text }, { authorLine });
};

/** Commits an edited docs.json to an open pull request's branch. */
export const commitDocsToBranch = (path: string, branch: string, component: string, text: string) => {
  assertBranchWrites('save changes', 'Send your edits as a suggestion instead.');
  return commitFileOnGitHub(client().gh, { path, branch, message: `docs(${component.toLowerCase()}): edit usage guidance in the Bridge docs editor`, next: () => text });
};

/** Accepts the Claude draft of a docs.json on a pull request's branch: needsReview becomes false, in one commit. */
export const acceptDocsOnBranch = (path: string, branch: string, component: string) => {
  assertBranchWrites('save changes', 'Accept the draft in the editor, then send it as a suggestion.');
  return commitFileOnGitHub(client().gh, { path, branch, message: `docs(${component.toLowerCase()}): accept the Claude draft after review`, next: acceptDocsText });
};
