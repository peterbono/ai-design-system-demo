// The Library <-> Studio switch in the top bar (components/SpaceSwitch.astro, scripts/space-switch.ts): one link that
// carries the reader's context across. From a Library page it opens the same thing in Studio (Button -> the Button
// drawer, Color -> the color tokens), and back. The Library side reuses the pages' own "Edit in Studio" doors
// (LibraryHeader `studio`): the same Studio routes, built with studioHref so a team shell keeps its team.
//
// Pure and browser-safe: the layout resolves the build-time target, the script resolves it again in the browser,
// where the query (?c=button in Studio) and the team in the address are known.
import { LIBRARY_ROOT, libraryHref, ownLibrary, sameTeam, type TeamPair } from './library-shells';
import { STUDIO_ROOT, studioHrefAt } from './team-path';

export type SwitchSpace = 'library' | 'studio';

/** Library foundations pages and the token group their "Edit in Studio" door focuses (pages/foundations/*.astro). */
export const FOUNDATION_FOCUS: Readonly<Record<string, { focus: string; label: string }>> = {
  color: { focus: 'color', label: 'Color' },
  typography: { focus: 'font', label: 'Typography' },
  spacing: { focus: 'space', label: 'Spacing' },
  radius: { focus: 'radius', label: 'Radius and borders' },
  elevation: { focus: 'shadow', label: 'Elevation' },
};

/** Where the switch goes and what it names: `item` is the thing carried across ("Button"), null for a space home. */
export interface SwitchTarget {
  href: string;
  item: string | null;
}

/** A component's display name from its slug, when the caller knows it. */
export type NameOf = (slug: string) => string | null | undefined;

const norm = (path: string) => path.replace(/\/?$/, '/');
const SLUG = /^[a-z0-9][a-z0-9-]*$/i;
const slugParam = (search: string, key = 'c'): string | null => {
  const v = new URLSearchParams(search).get(key);
  return v && SLUG.test(v) ? v.toLowerCase() : null;
};
const nameFor = (slug: string, nameOf?: NameOf) => nameOf?.(slug) || null;

/** The Studio route (relative to the Studio root) for a page of Bridge's own Library, and what it names. */
export function studioRouteOfLibrary(pathname: string, nameOf?: NameOf): { route: string; item: string | null } {
  const p = norm(pathname);
  const comp = /^\/components\/([^/]+)\/$/.exec(p);
  if (comp && SLUG.test(comp[1]!)) {
    const slug = comp[1]!.toLowerCase();
    return { route: `components/?c=${encodeURIComponent(slug)}`, item: nameFor(slug, nameOf) };
  }
  if (p === '/components/') return { route: 'components/', item: 'Components' };
  const found = /^\/foundations\/([^/]+)\/$/.exec(p);
  if (found) {
    const f = FOUNDATION_FOCUS[found[1]!];
    if (f) return { route: `tokens/?focus=${f.focus}`, item: f.label };
    if (found[1] === 'accessibility') return { route: 'quality/', item: 'Accessibility' };
  }
  if (p === '/tokens/') return { route: 'tokens/', item: 'Tokens' };
  if (p === '/how-review-works/') return { route: 'settings/#approvals', item: 'Approvals' };
  return { route: '', item: null };
}

/** The Studio route for a page of a team's Library (/library/<owner>/<repo>/<route>), from its Library route. */
export function studioRouteOfTeamLibrary(libraryRoute: string, search = ''): { route: string; item: string | null } {
  const r = norm(libraryRoute).replace(/^\/+/, '');
  const comp = /^components\/([^/]+)\/$/.exec(r);
  if (comp && SLUG.test(comp[1]!)) return { route: `components/?c=${encodeURIComponent(comp[1]!.toLowerCase())}`, item: null };
  if (r === 'components/') {
    const slug = slugParam(search);
    return slug ? { route: `components/?c=${encodeURIComponent(slug)}`, item: null } : { route: 'components/', item: 'Components' };
  }
  // The same foundation pages as the own Library (lib/library-shells.ts LIBRARY_FOUNDATION_PAGES).
  const found = /^foundations\/([^/]+)\/$/.exec(r);
  if (found) {
    const f = FOUNDATION_FOCUS[found[1]!];
    if (f) return { route: `tokens/?focus=${f.focus}`, item: f.label };
    if (found[1] === 'accessibility') return { route: 'quality/', item: 'Accessibility' };
  }
  if (r === 'tokens/' || r === 'foundations/') return { route: 'tokens/', item: 'Tokens' };
  if (r === 'how-review-works/') return { route: 'settings/#approvals', item: 'Approvals' };
  return { route: '', item: null };
}

/**
 * The Library route for a Studio route (relative to the Studio root, '' is Home), and what it names. Every Library has
 * the same pages: the foundations and a page per component.
 */
export function libraryRouteOfStudio(studioRoute: string, search = '', nameOf?: NameOf): { route: string; item: string | null } {
  const r = norm(studioRoute.replace(/^\/+/, '')).replace(/^\/$/, '');
  const docs = /^components\/docs\/([^/]+)\/$/.exec(r);
  const slug = docs && SLUG.test(docs[1]!) ? docs[1]!.toLowerCase() : r === 'components/' ? slugParam(search) : null;
  if (slug) return { route: `components/${slug}/`, item: nameFor(slug, nameOf) };
  if (r === 'components/' || r.startsWith('components/')) return { route: 'components/', item: 'Components' };
  if (r === 'tokens/') {
    const focus = new URLSearchParams(search).get('focus');
    const page = focus ? Object.entries(FOUNDATION_FOCUS).find(([, f]) => f.focus === focus) : undefined;
    if (page) return { route: `foundations/${page[0]}/`, item: page[1].label };
    return { route: 'tokens/', item: 'Tokens' };
  }
  if (r === 'quality/') return { route: 'foundations/accessibility/', item: 'Accessibility' };
  return { route: '', item: null };
}

export interface SwitchContext {
  /** The space this page is in. */
  space: SwitchSpace;
  /** location.pathname, or the page path at build time. */
  pathname: string;
  search?: string;
  /** Studio root of this page: '/studio/' self-hosted, '/studio/<owner>/<repo>/' on a team shell (studioBase). */
  studioRoot?: string;
  /** The team whose Library this Studio page links to (a team shell), or whose Library this page is (a Library shell). */
  team?: { owner: string; repo: string } | null;
  /** On a team's Library shell: the route this page stands for ('components/'). */
  libraryRoute?: string;
  nameOf?: NameOf;
  /** The repository this site documents: its Library is the site's own, whoever the visitor. Default: from <html>. */
  own?: TeamPair | null;
}

/** Where the switch on this page goes, and the item it carries. */
export function switchTarget(ctx: SwitchContext): SwitchTarget {
  const search = ctx.search ?? '';
  const root = ctx.studioRoot ?? STUDIO_ROOT;
  if (ctx.space === 'library') {
    const { route, item } = ctx.libraryRoute !== undefined ? studioRouteOfTeamLibrary(ctx.libraryRoute, search) : studioRouteOfLibrary(ctx.pathname, ctx.nameOf);
    return { href: studioHrefAt(root, route), item };
  }
  const rel = norm(ctx.pathname).startsWith(root) ? norm(ctx.pathname).slice(root.length) : '';
  // The team this site documents has one Library, the site's own (a page per foundation and component).
  const team = ctx.team && !sameTeam(ctx.team, ctx.own === undefined ? ownLibrary() : ctx.own) ? ctx.team : null;
  const { route, item } = libraryRouteOfStudio(rel, search, ctx.nameOf);
  if (team) return { href: libraryHref(team.owner, team.repo, route, null), item };
  return { href: route ? `/${route}` : LIBRARY_ROOT, item };
}

/** The other space: where the switch goes. */
export const otherSpace = (space: SwitchSpace): SwitchSpace => (space === 'library' ? 'studio' : 'library');

/** The link's accessible name: the action, never the visible word (which names where you are). */
export const switchLabel = (space: SwitchSpace): string => (space === 'library' ? 'Open Studio' : 'Open Library');

/** Read after the name (aria-describedby): where the reader is now. */
export const currentLabel = (space: SwitchSpace): string => (space === 'library' ? "You're in the Library" : "You're in the Studio");

/** The tooltip: the destination, with the item when one is carried ("Open Button in Studio"). */
export function switchTooltip(space: SwitchSpace, item: string | null): string {
  if (space === 'library') return item ? `Open ${item} in Studio` : 'Open Studio';
  return item ? `Open ${item} in the Library` : 'Open the Library';
}

// ---- First-visit hint: on a reader's first visit only, a dot crosses the track once toward the other space. ----

export const HINT_KEY = 'bridge.space-switch.seen';

type HintStore = Pick<Storage, 'getItem' | 'setItem'>;

/** True when the hint should play: never seen in this browser and motion allowed. Storage errors read as "seen". */
export function shouldShowHint(store: HintStore | null | undefined, reducedMotion: boolean): boolean {
  if (reducedMotion || !store) return false;
  try {
    return store.getItem(HINT_KEY) === null;
  } catch {
    return false;
  }
}

/** Records the hint as seen. Returns false when the browser refuses storage (private mode): the hint just plays once per page. */
export function markHintSeen(store: HintStore | null | undefined): boolean {
  if (!store) return false;
  try {
    store.setItem(HINT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** A click the switch may animate before navigating: a plain primary click, no modifier, same tab. */
export function isPlainClick(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** How long the switch plays before the page changes: short enough to feel instant, long enough to read the slide. */
export const NAVIGATE_AFTER_MS = 280;
