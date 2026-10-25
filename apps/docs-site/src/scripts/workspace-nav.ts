// The side nav of the browser workspace (lib/nav.ts workspaceNav): with a team made in Bridge (?team=<id> in the
// address), Home and Settings carry it, so both open that team; without one, Settings is hidden (nothing to set yet).
// Called on load and whenever the page names the team (pages/studio/workspace.astro, TeamKeySettings).
import { WORKSPACE_HOME, WORKSPACE_SETTINGS } from '../lib/start';

export function paintWorkspaceNav(): void {
  const id = new URLSearchParams(location.search).get('team')?.trim().toLowerCase() ?? '';
  const team = /^[a-f0-9]{16}$/.test(id) ? id : null;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a.nav-link, .nav-sub a')) {
    const path = new URL(a.href, location.href).pathname;
    if (path !== WORKSPACE_HOME && path !== WORKSPACE_SETTINGS) continue;
    a.href = team ? `${path}?team=${team}` : path;
    if (path === WORKSPACE_SETTINGS) (a.closest('li') ?? a).hidden = !team;
  }
}
