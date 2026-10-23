// `npm run dev:full` (dev/local-api.ts): the Node to Web request and response mapping, routing to api/* files, the
// file-backed Redis, the outbox, the env that never carries production storage or email keys, and a real sign-in
// through the account and entry functions on that storage.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertLocal,
  devReserved,
  fileRedis,
  handlerFor,
  highlight,
  insecureCookie,
  isModuleRequest,
  type Local,
  localEnv,
  outboxSender,
  parseEnvFile,
  routeOf,
  seedMember,
  sendResponse,
  sessionSecret,
  toRequest,
} from '../../dev/local-api';
import * as account from '../../api/account/index';
import * as entry from '../../api/entry/index';
import { memberStore } from '../../api/_lib/members';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-local-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A real Node server whose handler maps through toRequest and sendResponse. */
async function serve(handle: (req: Request) => Promise<Response>) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void toRequest(req).then(handle).then((r) => sendResponse(res, r, { http: true }));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>((ok, ko) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: { host: `localhost:${port}`, ...init.headers } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', ko);
      if (init.body) req.write(init.body);
      req.end();
    });
  return { port, call, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

describe('request and response mapping', () => {
  it('passes method, URL, query, headers, cookies and body; returns status, headers and every Set-Cookie', async () => {
    let seen: Request | null = null;
    let body = '';
    const s = await serve(async (req) => {
      seen = req;
      body = await req.text();
      const h = new Headers({ 'Content-Type': 'application/json', 'X-Bridge-Test': 'yes' });
      h.append('Set-Cookie', 'a=1; Path=/; HttpOnly; Secure; SameSite=Lax');
      h.append('Set-Cookie', 'b=2; Path=/api/contribute; Secure');
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: h });
    });
    try {
      const r = await s.call('/api/contribute?repo=acme/ds&gh=x', {
        method: 'POST',
        headers: { cookie: 'bridge_account=v1.x.y; other=2', 'x-bridge-contribute': '1', origin: `http://localhost:${s.port}`, 'content-type': 'application/json' },
        body: '{"action":"sign-in"}',
      });
      expect(r.status).toBe(201);
      expect(JSON.parse(r.body)).toEqual({ ok: true });
      expect(r.headers['x-bridge-test']).toBe('yes');
      expect(r.headers['set-cookie']).toEqual(['a=1; Path=/; HttpOnly; SameSite=Lax', 'b=2; Path=/api/contribute']);
      const req = seen as unknown as Request;
      expect(req.method).toBe('POST');
      expect(new URL(req.url).pathname).toBe('/api/contribute');
      expect(new URL(req.url).searchParams.get('repo')).toBe('acme/ds');
      expect(new URL(req.url).host).toBe(`localhost:${s.port}`);
      expect(req.headers.get('x-bridge-contribute')).toBe('1');
      expect(req.headers.get('cookie')).toBe('bridge_account=v1.x.y; other=2');
      expect(req.headers.get('origin')).toBe(`http://localhost:${s.port}`);
      expect(body).toBe('{"action":"sign-in"}');
    } finally {
      await s.close();
    }
  });

  it('keeps error statuses and empty bodies (204, 403, 503)', async () => {
    let status = 204;
    const s = await serve(async () => (status === 204 ? new Response(null, { status }) : new Response('{"error":"x"}', { status })));
    try {
      expect((await s.call('/api/csp-report', { method: 'POST' })).status).toBe(204);
      status = 403;
      expect((await s.call('/api/entry')).status).toBe(403);
      status = 503;
      const r = await s.call('/api/entry');
      expect(r.status).toBe(503);
      expect(r.body).toBe('{"error":"x"}');
    } finally {
      await s.close();
    }
  });

  it('drops Secure only, never another attribute', () => {
    expect(insecureCookie('bridge_account=v; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax')).toBe('bridge_account=v; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    expect(insecureCookie('a=1; Path=/; Secure')).toBe('a=1; Path=/');
    expect(insecureCookie('secure_name=1; Path=/')).toBe('secure_name=1; Path=/');
  });
});

describe('routing', () => {
  const files = new Set(['api/entry/index.ts', 'api/github/token.ts', 'api/_lib/redis.ts', 'api/account/index.ts']);
  const exists = (p: string) => files.has(p);
  it('maps /api/<name> and /api/<path> to the file Vercel would run', () => {
    expect(routeOf('/api/entry', exists)).toBe('api/entry/index.ts');
    expect(routeOf('/api/entry/', exists)).toBe('api/entry/index.ts');
    expect(routeOf('/api/github/token', exists)).toBe('api/github/token.ts');
    expect(routeOf('/api/account', exists)).toBe('api/account/index.ts');
  });
  it('never serves _lib, unknown names or odd paths', () => {
    expect(routeOf('/api/_lib/redis', exists)).toBeNull();
    expect(routeOf('/api/nope', exists)).toBeNull();
    expect(routeOf('/api/../secret', exists)).toBeNull();
    expect(routeOf('/studio/', exists)).toBeNull();
  });
  it('lets source module requests (a page importing api/_lib) go on to Vite', () => {
    expect(isModuleRequest('/api/_lib/domains.ts')).toBe(true);
    expect(isModuleRequest('/api/_lib/redis')).toBe(true);
    expect(isModuleRequest('/api/entry/index.ts')).toBe(true);
    expect(isModuleRequest('/api/entry')).toBe(false);
    expect(isModuleRequest('/api/github/token')).toBe(false);
    expect(isModuleRequest('/api/dev/outbox')).toBe(false);
    expect(isModuleRequest('/studio/x.ts')).toBe(false);
  });
});

describe('reserved team paths in dev', () => {
  it('reads them from the Studio page sources the way the build reads its output', () => {
    const r = devReserved(join(__dirname, '..', 'pages', 'studio'));
    expect(r.firsts).toEqual(expect.arrayContaining(['changes', 'workspace', 'settings', 'brands', 'components', 'versions']));
    expect(r.firsts).not.toContain('index.html');
    expect(r.pairs).toEqual(expect.arrayContaining(['brands/new', 'components/docs', 'versions/data.json', 'changes/index.html']));
  });
  it('answers an empty list for a missing folder', () => {
    expect(devReserved(join(dir, 'nope'))).toEqual({ firsts: [], pairs: [] });
  });
});

describe('file-backed Redis', () => {
  it('survives a restart: strings with TTL, sets and sorted sets', async () => {
    let t = 1_000_000;
    const file = join(dir, 'redis.json');
    const a = fileRedis(file, () => t);
    await a.cmd('SET', 'k', 'v');
    await a.cmd('SET', 'short', 'x', 'EX', 10);
    await a.pipe([['SADD', 's', 'one', 'two'], ['ZADD', 'z', 5, 'five'], ['ZADD', 'z', 1, 'one']]);
    const b = fileRedis(file, () => t);
    expect(await b.cmd('GET', 'k')).toBe('v');
    expect(await b.cmd('GET', 'short')).toBe('x');
    expect(((await b.cmd('SMEMBERS', 's')) as string[]).sort()).toEqual(['one', 'two']);
    expect(await b.cmd('ZRANGE', 'z', 0, -1)).toEqual(['one', 'five']);
    t += 11_000;
    expect(await fileRedis(file, () => t).cmd('GET', 'short')).toBeNull();
  });

  it('reads the file again when another process changed it (seed, reset)', async () => {
    const file = join(dir, 'redis.json');
    const server = fileRedis(file);
    await server.cmd('SET', 'a', '1');
    await seedMember(fileRedis(file), 'Acme/DS', 'Ana@Example.com');
    expect((await memberStore(server).get('acme/ds', 'ana@example.com'))?.name).toBe('Ana');
    expect(await server.cmd('GET', 'a')).toBe('1');
    rmSync(file);
    expect(await server.cmd('GET', 'a')).toBeNull();
  });

  it('only writes the file on commands that change data', async () => {
    const file = join(dir, 'redis.json');
    const r = fileRedis(file);
    await r.cmd('GET', 'x');
    expect(() => readFileSync(file)).toThrow();
    await r.cmd('INCRBY', 'n', 2);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([{ key: 'n', type: 'string', value: '2', until: null }]);
  });
});

describe('outbox and env', () => {
  it('prints the code, keeps the newest first and never sends', async () => {
    const lines: string[] = [];
    const box = outboxSender(join(dir, 'outbox.json'), (s) => lines.push(s));
    await box.send({ to: 'a@example.com', subject: 'Your Bridge code', text: 'Your code is 123456.\nIt works for 10 minutes.', html: '<p>123456</p>' });
    await box.send({ to: 'b@example.com', subject: 'Invite', text: 'Open http://localhost:4321/studio/acme/ds/#x to join.', html: '' });
    expect(lines[0]).toContain('code: 123456');
    expect(lines[1]).toContain('link: http://localhost:4321/studio/acme/ds/#x');
    expect(box.list().map((m) => m.to)).toEqual(['b@example.com', 'a@example.com']);
    expect(highlight({ text: 'nothing' })).toBeNull();
  });

  it('never carries storage, email, backup or cron keys, whatever the shell holds', () => {
    const shell = { KV_REST_API_URL: 'https://prod', UPSTASH_REDIS_REST_TOKEN: 't', RESEND_API_KEY: 're_x', INVITE_EMAIL_FROM: 'a@b.c', BLOB_READ_WRITE_TOKEN: 'b', CRON_SECRET: 'c', GITHUB_APP_ID: '42' };
    const env = localEnv('s'.repeat(40), [{ GITHUB_APP_PRIVATE_KEY: 'pem' }, shell]);
    expect(env.KV_REST_API_URL).toBeUndefined();
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.GITHUB_APP_ID).toBe('42');
    expect(env.GITHUB_APP_PRIVATE_KEY).toBe('pem');
    expect(env.LIBRARY_SESSION_SECRET).toBe('s'.repeat(40));
  });

  it('reads .env.local with quotes and a multi-line key', () => {
    const v = parseEnvFile('# c\nGITHUB_APP_ID=42\nexport A="x\\ny"\nGITHUB_APP_PRIVATE_KEY="-----BEGIN-----\nabc\n-----END-----"\nB=\'q\'\n');
    expect(v).toEqual({ GITHUB_APP_ID: '42', A: 'x\ny', GITHUB_APP_PRIVATE_KEY: '-----BEGIN-----\nabc\n-----END-----', B: 'q' });
  });

  it('keeps one session secret per computer, long enough for the functions', () => {
    const a = sessionSecret(dir);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(sessionSecret(dir)).toBe(a);
    writeFileSync(join(dir, 'session-secret'), 'short');
    expect(sessionSecret(dir)).not.toBe('short');
  });

  it('refuses production and Vercel', () => {
    expect(() => assertLocal({ NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => assertLocal({ VERCEL: '1' })).toThrow(/Vercel/);
    expect(() => assertLocal({ NODE_ENV: 'development' })).not.toThrow();
  });
});

describe('a sign-in through the real functions', () => {
  it('code by email, verify, then GET /api/entry answers create; a seeded team answers teams', async () => {
    const redis = fileRedis(join(dir, 'redis.json'));
    const lines: string[] = [];
    const email = outboxSender(join(dir, 'outbox.json'), (s) => lines.push(s));
    const offline = async () => {
      throw new Error('no network in this test');
    };
    const local: Local = { redis, email, env: localEnv('k'.repeat(40), []), fetch: offline };
    const acc = handlerFor('api/account/index.ts', account, local, 'POST')!;
    const ent = handlerFor('api/entry/index.ts', entry, local, 'GET')!;
    const origin = 'http://localhost:4321';
    const post = (body: unknown, cookie = '') =>
      acc(new Request(`${origin}/api/account`, { method: 'POST', headers: { origin, host: 'localhost:4321', 'x-bridge-account': '1', 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }));

    const asked = await post({ action: 'code', email: 'test@example.com' });
    expect(asked.status).toBe(200);
    const code = /code: (\d{6})/.exec(lines.join('\n'))![1]!;
    const verified = await post({ action: 'verify', email: 'test@example.com', code });
    expect(verified.status).toBe(200);
    const cookie = verified.headers.getSetCookie()[0]!.split(';')[0]!;

    const get = () => ent(new Request(`${origin}/api/entry`, { headers: { origin, host: 'localhost:4321', cookie } }));
    expect(await (await get()).json()).toEqual({ kind: 'create' });
    await seedMember(redis, 'acme/ds', 'test@example.com');
    const teams = (await (await get()).json()) as { kind: string; teams: { repo: string }[] };
    expect(teams.kind).toBe('teams');
    expect(teams.teams.map((t) => t.repo)).toEqual(['acme/ds']);
  });
});
