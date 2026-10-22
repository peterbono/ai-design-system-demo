// Studio Settings: the plain words behind two rows. Pure helpers, covered by settings-view.test.ts.
//
// - Approvals as a rule list without tier numbers, built from the Risk tiers table of docs/GOVERNANCE.md (the same
//   rows How review works shows), so the plain list never drifts from the rules.
// - The Account block for each connection state.
// - How changes reach your code: the two modes in words (shared with the onboarding checklist), what the GitHub App
//   may do on the repository, and the format-preserving edit of `changes` in bridge.config.json.
import { fromPlain, getEntry, parseJson, serializeJson, soloOwnerOf, soloOwnerSentence, toPlain, type ChangesMode, type JsonObject, type Owners, type Rights } from '@bridge-ds/core';
import type { TierSummary } from './governance';
import { noReachText, readOnlyText, type SignInApp } from './github-signin';
import { teamDisplayName } from './demo';

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
        detail: noReach ? noReachText(login, at.repo) : readOnly ? readOnlyText(login, at.repo, true) : teamDisplayName(at.repo),
        // A token pasted before the site had Sign in with GitHub: no token paste any more, only the way out.
        action: app ? 'Sign out' : at.signIn ? 'Disconnect' : 'Reconnect GitHub',
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

/**
 * Settings > Review rules: the only-owner line, shown when governance.soloOwnerCanApproveBoth is on and the owners
 * are one person holding both roles (core soloOwnerOf). Null otherwise: the line is not shown.
 */
export function soloOwnerRow(gov: { owners: Owners; rights: Rights | null; soloOwnerCanApproveBoth: boolean }): { label: string; help: string; value: string } | null {
  const login = soloOwnerOf(gov);
  if (!login) return null;
  return { label: 'Only owner', help: 'A design system run by one person.', value: soloOwnerSentence(login) };
}

// ---------------------------------------------------------------------------------------------------------------
// How changes reach your code (bridge.config.json `changes`)

export interface ChangesChoice {
  title: string;
  /** The first words, in bold: what Bridge does or does not do in the code. */
  lead?: string;
  text: string;
  /** What the GitHub App needs for this mode, in one line. */
  needs: string;
}

/** The two modes, in the words of the onboarding step and the Settings band. Suggestions first: the default. */
export const CHANGES_CHOICE: Record<ChangesMode, ChangesChoice> = {
  suggest: {
    title: 'Suggestions your developers apply',
    lead: 'Bridge writes nothing in your code.',
    text: 'Each kept change becomes a GitHub issue on your design system repo, with the exact change, previews and checks.',
    needs: 'Needs permission to create issues only',
  },
  direct: {
    title: 'Bridge opens pull requests',
    text: 'Bridge writes each kept change on a new branch of your repo and opens a pull request for review. For teams who want it.',
    needs: 'Needs write access to the repo',
  },
};

export const CHANGES_ORDER: readonly ChangesMode[] = ['suggest', 'direct'];

/** What a kept change becomes, in one short line (the onboarding checklist and the home). */
export const CHANGES_SHORT: Record<ChangesMode, string> = {
  suggest: 'Suggestions your developers apply',
  direct: 'Pull requests Bridge opens',
};

/**
 * While only today's GitHub App exists (it can write code wherever it is installed), suggest mode is a rule Bridge
 * keeps, not a permission GitHub enforces. Settings says so plainly.
 */
export const INTERIM_APP_TEXT = "Bridge's GitHub App can still write code on this repo. Suggest mode is a Bridge rule until the read-only app ships.";

/** With the read-only app configured, GitHub itself keeps suggest mode: Studio signs in with an app that cannot write code. */
export const READ_ONLY_APP_TEXT = "In this mode Studio signs in with Bridge's read-only GitHub App: it can read code and create issues, never write code.";

/**
 * The line Settings shows about suggest mode, from the app Studio signs in with in that mode (SignInConfig.suggestApp):
 * the read-only app, the interim sentence for the one write app, nothing without a GitHub App (a pasted token).
 */
export function suggestAppText(app: SignInApp | null | undefined): string | null {
  if (app === 'suggest') return READ_ONLY_APP_TEXT;
  if (app === 'direct') return INTERIM_APP_TEXT;
  return null;
}

/** `changes` as the file says it: null when the key is absent (Bridge then sends suggestions, the default). */
export function changesInConfig(raw: { changes?: unknown } | null | undefined): ChangesMode | null {
  const v = raw?.changes;
  return v === 'suggest' || v === 'direct' ? v : null;
}

/** The mode in force: the file's, else the default (suggestions). */
export const effectiveChanges = (set: ChangesMode | null): ChangesMode => set ?? 'suggest';

/** Installation permissions, as GET /user/installations lists them ("read", "write", "admin"). */
export type AppPermissions = Partial<Record<'contents' | 'issues' | 'pull_requests' | 'metadata' | 'administration', string>>;

export interface AppReach {
  /** Can commit to the repository (contents write). */
  writesCode: boolean;
  /** One sentence: what the app may do, in plain words. */
  text: string;
}

const canWrite = (v: string | undefined) => v === 'write' || v === 'admin';

/** What the app installed on the repository may do, from its installation permissions. */
export function appReach(p: AppPermissions): AppReach {
  const code = canWrite(p.contents);
  const prs = canWrite(p.pull_requests);
  const issues = canWrite(p.issues);
  const parts = [code ? 'write code' : p.contents ? 'read code' : null, prs ? 'open pull requests' : null, issues ? 'create issues' : null].filter((x): x is string => Boolean(x));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'only read who you are');
  return { writesCode: code, text: `Can ${list} on this repo.` };
}

/** bridge.config.json with `changes` set to `mode`, everything else byte for byte. A new key goes after `version`. */
export function withChanges(configText: string, mode: ChangesMode): string {
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('bridge.config.json is not a JSON object.');
  const root = doc.root as JsonObject;
  const entry = getEntry(root, 'changes');
  if (entry && toPlain(entry.value) === mode) return configText;
  const node = fromPlain(mode, entry?.value, true);
  if (entry) entry.value = node;
  else {
    const at = root.entries.findIndex((e) => e.key === 'version');
    root.entries.splice(at >= 0 ? at + 1 : root.entries.length, 0, { key: 'changes', value: node });
  }
  root.raw = undefined;
  return serializeJson(doc);
}

export interface ChangesProposal {
  branch: string;
  title: string;
  body: string;
  message: string;
}

/** Branch, title, body and commit message of the pull request that sets `changes`. */
export function changesProposal(mode: ChangesMode, opts: { date: Date; prefix?: string; tierLabel: string; suggestApp?: SignInApp | null }): ChangesProposal {
  const appLine = mode === 'suggest' ? suggestAppText(opts.suggestApp) : null;
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const c = CHANGES_CHOICE[mode];
  const title = mode === 'suggest' ? 'chore(config): send kept changes as suggestions' : 'chore(config): open pull requests for kept changes';
  const body = [
    '## How changes reach the code',
    '',
    `Sets \`changes\` to \`"${mode}"\` in \`bridge.config.json\`.`,
    '',
    `- ${c.title}. ${c.lead ? `${c.lead} ` : ''}${c.text}`,
    `- ${c.needs}.`,
    ...(appLine ? [`- ${appLine}`] : []),
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio.',
  ].join('\n');
  return { branch: `${opts.prefix ?? ''}changes-${mode}-${stamp}`, title, body, message: `${title}\n\nProposed from Bridge Studio.` };
}
