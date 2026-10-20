// Products: the apps that consume the design system, as bridge.config.json `products` lists them. Bridge Studio
// groups branches by product, and the CLI and MCP server tell which product a folder or a repository is. A product
// lives in a folder of the design system repo (`path`) or in another GitHub repository (`repo`); the default one is
// the library itself, where a branch lands when nothing else matches. Pure: no Node API, it runs in the browser too.

export interface ProductConfig {
  /** Stable id: lowercase letters, digits and dashes ("admin"). The `product: <key>` label names it. */
  key: string;
  /** What people read ("Admin demo"). */
  name: string;
  /** "owner/name" when the product lives in another GitHub repository. */
  repo?: string;
  /** Folder of this repository, repo-relative ("apps/admin"). */
  path?: string;
  /** Preview URL pattern, same placeholders as previews.apps: {branch} {rawBranch} {pr} {sha} {sha7}. */
  preview?: string;
  /** react, vue, angular, svelte, astro, other. */
  framework?: string;
  /** The product a branch belongs to when nothing else matches: the library. */
  default?: boolean;
}

/** What a config without `products` means: the Admin demo first, then the library (the default). */
export const DEFAULT_PRODUCTS: ProductConfig[] = [
  { key: 'admin', name: 'Admin demo', path: 'apps/admin', framework: 'react' },
  { key: 'library', name: 'Library', default: true },
];

/** Pull request labels that pin a branch to a product ("product: admin"). */
export const PRODUCT_LABEL_PREFIX = 'product: ';

export const productLabel = (key: string): string => `${PRODUCT_LABEL_PREFIX}${key}`;

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

const KEY = /^[a-z0-9][a-z0-9-]*$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const FIELDS = ['key', 'name', 'repo', 'path', 'preview', 'framework', 'default'];

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
    if (o.path !== undefined) {
      const bad = typeof o.path !== 'string' || !o.path.trim() || o.path.startsWith('/') || o.path.split('/').includes('..');
      if (bad) problems.push(`${at}.path" must be a folder relative to the repository root, without a leading "/" or "..", such as "apps/admin"`);
    }
    if (o.preview !== undefined && (typeof o.preview !== 'string' || !/^https?:\/\//.test(o.preview))) problems.push(`${at}.preview" must be an http(s) URL template, such as "https://app-git-{branch}.vercel.app"`);
    if (o.framework !== undefined && (typeof o.framework !== 'string' || !o.framework.trim())) problems.push(`${at}.framework" must be a name such as "react", "vue" or "other"`);
    if (o.default !== undefined && typeof o.default !== 'boolean') problems.push(`${at}.default" must be true or false`);
    if (o.default === true) defaults++;
  });
  if (defaults > 1) problems.push('"products" marks more than one product as default: keep "default": true on the library only');
  return problems;
}

/** Whether two product lists say the same thing (toConfigJson leaves the default list out). */
export function sameProducts(a: readonly ProductConfig[], b: readonly ProductConfig[]): boolean {
  const norm = (l: readonly ProductConfig[]) => JSON.stringify(l.map((p) => FIELDS.map((f) => (p as unknown as Record<string, unknown>)[f] ?? null)));
  return norm(a) === norm(b);
}
