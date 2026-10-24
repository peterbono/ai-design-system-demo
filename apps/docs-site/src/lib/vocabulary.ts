// The words Studio speaks, in one place. Designers work in changes to the library: they start a change, send it for
// review, and a reviewer adds it to the library, which is published as a package release. Saving is invisible: there
// is no push, pull or commit on a Studio screen, and no branch, merge or main either (decision 2026-10-24: designers
// read "change" and "library"; git words stay in the "For developers" folds, the CLI, the MCP server and GitHub).
//
// Every Studio screen, status and sentence reads its words from here, so one rename is one edit. Developer words
// (branch, merge, main, pull request, commit, SHA, changeset, CI, workflow) never show on a Studio screen: a quiet
// "Open on GitHub" link on the line of the thing it concerns is the way to them. Pure: no DOM. Unit tested in
// vocabulary.test.ts.

export const VOCAB = {
  /** The unit of work: a change to the library (a branch and its pull request on GitHub). */
  branch: 'change',
  branches: 'changes',
  Branch: 'Change',
  Branches: 'Changes',
  /** The library everyone uses (main on GitHub), mid-sentence. */
  main: 'the library',
  /** The same, at the start of a sentence. */
  Main: 'The library',
  /** Start a change (a branch on GitHub). */
  createBranch: 'Start a change',
  /** Ask reviewers to look: the one send verb of the site (lib/gh-wording.ts sendButton), in direct mode. */
  requestReview: 'Send for review',
  /** The reviewer's step that ends with the change in the library (a merge on GitHub). */
  reviewAndMerge: 'Review and add to the library',
  /** The action that puts an approved change in the library (Merge on GitHub). */
  merge: 'Add to the library',
  /** The approved state: nothing left but adding it (ready to merge on GitHub). */
  readyToMerge: 'Ready to add to the library',
  /** Done: the change is in the library (merged into main on GitHub). */
  merged: 'Added to the library',
  /** Bring what the library gained since the change started (update from main on GitHub). */
  updateFromMain: 'Update from the library',
  /** The package release, the only "publish" (Figma: publish a library). */
  publish: 'Publish',
  save: 'Save',
  /** The one way to the developer view of a thing, on its own line. */
  openOnGitHub: 'Open on GitHub',
  /** Settings: the link that explains a setting the GitHub way. */
  howOnGitHub: 'How it works on GitHub',
} as const;

/** The status of a branch, as its badge and its filter say it. */
export const STATUS_WORDS = {
  draft: 'Draft',
  inReview: 'In review',
  waiting: 'Approved, waiting for code',
  waitingShort: 'Waiting for code',
  merged: 'Added to the library',
  closed: 'Closed',
} as const;

/**
 * Developer words that never show on a Studio screen, git's branch, merge and main included (designers read change and
 * library). Matched as whole words, case-insensitive (jargonIn).
 */
export const DEV_WORDS = ['push', 'pull', 'commit', 'pull request', 'PR', 'SHA', 'changeset', 'CI', 'workflow', 'branch', 'merge', 'main'] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The developer words a piece of screen text uses, in DEV_WORDS order. "PR" and "CI" match only in capitals. */
export function jargonIn(text: string): string[] {
  return DEV_WORDS.filter((w) => {
    const caps = w === 'PR' || w === 'CI' || w === 'SHA';
    const word = w === 'merge' ? 'merg(?:e|es|ed|ing)' : `${escape(w)}(?:e?s|ed|ing)?`;
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${word}(?![A-Za-z0-9_-])`, caps ? '' : 'i');
    return re.test(text);
  });
}

/** "1 change", "3 changes". */
export const branchCount = (n: number) => `${n} ${n === 1 ? VOCAB.branch : VOCAB.branches}`;

// ---------------------------------------------------------------------------------------------------------------
// Jira ticket keys: an optional "DS-42" given when a branch is created. Jira's GitHub integration links a pull
// request whose title (or branch name) starts with the key, so the key goes first in both.

// The rules live in @bridge-ds/core (jira.ts), shared with the MCP server and the CLI.
export { branchWithJiraKey, isJiraKey, jiraKeyOf, parseJiraKey, titleWithJiraKey, withoutJiraKey } from '@bridge-ds/core';
