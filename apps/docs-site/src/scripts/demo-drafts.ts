// Drafts made on the sample team (Acme Design) stay in this browser for the visit, and never reach a real team: on
// the sample team a real draft is put aside; on any other page the sample drafts are dropped and the real draft comes
// back (lib/demo.ts swapDemoDrafts). Run by the layout in <head>, before any page script reads a draft.
import { isSampleTeam, swapDemoDrafts } from '../lib/demo';
import { libraryFromPath } from '../lib/library-shells';
import { pageTeamFromPath } from '../lib/team-path';

/** The team of this page: a team Studio page or a team Library page, null elsewhere. */
function pageTeam(): string | null {
  const root = document.documentElement;
  const t = root.hasAttribute('data-library-shell') ? libraryFromPath(location.pathname) : pageTeamFromPath(location.pathname, root.hasAttribute('data-hosted'));
  return t ? `${t.owner}/${t.repo}` : null;
}

export function runDemoDrafts() {
  try {
    swapDemoDrafts(localStorage, isSampleTeam(pageTeam()));
  } catch {
    /* storage blocked: nothing is kept anyway */
  }
}

runDemoDrafts();
