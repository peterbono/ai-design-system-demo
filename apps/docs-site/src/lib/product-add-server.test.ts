// Adding a product straight to main (api/_lib/product-add.ts, routed from /api/ship): who may (admins and leads, read
// with their own token), what may be added (one product, validated strictly), and what is written (one file, one
// product, every other byte the same). The only code path that uses the app's bypass of the main ruleset.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AppTokens } from '../../api/_lib/github-app';
import { memoryRedis } from '../../api/_lib/redis';
import { productsKey, wroteKey } from '../../api/_lib/team-read';
import { addProductMessage, addRoleOf, insertProduct, leadsOf, takenProblem, validProductEntry, ADD_PRODUCT_SERVER_WORDS as W, type ProductEntry } from '../../api/_lib/product-add';
import { handleShip, type FetchLike } from '../../api/ship/index';

const ROOT_CONFIG = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../bridge.config.json'), 'utf8');
const HOST = 'bridge.example.com';
const TEAM = 'acme/design';
const ENTRY: ProductEntry = { key: 'checkout', name: 'Checkout', repo: 'acme/checkout', design: { repo: 'acme/checkout-design' }, framework: 'react' };

/** Callers by token: their login, permissions on the team, and whether they can open acme/checkout. */
const PEOPLE: Record<string, { login: string; id?: number; perms: Record<string, boolean>; sees?: boolean }> = {
  'Bearer ghu_admin_token_0000000000': { login: 'ada', id: 11, perms: { admin: true, push: true, pull: true } },
  'Bearer ghu_lead_token_00000000000': { login: 'dana', id: 12, perms: { admin: false, push: true, pull: true } },
  'Bearer ghu_lead_reader_token_0000': { login: 'malik', perms: { admin: false, push: false, pull: true } },
  'Bearer ghu_writer_token_000000000': { login: 'sam', perms: { admin: false, push: true, pull: true } },
  'Bearer ghu_team_member_token_0000': { login: 'tara', perms: { admin: false, push: true, pull: true } },
  'Bearer ghu_blind_lead_token_00000': { login: 'dana', perms: { admin: false, push: true, pull: true }, sees: false },
};
const ADMIN = 'Bearer ghu_admin_token_0000000000';
const LEAD = 'Bearer ghu_lead_token_00000000000';

interface World {
  text: string;
  sha: string;
  calls: { method: string; path: string; body?: any; auth: string }[];
  /** Answers of the next PUTs, in order (default: write it). */
  puts: { status: number; message?: string }[];
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const configWith = (governance: unknown) => {
  const c = JSON.parse(ROOT_CONFIG);
  c.governance = governance;
  return `${JSON.stringify(c, null, 2)}\n`;
};
const GOV = { owners: { design: ['dana', '@acme/design-team'], tech: ['malik'] } };

function world(text = ROOT_CONFIG): World {
  return { text, sha: 'a'.repeat(40), calls: [], puts: [] };
}

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const auth = init.headers.Authorization ?? '';
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path: u.pathname + u.search, body, auth });
    const p = u.pathname;
    const who = PEOPLE[auth];
    if (who) {
      if (p === '/user') return res(200, { login: who.login, name: who.login === 'dana' ? 'Dana Whitfield' : null, ...(who.id ? { id: who.id } : {}) });
      if (p === `/repos/${TEAM}`) return res(200, { default_branch: 'main', permissions: who.perms });
      if (p === '/repos/acme/checkout') return who.sees === false ? res(404, {}) : res(200, { full_name: 'acme/checkout' });
      return res(404, {});
    }
    expect(auth).toBe('Bearer ghs_app');
    if (p === `/repos/${TEAM}/contents/bridge.config.json` && init.method === 'GET') {
      expect(u.searchParams.get('ref')).toBe('main');
      return res(200, { sha: w.sha, content: Buffer.from(w.text).toString('base64'), encoding: 'base64' });
    }
    if (p === `/repos/${TEAM}/contents/bridge.config.json` && init.method === 'PUT') {
      const next = w.puts.shift() ?? { status: 200 };
      if (next.status !== 200) return res(next.status, { message: next.message ?? '' });
      expect(body.sha).toBe(w.sha);
      w.text = Buffer.from(body.content, 'base64').toString('utf8');
      w.sha = 'c'.repeat(40);
      return res(200, { content: { sha: 'd'.repeat(40) }, commit: { sha: 'e'.repeat(40) } });
    }
    return res(404, {});
  };
}

const app: AppTokens = { installationToken: async () => 'ghs_app' };
const noApp: AppTokens = { installationToken: async () => null };

function ask(w: World, auth: string | null, product: unknown = ENTRY, deps: { app?: AppTokens; redis?: ReturnType<typeof memoryRedis> } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', host: HOST, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' };
  if (auth) headers.Authorization = auth;
  else headers['X-Bridge-Contribute'] = '1';
  const req = new Request(`https://${HOST}/api/ship`, { method: 'POST', headers, body: JSON.stringify({ repo: TEAM, action: 'add-product', product }) });
  return handleShip(req, {}, { fetch: github(w), app: deps.app ?? app, ...(deps.redis ? { redis: deps.redis } : {}) });
}

const writes = (w: World) => w.calls.filter((c) => c.method !== 'GET');

describe('add a product: who may', () => {
  it('a repository admin adds it', async () => {
    const w = world(configWith(GOV));
    const r = await ask(w, ADMIN);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ added: true, key: 'checkout', commit: 'e'.repeat(40) });
  });

  it('a lead with write access adds it', async () => {
    const w = world(configWith(GOV));
    const r = await ask(w, LEAD);
    expect(r.status).toBe(200);
    expect((await r.json()).added).toBe(true);
  });

  it('a lead listed but without write access is refused', async () => {
    const w = world(configWith(GOV));
    const r = await ask(w, 'Bearer ghu_lead_reader_token_0000');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'not_lead', message: W.notLead });
    expect(writes(w)).toEqual([]);
  });

  it('a writer who is not a lead is refused', async () => {
    const w = world(configWith(GOV));
    const r = await ask(w, 'Bearer ghu_writer_token_000000000');
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('not_lead');
    expect(writes(w)).toEqual([]);
  });

  it('a team entry (@org/team) never counts as a lead', async () => {
    const w = world(configWith({ owners: { design: ['@acme/tara'], tech: [] } }));
    expect(leadsOf(JSON.parse(w.text))).toEqual([]);
    const r = await ask(w, 'Bearer ghu_team_member_token_0000');
    expect(r.status).toBe(403);
  });

  it('an email member (no GitHub sign-in) is refused before anything is read', async () => {
    const w = world();
    const r = await ask(w, null);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('needs_github');
    expect(w.calls).toEqual([]);
  });

  it('addRoleOf: admin, lead with push or maintain, else nobody', () => {
    expect(addRoleOf({ admin: true }, 'x', [])).toBe('admin');
    expect(addRoleOf({ push: true }, 'Dana', ['dana'])).toBe('lead');
    expect(addRoleOf({ maintain: true }, 'dana', ['dana'])).toBe('lead');
    expect(addRoleOf({ pull: true }, 'dana', ['dana'])).toBeNull();
    expect(addRoleOf({ push: true }, 'sam', ['dana'])).toBeNull();
    expect(addRoleOf(null, 'dana', ['dana'])).toBeNull();
  });

  it('the caller must be able to open the product with their own sign-in', async () => {
    const w = world(configWith(GOV));
    const r = await ask(w, 'Bearer ghu_blind_lead_token_00000');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'not_found', message: W.notFound });
    expect(writes(w)).toEqual([]);
  });
});

describe('add a product: what may be added', () => {
  const bad: [string, unknown][] = [
    ['not an object', 'checkout'],
    ['an array', [ENTRY]],
    ['an extra key', { ...ENTRY, owner: 'x' }],
    ['default: true', { ...ENTRY, default: true }],
    ['a path', { ...ENTRY, path: 'packages' }],
    ['a key with capitals', { ...ENTRY, key: 'Checkout' }],
    ['the library key', { ...ENTRY, key: 'library' }],
    ['a long key', { ...ENTRY, key: 'a'.repeat(41) }],
    ['an empty name', { ...ENTRY, name: '  ' }],
    ['an untrimmed name', { ...ENTRY, name: ' Checkout' }],
    ['a name with a control character', { ...ENTRY, name: 'Check\nout' }],
    ['a long name', { ...ENTRY, name: 'a'.repeat(61) }],
    ['a bad repo', { ...ENTRY, repo: 'acme', design: undefined }],
    ['the team itself', { key: 'self', name: 'Self', repo: TEAM }],
    ['a design copy elsewhere', { ...ENTRY, design: { repo: 'evil/checkout-design' } }],
    ['a design with more keys', { ...ENTRY, design: { repo: 'acme/checkout-design', preview: 'https://x.pages.dev' } }],
    ['another framework', { ...ENTRY, framework: 'vue' }],
    ['a preview without production', { ...ENTRY, preview: 'https://{branch}.checkout.pages.dev' }],
    ['a preview on another host', { ...ENTRY, preview: 'https://evil.example', production: 'https://checkout.pages.dev' }],
    ['a plain http preview', { ...ENTRY, preview: 'http://{branch}.checkout.pages.dev', production: 'https://checkout.pages.dev' }],
    ['a long preview', { ...ENTRY, preview: `https://${'a'.repeat(200)}.pages.dev`, production: 'https://checkout.pages.dev' }],
    ['a placeholder in production', { ...ENTRY, preview: 'https://{branch}.checkout.pages.dev', production: 'https://{branch}.checkout.pages.dev' }],
  ];
  it.each(bad)('refuses %s', (_, v) => {
    expect(validProductEntry(v, TEAM)).toBeNull();
  });

  it('accepts what Studio sends, with previews from Vercel, Netlify or Cloudflare', () => {
    expect(validProductEntry(ENTRY, TEAM)).toEqual(ENTRY);
    expect(validProductEntry({ key: 'shop', name: 'Shop', repo: 'acme/shop' }, TEAM)).toEqual({ key: 'shop', name: 'Shop', repo: 'acme/shop' });
    for (const [preview, production] of [
      ['https://shop-git-{branch}-acme.vercel.app', 'https://shop.vercel.app'],
      ['https://deploy-preview-{pr}--shop.netlify.app', 'https://shop.netlify.app'],
      ['https://{branch}.shop.pages.dev', 'https://shop.pages.dev'],
    ]) expect(validProductEntry({ ...ENTRY, preview, production }, TEAM)).toMatchObject({ preview, production });
  });

  // A product added from its address (Add a product, "Only its address"): the design team's own code beside it, and the
  // live product's https origin exactly as Studio keeps it.
  const ADDRESS: ProductEntry = { key: 'checkout', name: 'Checkout', repo: 'acme/checkout', design: { repo: 'acme/checkout-design' }, address: 'https://posterstudio.com', framework: 'react' };
  it('accepts a product added from its address, its address kept as is', () => {
    expect(validProductEntry(ADDRESS, TEAM)).toEqual(ADDRESS);
    expect(validProductEntry({ key: 'poster', name: 'Poster', repo: 'acme/poster', address: 'https://shop.poster-studio.co.uk' }, TEAM)).toMatchObject({ address: 'https://shop.poster-studio.co.uk' });
  });

  const badAddress: [string, unknown][] = [
    ['a bare domain', 'posterstudio.com'],
    ['plain http', 'http://posterstudio.com'],
    ['a path', 'https://posterstudio.com/checkout'],
    ['a trailing slash', 'https://posterstudio.com/'],
    ['a port', 'https://posterstudio.com:8443'],
    ['a sign-in', 'https://me:pw@posterstudio.com'],
    ['a query', 'https://posterstudio.com?x=1'],
    ['capitals', 'https://PosterStudio.com'],
    ['an IP address', 'https://127.0.0.1'],
    ['localhost', 'https://localhost'],
    ['another protocol', 'javascript:alert(1)'],
    ['not a string', { href: 'https://posterstudio.com' }],
    ['an empty one', ''],
    ['a long one', `https://${'a'.repeat(200)}.com`],
  ];
  it.each(badAddress)('refuses an address with %s', (_, address) => {
    expect(validProductEntry({ ...ADDRESS, address }, TEAM)).toBeNull();
  });

  it('writes a product added from its address with its address, in the file order', async () => {
    const w = world(configWith(GOV));
    const r = await ask(w, ADMIN, ADDRESS);
    expect(r.status).toBe(200);
    const added = JSON.parse(w.text).products.find((p: { key: string }) => p.key === 'checkout');
    expect(added).toEqual(ADDRESS);
    expect(Object.keys(added)).toEqual(['key', 'name', 'repo', 'design', 'address', 'framework']);
    const bad = world(configWith(GOV));
    const refused = await ask(bad, ADMIN, { ...ADDRESS, address: 'http://posterstudio.com' });
    expect(refused.status).toBe(400);
    expect(writes(bad)).toEqual([]);
  });

  it('an invalid entry answers 400 and writes nothing', async () => {
    const w = world(configWith(GOV));
    const r = await ask(w, ADMIN, { ...ENTRY, default: true });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('invalid_product');
    expect(writes(w)).toEqual([]);
  });

  it('takenProblem: a key, a name or a repository the team already lists', () => {
    const list = JSON.parse(ROOT_CONFIG).products;
    expect(takenProblem({ ...ENTRY, key: 'admin-app' }, list)).toBe(W.takenKey);
    expect(takenProblem({ ...ENTRY, name: 'art PRINT shop' }, list)).toBe(W.takenName);
    expect(takenProblem({ ...ENTRY, repo: 'The-Bridge-Company/art-print-shop', design: undefined }, list)).toBe(W.takenRepo);
    expect(takenProblem({ ...ENTRY, repo: 'the-bridge-company/art-print-shop-design', design: undefined }, list)).toBe(W.takenRepo);
    expect(takenProblem(ENTRY, list)).toBeNull();
  });

  it('a product already listed answers 409 and writes nothing', async () => {
    const w = world();
    const r = await ask(w, ADMIN, { key: 'shop', name: 'Art print shop', repo: 'acme/checkout' });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'taken', message: W.takenName });
    expect(writes(w)).toEqual([]);
  });
});

describe('add a product: what is written', () => {
  it('one PUT of bridge.config.json on the default branch, with its sha, and nothing else', async () => {
    const w = world();
    const before = w.text;
    const r = await ask(w, ADMIN);
    expect(r.status).toBe(200);
    const ws = writes(w);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ method: 'PUT', path: `/repos/${TEAM}/contents/bridge.config.json`, auth: 'Bearer ghs_app' });
    expect(ws[0]!.body.branch).toBe('main');
    expect(ws[0]!.body.sha).toBe('a'.repeat(40));
    expect(Object.keys(ws[0]!.body).sort()).toEqual(['branch', 'content', 'message', 'sha']);
    const old = JSON.parse(before);
    const now = JSON.parse(w.text);
    // Before the library (last), whatever products the team added from Studio before it.
    expect(now.products).toEqual([...old.products.slice(0, -1), ENTRY, old.products.at(-1)]);
    expect({ ...now, products: old.products }).toEqual(old);
    const body = await r.json();
    expect(body.products).toEqual(now.products);
  });

  it('keeps every other byte: the new product is one line, before the library, written like its neighbours', () => {
    const next = insertProduct(ROOT_CONFIG, ENTRY)!;
    const line = '    { "key": "checkout", "name": "Checkout", "repo": "acme/checkout", "design": { "repo": "acme/checkout-design" }, "framework": "react" },\n';
    const at = ROOT_CONFIG.indexOf('    { "key": "library"');
    expect(next).toBe(ROOT_CONFIG.slice(0, at) + line + ROOT_CONFIG.slice(at));
  });

  it('multi-line products get a multi-line entry; no library: last', () => {
    const text = '{\n  "products": [\n    {\n      "key": "a",\n      "name": "A"\n    }\n  ]\n}\n';
    const next = insertProduct(text, { key: 'b', name: 'B', repo: 'x/b' })!;
    expect(next).toBe('{\n  "products": [\n    {\n      "key": "a",\n      "name": "A"\n    },\n    {\n      "key": "b",\n      "name": "B",\n      "repo": "x/b"\n    }\n  ]\n}\n');
  });

  it('strings with brackets, quotes and a "products" key elsewhere do not confuse it', () => {
    const text = '{ "name": "a [\\"products\\"] {", "nested": { "products": [1] }, "products": [ { "key": "lib", "name": "L ]}", "default": true } ] }';
    const next = insertProduct(text, { key: 'b', name: 'B', repo: 'x/b' })!;
    expect(JSON.parse(next).products.map((p: { key: string }) => p.key)).toEqual(['b', 'lib']);
    expect(JSON.parse(next).nested).toEqual({ products: [1] });
  });

  it('no products array: not written, the client sends it for review', async () => {
    const w = world('{ "name": "x", "products": [] }');
    expect(insertProduct(w.text, ENTRY)).toBeNull();
    const r = await ask(w, ADMIN);
    expect(await r.json()).toEqual({ added: false, code: 'config_shape', reason: W.configShape });
    expect(writes(w)).toEqual([]);
  });

  it('the commit names the person and their role', () => {
    const m = addProductMessage(ENTRY, { name: 'Dana Whitfield', login: 'dana', id: 12, role: 'lead' });
    expect(m).toBe('chore(config): add the product "Checkout"\n\nAdded from Bridge Studio by Dana Whitfield (@dana), a lead of this team. Bridge writes this one file directly: adding a product needs no review.\n\nCo-authored-by: Dana Whitfield <12+dana@users.noreply.github.com>');
    expect(m).not.toMatch(/\u2014/);
  });

  it('the file changed a moment ago: reads it again once and adds to that', async () => {
    const w = world();
    w.puts = [{ status: 409, message: 'bridge.config.json does not match aaaa' }];
    const r = await ask(w, ADMIN);
    expect((await r.json()).added).toBe(true);
    expect(writes(w)).toHaveLength(2);
    expect(w.calls.filter((c) => c.method === 'GET' && c.path.includes('/contents/'))).toHaveLength(2);
  });

  it.each([
    [409, 'Repository rule violations found'],
    [403, 'Resource not accessible by integration'],
    [422, 'Changes must be made through a pull request.'],
  ])('GitHub refuses the direct write (%i): not added, it goes to review', async (status, message) => {
    const w = world();
    w.puts = [{ status, message }];
    const r = await ask(w, ADMIN);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ added: false, code: 'direct_refused', reason: W.refused });
    expect(writes(w)).toHaveLength(1);
  });

  it('no app on the library: not added, it goes to review', async () => {
    const w = world();
    const r = await ask(w, ADMIN, ENTRY, { app: noApp });
    expect(await r.json()).toEqual({ added: false, code: 'app_missing', reason: W.appMissing });
    expect(writes(w)).toEqual([]);
  });

  it("notes the write in Bridge's read cache so every member sees the product at once", async () => {
    const redis = memoryRedis();
    await redis.cmd('SET', productsKey(TEAM), '{"repos":[]}');
    const w = world();
    const r = await ask(w, ADMIN, ENTRY, { redis });
    expect((await r.json()).added).toBe(true);
    expect(await redis.cmd('GET', wroteKey(TEAM))).toBeTruthy();
    expect(await redis.cmd('GET', productsKey(TEAM))).toBeNull();
  });

  it('an unknown action is refused', async () => {
    const req = new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: ADMIN }, body: JSON.stringify({ repo: TEAM, action: 'write-file' }) });
    const r = await handleShip(req, {}, { fetch: github(world()), app });
    expect(r.status).toBe(400);
  });
});
