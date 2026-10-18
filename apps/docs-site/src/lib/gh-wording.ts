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
