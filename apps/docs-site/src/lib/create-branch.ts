// "Start an exploration" in Studio (components/ds/studio/StartExploration): one flow for all work. What it is (one
// sentence) and where: a product, or the library itself (a token, a variant, a new component is an exploration whose
// target is the library). It starts the way the CLI and MCP server start one: an exploration with the product's label
// (productMarks from @bridge-ds/core, none for the library), handed to Claude with one line that sets it up and hands
// control back. Pure: the dialog and its tests share it.
import { defaultProduct, findProduct, parseJiraKey, productRepoOf, type ProductConfig } from '@bridge-ds/core';
import { studioHref } from './team-path';

/** The products a feature can be built in: every product but the default one (the library itself). */
export function featureProducts(products: readonly ProductConfig[]): ProductConfig[] {
  if (!products.length) return [];
  const lib = defaultProduct(products);
  return products.filter((p) => p.key !== lib.key);
}

/** The library as a target, after the products: its name in the menu and the one line under it. */
export const LIBRARY_TARGET = { label: 'The library', hint: 'Tokens, variants, new components' } as const;

export interface StartTarget {
  value: string;
  label: string;
  description?: string;
  product: ProductConfig;
  /** The library itself (the default product): the exploration starts in the design system, with no product label. */
  library: boolean;
}

/** Where an exploration can start: every product, then the library. Empty while the products are unknown. */
export function startTargets(products: readonly ProductConfig[]): StartTarget[] {
  if (!products.length) return [];
  const lib = defaultProduct(products);
  return [
    ...featureProducts(products).map((p) => ({ value: p.key, label: p.name, product: p, library: false })),
    { value: lib.key, label: LIBRARY_TARGET.label, description: LIBRARY_TARGET.hint, product: lib, library: true },
  ];
}

/**
 * The target picked when the dialog opens: the one the page came from (?product=, key or name; "library" for the
 * library), else the only product there is, else the library when there is no product, else none (the person picks).
 */
export function initialTarget(targets: readonly StartTarget[], fromPage: string | null | undefined): string | null {
  const page = (fromPage ?? '').trim().toLowerCase();
  const lib = targets.find((t) => t.library);
  if (lib && page === 'library') return lib.value;
  const hit = findProduct(targets.map((t) => t.product), fromPage);
  if (hit) return hit.key;
  const products = targets.filter((t) => !t.library);
  if (products.length === 1) return products[0]!.value;
  return products.length ? null : (lib?.value ?? null);
}

/** The ?product= of a page address, or null. */
export const productParam = (search: string): string | null => new URLSearchParams(search).get('product')?.trim() || null;

const MAX_NAME = 60;

/** The exploration name from the sentence: the sentence itself, cut at a word under 60 characters. */
export function featureName(sentence: string): string {
  const s = sentence.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  if (s.length <= MAX_NAME) return s;
  const cut = s.slice(0, MAX_NAME + 1);
  const at = cut.lastIndexOf(' ');
  return (at > 20 ? cut.slice(0, at) : s.slice(0, MAX_NAME)).trim();
}

/**
 * What the feature sentence adds as the exploration's purpose: nothing when its name already says all of it (the
 * purpose is optional, never the name again), the whole sentence when the name had to be cut.
 */
export function featurePurpose(sentence: string): string {
  const s = sentence.trim().replace(/\s+/g, ' ');
  return featureName(s) === s.replace(/[.!?]+$/, '') ? '' : s;
}

export interface FeatureForm {
  product: string | null;
  sentence: string;
  jira: string;
}

/** What stops the feature from starting, each saying how to fix it, keyed by field. Empty: ready. */
export function featureProblems(f: FeatureForm, targets: readonly StartTarget[]): Partial<Record<'product' | 'sentence' | 'jira', string>> {
  const out: Partial<Record<'product' | 'sentence' | 'jira', string>> = {};
  if (!f.product || !targets.some((t) => t.value === f.product)) out.product = 'Pick a product or the library.';
  const name = featureName(f.sentence);
  if (!name) out.sentence = 'Say what you want to explore, for example "Billing screen with overdue invoices".';
  else if (!/[a-z0-9]/i.test(name)) out.sentence = 'Use letters or digits: the sentence names the work.';
  if (f.jira.trim()) {
    try {
      parseJiraKey(f.jira);
    } catch (err) {
      out.jira = (err as Error).message;
    }
  }
  return out;
}

/**
 * What to say to Claude once the work exists, with the Bridge MCP server: it opens the exploration and the library,
 * then hands control back. No task and no gap report up front: the designer drives the exploration in the terminal,
 * and bridge_missing_pieces lists what the library lacks when they finish.
 */
export function claudePrompt(x: { sentence: string; product: ProductConfig; number: number; library?: boolean }): string {
  if (x.library) return `Open Bridge exploration #${x.number} "${featureName(x.sentence)}" in the Bridge library. I'll tell you what to explore.`;
  const where = x.product.path ? ` (${x.product.path})` : x.product.repo ? ` (${x.product.repo})` : '';
  return `Open Bridge exploration #${x.number} "${featureName(x.sentence)}" in ${x.product.name}${where} and use the Bridge library. I'll tell you what to explore.`;
}

/** Where the person lands once the exploration started: its page in Changes. */
export const featureHref = (n: number) => studioHref(`changes/?exploration=${n}`);

/**
 * Where a feature's exploration is created: the product's own repository when the team connected one (productRepoOf
 * from @bridge-ds/core), so developers check the branch out in their own environment and get the library from npm;
 * else null, the design system repository (a product folder there, the demo workspace).
 */
export const featureRepo = (p: ProductConfig, designSystemRepo: string): string | null => productRepoOf(p, designSystemRepo);

/** Why the feature cannot start in its product's repository, in designer words: no GitHub detail, one way forward. */
export function productRepoBlockedLine(product: string, reason: 'not-connected' | 'read-only'): string {
  return reason === 'read-only'
    ? `You can look at ${product} but not start work in it yet. Ask an admin to give you access, or start it in the library for now.`
    : `Bridge is not connected to ${product} yet. Ask an admin to connect it, or start it in the library for now.`;
}

/** The admin action: its button label and the message it copies (install Bridge on the repository, or give access). */
export function askAdmin(product: string, repo: string, reason: 'not-connected' | 'read-only', installLink: string): { label: string; message: string } {
  if (reason === 'read-only') return { label: 'Ask an admin for access', message: `Hi, can you give me write access to github.com/${repo}? I want to start ${product} explorations from Bridge.` };
  return {
    label: `Ask an admin to connect ${product}`,
    message: `Hi, can you connect ${product} to Bridge? Install Bridge on github.com/${repo} (${installLink}, pick ${repo.split('/')[1] ?? repo}), so our explorations start in ${product} directly.`,
  };
}
