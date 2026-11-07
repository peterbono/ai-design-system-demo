// The page a capture found a change on, applied to a preview link (Open the preview, See it in the product, Open the
// build). Pure: no DOM, no fetch, covered by scripts/product-branch.test.ts.

/**
 * The toolbar link on the page a capture found the change on (`route`: "/plans", "/#/orders", "/?tenant=a#/orders"),
 * keeping the Bridge parameters. Anything that is not a path on the same preview leaves the link as it is.
 */
export function atRoute(link: string, route: string | null | undefined): string {
  if (!link || !route || !route.startsWith('/') || route.startsWith('//')) return link;
  try {
    const u = new URL(link);
    const t = new URL(route, u.origin);
    if (t.origin !== u.origin) return link;
    u.pathname = t.pathname;
    t.searchParams.forEach((v, k) => {
      if (!k.startsWith('bridge')) u.searchParams.set(k, v);
    });
    u.hash = t.hash;
    return u.href;
  } catch {
    return link;
  }
}
