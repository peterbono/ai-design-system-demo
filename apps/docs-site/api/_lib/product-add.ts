// Adding a product straight to a team's library (Studio's "Add a product" and "Start a new product"), routed from
// /api/ship: POST /api/ship { repo: "owner/name", action: "add-product", product: <entry> }.
//
// This is the ONLY code path that uses the Bridge GitHub App's bypass of the main ruleset (ruleset 25324954, app
// bridge-design-studio, id 5371630). It is scoped as narrowly as the change it makes:
//   - one file: bridge.config.json on the default branch, a constant path; nothing from the client picks a path or
//     sends file content. The new text is computed here from the text on the default branch.
//   - one change: exactly one product appended to the top-level `products` array (before the library), checked after
//     the edit by parsing both files and comparing them; the entry itself is validated strictly (validProductEntry).
//   - one kind of person: an admin of the team's repository, or a lead (a login listed in governance.owners or
//     governance.override.allowed) with write access, read with the caller's own GitHub token. Email members and
//     everyone else are refused. Nothing the browser says about who it is counts.
//   - one permission: an installation token narrowed to contents: write on the team's repository only.
// When GitHub refuses the direct write (an install without the bypass, a rule) the answer says so (`added: false`) and
// Studio opens the usual reviewed pull request instead.
//
//   -> 200 { added: true, key, products, commit }            written to the default branch
//   -> 200 { added: false, code, reason }                    not written: the client proposes it for review
//   -> 4xx { error, message }                                refused (who, or what), in designer words

import { githubApp, type AppTokens } from './github-app.js';
import { fail, GITHUB_DOWN, HttpError, json, type FetchLike } from './http.js';
import type { Redis } from './redis.js';
import { changedWrites, noteWrite, productsKey } from './team-read.js';

export const CONFIG_FILE = 'bridge.config.json';
export const ADD_PRODUCT_PERMISSIONS = { contents: 'write' } as const;
const API = 'https://api.github.com';
const NAME_MAX = 60;
const URL_MAX = 200;

export const ADD_PRODUCT_SERVER_WORDS = {
  needsGithub: 'Adding a product needs a GitHub sign-in.',
  signin: 'Your GitHub sign-in expired. Sign in again.',
  notLead: 'Only admins and leads of your team add products. Ask one of them.',
  notFound: 'Bridge cannot open that product on GitHub with your sign-in.',
  invalid: 'Bridge could not read that product. Pick it again.',
  takenKey: 'Your team already has a product with this address. Try again.',
  takenName: 'Another product already has this name. Pick a different one.',
  takenRepo: 'Your team already has this product.',
  configShape: 'Bridge could not add it straight away, so it goes to review.',
  refused: 'Bridge could not add it straight away on this library, so it goes to review.',
  appMissing: 'Bridge cannot add products by itself on this library yet, so it goes to review.',
} as const;

/** A product entry as Studio sends it (lib/add-product.ts newProductEntry), once validated. */
export interface ProductEntry {
  key: string;
  name: string;
  repo: string;
  design?: { repo: string };
  preview?: string;
  production?: string;
  framework?: 'react';
}

const ALLOWED = new Set(['key', 'name', 'repo', 'design', 'preview', 'production', 'framework']);
const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const HOSTS = ['.vercel.app', '.netlify.app', '.pages.dev'];
const isPlain = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const cleanName = (v: string) => v.trim().replace(/\s+/g, ' ');

function previewUrl(v: unknown, placeholders: boolean): string | null {
  if (typeof v !== 'string' || !v || v.length > URL_MAX) return null;
  const probe = placeholders ? v.replace(/\{(branch|pr)\}/g, 'x') : v;
  if (/[{}\s]/.test(probe)) return null;
  let u: URL;
  try {
    u = new URL(probe);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!HOSTS.some((h) => host.endsWith(h) && host.length > h.length)) return null;
  return v;
}

/**
 * The entry when it is exactly what Studio sends for a new product, else null. `team`: the team's repository
 * ("owner/name"), never a product of itself. Pure.
 */
export function validProductEntry(v: unknown, team: string): ProductEntry | null {
  if (!isPlain(v)) return null;
  if (Object.keys(v).some((k) => !ALLOWED.has(k))) return null;
  const { key, name, repo, design, preview, production, framework } = v;
  if (typeof key !== 'string' || !KEY.test(key) || key === 'library') return null;
  if (typeof name !== 'string' || /[\u0000-\u001f\u007f]/.test(name)) return null;
  const clean = cleanName(name);
  if (!clean || clean.length > NAME_MAX || clean !== name) return null;
  if (typeof repo !== 'string' || !REPO.test(repo)) return null;
  const [, rname] = repo.split('/') as [string, string];
  if (rname === '.' || rname === '..' || repo.toLowerCase() === team.toLowerCase()) return null;
  const out: ProductEntry = { key, name: clean, repo };
  if (design !== undefined) {
    if (!isPlain(design) || Object.keys(design).length !== 1 || design.repo !== `${repo}-design`) return null;
    out.design = { repo: `${repo}-design` };
  }
  if ((preview === undefined) !== (production === undefined)) return null;
  if (preview !== undefined) {
    const p = previewUrl(preview, true);
    const q = previewUrl(production, false);
    if (!p || !q) return null;
    out.preview = p;
    out.production = q;
  }
  if (framework !== undefined) {
    if (framework !== 'react') return null;
    out.framework = 'react';
  }
  return out;
}

/** Why the entry clashes with a product already listed (designer words), or null. Pure. */
export function takenProblem(entry: ProductEntry, products: readonly unknown[]): string | null {
  const low = (x: unknown) => (typeof x === 'string' ? x.trim().toLowerCase() : '');
  const repos = new Set([entry.repo, entry.design?.repo].filter(Boolean).map(low));
  for (const p of products) {
    if (!isPlain(p)) continue;
    if (low(p.key) === entry.key) return ADD_PRODUCT_SERVER_WORDS.takenKey;
    if (low(p.name) === low(entry.name)) return ADD_PRODUCT_SERVER_WORDS.takenName;
    const theirs = [low(p.repo), isPlain(p.design) ? low(p.design.repo) : ''].filter(Boolean);
    if (theirs.some((r) => repos.has(r))) return ADD_PRODUCT_SERVER_WORDS.takenRepo;
  }
  return null;
}

/** The team's leads: logins in governance.owners (design, tech) and override.allowed. Team entries never count. Pure. */
export function leadsOf(config: unknown): string[] {
  const g = isPlain(config) ? (config.governance as any) : null;
  const out = new Set<string>();
  for (const l of [g?.owners?.design, g?.owners?.tech, g?.override?.allowed]) {
    if (Array.isArray(l)) for (const v of l) if (typeof v === 'string' && /^@?[A-Za-z0-9-]{1,39}$/.test(v.trim())) out.add(v.trim().replace(/^@/, '').toLowerCase());
  }
  return [...out];
}

/** Whether the caller may add a product: a repository admin, or a lead with write access. Pure. */
export function addRoleOf(perms: Record<string, unknown> | null | undefined, login: string, leads: readonly string[]): 'admin' | 'lead' | null {
  if (!perms) return null;
  if (perms.admin === true) return 'admin';
  if ((perms.push === true || perms.maintain === true) && leads.includes(login.toLowerCase())) return 'lead';
  return null;
}

// --- Format-preserving insertion --------------------------------------------------------------------------------------

/** Skips whitespace from `i`. */
const ws = (s: string, i: number) => {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
};

/** The index just after the JSON value starting at `i` (string-aware, brackets balanced). */
function valueEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"') {
    i++;
    while (i < s.length) {
      if (s[i] === '\\') i += 2;
      else if (s[i] === '"') return i + 1;
      else i++;
    }
    throw new Error('Unterminated string.');
  }
  if (c === '{' || c === '[') {
    let depth = 0;
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === '"') {
        i = valueEnd(s, i);
        continue;
      }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new Error('Unbalanced brackets.');
  }
  while (i < s.length && !/[\s,}\]]/.test(s[i]!)) i++;
  return i;
}

/** The spans of the items of the top-level `products` array, and its brackets; null when there is none. */
function productsSpan(s: string): { open: number; close: number; items: { start: number; end: number }[] } | null {
  let i = ws(s, 0);
  if (s[i] !== '{') return null;
  i = ws(s, i + 1);
  while (i < s.length && s[i] !== '}') {
    if (s[i] !== '"') return null;
    const kEnd = valueEnd(s, i);
    const key = JSON.parse(s.slice(i, kEnd)) as string;
    i = ws(s, kEnd);
    if (s[i] !== ':') return null;
    i = ws(s, i + 1);
    const vStart = i;
    const vEnd = valueEnd(s, i);
    if (key === 'products' && s[vStart] === '[') {
      const items: { start: number; end: number }[] = [];
      let j = ws(s, vStart + 1);
      while (j < vEnd - 1 && s[j] !== ']') {
        const e = valueEnd(s, j);
        items.push({ start: j, end: e });
        j = ws(s, e);
        if (s[j] === ',') j = ws(s, j + 1);
      }
      return { open: vStart, close: vEnd - 1, items };
    }
    i = ws(s, vEnd);
    if (s[i] === ',') i = ws(s, i + 1);
  }
  return null;
}

/** `{ "a": 1, "b": { "c": 2 } }`: one line, as the file keeps a product. */
function inline(v: unknown): string {
  if (isPlain(v)) {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  return JSON.stringify(v);
}

const ORDER: (keyof ProductEntry)[] = ['key', 'name', 'repo', 'design', 'preview', 'production', 'framework'];
const ordered = (e: ProductEntry) => Object.fromEntries(ORDER.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson(a[k], b[k]));
  }
  return false;
}

/**
 * bridge.config.json with `entry` added to the top-level `products` array, before the default product (else last),
 * written like its neighbours; every other byte unchanged. Null when the file has no non-empty products array.
 * Throws when the result is anything but the file plus that one product. Pure.
 */
export function insertProduct(text: string, entry: ProductEntry): string | null {
  const parsed = JSON.parse(text) as unknown;
  if (!isPlain(parsed) || !Array.isArray(parsed.products) || !parsed.products.length) return null;
  const span = productsSpan(text);
  if (!span || span.items.length !== parsed.products.length) return null;
  const list = parsed.products as unknown[];
  const at = list.findIndex((p) => isPlain(p) && p.default === true);
  const plain = ordered(entry);
  let next: string;
  if (at >= 0) {
    const item = span.items[at]!;
    // The whitespace before that item, after the separator or the bracket.
    let k = item.start;
    while (k > 0 && /\s/.test(text[k - 1]!)) k--;
    const lead = text.slice(k, item.start);
    const indent = lead.slice(lead.lastIndexOf('\n') + 1);
    const body = text.slice(item.start, item.end).includes('\n') ? JSON.stringify(plain, null, 2).replace(/\n/g, `\n${indent}`) : inline(plain);
    next = `${text.slice(0, item.start)}${body},${lead || ' '}${text.slice(item.start)}`;
  } else {
    const last = span.items[span.items.length - 1]!;
    let k = last.start;
    while (k > 0 && /\s/.test(text[k - 1]!)) k--;
    const lead = text.slice(k, last.start);
    const indent = lead.slice(lead.lastIndexOf('\n') + 1);
    const body = text.slice(last.start, last.end).includes('\n') ? JSON.stringify(plain, null, 2).replace(/\n/g, `\n${indent}`) : inline(plain);
    next = `${text.slice(0, last.end)},${lead || ' '}${body}${text.slice(last.end)}`;
  }
  const expected = { ...parsed, products: [...list.slice(0, at >= 0 ? at : list.length), plain, ...list.slice(at >= 0 ? at : list.length)] };
  if (!sameJson(JSON.parse(next), expected)) throw new Error('The edit changed more than one product.');
  return next;
}

// --- GitHub ------------------------------------------------------------------------------------------------------------

interface Gh {
  status: number;
  data: any;
}

async function call(f: FetchLike, token: string, method: string, path: string, body?: unknown): Promise<Gh> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-add-product', 'X-GitHub-Api-Version': '2022-11-28', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  let data: any = null;
  try {
    data = res.status === 204 ? null : await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64').toString('utf8');
const path = (owner: string, repo: string) => `/repos/${owner}/${repo}/contents/${CONFIG_FILE}`;

/** The config on the default branch, read with the app's token: its text and blob sha; null when missing. */
async function readConfig(f: FetchLike, token: string, owner: string, repo: string, branch: string): Promise<{ text: string; sha: string } | null> {
  const r = await call(f, token, 'GET', `${path(owner, repo)}?ref=${encodeURIComponent(branch)}`);
  if (r.status === 404) return null;
  if (r.status !== 200 || typeof r.data?.content !== 'string' || typeof r.data?.sha !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return { text: unb64(r.data.content), sha: r.data.sha };
}

/** The commit message: names the person and why no review. */
export function addProductMessage(entry: Pick<ProductEntry, 'name'>, who: { name: string; login: string; id: number | null; role: 'admin' | 'lead' }): string {
  const lines = [
    `chore(config): add the product ${JSON.stringify(entry.name)}`,
    '',
    `Added from Bridge Studio by ${who.name} (@${who.login}), ${who.role === 'admin' ? 'an admin' : 'a lead'} of this team. Bridge writes this one file directly: adding a product needs no review.`,
  ];
  if (who.id !== null) lines.push('', `Co-authored-by: ${who.name} <${who.id}+${who.login}@users.noreply.github.com>`);
  return lines.join('\n');
}

export interface AddProductEnv {
  GITHUB_APP_ID?: string | undefined;
  GITHUB_APP_PRIVATE_KEY?: string | undefined;
}

export interface AddProductDeps {
  fetch: FetchLike;
  now?: () => number;
  /** Injected (tests, local mode); otherwise built from the env with contents: write only. */
  app?: AppTokens;
  redis?: Redis | null;
}

const notAdded = (code: 'direct_refused' | 'app_missing' | 'config_shape', reason: string) => json(200, { added: false, code, reason });

/**
 * Adds `body.product` to the team's bridge.config.json on its default branch. `bearer`: the caller's GitHub token
 * (null: refused). Every answer is a Response (errors included).
 */
export async function handleAddProduct(x: { owner: string; repo: string; full: string; bearer: string | null; product: unknown }, env: AddProductEnv, deps: AddProductDeps): Promise<Response> {
  const W = ADD_PRODUCT_SERVER_WORDS;
  const { owner, repo, full } = x;
  if (!x.bearer) return fail(403, 'needs_github', W.needsGithub);
  const now = deps.now ?? Date.now;
  const f = deps.fetch;
  // Who asks, read with their own token.
  const me = await call(f, x.bearer, 'GET', '/user');
  if (me.status === 401 || typeof me.data?.login !== 'string') return fail(401, 'signin', W.signin);
  const login: string = me.data.login;
  const name = typeof me.data.name === 'string' && me.data.name.trim() ? me.data.name.trim() : login;
  const id = typeof me.data.id === 'number' && Number.isSafeInteger(me.data.id) ? me.data.id : null;
  const r = await call(f, x.bearer, 'GET', `/repos/${owner}/${repo}`);
  if (r.status === 401) return fail(401, 'signin', W.signin);
  const perms = r.status === 200 && isPlain(r.data?.permissions) ? (r.data.permissions as Record<string, unknown>) : null;
  if (!perms || !(perms.admin || perms.push || perms.maintain)) return fail(403, 'not_lead', W.notLead);
  const branch = typeof r.data?.default_branch === 'string' && r.data.default_branch ? r.data.default_branch : 'main';

  const entry = validProductEntry(x.product, `${owner}/${repo}`);
  if (!entry) return fail(400, 'invalid_product', W.invalid);

  const appId = env.GITHUB_APP_ID?.trim();
  const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const app = deps.app ?? (appId && pem ? githubApp(appId, pem, f, now, { permissions: { ...ADD_PRODUCT_PERMISSIONS }, require: { ...ADD_PRODUCT_PERMISSIONS }, userAgent: 'bridge-add-product' }) : null);
  const token = app ? await app.installationToken(owner, repo) : null;
  if (!token) return notAdded('app_missing', W.appMissing);

  let current = await readConfig(f, token, owner, repo, branch);
  if (!current) return notAdded('config_shape', W.configShape);
  let config: unknown;
  try {
    config = JSON.parse(current.text);
  } catch {
    return notAdded('config_shape', W.configShape);
  }
  const role = addRoleOf(perms, login, leadsOf(config));
  if (!role) return fail(403, 'not_lead', W.notLead);

  // The product itself: the caller must be able to open it.
  const product = await call(f, x.bearer, 'GET', `/repos/${entry.repo}`);
  if (product.status === 401) return fail(401, 'signin', W.signin);
  if (product.status !== 200) return fail(400, 'not_found', W.notFound);

  const message = addProductMessage(entry, { name, login, id, role });
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = JSON.parse(current.text) as Record<string, unknown>;
    const taken = takenProblem(entry, Array.isArray(parsed.products) ? parsed.products : []);
    if (taken) return fail(409, 'taken', taken);
    let next: string | null;
    try {
      next = insertProduct(current.text, entry);
    } catch {
      next = null;
    }
    if (!next) return notAdded('config_shape', W.configShape);
    const put = await call(f, token, 'PUT', path(owner, repo), { message, content: b64(next), sha: current.sha, branch });
    if (put.status === 200 || put.status === 201) {
      const products = (JSON.parse(next) as { products: unknown[] }).products;
      if (deps.redis) {
        const t = now();
        await Promise.all([
          noteWrite(deps.redis, full, t).catch(() => undefined),
          deps.redis.pipe([...changedWrites(full, ['code'], t), ['DEL', productsKey(full)]]).catch(() => undefined),
        ]);
      }
      return json(200, { added: true, key: entry.key, products, commit: typeof put.data?.commit?.sha === 'string' ? put.data.commit.sha : null });
    }
    const text = String(put.data?.message ?? '');
    const ruled = /rule|protected|violation/i.test(text);
    if (put.status === 409 && !ruled && attempt === 0) {
      // Someone changed the file a moment ago: read it again and add to that.
      const again = await readConfig(f, token, owner, repo, branch);
      if (!again) return notAdded('config_shape', W.configShape);
      current = again;
      continue;
    }
    if (put.status === 401 || put.status === 403 || put.status === 404 || put.status === 409 || put.status === 422) return notAdded('direct_refused', W.refused);
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  return notAdded('direct_refused', W.refused);
}
