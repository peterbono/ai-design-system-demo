// Adding a product from Bridge (Settings > Products and the onboarding Products step, components/ds/studio/AddProduct.tsx):
// the words, the key Bridge gives it, what its host (Vercel, Netlify statuses, Cloudflare Pages check runs) says about its previews, the bridge.config.json entry,
// which products Bridge offers (never its own designers' copies: isDesignCopy), who adds them (canAddProduct), the
// product shown at once once added (withAddedProducts), the format-preserving edit and the pull request of the
// reviewed fallback (scripts/roles.ts proposeNewProduct). Designers never read "repository", "fork" or "config" here.
// Pure, covered by add-product.test.ts.
import { fromPlain, getEntry, isCloudflareCheck, parseCloudflareCheck, parseJson, serializeJson, type PreviewCheckRun, type JsonArray, type JsonObject, type ProductConfig } from '@bridge-ds/core';
import { cleanProductName, PRODUCT_NAME_MAX } from './product-name';
import { canonicalRepo } from './team-path';
import { DESIGN_COPY_DESCRIPTION, DESIGN_COPY_TOPIC } from './design-copy';

export const ADD_PRODUCT_WORDS = {
  open: 'Add a product',
  noneYet: 'No product yet. An admin of your team adds them here.',
  title: 'Add a product',
  // The onboarding Products step's line while the team has none yet (the dialog itself asks `question`).
  lead: 'A product your team designs for. Its explorations happen in a copy of it, so the developers keep their code.',
  // The dialog opens on what Bridge found on GitHub (one row each, with Add), else straight on a new product.
  codeLoading: 'Looking for your products on GitHub…',
  foundLead: "Bridge found these on GitHub. Your team doesn't have them yet.",
  add: 'Add',
  addLabel: (name: string) => `Add ${name}`,
  adding: (name: string) => `Adding ${name}…`,
  startNew: 'Start a new product',
  // A new product: its name, then Create product (lib/new-product.ts NEW_PRODUCT_WORDS).
  newLead: 'Bridge sets it up with your library, ready for explorations.',
  codeOnGitHub: 'Its code is already on GitHub?',
  findThere: 'Find it there',
  // Under the list, always: the way to a product Bridge cannot see yet (GitHub opens in a small window).
  notListed: 'Not in the list?',
  findOnGitHub: 'Find it on GitHub',
  // GitHub did not answer when the dialog opened: why nothing is listed, and Try again.
  unreadLine: 'Bridge could not get your products from GitHub just now.',
  unreadAction: 'It often works a moment later.',
  // While GitHub's window is open, the dialog waits and reads the list again on its own.
  waiting: 'Tick your product on GitHub, then Save. Bridge waits here.',
  waitingNote: 'Bridge looks for it every few seconds.',
  showGitHub: 'Show GitHub',
  tryAgain: 'Try again',
  copy: 'Give designers their own copy',
  copyHelp: 'Designers explore in it. The developers only get a task when a designer is done.',
  cancel: 'Cancel',
  // The library does not let Bridge add it straight away (an older setup): it goes to review instead, said plainly.
  sent: 'Sent for review. It shows here once someone approves it.',
  reviewTitle: 'Sent for review',
  reviewLine: (name: string) => `Bridge could not add ${name} straight away on this library, so it went to review. It shows in your products once someone approves it.`,
  done: 'Done',
  refused: 'Bridge could not add the product. Try again in a minute.',
  // Someone who does not own the account on GitHub: GitHub lets them request access, its owners approve.
  copyForOwners: 'Copy a message for the owners',
  copiedForOwners: 'Message copied',
  copiedForOwnersSaid: 'Message copied. Paste it to the owners.',
  checkAgain: 'Check again',
} as const;

/** The line that says the new product arrived (announced, then the form waits with it picked). */
export const foundLine = (name: string) => `${name} is here. Add it when you're ready.`;

/**
 * GitHub closed with nothing new: someone who does not own the account could only ask for access, and its owners
 * decide. `account`: the GitHub account Bridge asked about, when known.
 */
export const nothingNewLine = (account: string | null | undefined) =>
  `Nothing new yet. If GitHub asked you to request access, the owners of ${account || 'that account'} get it; this list updates when they approve.`;

/** Said before GitHub opens, to someone who cannot give access themselves: GitHub turns their Save into a request. */
export const ownersOnlyLine = (account: string) => `Only the owners of ${account} can show Bridge where it is. GitHub sends them your request.`;

/** GitHub closed with nothing new for someone who could only request: what happens next. */
export const requestSentLine = (account: string, product: string | null | undefined) =>
  `Request sent to the owners of ${account}. Bridge shows ${product?.trim() || 'your product'} here as soon as they approve.`;

/**
 * Add a product's own "nothing new" line (CopyAccessStep keeps nothingNewLine): GitHub closed and Bridge still sees
 * nothing new. Someone who does not own the account could only ask, and its owners decide.
 */
export const nothingYetLine = (account: string | null | undefined) =>
  `Nothing new yet. If GitHub asked you to request access, the owners of ${account || 'that account'} decide. Bridge shows your product here when they approve.`;

/**
 * Whether the viewer can give Bridge access on `account` themselves: their own account, or an organization where
 * GitHub says they are an owner (GET /user/memberships/orgs/{org}: role "admin", state "active"). Null when Bridge
 * cannot tell (the membership was not readable): the dialog then keeps its usual words.
 */
export function ownsAccount(x: {
  login: string | null | undefined;
  account: string;
  /** The installation's account type, when there is one ("User" or "Organization"). */
  type?: string | null;
  /** The viewer's membership of `account`; null when GitHub answered that they have none, undefined when unknown. */
  membership?: { role?: string | null; state?: string | null } | null;
}): boolean | null {
  const login = x.login?.trim().toLowerCase();
  const account = x.account.trim().toLowerCase();
  if (login && login === account) return true;
  if (x.type === 'User') return false;
  if (x.membership === undefined) return null;
  if (x.membership === null) return false;
  return x.membership.role === 'admin' && x.membership.state !== 'pending';
}

/** A request this browser sent to the owners, kept per team until the product arrives (localStorage). */
export interface PendingRequest {
  /** The GitHub account whose owners decide. */
  account: string;
  /** The product's name when the person typed one, else null. */
  product: string | null;
  /** The products listed when GitHub opened ("owner/name"): anything else that shows up is the approved one. */
  before: string[];
  at: number;
}

/** How long a request is remembered: GitHub keeps it until the owners answer, Bridge stops saying so after a while. */
export const PENDING_KEEP_MS = 30 * 24 * 60 * 60_000;

/** The localStorage key of a team's pending request ("owner/repo", case-insensitive). */
export const pendingKey = (team: string) => `bridge.addProduct.requested:${team.toLowerCase()}`;

/** A stored request, or null when there is none, it is not one, or it is older than PENDING_KEEP_MS. */
export function parsePending(text: string | null, now: number): PendingRequest | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<PendingRequest> | null;
    if (!v || typeof v !== 'object' || typeof v.account !== 'string' || !v.account.trim() || typeof v.at !== 'number') return null;
    if (now - v.at > PENDING_KEEP_MS || v.at > now + 60_000) return null;
    const before = Array.isArray(v.before) ? v.before.filter((r): r is string => typeof r === 'string').slice(0, 500) : [];
    const product = typeof v.product === 'string' && v.product.trim() ? v.product.trim().slice(0, PRODUCT_NAME_MAX) : null;
    return { account: v.account.trim(), product, before, at: v.at };
  } catch {
    return null;
  }
}

/** One product Bridge can see on GitHub: "owner/name", its name, its default branch. */
export interface ProductRepoChoice {
  full: string;
  name: string;
  defaultBranch: string;
}

/** A repository as GitHub lists it, for the pick list. */
export interface RepoLike {
  full_name: string;
  name: string;
  default_branch?: string;
  archived?: boolean;
  fork?: boolean;
  /** GitHub topics (listed with the repository). Bridge marks its designers' copies with DESIGN_COPY_TOPIC. */
  topics?: string[] | null;
  description?: string | null;
}

const sentence = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\.$/, '');

/**
 * Whether a repository is one of Bridge's designers' copies, never a product of its own: marked by Bridge when it made
 * it (the topic, or its description), some listed product's copy (`copies`: design.repo of the known settings, lower
 * case), or named "<product>-design" (or "-design-old") next to a product in `products` ("owner/name", lower case:
 * the team's and the ones found with it).
 */
export function isDesignCopy(r: Pick<RepoLike, 'full_name' | 'topics' | 'description'>, x: { copies: ReadonlySet<string>; products: ReadonlySet<string> }): boolean {
  const full = canonicalRepo(r.full_name).toLowerCase();
  if (x.copies.has(full)) return true;
  if ((r.topics ?? []).some((t) => typeof t === 'string' && t.toLowerCase() === DESIGN_COPY_TOPIC)) return true;
  const said = sentence(r.description);
  if (said && said === sentence(DESIGN_COPY_DESCRIPTION)) return true;
  const base = /^(.+)-design(?:-old)?$/.exec(full)?.[1];
  return Boolean(base && x.products.has(base));
}

/**
 * What can be picked: never the design system itself (`ds`, "owner/name"), a product or copy already listed, an
 * archived one or the same one twice. Sorted by "owner/name".
 */
export function pickableRepos(repos: readonly RepoLike[], listed: readonly Pick<ProductConfig, 'repo' | 'design'>[], ds: string): ProductRepoChoice[] {
  // Old names count as the new ones (lib/team-path canonicalRepo): a product listed before a rename is still listed.
  const norm = (r: string) => canonicalRepo(r).toLowerCase();
  const self = norm(ds);
  const copies = new Set(listed.map((p) => p.design?.repo).filter((r): r is string => Boolean(r)).map(norm));
  const taken = new Set([...listed.map((p) => p.repo).filter((r): r is string => Boolean(r)).map(norm), ...copies]);
  // Bridge's own designers' copies are never offered (isDesignCopy): next to a listed product or to one found with it.
  const products = new Set([...taken, ...repos.map((r) => norm(r.full_name))]);
  const seen = new Set<string>();
  return repos
    .filter((r) => {
      const full = norm(r.full_name);
      if (seen.has(full) || full === self || taken.has(full) || r.archived) return false;
      if (isDesignCopy(r, { copies, products })) return false;
      seen.add(full);
      return true;
    })
    .map((r) => ({ full: r.full_name, name: r.name, defaultBranch: r.default_branch ?? 'main' }))
    .sort((a, b) => a.full.localeCompare(b.full));
}

/** The first product in `now` that was not in the list before (`before`: "owner/name" as shown then), else null. */
export function newRepoIn(before: Iterable<string>, now: readonly ProductRepoChoice[]): ProductRepoChoice | null {
  const known = new Set([...before].map((r) => r.toLowerCase()));
  return now.find((r) => !known.has(r.full.toLowerCase())) ?? null;
}

/** `list` with the products of `more` it lacks, sorted like the pick list. */
export function mergeRepos(list: readonly ProductRepoChoice[], more: readonly ProductRepoChoice[]): ProductRepoChoice[] {
  const known = new Set(list.map((r) => r.full.toLowerCase()));
  return [...list, ...more.filter((r) => !known.has(r.full.toLowerCase()))].sort((a, b) => a.full.localeCompare(b.full));
}

// Giving Bridge access from the dialog (Vercel's "Adjust GitHub App permissions"): GitHub opens in a small centered
// window on the installation's page, the dialog waits and reads the list again, and goes back to the form with the new
// product picked. The return page (pages/studio/auth/access.astro) tells the dialog at once when GitHub sends it there.

/** How often the dialog reads the list while it waits, and for how long at most. */
export const ACCESS_TICK_MS = 4_000;
export const ACCESS_MAX_MS = 10 * 60_000;

/** The message the return page sends to the dialog that opened GitHub. */
export const ACCESS_MESSAGE = 'bridge:github-access-updated';

/** A message from this site's return page: same origin and the one type. Anything else is ignored. */
export function isAccessMessage(e: { origin: string; data: unknown }, origin: string): boolean {
  return e.origin === origin && typeof e.data === 'object' && e.data !== null && (e.data as { type?: unknown }).type === ACCESS_MESSAGE;
}

/** window.open features for a window of `size`, centered on the window it opens from. */
export function popupFeatures(from: { screenX: number; screenY: number; outerWidth: number; outerHeight: number }, size = { width: 1020, height: 760 }): string {
  const left = Math.max(0, Math.round(from.screenX + (from.outerWidth - size.width) / 2));
  const top = Math.max(0, Math.round(from.screenY + (from.outerHeight - size.height) / 2));
  return `popup=yes,width=${size.width},height=${size.height},left=${left},top=${top}`;
}

/**
 * Where the dialog is: the form, waiting on GitHub, GitHub closed with nothing new, a request waiting on the owners
 * (someone who could only request), or GitHub busy for the viewer.
 */
export type AccessStep =
  | { kind: 'list' }
  | { kind: 'waiting'; since: number }
  | { kind: 'nothing-new' }
  | { kind: 'requested' }
  | { kind: 'busy'; resetsAt: Date | null; source: 'github' | 'bridge' };

export type AccessEvent =
  | { type: 'open'; at: number }
  | { type: 'cancel' }
  | { type: 'found' }
  /** `requested`: the viewer could only request access (not an owner), so GitHub sent the owners a request. */
  | { type: 'closed'; requested?: boolean }
  | { type: 'timeout'; requested?: boolean }
  /** The dialog opened with a request this browser sent earlier. */
  | { type: 'pending' }
  | { type: 'busy'; resetsAt: Date | null; source: 'github' | 'bridge' }
  | { type: 'read' };

/**
 * The next step. GitHub opened: waiting. Cancel, or the new product found: the form. GitHub closed, or the wait ran
 * out, with nothing new: "Nothing new yet", or "Request sent" for someone who could only request. A request kept
 * from earlier: "Request sent". GitHub busy: the busy line, until a read works again (`read`).
 */
export function accessStep(step: AccessStep, e: AccessEvent): AccessStep {
  switch (e.type) {
    case 'open':
      return { kind: 'waiting', since: e.at };
    case 'cancel':
    case 'found':
      return { kind: 'list' };
    case 'closed':
    case 'timeout':
      return step.kind === 'waiting' ? (e.requested ? { kind: 'requested' } : { kind: 'nothing-new' }) : step;
    case 'pending':
      return step.kind === 'list' ? { kind: 'requested' } : step;
    case 'busy':
      return { kind: 'busy', resetsAt: e.resetsAt, source: e.source };
    case 'read':
      return step.kind === 'busy' ? { kind: 'list' } : step;
  }
}

/** The wait ran out: stop reading. */
export const waitedTooLong = (step: AccessStep, now: number) => step.kind === 'waiting' && now - step.since >= ACCESS_MAX_MS;

/** A readable name from a code name: "art-print-shop" -> "Art print shop". */
export function nameFromRepo(repoName: string): string {
  const words = repoName.replace(/[-_.]+/g, ' ').trim().replace(/\s+/g, ' ');
  return words ? (words[0]!.toUpperCase() + words.slice(1)).slice(0, PRODUCT_NAME_MAX) : '';
}

/**
 * The name Bridge gives a picked product (there is no name field: it can be renamed later): the readable one, made
 * unique with its GitHub account when another product already has it ("Shop (studio)", then "Shop (studio) 2").
 */
export function productNameFor(repo: Pick<ProductRepoChoice, 'full' | 'name'>, products: readonly Pick<ProductConfig, 'name'>[]): string {
  const taken = new Set(products.map((p) => p.name.trim().toLowerCase()));
  const base = nameFromRepo(repo.name) || repo.name;
  if (!taken.has(base.toLowerCase())) return base;
  const owner = repo.full.split('/')[0] ?? '';
  const withOwner = cleanProductName(`${base} (${owner})`).slice(0, PRODUCT_NAME_MAX);
  if (!taken.has(withOwner.toLowerCase())) return withOwner;
  for (let i = 2; ; i++) {
    const n = cleanProductName(`${withOwner.slice(0, PRODUCT_NAME_MAX - String(i).length - 1)} ${i}`);
    if (!taken.has(n.toLowerCase())) return n;
  }
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

// The team's GitHub account, for the GitHub step when Bridge does not know its installation (none yet, or GitHub did
// not answer): the app's install page for that account (lib/access-view installForAccountUrl), never the account picker.

/** The team's GitHub account as GET /users/{login} answers it: its id (it survives a rename) and its type. */
export interface OwnerAccount {
  id: number;
  type: 'User' | 'Organization';
}

/** An account from GitHub's answer (or this browser's copy of it), else null. */
export function parseOwnerAccount(v: unknown): OwnerAccount | null {
  if (!v || typeof v !== 'object') return null;
  const { id, type } = v as { id?: unknown; type?: unknown };
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  return { id, type: type === 'Organization' ? 'Organization' : 'User' };
}

/** Where this browser keeps an account's id (an id never changes, so the copy never goes stale). */
export const ownerAccountKey = (login: string) => `bridge.owner-account:${login.trim().toLowerCase()}`;

/**
 * The people who lead the team (governance owners, design and tech, and the owner override list), as GitHub logins in
 * lower case. A team entry ("@org/team") never counts here: the server reads the same list (api/_lib/product-add.ts).
 */
export function teamLeadsOf(config: unknown): string[] {
  type Gov = { owners?: { design?: unknown; tech?: unknown }; override?: { allowed?: unknown } };
  const c = config && typeof config === 'object' ? (config as Gov & { governance?: Gov }) : null;
  // bridge.config.json keeps them under `governance`; the page's settings (core SiteRepo) at the top.
  const g = c?.governance ?? c;
  const out = new Set<string>();
  for (const l of [g?.owners?.design, g?.owners?.tech, g?.override?.allowed]) {
    if (Array.isArray(l)) for (const v of l) if (typeof v === 'string' && /^@?[A-Za-z0-9-]{1,39}$/.test(v.trim())) out.add(v.trim().replace(/^@/, '').toLowerCase());
  }
  return [...out];
}

/**
 * Who adds products: admins and leads of the team signed in with GitHub (never an email member, never the sample
 * team). Bridge checks it again on the server before it writes anything; this only decides whether the button shows.
 */
export function canAddProduct(
  access: { admin?: boolean; repoAdmin?: boolean; write?: boolean; contributor?: boolean } | null | undefined,
  x: { sample: boolean; login: string | null | undefined; config: unknown },
): boolean {
  if (x.sample || !access || access.contributor) return false;
  if (access.admin || access.repoAdmin) return true;
  const login = x.login?.trim().toLowerCase();
  return Boolean(access.write && login && teamLeadsOf(x.config).includes(login));
}

// A product just added (straight to the team's settings, lib/product-add-api.ts): the page knows it before GitHub's
// answers catch up (a browser's copy of the settings, Bridge's read cache), so the side nav and its page show it at
// once. Kept per team in this tab (sessionStorage, scripts/repo-context.ts), until the settings read list it or
// ADDED_KEEP_MS passed.

/** A product this tab added, and when. */
export interface AddedProduct {
  entry: ProductConfig;
  at: number;
}

/** How long a just-added product is shown before the team's settings list it: long enough for any cache to turn. */
export const ADDED_KEEP_MS = 10 * 60_000;

/** The sessionStorage key of a team's just-added products ("owner/repo", case-insensitive). */
export const addedKey = (team: string) => `bridge.addedProducts:${team.toLowerCase()}`;

const isAdded = (a: unknown, now: number): a is AddedProduct => {
  if (!a || typeof a !== 'object') return false;
  const { at, entry } = a as Partial<AddedProduct>;
  return typeof at === 'number' && now - at < ADDED_KEEP_MS && at <= now + 60_000 && typeof entry?.key === 'string' && typeof entry.name === 'string';
};

/** The kept list, or [] when there is none, it is not one, or its entries are too old. */
export function parseAdded(text: string | null, now: number): AddedProduct[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((a) => isAdded(a, now)) : [];
  } catch {
    return [];
  }
}

/**
 * `products` with the just-added ones it does not list yet (by key), before the default product as the settings keep
 * them. Unchanged when every one is there.
 */
export function withAddedProducts(products: readonly ProductConfig[], added: readonly AddedProduct[]): ProductConfig[] {
  const keys = new Set(products.map((p) => p.key.toLowerCase()));
  const missing = added.map((a) => a.entry).filter((e) => !keys.has(e.key.toLowerCase()));
  const list = [...products];
  if (!missing.length) return list;
  const at = list.findIndex((p) => p.default);
  list.splice(at >= 0 ? at : list.length, 0, ...missing);
  return list;
}
