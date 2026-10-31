// The links to where History went, for this page (self-hosted, a team's Studio shell or a team's Library): the Shipped
// tab, the next release on Being built and the Library changelog's token changes (lib/history-moved).
import { libraryFromPath, ownLibrary, type TeamPair } from '../lib/library-shells';
import { movedHistory, tokenChangesHref } from '../lib/history-moved';
import { isHosted, pageTeamFromPath, studioHref } from '../lib/team-path';

/** The team in the address (a Studio team shell or a team's Library), null on this site's own pages. */
const pageTeam = (): TeamPair | null => (typeof location === 'undefined' ? null : (pageTeamFromPath(location.pathname, isHosted()) ?? libraryFromPath(location.pathname)));

/** The token and guidance changes of this page's library (its Library changelog), on an entry or a token. */
export const tokenChangesLink = (q: { entry?: string | null; token?: string | null } = {}): string => tokenChangesHref(pageTeam(), ownLibrary(), q);

/** Where an old History address of this page goes now, or null when it is not one. */
export const historyRedirect = (): string | null =>
  movedHistory(location.search, location.hash, { changes: studioHref('changes/'), building: studioHref('building/'), changelog: tokenChangesLink });
