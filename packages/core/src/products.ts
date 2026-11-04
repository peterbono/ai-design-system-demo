// Products: the apps that consume the design system, as bridge.config.json `products` lists them. Bridge Studio
// groups branches by product, and the CLI and MCP server tell which product a folder or a repository is. A product
// lives in a folder of the design system repo (`path`) or in another GitHub repository (`repo`); the default one is
// the library itself, where a branch lands when nothing else matches. Pure: no Node API, it runs in the browser too.

export interface ProductConfig {
  /** Stable id: lowercase letters, digits and dashes ("admin"). The `product: <key>` label names it. */
  key: string;
  /** What people read ("Admin demo"). */
  name: string;
  /** "owner/name" when the product lives in another GitHub repository: the developers' own. */
  repo?: string;
  /**
   * The design team's copy of that repository (a fork the team owns): explorations start there, never in the
   * developers' repository, and "Done exploring" sends the developers a task (an issue) instead of a branch.
   */
  design?: DesignCopyConfig;
  /** Folder of this repository, repo-relative ("apps/admin"). */
  path?: string;
  /** Preview URL pattern, same placeholders as previews.apps: {branch} {rawBranch} {pr} {sha} {sha7}. */
  preview?: string;
  /**
   * The product in production ("https://shop.acme.com"), no placeholders: Live product in the Bridge toolbar and
   * "See the product today". A product of this repository may use previews.production.<key> instead.
   */
  production?: string;
  /**
   * The live product this one stands for, when the team cannot reach its code ("https://posterstudio.com", an https
   * origin): a product added from "Only its address". Its `repo` is then the design team's own, started by Bridge from
   * the product starter with the library: explorations rebuild the live pages with the library, and "Done exploring"
   * sends the developers a task (the preview, the page it started from, what changes), never code.
   */
  address?: string;
  /** react, vue, angular, svelte, astro, other. */
  framework?: string;
  /** The product a branch belongs to when nothing else matches: the library. */
  default?: boolean;
}

/** The design team's copy of a product repository (ProductConfig.design). */
export interface DesignCopyConfig {
  /** "owner/name" of the copy. */
  repo: string;
  /** Preview URL pattern of the copy, same placeholders as previews.apps. */
  preview?: string;
}

/** What a config without `products` means: the Admin demo first, then the library (the default). */
export const DEFAULT_PRODUCTS: ProductConfig[] = [
  { key: 'admin', name: 'Admin demo', path: 'apps/admin', framework: 'react' },
  { key: 'library', name: 'Library', default: true },
];

/** Pull request labels that pin a branch to a product ("product: admin"). */
export const PRODUCT_LABEL_PREFIX = 'product: ';

export const productLabel = (key: string): string => `${PRODUCT_LABEL_PREFIX}${key}`;

/**
 * Labels and a body line for new work started for a product (a branch, an exploration, a request): the
 * `product: <key>` label and "**Product:** <name>". The default product adds nothing, since productOfBranch lands
 * an unlabeled branch there. Studio, the CLI and the MCP server all write these.
 */
export function productMarks(products: readonly ProductConfig[], p: ProductConfig): { labels: string[]; line: string } {
  if (p.key === defaultProduct(products).key) return { labels: [], line: '' };
  return { labels: [productLabel(p.key)], line: `**Product:** ${p.name}` };
}

/** The configured products, or DEFAULT_PRODUCTS when the config lists none. */
export function productsOf(config: { products?: ProductConfig[] | undefined } | null | undefined): ProductConfig[] {
  const list = config?.products;
  return Array.isArray(list) && list.length ? list : DEFAULT_PRODUCTS;
}

/** The product marked `default: true`, else the last one listed. */
export function defaultProduct(products: readonly ProductConfig[]): ProductConfig {
  const list = products.length ? products : DEFAULT_PRODUCTS;
  return list.find((p) => p.default) ?? list[list.length - 1]!;
}

/** A product by key or name, whatever the case. */
export function findProduct(products: readonly ProductConfig[], keyOrName: string | null | undefined): ProductConfig | undefined {
  const k = (keyOrName ?? '').trim().toLowerCase();
  if (!k) return undefined;
  return products.find((p) => p.key.toLowerCase() === k) ?? products.find((p) => p.name.toLowerCase() === k);
}

const cleanPath = (p: string) => p.trim().replace(/^\.?\/+|\/+$/g, '');

/**
 * The product a branch belongs to: a `product: <key>` label naming a known product wins; else the first product
 * (other than the default) whose folder holds one of the changed files; else the default product. Files not read
 * yet (null) land on the default, since every branch of the repository starts from the library.
 */
export function productOfBranch(
  products: readonly ProductConfig[],
  branch: { files?: readonly string[] | null | undefined; labels?: readonly (string | { name: string })[] | null | undefined },
): ProductConfig {
  const fallback = defaultProduct(products);
  for (const l of branch.labels ?? []) {
    const name = typeof l === 'string' ? l : l?.name;
    if (typeof name !== 'string' || !name.toLowerCase().startsWith(PRODUCT_LABEL_PREFIX)) continue;
    const hit = findProduct(products, name.slice(PRODUCT_LABEL_PREFIX.length));
    if (hit) return hit;
  }
  const files = branch.files ?? [];
  for (const p of products) {
    if (p === fallback || !p.path) continue;
    const prefix = `${cleanPath(p.path)}/`;
    if (prefix !== '/' && files.some((f) => f.startsWith(prefix))) return p;
  }
  return fallback;
}

/**
 * The product a place belongs to: a product whose `repo` is the current repository (when that is not the design
 * system repository itself); else the product whose folder holds `relPath` (the deepest one); else the default.
 */
export function productForPlace(
  products: readonly ProductConfig[],
  place: { relPath?: string | null | undefined; repo?: string | null | undefined; designSystemRepo?: string | null | undefined },
): { product: ProductConfig; how: 'repo' | 'path' | 'default' } {
  const repo = place.repo?.trim().toLowerCase();
  if (repo && repo !== place.designSystemRepo?.trim().toLowerCase()) {
    const hit = products.find((p) => p.repo?.toLowerCase() === repo);
    if (hit) return { product: hit, how: 'repo' };
  }
  const rel = cleanPath(place.relPath ?? '');
  if (rel && rel !== '.') {
    let best: ProductConfig | undefined;
    for (const p of products) {
      if (!p.path) continue;
      const dir = cleanPath(p.path);
      if (dir && (rel === dir || rel.startsWith(`${dir}/`)) && (!best || dir.length > cleanPath(best.path!).length)) best = p;
    }
    if (best) return { product: best, how: 'path' };
  }
  return { product: defaultProduct(products), how: 'default' };
}

/**
 * The repository an exploration for this product is created in: the design team's copy when the team set one
 * (`design.repo`), else the product's own repository (`repo`, other than the design system repository), so the work
 * runs in a real copy of the product with the library from npm. Null otherwise (a product folder of the design system
 * repository, the library itself, the demo workspace): the exploration then lives in the design system repository.
 */
export function productRepoOf(p: ProductConfig | null | undefined, designSystemRepo: string | null | undefined): string | null {
  return designCopyOf(p, designSystemRepo) ?? productCodeRepoOf(p, designSystemRepo);
}

/** The developers' own repository of a product (`repo`, other than the design system repository), else null. */
export function productCodeRepoOf(p: ProductConfig | null | undefined, designSystemRepo: string | null | undefined): string | null {
  const repo = p?.repo?.trim();
  if (!repo || !REPO.test(repo)) return null;
  return repo.toLowerCase() === (designSystemRepo ?? '').trim().toLowerCase() ? null : repo;
}

/**
 * The design team's copy of a product's repository (`design.repo`), when the product has its own repository and the
 * copy is another one; else null. Explorations of that product live there.
 */
export function designCopyOf(p: ProductConfig | null | undefined, designSystemRepo: string | null | undefined): string | null {
  const code = productCodeRepoOf(p, designSystemRepo);
  const copy = p?.design?.repo?.trim();
  if (!code || !copy || !REPO.test(copy)) return null;
  const low = copy.toLowerCase();
  return low === code.toLowerCase() || low === (designSystemRepo ?? '').trim().toLowerCase() ? null : copy;
}

/**
 * The product as its explorations in the design team's copy see it: the copy's preview pattern stands for `preview`
 * (none when the copy has no preview deploys yet), since every exploration preview is a deploy of the copy.
 */
export function withCopyPreview(p: ProductConfig): ProductConfig {
  const { preview: _preview, ...rest } = p;
  return p.design?.preview ? { ...rest, preview: p.design.preview } : rest;
}

/**
 * The products whose explorations live in their own repository (productRepoOf), each with that repository, one entry
 * per repository (the first product listed wins when two share one). Lists read each of them once.
 */
export function productRepos(products: readonly ProductConfig[], designSystemRepo: string | null | undefined): { product: ProductConfig; repo: string }[] {
  const seen = new Set<string>();
  const out: { product: ProductConfig; repo: string }[] = [];
  for (const p of products) {
    const repo = productRepoOf(p, designSystemRepo);
    if (!repo || seen.has(repo.toLowerCase())) continue;
    seen.add(repo.toLowerCase());
    out.push({ product: designCopyOf(p, designSystemRepo) ? withCopyPreview(p) : p, repo });
  }
  return out;
}

/**
 * The product whose explorations live in `repo` ("owner/name", any case), else the product whose developers' repository
 * it is; undefined for the design system repository.
 */
export function productOfRepo(products: readonly ProductConfig[], repo: string | null | undefined, designSystemRepo?: string | null | undefined): ProductConfig | undefined {
  const r = (repo ?? '').trim().toLowerCase();
  if (!r) return undefined;
  return productRepos(products, designSystemRepo).find((x) => x.repo.toLowerCase() === r)?.product ?? products.find((p) => productCodeRepoOf(p, designSystemRepo)?.toLowerCase() === r);
}

/** The product whose design team's copy is `repo` (designCopyOf), any case. */
export function productOfDesignCopy(products: readonly ProductConfig[], repo: string | null | undefined, designSystemRepo?: string | null | undefined): ProductConfig | undefined {
  const r = (repo ?? '').trim().toLowerCase();
  return r ? products.find((p) => designCopyOf(p, designSystemRepo)?.toLowerCase() === r) : undefined;
}

const KEY = /^[a-z0-9][a-z0-9-]*$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const FIELDS = ['key', 'name', 'repo', 'design', 'path', 'preview', 'production', 'address', 'framework', 'default'];

/** What is wrong with a `products` value, each problem saying how to fix it. Empty: valid (or absent). */
export function productProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return ['"products" must be a list of { "key", "name" } objects'];
  if (!raw.length) return ['"products" must list at least one product, or be left out to use the defaults'];
  const problems: string[] = [];
  const seen = new Set<string>();
  let defaults = 0;
  raw.forEach((p: unknown, i) => {
    const at = `"products[${i}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      problems.push(`${at}" must be an object with a "key" and a "name"`);
      return;
    }
    const o = p as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!FIELDS.includes(k)) problems.push(`${at}.${k}" is not a known field (${FIELDS.join(', ')})`);
    if (typeof o.key !== 'string' || !KEY.test(o.key)) problems.push(`${at}.key" must be lowercase letters, digits and dashes, such as "admin"`);
    else if (seen.has(o.key)) problems.push(`${at}.key" ("${o.key}") is used twice: give each product its own key`);
    else seen.add(o.key);
    if (typeof o.name !== 'string' || !o.name.trim()) problems.push(`${at}.name" must be the name people read, such as "Admin demo"`);
    if (o.repo !== undefined && (typeof o.repo !== 'string' || !REPO.test(o.repo))) problems.push(`${at}.repo" must be "owner/name"`);
    if (o.design !== undefined) {
      const d = o.design as Record<string, unknown> | null;
      if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.repo !== 'string' || !REPO.test(d.repo)) {
        problems.push(`${at}.design" must be { "repo": "owner/name" }: the design team's copy of the product's repository`);
      } else {
        for (const k of Object.keys(d)) if (k !== 'repo' && k !== 'preview') problems.push(`${at}.design.${k}" is not a known field (repo, preview)`);
        if (d.preview !== undefined && (typeof d.preview !== 'string' || !/^https?:\/\//.test(d.preview))) problems.push(`${at}.design.preview" must be an http(s) URL template, such as "https://shop-design-git-{branch}.vercel.app"`);
        if (typeof o.repo !== 'string') problems.push(`${at}.design" needs "repo" too: the copy is of the product's own repository`);
        else if (d.repo.toLowerCase() === o.repo.toLowerCase()) problems.push(`${at}.design.repo" must be another repository than "repo": the design team's copy, not the developers' repository`);
      }
    }
    if (o.path !== undefined) {
      const bad = typeof o.path !== 'string' || !o.path.trim() || o.path.startsWith('/') || o.path.split('/').includes('..');
      if (bad) problems.push(`${at}.path" must be a folder relative to the repository root, without a leading "/" or "..", such as "apps/admin"`);
    }
    if (o.preview !== undefined && (typeof o.preview !== 'string' || !/^https?:\/\//.test(o.preview))) problems.push(`${at}.preview" must be an http(s) URL template, such as "https://app-git-{branch}.vercel.app"`);
    if (o.production !== undefined && (typeof o.production !== 'string' || !/^https?:\/\/[^{}\s]+$/.test(o.production))) problems.push(`${at}.production" must be the product's production URL, without placeholders, such as "https://shop.example.com"`);
    if (o.address !== undefined) {
      if (typeof o.address !== 'string' || productAddressOf(o.address) !== o.address) problems.push(`${at}.address" must be the live product's https address, without a path, such as "https://shop.example.com"`);
      else if (typeof o.repo !== 'string') problems.push(`${at}.address" needs "repo" too: the design team's own code, where its pages are rebuilt with the library`);
    }
    if (o.framework !== undefined && (typeof o.framework !== 'string' || !o.framework.trim())) problems.push(`${at}.framework" must be a name such as "react", "vue" or "other"`);
    if (o.default !== undefined && typeof o.default !== 'boolean') problems.push(`${at}.default" must be true or false`);
    if (o.default === true) defaults++;
  });
  if (defaults > 1) problems.push('"products" marks more than one product as default: keep "default": true on the library only');
  return problems;
}

// Products added from their address ("Only its address"): the team has no access to the live product's code. Bridge
// starts the design team's own code for it from the product starter, and explorations rebuild the live product's pages
// with the library.

/** A host name with at least one dot and a letter top-level domain: never an IP address, never "localhost". */
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** The https URL a person typed ("posterstudio.com/checkout" or "https://..."), or null. Never another protocol. */
function httpsUrl(input: string | null | undefined): URL | null {
  const t = (input ?? '').trim();
  if (!t || t.length > 500 || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/:]+:\d/.test(t) ? t : `https://${t.replace(/^\/\//, '')}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return HOST.test(u.hostname.toLowerCase()) ? u : null;
}

/**
 * The address Bridge keeps for a product added from its address: its https origin ("https://posterstudio.com"), from a
 * bare domain or a full https link (the path is left out). Null when it is not one: another protocol, an IP address,
 * a port, a sign-in in the link.
 */
export function productAddressOf(input: string | null | undefined): string | null {
  const u = httpsUrl(input);
  return u ? `https://${u.hostname.toLowerCase()}` : null;
}

/** The product's address when it was added from it (`address`), else null. */
export const liveAddressOf = (p: Pick<ProductConfig, 'address'> | null | undefined): string | null => (p?.address ? productAddressOf(p.address) : null);

/** "posterstudio.com": the address as people read it. */
export const addressDomain = (address: string): string => address.replace(/^https:\/\//, '').replace(/\/$/, '');

/**
 * A page of the product's own address, as a clean https link (no fragment), or null: another site, another protocol,
 * or not a link. "www." counts as the same site, and so do its subdomains (shop.posterstudio.com).
 */
export function pageOfAddress(input: string | null | undefined, address: string | null | undefined): string | null {
  const base = productAddressOf(address);
  const u = httpsUrl(input);
  if (!base || !u) return null;
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  const site = strip(addressDomain(base));
  const host = strip(u.hostname);
  if (host !== site && !host.endsWith(`.${site}`)) return null;
  u.hash = '';
  return u.href;
}

/**
 * What Claude is told when an exploration starts from a page of the live product: open it in the browser (a plain
 * fetch misses what JavaScript draws), rebuild it with the library alone, then explore the change. Never the site's
 * own styles or files. Shared by Studio's start lines and the MCP server's brief.
 */
export function startPageBrief(page: string, productName: string, change?: string | null): string {
  const what = (change ?? '').trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  return [
    `Start from ${page}, a page of ${productName} as it is live today.`,
    'Open it in the browser (Claude in Chrome when you have it: a plain fetch misses what JavaScript draws) and look at its layout, content and states.',
    "Rebuild that page in this exploration using ONLY the library's components and tokens: list them with the Bridge tools (bridge_list_components, bridge_search_tokens) before you build.",
    "Never copy the site's CSS, fonts, images or other files.",
    what ? `Then explore this change from that rebuilt page: ${what}.` : 'Then explore the change the designer describes, from that rebuilt page.',
  ].join(' ');
}

/** Whether two product lists say the same thing (toConfigJson leaves the default list out). */
export function sameProducts(a: readonly ProductConfig[], b: readonly ProductConfig[]): boolean {
  const norm = (l: readonly ProductConfig[]) => JSON.stringify(l.map((p) => FIELDS.map((f) => (p as unknown as Record<string, unknown>)[f] ?? null)));
  return norm(a) === norm(b);
}
