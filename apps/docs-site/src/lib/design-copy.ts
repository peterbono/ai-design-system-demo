// The design team's copy of a product (bridge.config.json products[].design), in designer words: the product page's
// card while there is none ("Make my copy"), the quiet line when the product moved on ("Get the latest"), and what
// each outcome says. Designers never read "fork", "branch" or "repository" here. Pure: tested in design-copy.test.ts.

import type { AppInstallation } from './access-view';
import type { GitHubBusy } from './github-busy';

/**
 * Where the copy stands for the page: none needed (no design copy set), missing, there (with how far behind), or not
 * known now because GitHub is busy for the viewer (never "missing": the page offers no "Make my copy" then).
 */
export type CopyView = { kind: 'none' } | { kind: 'missing' } | { kind: 'ready'; behind: number | null } | { kind: 'busy'; busy: GitHubBusy };

/**
 * How Bridge marks the designers' copy it makes (scripts/design-copy.ts markDesignCopy), so Add a product never lists a
 * copy as a product of its own (lib/add-product.ts isDesignCopy): a GitHub topic and the copy's description.
 */
export const DESIGN_COPY_TOPIC = 'bridge-design-copy';
export const DESIGN_COPY_DESCRIPTION = 'Bridge explorations for this product live here.';

export const COPY_WORDS = {
  intro: (product: string) => `Get your own copy of ${product} to explore in. The developers' code stays untouched.`,
  make: 'Make my copy',
  making: 'Making your copy. It takes about a minute.',
  made: (product: string) => `Your copy of ${product} is ready. Start an exploration in it.`,
  slow: 'Your copy is still being made. Come back in a minute.',
  turnedOff: (product: string) => `Copies of ${product} are turned off. Ask an admin to allow them.`,
  noAccess: (product: string) => `You cannot make a copy of ${product} yet. Ask an admin to give you access.`,
  behind: (product: string) => `${product} changed since your copy.`,
  getLatest: 'Get the latest',
  upToDate: 'Your copy is up to date.',
  conflict: 'Bridge could not bring the latest in on its own. Ask a developer to update your copy.',
  /** A running exploration of the copy that misses changes the product made since it started. */
  explorationBehind: (product: string) => `${product} changed since this exploration started.`,
  bringIn: 'Bring it in',
  broughtIn: 'The latest is in. Your preview updates in a few minutes.',
  bringConflict: 'Bridge could not bring it in on its own. Ask a developer.',
  bringFailed: 'Bridge could not bring it in. Try again in a minute.',
  failed: 'Bridge could not reach GitHub. Try again in a moment.',
  /** The copy is made but Bridge may not open it yet (Bridge sees only the products ticked on GitHub). */
  access: (copyName: string) => `One more step: let Bridge open your copy. Tick ${copyName} on GitHub, then Save.`,
  openGitHub: 'Open GitHub',
  accessWaiting: (copyName: string) => `Tick ${copyName} on GitHub, then Save. Bridge waits here.`,
  noCopyStart: (product: string) => `There is no copy of ${product} to explore in yet. Make one first: the developers' code stays untouched.`,
} as const;

/** The quiet line shows only when the product has moved on since the copy was made or last brought up to date. */
export const showsBehind = (v: CopyView | null | undefined): boolean => v?.kind === 'ready' && (v.behind ?? 0) > 0;

/** What "Make my copy" says once GitHub answered. */
export function madeLine(product: string, r: 'ready' | 'slow' | 'turned-off' | 'no-access' | 'failed'): string {
  switch (r) {
    case 'ready':
      return COPY_WORDS.made(product);
    case 'slow':
      return COPY_WORDS.slow;
    case 'turned-off':
      return COPY_WORDS.turnedOff(product);
    case 'no-access':
      return COPY_WORDS.noAccess(product);
    default:
      return COPY_WORDS.failed;
  }
}

/** What "Get the latest" says once GitHub answered. */
export const latestLine = (r: 'ok' | 'conflict' | 'failed'): string => (r === 'ok' ? COPY_WORDS.upToDate : r === 'conflict' ? COPY_WORDS.conflict : COPY_WORDS.failed);

/**
 * "Open in Claude Code" for an exploration in the design team's copy: claude.ai/code with the copy selected
 * (`repositories`) and the first message (`prompt`) naming the branch to work on, the goal and the preview. The link
 * cannot pick a branch, so the message does.
 */
export function claudeCodeUrl(x: { copy: string; branch: string; name: string; purpose?: string | null | undefined; product: string; previewUrl?: string | null | undefined }): string {
  const lines = [
    `Check out the branch ${x.branch} and work on it: it is the Bridge exploration "${x.name}" in the design team's copy of ${x.product}.`,
    ...(x.purpose?.trim() ? [`Goal: ${x.purpose.trim()}`] : []),
    ...(x.previewUrl ? [`Its preview: ${x.previewUrl}`] : []),
    'Use the Bridge library components and tokens. Push your changes to that branch so the preview updates.',
  ];
  const q = new URLSearchParams({ repositories: x.copy, prompt: lines.join('\n') });
  return `https://claude.ai/code?${q.toString()}`;
}

/** One installation of the Bridge app with what it sees: every product of the account ("all") or the ticked ones. */
export interface CopyInstallation extends AppInstallation {
  repository_selection?: string;
}

/**
 * The copy is made but Bridge cannot open it: the GitHub app sees only the products ticked on the copy's account, and
 * GitHub does not tick a new copy on its own. `installation` is the one to open on GitHub (its list of products and
 * Save). `name` is what GitHub lists: the copy's own name.
 */
export interface CopyAccess {
  kind: 'needs-access';
  copy: string;
  name: string;
  installation: CopyInstallation;
}

/**
 * What the copy's account lets Bridge see: every product ("all": nothing to do), only the ticked ones ("selected", with
 * the installation to adjust), or nothing (Bridge is not on that account).
 */
export function copyAccessTarget(list: readonly CopyInstallation[], copy: string): { kind: 'all' } | { kind: 'selected'; installation: CopyInstallation } | { kind: 'none' } {
  const owner = copy.split('/')[0]!.toLowerCase();
  const own = list.find((i) => i.account?.login?.toLowerCase() === owner);
  if (!own) return { kind: 'none' };
  return own.repository_selection === 'selected' ? { kind: 'selected', installation: own } : { kind: 'all' };
}

/** Whether `copy` ("owner/name") is among the products an installation lists (GitHub's names ignore case). */
export const copyListed = (repos: readonly { full_name?: string | null }[], copy: string): boolean =>
  repos.some((r) => r.full_name?.toLowerCase() === copy.toLowerCase());

/** The access step's outcome of "Make my copy", told apart from its words. */
export const needsCopyAccess = (r: unknown): r is CopyAccess => typeof r === 'object' && r !== null && (r as { kind?: unknown }).kind === 'needs-access';
