// An email member's way to their Studio (lib/email-studio.ts) in the browser: on Bridge's own Studio (/studio/...) they
// are sent to the same page of their team's address; on the Library and the site, the Studio links and the Library <->
// Studio switch point at that address. Signed out, or signed in with GitHub, nothing changes. Team addresses and team
// Libraries carry their team already: left alone.
import { emailMemberTeam, emailStudioLink, emailStudioRedirect, memberStudioRedirect, teamStudioRoute } from '../lib/email-studio';
import { isHostedSite, STUDIO_ROOT, teamHref } from '../lib/team-path';
import { loadRecentTeams } from '../lib/recent-teams';
import { loadReserved } from '../lib/team-open';

/** The teams this browser's person joined by email: the session hints, else the account's answer. */
async function emailTeams(onStudio: boolean): Promise<string[]> {
  const { contributorRepos } = await import('./contribute-session');
  const hinted = contributorRepos();
  // The hints are written at sign-in; only the Studio asks the server too (Library readers are mostly signed out).
  if (hinted.length || !onStudio) return hinted;
  try {
    const { getAccount } = await import('./account-session');
    const { account } = await getAccount();
    return account ? account.teams.filter((t) => t.via === 'email').map((t) => t.repo) : [];
  } catch {
    return [];
  }
}

export async function initEmailStudio(): Promise<void> {
  const html = document.documentElement;
  if (html.hasAttribute('data-hosted') || html.hasAttribute('data-library-shell') || html.hasAttribute('data-no-repo')) return;
  const { signedInWithGitHub } = await import('./github-session');
  if (signedInWithGitHub()) return initMemberStudio(true);
  void initMemberStudio(false);
  const teams = await emailTeams(location.pathname.startsWith(STUDIO_ROOT) || location.pathname === STUDIO_ROOT.slice(0, -1));
  if (!teams.length) return;
  const [{ repoContext }, reserved] = await Promise.all([import('./repo-context'), loadReserved().catch(() => null)]);
  const ctx = repoContext();
  const pageRepo = ctx.owner && ctx.repo ? `${ctx.owner}/${ctx.repo}` : null;
  const recent = loadRecentTeams();
  const to = emailStudioRedirect({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    github: false,
    teamPage: false,
    emailTeams: teams,
    recent,
    pageRepo,
    reserved,
  });
  if (to) return location.replace(to);
  const team = emailMemberTeam(teams, recent, pageRepo);
  if (!team) return;
  // The Library and the site: every build-time Studio link, and the switch, go to the team's address.
  for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[href^="${STUDIO_ROOT.slice(0, -1)}"]`)) {
    if (a.hasAttribute('data-demo-link')) continue;
    const href = emailStudioLink(a.getAttribute('href')!, team, reserved);
    if (href) a.setAttribute('href', href);
  }
  const root = teamHref(team.owner, team.repo, reserved);
  for (const el of document.querySelectorAll<HTMLAnchorElement>('a[data-space-switch][data-switch-space="library"]')) el.dataset.studioRoot = root;
  const { refreshSpaceSwitch } = await import('./space-switch');
  refreshSpaceSwitch();
}

/**
 * The hosted site's /studio/ shows Bridge's own design system to everyone. Someone on that team works at its team
 * address instead (lib/email-studio.ts memberStudioRedirect), so their role and what waits on them read the same as on
 * every team page: signed in with GitHub, once GitHub says they can change it; otherwise when their Bridge account lists
 * the team. A visitor stays on the showcase.
 */
async function initMemberStudio(github: boolean): Promise<void> {
  if (!isHostedSite() || teamStudioRoute(location.pathname) === null) return;
  const { repoContext } = await import('./repo-context');
  const ctx = repoContext();
  const pageRepo = ctx.owner && ctx.repo ? `${ctx.owner}/${ctx.repo}` : null;
  if (!pageRepo) return;
  let gone = false;
  const go = async () => {
    if (gone) return;
    gone = true;
    const reserved = await loadReserved().catch(() => null);
    const to = memberStudioRedirect({ pathname: location.pathname, search: location.search, hash: location.hash, hostedSite: true, teamPage: false, pageRepo, member: true, reserved });
    if (to) location.replace(to);
  };
  if (github) {
    const { onAccess } = await import('./github-session');
    onAccess((a) => {
      if (a?.write && !a.contributor) void go();
    });
    return;
  }
  try {
    const { getAccount } = await import('./account-session');
    const { account } = await getAccount();
    if (account?.teams.some((t) => t.repo.toLowerCase() === pageRepo.toLowerCase())) void go();
  } catch {
    /* no account server: the showcase stays */
  }
}
