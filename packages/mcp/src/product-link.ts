// A product repository connected to Bridge (`bridge connect`, run once inside it): `.bridge/product.json` names the
// team's design system repository and the product key. Claude and the bridge CLI run there read the design system
// (its bridge.config.json, tokens and products) from GitHub, default the product to this one, and switch this checkout
// when continuing one of its explorations. No DTCG files are needed in the product repository.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILE } from './config.js';
import type { ContextOptions } from './context.js';

/** Where the pointer lives, relative to the product repository root. */
export const PRODUCT_POINTER = '.bridge/product.json';

export interface ProductPointer {
  version: 1;
  /** The team's design system repository, `owner/name`, where bridge.config.json lives. */
  designSystem: string;
  /** The product key in that bridge.config.json `products[]`. */
  product: string;
}

export interface ProductLink extends ProductPointer {
  /** The product repository root: the folder holding `.bridge/product.json`. */
  root: string;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The same link kept in the clone's own git config (`bridge.designSystem`, `bridge.product`, set by `bridge connect`):
 * it survives switching to a branch made before the setup was committed, where `.bridge/product.json` is not.
 */
export const GIT_CONFIG_KEYS = { designSystem: 'bridge.designSystem', product: 'bridge.product' } as const;

const gitConfig = (dir: string, key: string) =>
  new Promise<string>((done) => execFile('git', ['config', '--local', '--get', key], { cwd: dir, timeout: 5000 }, (err, out) => done(err ? '' : String(out).trim())));

async function linkFromGitConfig(dir: string): Promise<ProductPointer | null> {
  const [designSystem, product] = await Promise.all([gitConfig(dir, GIT_CONFIG_KEYS.designSystem), gitConfig(dir, GIT_CONFIG_KEYS.product)]);
  return REPO.test(designSystem) && product ? { version: 1, designSystem, product } : null;
}

/** The pointer from its JSON text, or why it cannot be read, in plain words. */
export function parseProductPointer(text: string): ProductPointer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${PRODUCT_POINTER} is not valid JSON. Run \`bridge connect --ds <owner/name> --product <key>\` again to rewrite it.`);
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const designSystem = typeof o.designSystem === 'string' ? o.designSystem.trim() : '';
  const product = typeof o.product === 'string' ? o.product.trim() : '';
  if (!REPO.test(designSystem)) throw new Error(`${PRODUCT_POINTER} needs "designSystem": "owner/name", the team's design system repository.`);
  if (!product) throw new Error(`${PRODUCT_POINTER} needs "product": the product key in the design system's bridge.config.json.`);
  return { version: 1, designSystem, product };
}

/**
 * The connected product repository `dir` is in: the nearest folder at or above it with `.bridge/product.json`. A
 * folder with its own bridge.config.json met first wins (it is a design system repository, not a product), and so
 * does the end of the git repository (the folder holding `.git`): there the clone's git config may still keep the link
 * (GIT_CONFIG_KEYS), else null.
 */
export async function findProductLink(dir: string): Promise<ProductLink | null> {
  let at = resolve(dir);
  for (;;) {
    if (existsSync(join(at, CONFIG_FILE))) return null;
    const p = join(at, PRODUCT_POINTER);
    if (existsSync(p)) return { ...parseProductPointer(await readFile(p, 'utf8')), root: at };
    if (existsSync(join(at, '.git'))) {
      const kept = await linkFromGitConfig(at);
      return kept ? { ...kept, root: at } : null;
    }
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * Context options for a command run in `dir`. In a connected product repository: the design system repository on
 * GitHub (`repo`), this checkout (`workTree`) and its product key (`product`). Elsewhere `base` unchanged with `root`.
 * An explicit `repo` (the MCP server's `--repo`) keeps it, and takes the checkout and product only when the pointer
 * names that same repository.
 */
export async function linkedOptions(dir: string, base: Omit<ContextOptions, 'root'> & { root?: string | undefined } = {}): Promise<ContextOptions & { link?: ProductLink }> {
  const { root: _root, ...rest } = base;
  const link = await findProductLink(dir);
  if (!link || (rest.repo && rest.repo.toLowerCase() !== link.designSystem.toLowerCase())) return rest.repo ? rest : { ...rest, root: dir };
  return { ...rest, repo: rest.repo ?? link.designSystem, workTree: link.root, product: link.product, link };
}
