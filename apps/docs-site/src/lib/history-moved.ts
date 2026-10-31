// Where the old Changes > History went (pure, browser-safe). History mixed three things that each moved to where it
// belongs:
//   - the history of the work (what shipped, explorations included): Changes, the Shipped tab (?state=shipped);
//   - the next release and its "Review and publish": Being built, the end of the build pipeline (#next-release);
//   - the token and usage guidance changes, by release: the Library changelog (#token-changes), read only.
// Old addresses (?view=history with &entry= or &token=, and the History anchors) land on the right one.
import { LIBRARY_ROOT, sameTeam, type TeamPair } from './library-shells';

/** The anchor of the next release card on Being built. */
export const NEXT_RELEASE_ID = 'next-release';
/** The anchor of the token and guidance changes on the Library changelog. */
export const TOKEN_CHANGES_ID = 'token-changes';

/**
 * The Library changelog of a team ('/library/<owner>/<repo>/changelog/'), or the site's own ('/changelog/') when there
 * is no team or it is the repository this site documents (`own`).
 */
export function changelogPath(team: TeamPair | null, own: TeamPair | null): string {
  if (!team || sameTeam(team, own)) return '/changelog/';
  return `${LIBRARY_ROOT}${encodeURIComponent(team.owner)}/${encodeURIComponent(team.repo)}/changelog/`;
}

/** The token and guidance changes on the Library changelog, with an entry (&entry=) or a token filter (&token=). */
export function tokenChangesHref(team: TeamPair | null, own: TeamPair | null, q: { entry?: string | null; token?: string | null } = {}): string {
  const p = new URLSearchParams();
  if (q.entry) p.set('entry', q.entry);
  if (q.token) p.set('token', q.token);
  const s = p.toString();
  return `${changelogPath(team, own)}${s ? `?${s}` : ''}#${TOKEN_CHANGES_ID}`;
}

/**
 * Where an old History address goes, or null when the address is not one (no ?view=history). `at` gives the pages of
 * this Studio (self-hosted or the team's): Changes, Being built and the Library changelog.
 *   - the release card anchor (#hs-next, #next-release): Being built, on the card;
 *   - an entry, a token filter or a timeline anchor (#hs-..., #token-changes): the Library changelog, on that entry;
 *   - anything else: Changes, the Shipped tab, other parameters kept (a person, a kind).
 */
export function movedHistory(search: string, hash: string, at: { changes: string; building: string; changelog: (q: { entry: string | null; token: string | null }) => string }): string | null {
  const q = new URLSearchParams(search);
  if (q.get('view') !== 'history') return null;
  if (hash === '#hs-next' || hash === `#${NEXT_RELEASE_ID}`) return `${at.building}#${NEXT_RELEASE_ID}`;
  const entry = q.get('entry');
  const token = q.get('token');
  if (entry || token || hash.startsWith('#hs-') || hash === `#${TOKEN_CHANGES_ID}`) return at.changelog({ entry, token });
  q.delete('view');
  q.set('state', 'shipped');
  return `${at.changes}?${q.toString()}`;
}
