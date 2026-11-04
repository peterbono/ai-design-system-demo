// The design team's copy of a product (bridge.config.json products[].design), in designer words. The copy is a
// one-time team setup the admin chose in Add a product ("Give designers their own copy"): Bridge makes it right after
// the add, in the background (the product page's quiet line, for the admin or lead who added it), or, for a product
// added before that, inside "Start an exploration" (one action, a short wait). Nobody ever sees a "Make my copy" step.
// Also the quiet line when the product moved on ("Get the latest"), and what each outcome says. Designers never read
// "fork", "branch" or "repository" here. Pure: tested in design-copy.test.ts.

import type { AppInstallation } from './access-view';
import type { GitHubBusy } from './github-busy';

/**
 * Where the copy stands for the page: none needed (no design copy set), missing, there (with how far behind), or not
 * known now because GitHub is busy for the viewer (never "missing").
 */
export type CopyView = { kind: 'none' } | { kind: 'missing' } | { kind: 'ready'; behind: number | null } | { kind: 'busy'; busy: GitHubBusy };

/**
 * How Bridge marks the designers' copy it makes (scripts/design-copy.ts markDesignCopy), so Add a product never lists a
 * copy as a product of its own (lib/add-product.ts isDesignCopy): a GitHub topic and the copy's description.
 */
export const DESIGN_COPY_TOPIC = 'bridge-design-copy';
export const DESIGN_COPY_DESCRIPTION = 'Bridge explorations for this product live here.';

export const COPY_WORDS = {
  /** After the access step, or wherever Bridge waits for GitHub to build the copy. */
  making: 'Getting the copy ready. It takes about a minute.',
  /** Start an exploration on a product added before copies were made at add time: the one short wait. */
  startMaking: (product: string) => `Getting ${product} ready to explore. It takes about a minute.`,
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
  /** The copy is made but Bridge may not open it yet (Bridge sees only the products ticked on GitHub). Admins only. */
  access: (copyName: string) => `One more step: let Bridge open the designers' copy. Tick ${copyName} on GitHub, then Save.`,
  openGitHub: 'Open GitHub',
  accessWaiting: (copyName: string) => `Tick ${copyName} on GitHub, then Save. Bridge waits here.`,
} as const;

/** The product page's quiet line right after Add a product, for the admin or lead who added it (nobody else). */
export const COPY_SETUP_WORDS = {
  making: 'Getting a copy ready for your designers…',
  tryAgain: 'Try again',
} as const;

/** How making the copy ended, as scripts/design-copy.ts makeCopy and finishCopy answer it (the access step apart). */
export type CopyOutcome = 'ready' | 'slow' | 'turned-off' | 'no-access' | 'failed';

/**
 * What the admin or lead who added the product reads when the copy could not be made in the background, beside Try
 * again. `ask`: the copy is made, but only an admin can let Bridge open it and this viewer is not one.
 */
export function setupLine(product: string, r: Exclude<CopyOutcome, 'ready'> | 'ask'): string {
  switch (r) {
    case 'slow':
      return 'The copy for your designers is taking longer than usual.';
    case 'turned-off':
      return `Copies of ${product} are turned off on GitHub, so your designers have none yet.`;
    case 'no-access':
      return `GitHub did not let you make a copy of ${product} for your designers.`;
    case 'ask':
      return "An admin needs to let Bridge open your designers' copy.";
    default:
      return 'Bridge could not get a copy ready for your designers.';
  }
}

/**
 * What Start an exploration says when the copy it made first is not ready: the start waits, and Start tries again.
 * `ask`: only an admin can let Bridge open the new copy, and this viewer is not one.
 */
export function startCopyLine(product: string, r: Exclude<CopyOutcome, 'ready'> | 'ask'): string {
  switch (r) {
    case 'slow':
      return `${product} is still getting ready. Try again in a minute.`;
    case 'turned-off':
      return `Copies of ${product} are turned off. Ask an admin to allow them.`;
    case 'no-access':
      return `Bridge could not get ${product} ready with your sign-in. Ask an admin to start its first exploration.`;
    case 'ask':
      return `${product} is almost ready. Ask an admin to start its first exploration: that finishes the setup.`;
    default:
      return COPY_WORDS.failed;
  }
}

/**
 * What Start an exploration does once Bridge made the copy first: start (ready), the access step (an admin only), or
 * say why it waits.
 */
export function afterCopyFirst(r: CopyOutcome | CopyAccess, admin: boolean): { kind: 'start' } | { kind: 'access'; access: CopyAccess } | { kind: 'say'; line: (product: string) => string } {
  if (needsCopyAccess(r)) return admin ? { kind: 'access', access: r } : { kind: 'say', line: (p) => startCopyLine(p, 'ask') };
  if (r === 'ready') return { kind: 'start' };
  return { kind: 'say', line: (p) => startCopyLine(p, r) };
}

/**
 * The product page right after Add a product (this browser only, sessionStorage): Bridge makes the copy of this
 * product of this team in the background. Older than half an hour, it is forgotten (the start flow still makes the
 * copy if it never came).
 */
export const COPY_SETUP_MAX_MS = 30 * 60 * 1000;
export const copySetupKey = (team: string, product: string): string => `bridge:copy-setup:${team.toLowerCase()}:${product.toLowerCase()}`;
/** Notes the copy to make (Add a product, right before its page opens). Best effort: storage refused changes nothing. */
export function noteCopySetup(storage: Pick<Storage, 'setItem'> | null | undefined, team: string, product: string, now: number): void {
  try {
    storage?.setItem(copySetupKey(team, product), JSON.stringify({ at: now }));
  } catch {
    /* storage refused: the first exploration makes the copy instead */
  }
}
export function copySetupFresh(raw: string | null | undefined, now: number): boolean {
  if (!raw) return false;
  try {
    const at = (JSON.parse(raw) as { at?: unknown }).at;
    return typeof at === 'number' && now - at >= 0 && now - at < COPY_SETUP_MAX_MS;
  } catch {
    return false;
  }
}

/** The quiet line shows only when the product has moved on since the copy was made or last brought up to date. */
export const showsBehind = (v: CopyView | null | undefined): boolean => v?.kind === 'ready' && (v.behind ?? 0) > 0;

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

/** The access step's outcome of making the copy, told apart from the others. */
export const needsCopyAccess = (r: unknown): r is CopyAccess => typeof r === 'object' && r !== null && (r as { kind?: unknown }).kind === 'needs-access';
