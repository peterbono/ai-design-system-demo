// The words of the one way in to GitHub, in one place. With a GitHub App (GITHUB_APP_CLIENT_ID at build) the site
// says "Sign in"; without one (forks, local dev) the token paste is the way in and the site says "Connect GitHub".
// Callers pass whether sign-in is configured: signInConfig() at build, prefersSignIn() in the browser.

/** The bare verb, for a sentence: "Sign in" or "Connect GitHub"; again: "Sign in again" or "Reconnect GitHub". */
export function ghVerb(signIn: boolean, again = false): string {
  if (signIn) return again ? 'Sign in again' : 'Sign in';
  return again ? 'Reconnect GitHub' : 'Connect GitHub';
}

/** An action with its goal: ghAction('send', true) is "Sign in to send", false gives "Connect GitHub to send". */
export function ghAction(goal: string, signIn: boolean, again = false): string {
  return `${ghVerb(signIn, again)} to ${goal}`;
}

/** The standalone button: "Sign in with GitHub" or "Connect GitHub". */
export function ghButton(signIn: boolean): string {
  return signIn ? 'Sign in with GitHub' : 'Connect GitHub';
}

/**
 * GitHub's hourly read limit ran out. Signed out: anonymous reads and the two ways out. Signed in (`signedIn`): the
 * limit of the viewer's own account, never "anonymous" nor "Sign in", with when it resets (accountLimitLine).
 */
export function rateLimitedLine(signIn: boolean, opts: { signedIn?: boolean; resetAt?: Date | null; now?: number } = {}): string {
  if (opts.signedIn) return accountLimitLine(opts.resetAt ?? null, opts.now);
  return `GitHub limits anonymous reads to 60 an hour and this browser has used them. ${ghVerb(signIn)}, or try again later.`;
}

/** The time a limit resets, as the viewer's clock shows it ("14:32"). */
export const resetClock = (at: Date): string => at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * A signed-in viewer reached GitHub's hourly limit (every Bridge tab and tool on their account shares it): what
 * happened and when it comes back, in plain words. `what`: what could not be shown ("Recent changes").
 */
export function accountLimitLine(resetAt: Date | null, now = Date.now(), what?: string): string {
  const head = what ? `${what} cannot be shown right now: GitHub's hourly limit for your account is reached.` : "GitHub's hourly limit for your account is reached.";
  if (!resetAt || !Number.isFinite(resetAt.getTime())) return `${head} It resets within the hour, then reload the page.`;
  const min = Math.max(1, Math.ceil((resetAt.getTime() - now) / 60000));
  return `${head} It resets at ${resetClock(resetAt)} (in ${min} min), then reload the page.`;
}

// ---------------------------------------------------------------------------------------------------------------
// How a change reaches the code (bridge.config.json "changes"). "suggest" (the default): Studio sends a suggestion
// that the DS lead reviews and a developer applies; "direct": Studio opens a branch and asks for review. The words
// below are the one source for both, so a designer never reads "issue", "pull request" or "commit" on a send.
// Pure: the mode comes from the caller (siteRepo().changes at build, changesModeOnPage() in the browser).

/** How changes reach the code. Same values as core's ChangesMode. */
export type SendMode = 'suggest' | 'direct';

/** What a Studio surface sends. */
export type SendWhat = 'tokens' | 'piece' | 'docs' | 'brand' | 'revert';

const SEND_BUTTON: Record<SendWhat, Record<SendMode, string>> = {
  tokens: { suggest: 'Send suggestion', direct: 'Send for review' },
  piece: { suggest: 'Send suggestion', direct: 'Send for review' },
  docs: { suggest: 'Send suggestion', direct: 'Send for review' },
  brand: { suggest: 'Send suggestion', direct: 'Send for review' },
  revert: { suggest: 'Send suggestion', direct: 'Send for review' },
};

/**
 * The one verb that sends, whatever is sent (tokens, a product piece, docs, a brand, an undo): "Send suggestion" in
 * suggest mode, "Send for review" in direct mode. Branch and pull request words stay internal or under "For developers".
 */
export function sendButton(what: SendWhat, mode: SendMode): string {
  return SEND_BUTTON[what][mode];
}

/** The goal after "Sign in to": "send a suggestion" or "send it for review". */
export function sendGoal(_what: SendWhat, mode: SendMode): string {
  return mode === 'suggest' ? 'send a suggestion' : 'send it for review';
}

/** Title of the send dialog: "Send a suggestion" or "Send for review". */
export function sendDialogTitle(mode: SendMode): string {
  return mode === 'suggest' ? 'Send a suggestion' : 'Send for review';
}

/** The status line while it goes out: "Sending your suggestion" or "Sending it for review". */
export function sendingLine(mode: SendMode): string {
  return mode === 'suggest' ? 'Sending your suggestion' : 'Sending it for review';
}

/** The done state of a send in direct mode: "Sent for review". */
export const SENT_FOR_REVIEW = 'Sent for review';

/** What happens after a suggestion, in one sentence: who reviews it and who applies it. */
export const SUGGEST_NEXT = 'Your DS lead reviews it. Once approved, a developer applies it to the code.';

/** The done line of a suggestion: "Suggestion #42 sent to your DS lead. A developer applies it once approved." */
export function suggestionSentLine(n: number): string {
  return `Suggestion #${n} sent to your DS lead. A developer applies it once it is approved.`;
}

/** The title of the done state: "Suggestion sent". */
export const SUGGESTION_SENT = 'Suggestion sent';

/** Link to a sent suggestion: plain words, the GitHub page behind it. */
export const SEE_SUGGESTION = 'See the suggestion';

/** The error line when nothing went out: "Not sent: ...", whatever the mode. */
export function notSentLine(_mode: SendMode, why: string): string {
  return `Not sent: ${why}`;
}

/**
 * Why a branch action is not offered in suggest mode: "This design system takes suggestions, so Bridge does not add
 * to branches here. Send your edits as a suggestion instead." `instead` is the way out, when there is one.
 */
export function suggestOnlyLine(action: string, instead?: string): string {
  return `This design system takes suggestions, so Bridge does not ${action} here.${instead ? ` ${instead}` : ''}`;
}

/** Why an exploration does not start in suggest mode: it is a branch. Shown on the start form and when it is asked for. */
export const EXPLORATION_SUGGEST_INSTEAD = 'An exploration is a separate copy of the library: a developer of the team can start one from Claude Code.';
export const EXPLORATION_SUGGEST_LINE = suggestOnlyLine('start explorations', EXPLORATION_SUGGEST_INSTEAD);

// ---------------------------------------------------------------------------------------------------------------
// Saving to branches on a team page (multi-team plan 3.2, PR 3d). Everyone signs in with Bridge, which reads and sends
// suggestions. A team in direct mode saves changes on branches: the first time someone does that, Bridge asks GitHub
// for one more OK (the Bridge Direct app). Designer words only: no "OAuth", "token", "scope" or "pull request".

/** The explainer before GitHub's OK screen: why, what it allows, and the limit. */
export const DIRECT_CONSENT = {
  title: 'Allow Bridge to save your changes',
  lead: 'This team saves each change on its own. To start one for you, Bridge needs one more OK from GitHub. You only give it once.',
  canTitle: 'With it, Bridge can',
  can: ['Start a change and save your edits to it', 'Ask for review, and ship a change once it is approved'],
  limit: 'Bridge never does more than your own access on GitHub allows.',
  continueLabel: 'Continue on GitHub',
  later: 'Not now',
  /** Under the action that asked, while the dialog is open: what to do, then do it again. */
  needed: 'Allow Bridge to save your changes, then try again.',
  /** The OK was given with another GitHub account than the one signed in to Bridge. */
  otherAccount: (got: string, want: string) => `GitHub gave the OK for @${got}, but you are signed in to Bridge as @${want}. Switch to @${want} on GitHub, then continue.`,
  /** The OK expired or was taken back on GitHub. */
  expired: 'Your OK to save changes expired. Continue on GitHub to give it again.',
} as const;

/** Bridge Direct is not set up on the team's repository: admins install it, everyone else asks their lead. */
export const DIRECT_SETUP = {
  title: 'Saving changes is not set up yet',
  installLabel: 'Install Bridge Direct',
  askLabel: 'Ask your lead',
  copied: 'Message copied',
  /** Under the action that asked. */
  needed: 'Saving changes is not set up for this team yet.',
} as const;

/** The setup sentence: an admin can finish it in a minute; anyone else asks their lead. */
export function directSetupLine(repo: string, admin: boolean): string {
  return admin
    ? `Bridge needs one more app on ${repo} to save changes. Install Bridge Direct on GitHub, pick ${repo.split('/')[1] ?? repo}, then try again. It takes a minute.`
    : `Your lead needs to add one more app on ${repo} before Bridge can save changes. Send them a message: it takes them a minute.`;
}

/** What a teammate sends their lead when Bridge Direct is missing on the repository. */
export function askDirectInstallMessage(repo: string, install: string, link: string): string {
  return `Hi, can you install Bridge Direct on github.com/${repo}? Bridge needs it to save our changes. It takes a minute: ${install} (pick ${repo.split('/')[1] ?? repo}). Then we keep working at ${link}`;
}
