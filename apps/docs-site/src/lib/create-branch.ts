// "Create branch" in Studio (components/ds/studio/StartChange): product first, since most work is a feature in a
// product. Step 1 asks what the work is (a feature in a product, or a change to the library); step 2 asks what the
// feature is and in which product, or which library change. A feature starts the way the CLI and MCP server start one
// for a product: an exploration with the product's label (productMarks from @bridge-ds/core), handed to Claude with
// one line that sets it up and hands control back. Pure: the dialog and its tests share it.
import { defaultProduct, findProduct, parseJiraKey, productRepoOf, type ProductConfig } from '@bridge-ds/core';
import { studioHref } from './team-path';

export type WorkKind = 'feature' | 'library';

export const KIND_CHOICES: { value: WorkKind; title: string; line: string }[] = [
  { value: 'feature', title: 'A feature in a product', line: 'A new screen or flow. You explore it with Claude AI and the library.' },
  { value: 'library', title: 'A change to the library', line: 'A token, a variant or a new component.' },
];

/** The products a feature can be built in: every product but the default one (the library itself). */
export function featureProducts(products: readonly ProductConfig[]): ProductConfig[] {
  if (!products.length) return [];
  const lib = defaultProduct(products);
  return products.filter((p) => p.key !== lib.key);
}

/**
 * The product picked when step 2 opens: the one the page came from (?product=, key or name) when a feature can be
 * built in it, else the only one there is, else none (the person picks).
 */
export function initialProduct(choices: readonly ProductConfig[], fromPage: string | null | undefined): string | null {
  const hit = findProduct(choices, fromPage);
  if (hit) return hit.key;
  return choices.length === 1 ? choices[0]!.key : null;
}

/** The ?product= of a page address, or null. */
export const productParam = (search: string): string | null => new URLSearchParams(search).get('product')?.trim() || null;

/** Where step 1 starts: the kind question, or the library choices directly when no product but the library exists. */
export const firstStep = (choices: readonly ProductConfig[]): 'kind' | 'library' => (choices.length ? 'kind' : 'library');

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
export function featureProblems(f: FeatureForm, choices: readonly ProductConfig[]): Partial<Record<'product' | 'sentence' | 'jira', string>> {
  const out: Partial<Record<'product' | 'sentence' | 'jira', string>> = {};
  if (!f.product || !findProduct(choices, f.product)) out.product = 'Pick the product it is for.';
  const name = featureName(f.sentence);
  if (!name) out.sentence = 'Say what you are building, for example "Billing screen with overdue invoices".';
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
export function claudePrompt(x: { sentence: string; product: ProductConfig; number: number }): string {
  const where = x.product.path ? ` (${x.product.path})` : x.product.repo ? ` (${x.product.repo})` : '';
  return `Open Bridge exploration #${x.number} "${featureName(x.sentence)}" in ${x.product.name}${where} and use the Bridge library. I'll tell you what to explore.`;
}

/** Where the person lands once the feature started: the branch in place on the Branches page. */
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
