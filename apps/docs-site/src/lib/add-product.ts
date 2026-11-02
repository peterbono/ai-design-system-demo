// Adding a product from Bridge (Settings > Products and the onboarding Products step, components/ds/studio/AddProduct.tsx):
// the words, the key Bridge gives it, what its host (Vercel, Netlify statuses, Cloudflare Pages check runs) says about its previews, the bridge.config.json entry,
// the format-preserving edit that appends it, and the pull request that carries it (scripts/roles.ts proposeNewProduct,
// the same path as a product rename). Designers never read "repository", "fork" or "config" here. Pure, covered by
// add-product.test.ts.
import { fromPlain, getEntry, isCloudflareCheck, parseCloudflareCheck, parseJson, serializeJson, type PreviewCheckRun, type JsonArray, type JsonObject, type ProductConfig } from '@bridge-ds/core';
import { cleanProductName, PRODUCT_NAME_MAX } from './product-name';

export const ADD_PRODUCT_WORDS = {
  open: 'Add a product',
  noneYet: 'No product yet. An admin of your team adds them here.',
  title: 'Add a product',
  lead: 'A product your team designs for. Its explorations happen in a copy of it, so the developers keep their code.',
  code: 'Its code',
  codeHelp: 'The products Bridge can see on GitHub.',
  codeLoading: 'Looking for your products…',
  codeNone: 'Bridge sees no product yet. Ask an admin to give the Bridge app access to it on GitHub.',
  name: 'Name',
  nameHelp: 'What your team calls it.',
  copy: 'Give designers their own copy',
  copyHelp: 'Designers explore in it. The developers only get a task when a designer is done.',
  previewsFound: 'Bridge found its previews.',
  previewsLater: 'Bridge finds the previews after the first change.',
  checking: 'Checking its previews…',
  send: 'Add product',
  cancel: 'Cancel',
  sent: 'Product added for review. It shows everywhere once merged.',
  refused: 'Bridge could not add the product. Ask an admin of the design system.',
} as const;

/** One product Bridge can see on GitHub: "owner/name", its name, its default branch. */
export interface ProductRepoChoice {
  full: string;
  name: string;
  defaultBranch: string;
}

/** A readable name from a code name: "art-print-shop" -> "Art print shop". */
export function nameFromRepo(repoName: string): string {
  const words = repoName.replace(/[-_.]+/g, ' ').trim().replace(/\s+/g, ' ');
  return words ? (words[0]!.toUpperCase() + words.slice(1)).slice(0, PRODUCT_NAME_MAX) : '';
}

/** A product key: lowercase letters, digits and dashes, unique among `taken` ("shop", then "shop-2"). */
export function productKeyFor(repoName: string, taken: readonly string[]): string {
  const base = repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'product';
  const used = new Set(taken.map((k) => k.toLowerCase()));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** What is wrong with the choice, in one sentence; null when it can be sent. */
export function addProductProblem(x: { name: string; repo: string | null }, products: readonly Pick<ProductConfig, 'name' | 'repo' | 'design'>[]): string | null {
  if (!x.repo) return 'Pick the product.';
  const repo = x.repo.toLowerCase();
  if (products.some((p) => p.repo?.toLowerCase() === repo || p.design?.repo?.toLowerCase() === repo)) return 'Bridge already lists this product.';
  const name = cleanProductName(x.name);
  if (!name) return 'Type a name for the product.';
  if (name.length > PRODUCT_NAME_MAX) return `Keep it to ${PRODUCT_NAME_MAX} characters.`;
  if (products.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) return 'Another product already has this name. Pick a different one.';
  return null;
}

/** A commit status as GET /repos/{r}/commits/{ref}/status lists it. */
export interface StatusLike {
  context?: string | null;
  state?: string | null;
  target_url?: string | null;
}

/** The Vercel scope and project of an inspector URL (https://vercel.com/<scope>/<project>/<deployment id>). */
function inspector(url: string | null | undefined): { scope: string; project: string } | null {
  const m = /^https:\/\/(?:www\.)?vercel\.com\/([a-z0-9-]+)\/([a-z0-9._-]+)\/[A-Za-z0-9]+\/?$/i.exec(url ?? '');
  return m ? { scope: m[1]!.toLowerCase(), project: m[2]!.toLowerCase() } : null;
}

/**
 * The previews a product's Vercel statuses point to: the branch preview pattern and the production address of the
 * first Vercel project found ("Vercel" or "Vercel – <project>"). Null when no Vercel status is there yet.
 */
export function previewsFromStatuses(statuses: readonly StatusLike[]): { preview: string; production: string } | null {
  for (const s of statuses) {
    // Netlify: `netlify/<site>/deploy-preview` (or `/deploy`): pull request previews and the site's own address.
    const site = /^netlify\/([a-z0-9-]+)\//i.exec(s.context ?? '')?.[1]?.toLowerCase();
    if (site) return { preview: `https://deploy-preview-{pr}--${site}.netlify.app`, production: `https://${site}.netlify.app` };
    if (!/^\s*vercel\b/i.test(s.context ?? '')) continue;
    const at = inspector(s.target_url);
    if (!at) continue;
    return {
      preview: `https://${at.project}-git-{branch}-${at.scope}.vercel.app`,
      production: `https://${at.project}.vercel.app`,
    };
  }
  return null;
}

/**
 * The previews a product's Cloudflare Pages check run points to: `https://{branch}.<project>.pages.dev` and
 * `https://<project>.pages.dev`, from the project its preview links are on. Null when no Cloudflare run is there.
 */
export function previewsFromCheckRuns(runs: readonly PreviewCheckRun[]): { preview: string; production: string } | null {
  for (const c of runs) {
    if (!isCloudflareCheck(c)) continue;
    const links = parseCloudflareCheck(c);
    const host = (() => {
      try {
        return new URL(links?.branchUrl ?? links?.commitUrl ?? '').hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const project = /^[a-z0-9-]+\.([a-z0-9-]+)\.pages\.dev$/.exec(host)?.[1];
    if (project) return { preview: `https://{branch}.${project}.pages.dev`, production: `https://${project}.pages.dev` };
  }
  return null;
}

/** The copy's name next to the product: "owner/shop" -> "owner/shop-design". */
export const copyRepoFor = (repo: string) => `${repo}-design`;

/** The bridge.config.json entry, in the order the file keeps (key, name, repo, design, preview, production, framework). */
export function newProductEntry(x: {
  key: string;
  name: string;
  repo: string;
  copy: boolean;
  previews?: { preview: string; production: string } | null;
  framework?: string;
}): ProductConfig {
  const entry: ProductConfig = { key: x.key, name: cleanProductName(x.name), repo: x.repo };
  if (x.copy) entry.design = { repo: copyRepoFor(x.repo) };
  if (x.previews) {
    entry.preview = x.previews.preview;
    entry.production = x.previews.production;
  }
  entry.framework = x.framework ?? 'react';
  return entry;
}

/** The library, as a team's own list keeps it when the file listed no products before. */
const LIBRARY: ProductConfig = { key: 'library', name: 'Library', default: true };

/**
 * bridge.config.json with `entry` added to `products`, before the default product so it stays last; the rest byte for
 * byte. A file that listed no products gets the new one and the library.
 */
export function withNewProduct(configText: string, entry: ProductConfig): string {
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('bridge.config.json is not a JSON object.');
  const root = doc.root as JsonObject;
  const found = getEntry(root, 'products');
  if (!found || found.value.kind !== 'array' || !(found.value as JsonArray).items.length) {
    const node = fromPlain([entry, LIBRARY]);
    // One product per line, as the file keeps them.
    if (node.kind === 'array') for (const item of node.items) if (item.kind === 'object') item.inline = true;
    if (found) found.value = node;
    else root.entries.push({ key: 'products', value: node });
    root.raw = undefined;
    return serializeJson(doc);
  }
  const list = found.value as JsonArray;
  const isDefault = (n: JsonArray['items'][number]) => n.kind === 'object' && getEntry(n, 'default')?.value.kind === 'boolean' && (getEntry(n, 'default')!.value as { value: boolean }).value;
  const at = list.items.findIndex(isDefault);
  const node = fromPlain(entry, list.items[0], true);
  list.items.splice(at >= 0 ? at : list.items.length, 0, node);
  list.raw = undefined;
  root.raw = undefined;
  return serializeJson(doc);
}

/** Branch, title, body and commit message of the pull request that adds the product. */
export function addProductProposal(entry: ProductConfig, opts: { date: Date; prefix?: string; tierLabel: string }): { branch: string; title: string; body: string; message: string } {
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const title = `chore(config): add the product ${JSON.stringify(entry.name)}`;
  const body = [
    '## A new product',
    '',
    `Adds \`products[key=${entry.key}]\` to \`bridge.config.json\`: ${JSON.stringify(entry.name)}, code in \`${entry.repo}\`.`,
    '',
    ...(entry.design ? [`- Designers explore in their own copy, \`${entry.design.repo}\`, made from the product page.`] : []),
    entry.preview ? `- Previews: \`${entry.preview}\`, production: ${entry.production}.` : '- Previews: found after the first change.',
    '- Studio and the Library list it once this merges.',
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio.',
  ].join('\n');
  return { branch: `${opts.prefix ?? ''}product-add-${entry.key.slice(0, 30)}-${stamp}`, title, body, message: `${title}\n\nProposed from Bridge Studio.` };
}
