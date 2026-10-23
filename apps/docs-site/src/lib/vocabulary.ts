// The words Studio speaks, in one place. Studio mirrors Figma branching (help.figma.com, "Guide to branching"):
// a designer creates a branch off main, requests a review, the reviewer reviews and merges it, and the library is
// published as a package release. Saving is invisible: there is no push, pull or commit on a Studio screen.
//
// Every Studio screen, status and sentence reads its words from here, so one rename is one edit. Developer words
// (pull request, commit, SHA, changeset, CI, workflow) never show on a Studio screen: a quiet "Open on GitHub" link
// on the line of the thing it concerns is the way to them. Pure: no DOM. Unit tested in vocabulary.test.ts.

export const VOCAB = {
  /** The unit of work: a branch of the library, a pull request on GitHub. */
  branch: 'branch',
  branches: 'branches',
  Branch: 'Branch',
  Branches: 'Branches',
  /** The library everyone uses, the branch every branch starts from. */
  main: 'main',
  /** Start a branch (Figma: "Create branch"). */
  createBranch: 'Create branch',
  /** Ask reviewers to look: the one send verb of the site (lib/gh-wording.ts sendButton), in direct mode. */
  requestReview: 'Send for review',
  /** The reviewer's step that ends in a merge (Figma: "Review and merge"). */
  reviewAndMerge: 'Review and merge',
  merge: 'Merge',
  /** Bring what main gained since the branch started (Figma: "Update from main"). */
  updateFromMain: 'Update from main',
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
  merged: 'Merged',
  closed: 'Closed',
} as const;

/**
 * Developer words that never show on a Studio screen. "branch", "merge" and "main" are Figma words and allowed.
 * Matched as whole words, case-insensitive (jargonIn).
 */
export const DEV_WORDS = ['push', 'pull', 'commit', 'pull request', 'PR', 'SHA', 'changeset', 'CI', 'workflow'] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The developer words a piece of screen text uses, in DEV_WORDS order. "PR" and "CI" match only in capitals. */
export function jargonIn(text: string): string[] {
  return DEV_WORDS.filter((w) => {
    const caps = w === 'PR' || w === 'CI' || w === 'SHA';
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${escape(w)}(e?s)?(?![A-Za-z0-9_-])`, caps ? '' : 'i');
    return re.test(text);
  });
}

/** "1 branch", "3 branches". */
export const branchCount = (n: number) => `${n} ${n === 1 ? VOCAB.branch : VOCAB.branches}`;

// ---------------------------------------------------------------------------------------------------------------
// Jira ticket keys: an optional "DS-42" given when a branch is created. Jira's GitHub integration links a pull
// request whose title (or branch name) starts with the key, so the key goes first in both.

// The rules live in @bridge-ds/core (jira.ts), shared with the MCP server and the CLI.
export { branchWithJiraKey, isJiraKey, jiraKeyOf, parseJiraKey, titleWithJiraKey, withoutJiraKey } from '@bridge-ds/core';
