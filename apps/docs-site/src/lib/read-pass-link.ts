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

/** A grant the server sent, checked: null when it is not one. */
export function parseGrant(v: unknown): ReadPassGrant | null {
  const g = v as Partial<ReadPassGrant> | null;
  if (!g || typeof g.pass !== 'string' || !PASS.test(g.pass) || typeof g.exp !== 'number' || !Array.isArray(g.origins)) return null;
  return { pass: g.pass, exp: g.exp, origins: g.origins.filter((o): o is string => typeof o === 'string') };
}
