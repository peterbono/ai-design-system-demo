// Studio Settings: the plain words behind two rows. Pure helpers, covered by settings-view.test.ts.
//
// - Approvals as a rule list without tier numbers, built from the Risk tiers table of docs/GOVERNANCE.md (the same
//   rows How review works shows), so the plain list never drifts from the rules.
// - The Account block for each connection state, and the owner override as one line.
import type { TierSummary } from './governance';
import { noReachText, readOnlyText } from './github-signin';

export interface ApprovalRule {
  tier: number;
  /** What kind of change, in plain words ("Token changes"). */
  what: string;
  /** Who approves it ("design owner + tech owner"). */
  who: string;
}

/**
 * Plain names for the kinds of change, matched against the Examples cell of each tier. A rewrite applies only while
 * its pattern still matches the governance text; otherwise the row falls back to the governance example itself.
 */
const PLAIN_WHAT: { match: RegExp; what: string }[] = [
  { match: /^token\b/i, what: 'Token changes' },
  { match: /^new component\b/i, what: 'New component or variant' },
  { match: /^docs\b/i, what: 'Docs fixes' },
];

const NUMBER_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three' };

/** "Design owner **and** tech owner, mandatory" -> "design owner + tech owner"; "1 code owner" -> "one owner". */
export function plainApprovals(markdown: string): string {
  const text = markdown
    .replace(/\*\*|__|`/g, '')
    .replace(/,\s*mandatory\b/i, '')
    .replace(/\s+(?:and|\+)\s+/gi, ' + ')
    .replace(/(\d+)\s+code\s+owners?/gi, (_, n: string) => `${NUMBER_WORD[Number(n)] ?? n} ${Number(n) === 1 ? 'owner' : 'owners'}`)
    .trim();
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** One rule per tier, the riskiest first (token changes lead, docs fixes close the list). */
export function approvalRules(tiers: Pick<TierSummary, 'tier' | 'approvals' | 'example'>[]): ApprovalRule[] {
  return [...tiers]
    .sort((a, b) => b.tier - a.tier)
    .map((t) => ({
      tier: t.tier,
      what: PLAIN_WHAT.find((p) => p.match.test(t.example.trim()))?.what ?? t.example,
      who: plainApprovals(t.approvals),
    }))
    .filter((r) => r.what && r.who);
}

/** The rule as one sentence: "Token changes: design owner + tech owner." */
export const ruleSentence = (r: ApprovalRule) => `${r.what}: ${r.who}.`;

/** Settings > Account: the four states of the GitHub connection, as the page shows them. */
export type AccountState = 'checking' | 'connected' | 'readonly' | 'rejected';

export interface AccountView {
  /** Read only or refused: the page's one Harbor zone, with a drawing and the primary action. */
  zone: boolean;
  title: string;
  detail?: string;
  /**
   * The one action: connect or sign in (primary, in the zone), or change the token or sign out (quiet, on the
   * connected row).
   */
  action?: string;
  /** What the action does: sign in with GitHub, open the token dialog, or sign out. */
  actionKind?: 'signin' | 'token' | 'signout';
  /** What the token may do on the library, once GitHub said so. */
  badge?: { label: string; tone: 'success' | 'neutral' };
}

export interface AccountFacts {
  login?: string;
  write: boolean | null;
  repo: string;
  /** How the browser holds access: a pasted token (default) or a Sign in with GitHub session. */
  mode?: 'token' | 'app';
  /** The site has a GitHub App, so Sign in with GitHub is the way in (docs/SIGN-IN.md). */
  signIn?: boolean;
  /** Signed in: false when the app does not reach the repository for this account (wrong account, not installed). */
  reach?: boolean | null;
}

export function accountView(state: AccountState, at: AccountFacts): AccountView {
  const app = at.mode === 'app';
  switch (state) {
    case 'checking':
      return { zone: false, title: 'Checking your GitHub connection.' };
    case 'connected': {
      const login = at.login ?? 'This account';
      const noReach = app && at.reach === false;
      const readOnly = app && !noReach && at.write === false;
      return {
        zone: false,
        title: at.login ? `Connected as @${at.login}` : 'Connected to GitHub',
        detail: noReach ? noReachText(login, at.repo) : readOnly ? readOnlyText(login, at.repo, true) : at.repo,
        // A token pasted before the site had Sign in with GitHub: no token paste any more, only the way out.
        action: app ? 'Sign out' : at.signIn ? 'Disconnect' : 'Change token',
        actionKind: app || at.signIn ? 'signout' : 'token',
        badge: noReach
          ? { label: 'No access', tone: 'neutral' }
          : at.write === null
            ? undefined
            : at.write
              ? { label: 'Can edit', tone: 'success' }
              : { label: 'Read only', tone: 'neutral' },
      };
    }
    case 'rejected':
      return app
        ? {
            zone: true,
            title: 'Your GitHub sign-in expired.',
            detail: 'Studio could not renew it. Sign in again to keep editing.',
            action: 'Sign in again',
            actionKind: 'signin',
          }
        : {
            zone: true,
            title: 'Your GitHub token stopped working.',
            detail: 'GitHub no longer accepts it: it was revoked, regenerated or has expired. Connect again to keep editing.',
            action: 'Reconnect GitHub',
            actionKind: at.signIn ? 'signin' : 'token',
            ...(at.signIn ? { detail: 'GitHub no longer accepts it: it was revoked, regenerated or has expired. Sign in to keep editing.', action: 'Sign in with GitHub' } : {}),
          };
    case 'readonly':
      return at.signIn
        ? {
            zone: true,
            title: 'Sign in with GitHub to approve and request reviews.',
            detail: `Until then Studio only reads ${at.repo}.`,
            action: 'Sign in with GitHub',
            actionKind: 'signin',
          }
        : {
            zone: true,
            title: 'Connect GitHub to approve and request reviews.',
            detail: `Until then Studio only reads ${at.repo}.`,
            action: 'Connect GitHub',
            actionKind: 'token',
          };
  }
}

/** The owner override in one line, for its fold in Review rules. */
export function overrideText(o: { allowed: string[]; requireReason?: boolean; minReasonLength?: number }): { on: boolean; text: string } {
  if (!o.allowed.length) return { on: false, text: 'Every branch waits for its approvals before it is merged.' };
  const who = o.allowed.map((l) => `@${l}`).join(', ');
  const reason = o.requireReason ? `, with a written reason of ${o.minReasonLength ?? 0} characters or more` : '';
  return { on: true, text: `${who} may merge a branch when only approvals are missing${reason}.` };
}
