// "One step before the first preview" on a product page (components/ds/studio/ProductPreviewsStep.tsx): the step the
// Add a product dialog used to end with ("Show its previews"), now on the page the dialog lands on. Only an admin
// sees it (connecting a host is theirs to do), only while the product has no previews in the team's settings. It
// names the host the team already uses: the one of its other products' previews, else the library's, else Vercel.
// The words live in lib/new-product.ts (PREVIEWS_STEP_WORDS). Pure, covered by product-previews.test.ts.
import type { PreviewApps, ProductConfig } from '@bridge-ds/core';
import { CLOUDFLARE_IMPORT_URL, vercelImportUrl } from './new-product';

export type PreviewHost = 'vercel' | 'cloudflare';

/** What people read for each host. */
export const HOST_NAMES: Record<PreviewHost, string> = { vercel: 'Vercel', cloudflare: 'Cloudflare' };

/** The team's previews settings (bridge.config.json `previews`): per-app templates and production addresses. */
export interface PreviewsLike {
  apps?: PreviewApps | undefined;
  production?: PreviewApps | undefined;
}

/** One app's address in a previews map (keyed by product key for a product of the library's repository). */
const at = (apps: PreviewApps | undefined, key: string): string | undefined => (apps as Record<string, string | undefined> | undefined)?.[key];
const all = (apps: PreviewApps | undefined): string[] => Object.values(apps ?? {}).filter((u): u is string => typeof u === 'string');

/** The host of one preview or production address, from its domain; null for a custom domain or anything else. */
export function hostOf(url: string | null | undefined): PreviewHost | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec((url ?? '').trim());
  if (!m) return null;
  // Templates carry placeholders in the host ("{branch}.shop.pages.dev"): only the end of the name matters.
  const host = m[1]!.toLowerCase().replace(/:\d+$/, '');
  if (host === 'pages.dev' || host.endsWith('.pages.dev')) return 'cloudflare';
  if (host === 'vercel.app' || host.endsWith('.vercel.app')) return 'vercel';
  return null;
}

/** Every preview and production address a product has in the team's settings. */
function addressesOf(p: ProductConfig, previews: PreviewsLike | null | undefined): string[] {
  return [p.preview, p.design?.preview, p.production, at(previews?.apps, p.key), at(previews?.production, p.key)].filter((u): u is string => Boolean(u && u.trim()));
}

/** Whether the product shows previews already: a preview or production address in the team's settings. */
export const hasPreviews = (p: ProductConfig, previews?: PreviewsLike | null): boolean => addressesOf(p, previews).length > 0;

/** The host most of these addresses use (the first one met on a tie), or null. */
function mostUsed(urls: readonly string[]): PreviewHost | null {
  const count = new Map<PreviewHost, number>();
  let best: PreviewHost | null = null;
  for (const u of urls) {
    const h = hostOf(u);
    if (!h) continue;
    count.set(h, (count.get(h) ?? 0) + 1);
    if (!best || count.get(h)! > count.get(best)!) best = h;
  }
  return best;
}

/** Where the suggested host comes from: the team's other products, the library, or nothing (Vercel by default). */
export type HostSource = 'products' | 'library' | 'default';

/**
 * The host to suggest for `product`: the one the team's other products already show previews on (the library
 * aside), else the library's own (the team's `previews` apps and production), else Vercel.
 */
export function suggestedHost(product: Pick<ProductConfig, 'key'>, products: readonly ProductConfig[], previews?: PreviewsLike | null): { host: PreviewHost; source: HostSource } {
  const others = products.filter((p) => p.key !== product.key && !p.default);
  const fromProducts = mostUsed(others.flatMap((p) => addressesOf(p, previews)));
  if (fromProducts) return { host: fromProducts, source: 'products' };
  const fromLibrary = mostUsed([...all(previews?.apps), ...all(previews?.production)]);
  if (fromLibrary) return { host: fromLibrary, source: 'library' };
  return { host: 'vercel', source: 'default' };
}

export const otherHost = (h: PreviewHost): PreviewHost => (h === 'vercel' ? 'cloudflare' : 'vercel');

/** The host's own page to connect the product's code (opened in a new tab: Bridge never sees the account). */
export const connectUrl = (host: PreviewHost, repo: string | null): string =>
  host === 'cloudflare' ? CLOUDFLARE_IMPORT_URL : repo ? vercelImportUrl(repo) : 'https://vercel.com/new';

/** The code to connect: the design team's copy when there is one (explorations run there), else the product's own. */
export const codeOf = (p: ProductConfig, library: string | null): string | null => p.design?.repo ?? p.repo ?? library;

/**
 * Who sees the step: an admin of the team (connecting a host is theirs), on a real team, for a product of the team
 * (never the library), with no previews yet. Everybody else: nothing, not even a hint.
 */
export function showsPreviewsStep(x: { admin: boolean; sample: boolean; product: ProductConfig | null; previews?: PreviewsLike | null }): boolean {
  return Boolean(x.admin && !x.sample && x.product && !x.product.default && !hasPreviews(x.product, x.previews));
}

/** An admin, as the step reads the viewer's access: a GitHub admin of the team's code, or an admin of the team in Bridge. */
export const isTeamAdmin = (a: { admin?: boolean; repoAdmin?: boolean } | null | undefined): boolean => Boolean(a?.admin || a?.repoAdmin);

/** Everything the step shows, ready to paint. */
export interface PreviewsStep {
  host: PreviewHost;
  source: HostSource;
  connect: string;
  other: string;
}

export function previewsStep(product: ProductConfig, products: readonly ProductConfig[], previews: PreviewsLike | null | undefined, library: string | null): PreviewsStep {
  const { host, source } = suggestedHost(product, products, previews);
  const code = codeOf(product, library);
  return { host, source, connect: connectUrl(host, code), other: connectUrl(otherHost(host), code) };
}
