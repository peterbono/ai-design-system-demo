// "Try it in the product" on a change: the admin demo preview Vercel built for the change, opened with the Bridge
// toolbar (`?bridge=<change>`, apps/admin/src/bridge) on the admin screen that changes most. The URL is only one
// GitHub reported (Vercel commit status, deployment or bot comment), never the config template: Vercel shortens
// long branch aliases, so a template URL can point nowhere.
import type { ProductScreen } from '@bridge-ds/core';
import type { VisualShot } from './visual-impact';

// The preview and the link live in @bridge-ds/core (try-in-product.ts), shared with the MCP server and the CLI.
export { productPreview, tryInProductUrl, type ProductScreen } from '@bridge-ds/core';

/** The admin screen that changes most in the visual impact, or null when no admin screen changes. */
export function topScreen(shots: readonly VisualShot[] | null | undefined): ProductScreen | null {
  const top = (shots ?? [])
    .filter((s) => s.kind === 'route' && s.route && s.tenant && (s.status === 'changed' || s.status === 'added'))
    .reduce<VisualShot | null>((best, s) => (!best || s.percent > best.percent ? s : best), null);
  return top ? { label: top.label, route: top.route!, tenant: top.tenant!, theme: top.theme } : null;
}

