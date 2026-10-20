// Jira ticket keys: an optional "DS-42" given when a branch is created (Bridge Studio, the MCP server, the CLI).
// Jira's GitHub integration links a pull request whose title (or branch name) starts with the key, so the key goes
// first in both.

const JIRA_KEY = /^[A-Z][A-Z0-9_]{0,9}-[1-9]\d{0,6}$/;

/**
 * The Jira key given when a branch is created, normalised ("ds-42 " is "DS-42"), or null when empty. Throws a
 * sentence that says how to fix it when the text is not a key.
 */
export function parseJiraKey(input: string | null | undefined): string | null {
  const t = (input ?? '').trim().toUpperCase();
  if (!t) return null;
  if (!JIRA_KEY.test(t)) throw new Error('Write the Jira ticket as its key, like DS-42, or leave it empty.');
  return t;
}

/** Whether a text is a Jira key, without throwing (for live field validation). */
export const isJiraKey = (input: string) => JIRA_KEY.test(input.trim().toUpperCase());

const LEADING_KEY = /^\[?([A-Z][A-Z0-9_]{0,9}-[1-9]\d{0,6})\]?[:\s]\s*/;

/** The Jira key a title starts with ("DS-42 tokens: darker primary" gives "DS-42"), else null. */
export function jiraKeyOf(title: string): string | null {
  return LEADING_KEY.exec(title.trim())?.[1] ?? null;
}

/** The title without its leading Jira key. */
export const withoutJiraKey = (title: string) => title.trim().replace(LEADING_KEY, '');

/** The pull request title with the key first: "DS-42 tokens: darker primary". Idempotent; no key, no change. */
export function titleWithJiraKey(title: string, key: string | null): string {
  if (!key) return title;
  return `${key} ${withoutJiraKey(title)}`;
}

/** The branch name with the key first in its last part: "tokens/DS-42-darker-primary-20261019-1200". */
export function branchWithJiraKey(branch: string, key: string | null): string {
  if (!key || branch.includes(key)) return branch;
  const i = branch.lastIndexOf('/');
  return i < 0 ? `${key}-${branch}` : `${branch.slice(0, i + 1)}${key}-${branch.slice(i + 1)}`;
}
