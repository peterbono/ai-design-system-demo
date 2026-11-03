// "It's a new product", the second choice card of Add a product (components/ds/studio/StartNewProduct.tsx): the team has no code for the
// product yet, so Bridge starts it on GitHub from Bridge's product starter (TEMPLATE_REPO, a public template: Vite,
// React, the Bridge library, its tokens and toolbar), with the viewer's own GitHub sign-in (POST
// /repos/{template}/generate, scripts/new-product.ts). A product the app starts is one it can open right away, so
// there is no "Give Bridge access" step. Then the same review as Add product (scripts/roles.ts proposeNewProduct),
// and the way to its previews (Vercel or Cloudflare Pages, opened in a new window: Bridge never sees a password).
// Designers never read "repository", "template", "fork" or "config" here. Pure, covered by new-product.test.ts.
import type { ProductConfig } from '@bridge-ds/core';
import { cleanProductName, PRODUCT_NAME_MAX } from './product-name';

/** Bridge's product starter on GitHub (a public template repository). */
export const TEMPLATE_REPO = 'peterbono/bridge-product-starter';

export const NEW_PRODUCT_WORDS = {
  // Add a product's second choice card ("It's a new product") opens this form.
  title: "It's a new product",
  lead: 'Bridge sets it up with your library, ready for previews and explorations.',
  name: 'Name',
  nameHelp: 'What your team calls it.',
  create: 'Create product',
  back: 'Back',
  // While GitHub makes it (a few seconds).
  creating: (name: string) => `Starting ${name} on GitHub…`,
  // Made and proposed: the previews step.
  readyTitle: 'Show its previews',
  ready: (name: string) => `${name} is ready. It shows everywhere once your team approves it.`,
  previewsLead: 'Connect it to a host your team uses. Every change then gets its own preview.',
  vercel: 'Open in Vercel',
  cloudflare: 'Open in Cloudflare',
  previewsLater: 'Bridge finds the previews after the first change.',
  done: 'Done',
} as const;

/** A GitHub name from the product's name: "Art print shop" -> "art-print-shop". Empty when nothing usable is left. */
export function slugFor(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/**
 * The GitHub account a new product goes to, with no choice to make: where the team's products already live (the owner
 * of the first product's code in the team's settings, the library itself aside). A team with no product yet: the
 * team's own account, the owner of the library (`library`, "owner/repo"), else `account`. Null when none is known.
 */
export function newProductOwner(
  products: readonly Pick<ProductConfig, 'repo'>[],
  library: string | null | undefined,
  account?: string | null,
): string | null {
  const lib = (library ?? '').toLowerCase();
  for (const p of products) {
    const full = p.repo?.trim() ?? '';
    const owner = full.split('/')[0] ?? '';
    if (owner && full.toLowerCase() !== lib) return owner;
  }
  return (library ?? '').split('/')[0] || account || null;
}

/** What is wrong with the new product, in one sentence; null when it can be created. */
export function newProductProblem(x: { name: string; owner: string | null }, products: readonly Pick<ProductConfig, 'name' | 'repo' | 'design'>[]): string | null {
  const name = cleanProductName(x.name);
  if (!name) return 'Type a name for the product.';
  if (name.length > PRODUCT_NAME_MAX) return `Keep it to ${PRODUCT_NAME_MAX} characters.`;
  if (!slugFor(name)) return 'Use at least one letter or digit in the name.';
  if (products.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) return 'Another product already has this name. Pick a different one.';
  if (!x.owner) return 'Bridge is still reading your team. Try again in a minute.';
  const full = `${x.owner}/${slugFor(name)}`.toLowerCase();
  if (products.some((p) => p.repo?.toLowerCase() === full || p.design?.repo?.toLowerCase() === full)) return 'Another product already has almost the same name. Pick a different one.';
  return null;
}

/** Vercel's import page for the product (the team picks its Vercel account there, Bridge never sees it). */
export const vercelImportUrl = (full: string) => `https://vercel.com/new/import?s=${encodeURIComponent(`https://github.com/${full}`)}`;

/** Cloudflare's "connect to Git" page for a new Pages project, in the viewer's own Cloudflare account. */
export const CLOUDFLARE_IMPORT_URL = 'https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/pages';

/** Why GitHub refused to start the product, from its answer. */
export type StartRefusal = 'taken' | 'no-permission' | 'app-permission' | 'busy' | 'other';

/**
 * The kind of refusal: the name is taken in that account (422, unless GitHub names the visibility), Bridge itself may not create code there yet (403,
 * "not accessible by integration": the app lacks the permission or the account has not accepted it), the viewer may
 * not create there (403 or 404 on the account), GitHub busy (429 or a rate limit), anything else.
 */
export function startRefusal(err: { status?: number; message?: string; detail?: string } | null | undefined): StartRefusal {
  const status = err?.status ?? 0;
  const text = `${err?.detail ?? ''} ${err?.message ?? ''}`;
  if (status === 429 || /rate limit/i.test(text)) return 'busy';
  // GitHub's 422 often only says "Repository creation failed." (the reason sits in `errors`): the name is the one input.
  if (status === 422 && !/visibility|private/i.test(text)) return 'taken';
  if (status === 403 && /not accessible by integration/i.test(text)) return 'app-permission';
  if (status === 403 || status === 404) return 'no-permission';
  return 'other';
}

/** The message an owner gets, copied by "Ask an owner of <account>". */
export function askOwnerMessage(owner: string, kind: 'no-permission' | 'app-permission', name: string): string {
  return kind === 'app-permission'
    ? `Hi, can you accept Bridge's new GitHub permission for ${owner}? GitHub shows it on ${owner}'s installed apps, under Bridge. I want to start ${name} from Bridge.`
    : `Hi, can you let me create products in ${owner} on GitHub? I want to start ${name} from Bridge.`;
}

/** The line and the copy button for a refusal, in designer words. */
export function refusalLine(kind: StartRefusal, x: { owner: string; slug: string; name: string }): { line: string; ask?: { label: string; message: string } } {
  switch (kind) {
    case 'taken':
      return { line: `${x.owner} already has something called ${x.slug}. Pick a different name.` };
    case 'app-permission':
      return {
        line: `Bridge is not allowed to start products in ${x.owner} yet. An owner of ${x.owner} accepts it on GitHub.`,
        ask: { label: `Ask an owner of ${x.owner}`, message: askOwnerMessage(x.owner, 'app-permission', x.name) },
      };
    case 'no-permission':
      return {
        line: `You cannot create products in ${x.owner} yet. Ask an owner of ${x.owner} to let you.`,
        ask: { label: `Ask an owner of ${x.owner}`, message: askOwnerMessage(x.owner, 'no-permission', x.name) },
      };
    case 'busy':
      return { line: 'GitHub is busy. Try again in a minute.' };
    default:
      return { line: `Bridge could not start ${x.name}. Try again in a minute.` };
  }
}

/** How long Bridge waits for GitHub to finish the new product, and how often it looks. */
export const READY_TICK_MS = 1_500;
export const READY_MAX_MS = 30_000;

/** The link from the new product to the team's library, written in it once it exists (`bridge connect` writes the same). */
export const productPointer = (designSystem: string, key: string) => `${JSON.stringify({ version: 1, designSystem, product: key }, null, 2)}\n`;
