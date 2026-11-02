// The site's "Sign in" and "Get started" ([data-session-cta]) for someone already signed in on this browser: "Open
// Studio", to their team (lib/signin-continue.ts sessionCta). Signed out, they stay as built.
import { sessionCta } from '../lib/signin-continue';
import { loadRecentTeams, loadTeamNames } from '../lib/recent-teams';

export async function initSessionCta(): Promise<void> {
  const ctas = [...document.querySelectorAll<HTMLAnchorElement>('a[data-session-cta]')];
  if (!ctas.length) return;
  let cta: { label: string; href: string } | null = null;
  try {
    const { getAccount, workingGitHubToken } = await import('./account-session');
    const { account } = await getAccount().catch(() => ({ account: null }));
    const recent = loadRecentTeams();
    if (account) cta = sessionCta({ account, recent, teamNames: loadTeamNames() });
    else if (await workingGitHubToken().catch(() => null)) cta = { label: 'Open Studio', href: sessionCta({ account: null, github: { login: 'you' }, recent })!.href };
  } catch {
    return;
  }
  if (!cta) return;
  for (const a of ctas) {
    a.setAttribute('href', cta.href);
    const label = a.querySelector<HTMLElement>('[data-session-cta-label]');
    if (label) label.textContent = cta.label;
  }
}
