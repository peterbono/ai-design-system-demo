// How changes reach the code on this page: bridge.config.json "changes", from the repository settings (siteConfig in
// scripts/repo-context.ts: the layout's #bridge-repo, or the team's config on a team shell). Until the read-only GitHub App ships, suggest mode is a Bridge rule enforced here: every Studio send
// files a suggestion, and every branch or pull request write refuses with a plain sentence (assertBranchWrites).
import { DEFAULT_CHANGES_MODE, type ChangesMode } from '@bridge-ds/core';
import { suggestOnlyLine } from '../lib/gh-wording';
import { siteConfig } from './repo-context';

/** "suggest" (the default, also when the page says nothing) or "direct". */
export function changesModeOnPage(): ChangesMode {
  try {
    const site = siteConfig() as { changes?: unknown };
    return site.changes === 'direct' ? 'direct' : DEFAULT_CHANGES_MODE;
  } catch {
    return DEFAULT_CHANGES_MODE;
  }
}

/** Thrown when a branch or pull request write is asked for in suggest mode. Its message is the sentence to show. */
export class SuggestOnlyError extends Error {
  constructor(action: string, instead?: string) {
    super(suggestOnlyLine(action, instead));
    this.name = 'SuggestOnlyError';
  }
}

/**
 * Stops a branch or pull request write in suggest mode, before any GitHub call. `action` completes "Bridge does not
 * ... here" ("add to branches"); `instead` is the way out, when there is one.
 */
export function assertBranchWrites(action: string, instead?: string, mode: ChangesMode = changesModeOnPage()): void {
  if (mode === 'suggest') throw new SuggestOnlyError(action, instead);
}
