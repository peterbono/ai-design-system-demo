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

/** Anonymous reads ran out: what happened and the two ways out. */
export function rateLimitedLine(signIn: boolean): string {
  return `GitHub limits anonymous reads to 60 an hour and this browser has used them. ${ghVerb(signIn)}, or try again later.`;
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
  tokens: { suggest: 'Send suggestion', direct: 'Request review' },
  piece: { suggest: 'Suggest to the library', direct: 'Open a library branch' },
  docs: { suggest: 'Suggest docs change', direct: 'Request review' },
  brand: { suggest: 'Send suggestion', direct: 'Create branch' },
  revert: { suggest: 'Send suggestion', direct: 'Request review' },
};

/** The button that sends: "Send suggestion" in suggest mode; the branch words ("Request review") in direct mode. */
export function sendButton(what: SendWhat, mode: SendMode): string {
  return SEND_BUTTON[what][mode];
}

/** The goal after "Sign in to": "send a suggestion", or the direct one ("request review", "create the branch"). */
export function sendGoal(what: SendWhat, mode: SendMode): string {
  if (mode === 'suggest') return what === 'piece' ? 'suggest it to the library' : 'send a suggestion';
  return what === 'brand' ? 'create the branch' : what === 'piece' ? 'open a library branch' : 'request review';
}

/** Title of the send dialog: "Send a suggestion" or "Create branch". */
export function sendDialogTitle(mode: SendMode): string {
  return mode === 'suggest' ? 'Send a suggestion' : 'Create branch';
}

/** The status line while it goes out: "Sending your suggestion" or "Creating the branch". */
export function sendingLine(mode: SendMode): string {
  return mode === 'suggest' ? 'Sending your suggestion' : 'Creating the branch';
}

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

/** The error line when nothing went out: "Not sent: ..." for a suggestion, "Not created: ..." for a branch. */
export function notSentLine(mode: SendMode, why: string): string {
  return `${mode === 'suggest' ? 'Not sent' : 'Not created'}: ${why}`;
}

/**
 * Why a branch action is not offered in suggest mode: "This design system takes suggestions, so Bridge does not add
 * to branches here. Send your edits as a suggestion instead." `instead` is the way out, when there is one.
 */
export function suggestOnlyLine(action: string, instead?: string): string {
  return `This design system takes suggestions, so Bridge does not ${action} here.${instead ? ` ${instead}` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Saving to branches on a team page (multi-team plan 3.2, PR 3d). Everyone signs in with Bridge, which reads and sends
// suggestions. A team in direct mode saves changes on branches: the first time someone does that, Bridge asks GitHub
// for one more OK (the Bridge Direct app). Designer words only: no "OAuth", "token", "scope" or "pull request".

/** The explainer before GitHub's OK screen: why, what it allows, and the limit. */
export const DIRECT_CONSENT = {
  title: 'Allow Bridge to save to branches',
  lead: 'This team saves changes on branches. To start one for you, Bridge needs one more OK from GitHub. You only give it once.',
  canTitle: 'With it, Bridge can',
  can: ['Start a branch and save your edits to it', 'Ask for review, and ship a change once it is approved'],
  limit: 'Bridge never does more than your own access on GitHub allows.',
  continueLabel: 'Continue on GitHub',
  later: 'Not now',
  /** Under the action that asked, while the dialog is open: what to do, then do it again. */
  needed: 'Allow Bridge to save to branches, then try again.',
  /** The OK was given with another GitHub account than the one signed in to Bridge. */
  otherAccount: (got: string, want: string) => `GitHub gave the OK for @${got}, but you are signed in to Bridge as @${want}. Switch to @${want} on GitHub, then continue.`,
  /** The OK expired or was taken back on GitHub. */
  expired: 'Your OK to save to branches expired. Continue on GitHub to give it again.',
} as const;

/** Bridge Direct is not set up on the team's repository: admins install it, everyone else asks their lead. */
export const DIRECT_SETUP = {
  title: 'Saving to branches is not set up yet',
  installLabel: 'Install Bridge Direct',
  askLabel: 'Ask your lead',
  copied: 'Message copied',
  /** Under the action that asked. */
  needed: 'Saving to branches is not set up for this team yet.',
} as const;

/** The setup sentence: an admin can finish it in a minute; anyone else asks their lead. */
export function directSetupLine(repo: string, admin: boolean): string {
  return admin
    ? `Bridge needs one more app on ${repo} to save to branches. Install Bridge Direct on GitHub, pick ${repo.split('/')[1] ?? repo}, then try again. It takes a minute.`
    : `Your lead needs to add one more app on ${repo} before Bridge can save to branches. Send them a message: it takes them a minute.`;
}

/** What a teammate sends their lead when Bridge Direct is missing on the repository. */
export function askDirectInstallMessage(repo: string, install: string, link: string): string {
  return `Hi, can you install Bridge Direct on github.com/${repo}? Bridge needs it to save our changes to branches. It takes a minute: ${install} (pick ${repo.split('/')[1] ?? repo}). Then we keep working at ${link}`;
}
