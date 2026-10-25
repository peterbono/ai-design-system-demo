// "Connect my design system" (start screen) and "Connect your design system" (the demo's Sample data banner): the
// browser workspace exists from now on. Signed out, sign in with GitHub first and come back on the setup step; without
// Sign in with GitHub on this site, the workspace's step 1 offers the token.
import { rememberStart } from './start';
import { currentViewer, prefersSignIn, SignInError, startSignIn } from './github-session';

export function connectDesignSystem(e: Event, href: string) {
  rememberStart({ connect: true });
  if (currentViewer() || !prefersSignIn()) return;
  e.preventDefault();
  startSignIn(href).catch((err: unknown) => {
    // Sign-in could not start here (storage blocked, no Web Crypto): the setup's step 1 says how to go on.
    if (err instanceof SignInError) location.assign(href);
  });
}
