// The Bridge toolbar's pure logic: when it shows, which change it follows, what Before and After mean for that
// change, and the screens it lists. A product opens it only when Bridge Studio links here with `?bridge=<change>`;
// production renders nothing, except the Before side of a code change, which arrives with a handoff from a preview.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * What the toolbar knows about the product and its design system: from bridge.config.json (the product's entry in
 * products[] and previews), read at build time (the Admin demo) or from the design system repository at run time.
 */
export interface BridgeBuild {
  /** The repository whose pull requests `?bridge=<n>` names: the product's own repository, else the design system's. */
  owner: string;
  repo: string;
  /** Production Studio (previews.production.docs): the link back and the shipped tokens.css. */
  studio: string | null;
  /** The product in production (products[].production, else previews.production.<key>): Before of a code change. */
  production: string | null;
  /** The product's preview template (products[].preview): only these hosts may hand a code change over to production. */
  preview: string | null;
  /** VERCEL_ENV of the build ('production', 'preview', 'development'), null when unknown. */
  deployEnv: string | null;
  /** The library branch (repo.defaultBranch) and the token files' root (tokens.root): changes tried together. */
  defaultBranch?: string;
  tokensRoot?: string;
  /** The product's key (products[].key) and the design system repository ("owner/name"), for the way back to Studio. */
  product?: string;
  ds?: string;
}

export const PARAM = 'bridge';
/** Where After lives for a code change, carried to production on Before. */
export const RETURN_PARAM = 'bridge-return';
/** Scroll position carried across a Before/After navigation. */
export const SCROLL_PARAM = 'bridge-scroll';
export const SESSION_KEY = 'bridge-admin:change';
export const RETURN_KEY = 'bridge-admin:return';
export const DOCK_KEY = 'bridge-admin:toolbar-dock';
export const OPEN_KEY = 'bridge-admin:toolbar-open';
/** Changes tried together: the picks of the tokens they set differently (core encodePicks), from Studio. */
export const USE_PARAM = 'bridge-use';
export const USE_KEY = 'bridge-admin:use';
/** At most this many changes are tried together. */
export const MAX_TOGETHER = 4;

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/**
 * The change the toolbar follows: `?bridge=<n>` wins and is kept for the session (the admin's hash router keeps the
 * query, a reload or a new path does not need it again); `?bridge=off` forgets it. Blocked storage only loses the
 * memory, never the toolbar of the current page.
 */
export function readChange(search: string, storage: StorageLike | null): number | null {
  return readChanges(search, storage)[0] ?? null;
}

/**
 * The change numbers in "101" or "101,118,120" (an encoded comma too): positive, at most 7 digits, no repeats, at
 * most MAX_TOGETHER. Anything else in the list makes it unreadable (empty), never a guess.
 */
export function parseChanges(raw: string | null | undefined): number[] {
  const parts = (raw ?? '').trim().split(/,|%2C/i).map((p) => p.trim());
  if (!parts.every((p) => /^\d{1,7}$/.test(p) && Number(p) > 0)) return [];
  return [...new Set(parts.map(Number))].slice(0, MAX_TOGETHER);
}

/**
 * The changes the toolbar follows: one from "Try it in the product", 2 to 4 from "Try them together". Same memory as
 * one change: `?bridge=` wins and is kept for the session, `?bridge=off` forgets it, blocked storage only loses the
 * memory. The picks (`bridge-use`) travel with the list and are kept, or forgotten, with it.
 */
export function readChanges(search: string, storage: StorageLike | null): number[] {
  const params = new URLSearchParams(search);
  if (params.has(PARAM)) {
    const list = parseChanges(params.get(PARAM));
    if (!list.length) {
      if (storage) safe(() => (storage.removeItem(SESSION_KEY), storage.removeItem(USE_KEY)), undefined);
      return [];
    }
    if (storage) {
      safe(() => storage.setItem(SESSION_KEY, list.join(',')), undefined);
      const use = params.get(USE_PARAM);
      safe(() => (use && list.length > 1 ? storage.setItem(USE_KEY, use) : storage.removeItem(USE_KEY)), undefined);
    }
    return list;
  }
  return storage ? parseChanges(safe(() => storage.getItem(SESSION_KEY), null)) : [];
}

/** The picks that came with the list: from the address, else the session. */
export function readUse(search: string, storage: StorageLike | null): string | null {
  const params = new URLSearchParams(search);
  if (params.has(PARAM)) return params.get(USE_PARAM);
  return storage ? safe(() => storage.getItem(USE_KEY), null) : null;
}

/** A host that matches the product's preview template (`bridge-admin-git-{branch}-team.vercel.app`), https only. */
export function isPreviewUrl(raw: string | null | undefined, template: string | null): boolean {
  if (!raw || !template) return false;
  let url: URL;
  let tpl: URL;
  try {
    url = new URL(raw);
    tpl = new URL(template.replace(/\{[a-z]+\}/gi, 'x'));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const tplHost = /^https?:\/\/([^/?#]+)/i.exec(template)?.[1]?.toLowerCase();
  if (!tplHost || tpl.protocol !== 'https:') return false;
  const pattern = new RegExp(`^${tplHost.split(/\{[a-z]+\}/i).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+')}$`);
  return pattern.test(url.hostname.toLowerCase());
}

/** The preview to return to from production, from `?bridge-return=` or the session. Only a preview host counts. */
export function readReturn(search: string, storage: StorageLike | null, template: string | null): string | null {
  const raw = new URLSearchParams(search).get(RETURN_PARAM);
  if (raw !== null) {
    if (isPreviewUrl(raw, template)) {
      const origin = new URL(raw).origin;
      if (storage) safe(() => storage.setItem(RETURN_KEY, origin), undefined);
      return origin;
    }
    return null;
  }
  const stored = storage ? safe(() => storage.getItem(RETURN_KEY), null) : null;
  return isPreviewUrl(stored, template) ? new URL(stored!).origin : null;
}

export type Where = 'production' | 'preview' | 'local';

/** Which deployment this page is: the product in production by host or by build, a preview, or a local build. */
export function whereAmI(host: string, build: Pick<BridgeBuild, 'production' | 'deployEnv'>): Where {
  const prodHost = build.production ? safe(() => new URL(build.production!).host, null) : null;
  if (build.deployEnv === 'production' || (prodHost && host.toLowerCase() === prodHost.toLowerCase())) return 'production';
  if (build.deployEnv === 'preview') return 'preview';
  return 'local';
}

/**
 * Whether the toolbar renders. Never without a change from Studio. In production only for the Before side of a code
 * change, that is with a preview to return to: production on its own renders nothing.
 */
export function shouldRender(input: { change: number | null; where: Where; returnTo: string | null; together?: boolean }): boolean {
  if (input.change === null) return false;
  // Changes tried together run on production: no preview holds all of them.
  if (input.together) return true;
  if (input.where === 'production') return input.returnTo !== null;
  return true;
}

/** "These 3 changes": the After side of changes tried together, counting the ones switched on. */
export const togetherLabel = (n: number) => (n === 1 ? 'This change' : `These ${n} changes`);

/** The one hint line of changes tried together: where they run and why. */
export const TOGETHER_HINT = "The live product, with these changes' tokens applied in your browser only. No preview has all of them together.";

/** Show what changed found nothing on this screen for changes tried together. */
export const TOGETHER_EMPTY_LINE = "These changes don't touch this screen. Try another screen.";

/** Switches one change on or off, keeping the order Studio listed them in. */
export function toggleIncluded(all: number[], included: number[], n: number, on: boolean): number[] {
  const next = new Set(included);
  if (on) next.add(n);
  else next.delete(n);
  return all.filter((x) => next.has(x));
}

/** Studio's Changes list, where changes are tried together (and the way back). */
export function studioChangesUrl(build: Pick<BridgeBuild, 'studio' | 'owner' | 'repo'>): string {
  return build.studio ? `${build.studio.replace(/\/$/, '')}/studio/changes/` : `https://github.com/${build.owner}/${build.repo}/pulls`;
}

export type ChangeMode = 'tokens' | 'code';

/** Token files (DTCG and the contrast gate) and changesets only: Before swaps tokens live. Anything else is code. */
export function changeMode(files: string[]): ChangeMode {
  const tokenOnly = files.length > 0 && files.every((f) => f.endsWith('.tokens.json') || /contrast\.checks\.json$/.test(f) || f.startsWith('.changeset/'));
  return tokenOnly ? 'tokens' : 'code';
}

/** The live tokens (main's build, served by production Studio at `/tokens.css`), or null when not configured. */
export function liveTokensUrl(build: Pick<BridgeBuild, 'studio'>): string | null {
  return build.studio ? safe(() => new URL('tokens.css', build.studio!.replace(/\/?$/, '/')).href, null) : null;
}

/**
 * Studio's page for the change. A change in a product's own repository (an exploration there) opens as
 * `?exploration=<n>&product=<key>`; a change of the design system repository as `?pr=<n>`.
 */
export function studioChangeUrl(build: Pick<BridgeBuild, 'studio' | 'owner' | 'repo' | 'product' | 'ds'>, change: number): string {
  if (!build.studio) return `https://github.com/${build.owner}/${build.repo}/pull/${change}`;
  const studio = build.studio.replace(/\/$/, '');
  const own = build.product && build.ds && build.ds.toLowerCase() !== `${build.owner}/${build.repo}`.toLowerCase();
  return own ? `${studio}/studio/changes/?exploration=${change}&product=${encodeURIComponent(build.product!)}` : `${studio}/studio/changes/?pr=${change}`;
}

/** Shape of a visual impact manifest that the toolbar reads (written by @bridge-ds/visual). */
export interface ManifestShot {
  kind: 'story' | 'route';
  label: string;
  route?: string;
  tenant?: string;
  theme: string;
  status: string;
  percent: number;
}

export interface Screen {
  label: string;
  route: string;
  tenant: string;
  theme: string;
  percent: number;
}

/** The product screens the change alters, most changed first, one entry per screen, shop and theme. */
export function changedScreens(shots: ManifestShot[] | null | undefined): Screen[] {
  if (!Array.isArray(shots)) return [];
  const seen = new Set<string>();
  return shots
    .filter((s) => s.kind === 'route' && s.route && s.tenant && (s.status === 'changed' || s.status === 'added'))
    .sort((a, b) => b.percent - a.percent)
    .filter((s) => {
      const key = `${s.route}|${s.tenant}|${s.theme}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s) => ({ label: s.label, route: s.route!, tenant: s.tenant!, theme: s.theme, percent: s.percent }));
}

/**
 * The same page on another deployment (code changes: production for Before, the preview for After), with the
 * change, the way back and the scroll position in the query. The hash route (ra-core) is kept.
 */
export function sameScreenOn(target: string, here: { search: string; hash: string }, extra: { change: number; returnTo?: string | null; scroll?: number }): string {
  const url = new URL(target);
  const params = new URLSearchParams(here.search);
  params.delete(RETURN_PARAM);
  params.delete(SCROLL_PARAM);
  params.set(PARAM, String(extra.change));
  if (extra.returnTo) params.set(RETURN_PARAM, extra.returnTo);
  if (extra.scroll && extra.scroll > 0) params.set(SCROLL_PARAM, String(Math.round(extra.scroll)));
  url.pathname = '/';
  url.search = params.toString();
  url.hash = here.hash;
  return url.href;
}

/** The scroll position a Before/After navigation carried, once: the caller removes it from the address. */
export function readScroll(search: string): number | null {
  const raw = new URLSearchParams(search).get(SCROLL_PARAM);
  return raw && /^\d{1,7}$/.test(raw) ? Number(raw) : null;
}

export type Dock = 'start' | 'center' | 'end';
const DOCKS: Dock[] = ['start', 'center', 'end'];

/** Bottom right by default: the corner a back office leaves free most often. */
export function readDock(storage: StorageLike | null): Dock {
  const v = storage ? safe(() => storage.getItem(DOCK_KEY), null) : null;
  return DOCKS.includes(v as Dock) ? (v as Dock) : 'end';
}

/** One step left (-1) or right (+1), stopping at the edges. */
export function stepDock(dock: Dock, step: -1 | 1): Dock {
  return DOCKS[Math.min(DOCKS.length - 1, Math.max(0, DOCKS.indexOf(dock) + step))]!;
}

/** The dock nearest to where a drag ended: thirds of the viewport width. */
export function dockAt(x: number, width: number): Dock {
  if (width <= 0) return 'center';
  const r = x / width;
  return r < 1 / 3 ? 'start' : r > 2 / 3 ? 'end' : 'center';
}

/** Title of a change as people read it: conventional prefixes ("tokens: ") dropped, first letter up. */
export function readableTitle(title: string): string {
  const t = title.replace(/^\s*[a-z]+(\([^)]*\))?!?:\s*/i, '').trim() || title.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The B shortcut flips Before and After, unless the person is typing or holds a modifier. */
export function isFlipKey(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; target: unknown }): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== 'b') return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null;
  if (!t) return true;
  if (t.isContentEditable) return false;
  const tag = (t.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  return !(t.closest && t.closest('[role="combobox"], [role="textbox"], [role="searchbox"]'));
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: Rect, b: Rect, margin: number) => a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;

/**
 * Where the toolbar goes so it never covers a primary or submit button of the page: the chosen dock if it is free,
 * else the opposite corner, else the centre, else the chosen dock lifted just above the buttons it would cover. The
 * docks sit inside the area [left, right] (the content column, so it never sits over the sidebar).
 */
export function placeToolbar(input: { left: number; right: number; vh: number; w: number; h: number; gutter: number; preferred: Dock; obstacles: Rect[]; margin?: number }): { dock: Dock; lift: number } {
  const { left: areaLeft, right: areaRight, vh, w, h, gutter, preferred, obstacles } = input;
  const margin = input.margin ?? 8;
  const rectAt = (dock: Dock, lift = 0): Rect => {
    const left = dock === 'start' ? areaLeft : dock === 'end' ? areaRight - w : (areaLeft + areaRight - w) / 2;
    const bottom = vh - gutter - lift;
    return { left, right: left + w, top: bottom - h, bottom };
  };
  const opposite: Dock = preferred === 'start' ? 'end' : 'start';
  const order: Dock[] = [preferred, opposite, ...DOCKS.filter((d) => d !== preferred && d !== opposite)];
  for (const dock of order) {
    const r = rectAt(dock);
    if (!obstacles.some((o) => overlaps(r, o, margin))) return { dock, lift: 0 };
  }
  // Every dock covers something: stay put and rise above the highest button in the way.
  const base = rectAt(preferred);
  const inWay = obstacles.filter((o) => o.left < base.right + margin && o.right > base.left - margin && o.bottom > base.top - margin);
  const top = Math.min(...inWay.map((o) => o.top));
  const lift = Math.max(0, Math.ceil(base.bottom - (top - margin)));
  return { dock: preferred, lift: Math.min(lift, Math.max(0, vh - h - 2 * gutter)) };
}

/** What one token file can change on screen: a theme and a brand, or every one of them (null). */
function fileScope(file: string): { theme: string | null; brand: string | null } | 'none' {
  if (file.startsWith('.changeset/')) return 'none';
  let m = /(?:^|\/)semantic\/([a-z0-9-]+)\.tokens\.json$/i.exec(file);
  if (m && m[1] !== 'base') return { theme: m[1]!, brand: null };
  m = /(?:^|\/)brands\/([a-z0-9-]+)\.([a-z0-9-]+)\.tokens\.json$/i.exec(file);
  if (m) return { theme: m[2]!, brand: m[1]! };
  m = /(?:^|\/)brands\/([a-z0-9-]+)\.tokens\.json$/i.exec(file);
  if (m) return { theme: null, brand: m[1]! };
  // Primitives, base, density, components and anything else: could change every theme and brand.
  return { theme: null, brand: null };
}

export type NoDifference = { kind: 'theme'; here: string; touched: string } | { kind: 'brand'; here: string; touched: string };

/**
 * Whether a token change shows nothing in this theme and brand, from the token files it edits (DTCG layers named
 * semantic/<theme>, brands/<brand>.<theme>, brands/<brand>). Null when it may show, or when that cannot be told:
 * never claims "no difference" on a guess.
 */
export function noVisibleDifference(files: string[], here: { theme: string; brand: string }): NoDifference | null {
  const scopes = files.map(fileScope).filter((s): s is { theme: string | null; brand: string | null } => s !== 'none');
  if (!scopes.length) return null;
  const hits = (theme: string, brand: string) => scopes.some((s) => (s.theme === null || s.theme === theme) && (s.brand === null || s.brand === brand));
  if (hits(here.theme, here.brand)) return null;
  const theme = scopes.find((s) => s.theme !== null && s.theme !== here.theme && (s.brand === null || s.brand === here.brand))?.theme;
  if (theme) return { kind: 'theme', here: here.theme, touched: theme };
  const brand = scopes.find((s) => s.brand !== null && s.brand !== here.brand)?.brand;
  return brand ? { kind: 'brand', here: here.brand, touched: brand } : null;
}

/** "darker default background." The change title as a short phrase after "This change:". */
export function changeSummary(title: string): string {
  const t = readableTitle(title).replace(/[.\s]+$/, '');
  if (!t) return '';
  const lower = /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  return `${lower}.`;
}

export interface TokenChange {
  /** Token path, "color.bg.default". */
  path: string;
  /** CSS variable the token builds to, "--color-bg-default". */
  cssVar: string;
  /** The role it plays, what designers call it: "Page canvas" (its description), "Brand primary" (a palette role). */
  name: string;
  /** The exact step, second: "Primary 700" for a palette step, null for a semantic token. */
  step: string | null;
  type: string | null;
  /** The theme and brand its file applies to (null: every one). */
  theme: string | null;
  brand: string | null;
}

type TokenNode = { $value?: unknown; $type?: string; $description?: string; [k: string]: unknown };
type Leaf = { value: string; type: string | null; description: string | null };

function leaves(node: unknown, path: string[] = [], inheritedType: string | null = null, out = new Map<string, Leaf>()): Map<string, Leaf> {
  if (!node || typeof node !== 'object') return out;
  const n = node as TokenNode;
  const type = typeof n.$type === 'string' ? n.$type : inheritedType;
  if ('$value' in n) {
    out.set(path.join('.'), { value: JSON.stringify(n.$value), type, description: typeof n.$description === 'string' ? n.$description : null });
    return out;
  }
  for (const [k, v] of Object.entries(n)) if (!k.startsWith('$')) leaves(v, [...path, k], type, out);
  return out;
}

/** Palette roles a brand re-points (brands/<brand>.tokens.json), in designers' words. */
const PALETTE_ROLES: Record<string, string> = { primary: 'Brand primary', link: 'Link', neutral: 'Neutral', accent: 'Accent', success: 'Success', warning: 'Warning', danger: 'Danger', info: 'Info', categorical: 'Chart colours' };

/** The role a token plays: its description's first phrase, a palette role ("Brand primary"), else its path in words. */
export function roleOfToken(path: string, description: string | null): string {
  const first = description?.split(/[.:;(]/)[0]?.trim();
  if (first && first.length <= 40) return first;
  const m = /^palette\.([a-z-]+)\./.exec(path);
  if (m) return PALETTE_ROLES[m[1]!] ?? designerName(`palette.${m[1]}`, null);
  return designerName(path, null);
}

/** The palette step, shown second: "palette.primary.700" -> "Primary 700"; null for other tokens. */
export function stepOfToken(path: string): string | null {
  return path.startsWith('palette.') ? designerName(path, null) : null;
}

/** Designer name of a token: the first phrase of its description, else its path in words ("Bg default"). */
export function designerName(path: string, description: string | null): string {
  const first = description?.split(/[.:;(]/)[0]?.trim();
  if (first && first.length <= 40) return first;
  const words = path.replace(/^(color|palette)\./, '').split('.').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The tokens one file changes between two versions of it (parsed DTCG JSON, null when the file is added or removed):
 * every leaf whose $value differs, with the theme and brand its layer applies to.
 */
export function tokenChanges(file: string, before: unknown, after: unknown): TokenChange[] {
  const scope = fileScope(file);
  if (scope === 'none') return [];
  const a = leaves(before);
  const b = leaves(after);
  const out: TokenChange[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path);
    const y = b.get(path);
    if (x?.value === y?.value) continue;
    out.push({
      path,
      cssVar: `--${path.split('.').join('-')}`,
      name: roleOfToken(path, y?.description ?? x?.description ?? null),
      step: stepOfToken(path),
      type: y?.type ?? x?.type ?? null,
      theme: scope.theme,
      brand: scope.brand,
    });
  }
  return out;
}

/** WCAG contrast ratio between two rgb() colours, or null when either is not rgb (a non-colour value). */
export function contrastRatio(a: string, b: string): number | null {
  const lum = (c: string) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c.trim());
    if (!m) return null;
    const [r, g, bl] = [m[1], m[2], m[3]].map((n) => {
      const v = Number(n) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = lum(a);
  const y = lum(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Two colours under 1.1:1 read as the same at a glance: the swatch says "Subtle change" so it does not look broken. */
export const isSubtle = (a: string, b: string): boolean => {
  const r = contrastRatio(a, b);
  return r !== null && r < 1.1;
};

/** rgb(245, 247, 249) -> #f5f7f9; anything else as is. */
export function toHex(color: string): string {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color.trim());
  if (!m) return color;
  const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return m[4] !== undefined && Number(m[4]) < 1 ? `#${hex}${Math.round(Number(m[4]) * 255).toString(16).padStart(2, '0')}` : `#${hex}`;
}

/** "from Darker default background", "from #101 and #118": which change a token's value comes from (changes tried together). */
export function fromText(from: number[], titleOf: (n: number) => string | null): string {
  const names = from.map((n) => titleOf(n) ?? `#${n}`);
  return `from ${names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`;
}
