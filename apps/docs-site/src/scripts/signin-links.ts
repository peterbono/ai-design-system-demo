// Every "Sign in" link of the product that comes back to the page it was clicked on ([data-signin-next], the side nav's
// Sign in): its address is the one sign-in screen (pages/signin.astro) with ?next=<this page>, filled in the browser
// since the page's address (a team shell, a query) is only known here.
import { signInHref } from '../lib/account';

export function initSignInLinks(root: ParentNode = document) {
  const fill = () => {
    const here = location.pathname + location.search + location.hash;
    root.querySelectorAll<HTMLAnchorElement>('a[data-signin-next]').forEach((a) => a.setAttribute('href', signInHref(here)));
  };
  fill();
  // The address may change in place (filters, ?pr=): the link takes it at click time too.
  document.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a[data-signin-next]')) fill();
  }, true);
}
