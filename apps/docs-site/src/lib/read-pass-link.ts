// The read pass on a link Studio opens for a member (api/_lib/read-pass.ts): a product preview with the Bridge toolbar
// (`?bridge=<change>`) gets `#bridge-pass=<pass>` at the front of its fragment, so the toolbar there can read the change
// of a private product through Bridge. Only for the product pages the team's config names (the origins the server sent
// with the pass): a link to anywhere else (a preview URL from a hostile comment) never carries it. The fragment never
// reaches the preview host, and the toolbar removes it from the address at once (@bridge-ds/toolbar pass.ts).

export const PASS_FRAGMENT = 'bridge-pass';
const PASS = /^[A-Za-z0-9._-]{16,4096}$/;
/** A branch as a preview host carries it: one host label part. */
const BRANCH_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export interface ReadPassGrant {
  pass: string;
  /** When it stops opening reads (ms). */
  exp: number;
  /** Origin templates of the team's product pages (https, `{branch}` in the host). */
  origins: string[];
}

/** Whether `origin` is one of `templates` (same rule as the server's originAllowed, without its local dev servers). */
export function passOrigin(origin: string, templates: readonly string[], local = false): boolean {
  const o = origin.toLowerCase();
  if (LOCAL.test(o)) return local;
  return templates.some((t) => {
    if (!/^https:\/\//.test(t)) return false;
    if (!t.includes('{branch}')) return o === t.toLowerCase();
    const [pre, post] = t.toLowerCase().split('{branch}') as [string, string];
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${esc(pre)}${BRANCH_LABEL}${esc(post)}$`).test(o);
  });
}

/**
 * `href` with the pass in front of its fragment (`#bridge-pass=<pass>&<the fragment it had>`), or null when it must not
 * carry it: not a toolbar link (`?bridge=`), another origin than the team's product pages, an expired or malformed
 * pass, or one it already carries. `local`: Studio itself runs on this computer, so local product servers count.
 */
export function withReadPass(href: string, grant: ReadPassGrant | null, now: number, local = false): string | null {
  if (!grant || !PASS.test(grant.pass) || grant.exp - now < 60_000) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.searchParams.has('bridge')) return null;
  if (!passOrigin(url.origin, grant.origins, local)) return null;
  const rest = url.hash.replace(/^#/, '');
  if (rest.startsWith(`${PASS_FRAGMENT}=`)) return null;
  url.hash = `${PASS_FRAGMENT}=${grant.pass}${rest ? `&${rest}` : ''}`;
  return url.href;
}

/** Whether `href` opens a product page with the Bridge toolbar (`?bridge=`): a link a member's pass may go on. */
export function isToolbarLink(href: string): boolean {
  try {
    const url = new URL(href);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && url.searchParams.has('bridge');
  } catch {
    return false;
  }
}

/** The first @bridge-ds/toolbar that takes the pass out of the address (0.8.0). An older one leaves it in the hash. */
export const PASS_TOOLBAR = [0, 8, 0] as const;

/**
 * Whether the build of a branch with this package.json takes a read pass: false when its @bridge-ds/toolbar range
 * starts below PASS_TOOLBAR (^0.7.0 never installs 0.8). An older toolbar leaves `#bridge-pass=...` in the address,
 * and the product's hash router reads it as a screen that does not exist: an empty page under the toolbar. Null when
 * it cannot say (no package.json, no toolbar dependency, a workspace or tag range): the pass goes on as before.
 */
export function toolbarTakesPass(packageJson: string | null | undefined): boolean | null {
  if (!packageJson) return null;
  let range: unknown;
  try {
    const p = JSON.parse(packageJson) as Record<string, Record<string, unknown> | undefined>;
    range = p.dependencies?.['@bridge-ds/toolbar'] ?? p.devDependencies?.['@bridge-ds/toolbar'];
  } catch {
    return null;
  }
  if (typeof range !== 'string') return null;
  // The lowest version the range allows ("^0.7.0", "~0.7.2", "0.7.0", ">=0.6.0 <0.8.0"; a union counts its lowest).
  const lowest = range
    .split('||')
    .map((part) => /^\s*(?:\^|~|>=|=|v)?\s*(\d+)\.(\d+)\.(\d+)/.exec(part))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)
    .sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2])[0];
  if (!lowest) return null;
  const [a, b, c] = lowest;
  const [x, y, z] = PASS_TOOLBAR;
  return a !== x ? a > x : b !== y ? b > y : c >= z;
}

/** Under "Open the preview" when the branch's toolbar is older than the pass (toolbarTakesPass false). */
export const OLD_TOOLBAR_NOTE = "This preview has an older Bridge toolbar, so it opens without this change's details. Bring in the latest product, then open it again.";

/** A grant the server sent, checked: null when it is not one. */
export function parseGrant(v: unknown): ReadPassGrant | null {
  const g = v as Partial<ReadPassGrant> | null;
  if (!g || typeof g.pass !== 'string' || !PASS.test(g.pass) || typeof g.exp !== 'number' || !Array.isArray(g.origins)) return null;
  return { pass: g.pass, exp: g.exp, origins: g.origins.filter((o): o is string => typeof o === 'string') };
}
