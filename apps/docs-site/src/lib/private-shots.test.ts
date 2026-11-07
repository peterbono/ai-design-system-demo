// Screenshots of private products' explorations (api/_lib/private-shots.ts): only Bridge's own workflow (its GitHub
// OIDC token) asks what to capture and sends captures; only readers of the team (members, demo visitors) read them.
import { generateKeyPairSync, createSign } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryRedis } from '../../api/_lib/redis';
import { watchWrites } from '../../api/_lib/notify';
import { clearJwks, fileHints, putShot, shotKeyOf, shotsTodo, workflowClaims, AUDIENCE, ISSUER, SHOTS_REPOSITORY, type ShotsCtx } from '../../api/_lib/private-shots';
import { handleContribute, type ContribDeps } from '../../api/contribute/index';
import { clearReadMemory } from '../../api/_lib/team-read';

const T0 = Date.parse('2026-11-07T10:00:00Z');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', kty: 'RSA' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims: Record<string, unknown>, kid = 'k1') {
  const head = b64({ alg: 'RS256', kid });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, repository: SHOTS_REPOSITORY, ref: 'refs/heads/main', exp: Math.floor(T0 / 1000) + 300, ...claims });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `Bearer ${head}.${body}.${sig}`;
}
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(40)]).toString('base64');
const TEAM = 'acme-design-demo/bridge-demo-ds';
const COPY = 'acme-design-demo/acme-account-design';
const CONFIG = JSON.stringify({ products: [{ key: 'account', name: 'Account', repo: 'acme-design-demo/acme-account', design: { repo: COPY, preview: 'https://{branch}.acme-account-design.pages.dev' } }] });
const SHA = 'a'.repeat(40);

function world() {
  const redis = memoryRedis(() => T0);
  const f: ContribDeps['fetch'] = async (url) => {
    const u = new URL(url);
    if (u.href === `${ISSUER}/.well-known/jwks`) return Response.json({ keys: [jwk] });
    if (u.pathname === `/repos/${TEAM}/contents/bridge.config.json`) return new Response(CONFIG, { status: 200 });
    if (u.pathname === `/repos/${COPY}/pulls`) return Response.json([{ number: 1, head: { sha: SHA, ref: 'explore/team' } }, { number: 2, head: { sha: 'b'.repeat(40), ref: 'explore/profile' } }]);
    if (u.pathname === `/repos/${TEAM}`) return Response.json({ private: false });
    return Response.json({ message: 'Not Found' }, { status: 404 });
  };
  const ctx: ShotsCtx = { f, now: () => T0, redis, token: async () => 'ghs_x' };
  return { redis, f, ctx };
}

beforeEach(() => {
  clearJwks();
  clearReadMemory();
});

describe('private shots: who sends them', () => {
  it("accepts only Bridge's own workflow on its default branch, with GitHub's key and the shots audience", async () => {
    const { ctx } = world();
    expect(await workflowClaims(ctx, jwt({}))).toMatchObject({ repository: SHOTS_REPOSITORY });
    expect(await workflowClaims(ctx, jwt({ repository: 'someone/fork' }))).toBeNull();
    expect(await workflowClaims(ctx, jwt({ ref: 'refs/heads/feature' }))).toBeNull();
    expect(await workflowClaims(ctx, jwt({ aud: 'other' }))).toBeNull();
    expect(await workflowClaims(ctx, jwt({ exp: Math.floor(T0 / 1000) - 1 }))).toBeNull();
    expect(await workflowClaims(ctx, jwt({}, 'unknown'))).toBeNull();
    const forged = jwt({}).replace(/\.[\w-]+$/, '.AAAA');
    expect(await workflowClaims(ctx, forged)).toBeNull();
    expect(await workflowClaims(ctx, null)).toBeNull();
  });
});

describe('private shots: what to capture and what is kept', () => {
  it('lists the open explorations of watched copies without a capture at their head, and keeps a webp for a watched copy only', async () => {
    const { redis, ctx } = world();
    await redis.pipe(watchWrites([{ repo: COPY, meta: { team: TEAM, kind: 'copy', product: 'account' } }]));
    expect((await shotsTodo(ctx)).map((j) => [j.repo, j.pr, j.branch, j.template])).toEqual([
      [COPY, 1, 'explore/team', 'https://{branch}.acme-account-design.pages.dev'],
      [COPY, 2, 'explore/profile', 'https://{branch}.acme-account-design.pages.dev'],
    ]);
    expect((await putShot(ctx, { repo: COPY, pr: 1, sha: SHA, image: WEBP, url: 'https://explore-team.acme-account-design.pages.dev/' })).status).toBe(200);
    expect((await shotsTodo(ctx)).map((j) => j.pr)).toEqual([2]);
    expect((await putShot(ctx, { repo: 'someone/else', pr: 1, sha: SHA, image: WEBP })).status).toBe(403);
    expect((await putShot(ctx, { repo: COPY, pr: 1, sha: SHA, image: Buffer.from('<svg/>').toString('base64') })).status).toBe(400);
    expect(JSON.parse(String(await redis.cmd('GET', shotKeyOf(COPY, 1))))).toMatchObject({ sha: SHA });
  });
});

describe('private shots: through api/contribute', () => {
  const ENV = { LIBRARY_SESSION_SECRET: 's'.repeat(40) };
  const deps = (w: ReturnType<typeof world>): ContribDeps => ({ fetch: w.f, now: () => T0, redis: w.redis, app: { installationToken: async () => 'ghs_x' } });

  it('the workflow needs its OIDC token; a demo visitor reads the capture of a product listed by the team, nothing else', async () => {
    const w = world();
    await w.redis.pipe(watchWrites([{ repo: COPY, meta: { team: TEAM, kind: 'copy', product: 'account' } }]));
    const req = (q: string, init: RequestInit = {}) => new Request(`https://bridge.example.com/api/contribute?${q}`, { ...init, headers: { host: 'bridge.example.com', ...(init.headers ?? {}) } });
    expect((await handleContribute(req('shots=todo'), ENV, deps(w))).status).toBe(401);
    const todo = await handleContribute(req('shots=todo', { headers: { authorization: jwt({}) } }), ENV, deps(w));
    expect((await todo.json()).jobs).toHaveLength(2);
    const put = await handleContribute(req('shots=put', { method: 'POST', headers: { authorization: jwt({}), 'content-type': 'application/json' }, body: JSON.stringify({ repo: COPY, pr: 1, sha: SHA, image: WEBP }) }), ENV, deps(w));
    expect(put.status).toBe(200);
    const meta = await handleContribute(req(`repo=${TEAM}&shot=${COPY}&pr=1&meta=1`), ENV, deps(w));
    expect((await meta.json()).shot).toMatchObject({ sha: SHA });
    const img = await handleContribute(req(`repo=${TEAM}&shot=${COPY}&pr=1`), ENV, deps(w));
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('cache-control')).toContain('private');
    // A repository the team does not list, and a team that is not a demo for a visitor.
    expect((await handleContribute(req(`repo=${TEAM}&shot=someone/else&pr=1&meta=1`), ENV, deps(w))).status).toBe(403);
    expect((await handleContribute(req(`repo=acme/design&shot=${COPY}&pr=1&meta=1`), ENV, deps(w))).status).toBe(401);
  });
});

describe('private shots: the page to open', () => {
  it("names the changed files' pages, never the app shell", () => {
    expect(fileHints(['src/pages/Billing.tsx', 'src/App.tsx', 'src/main.tsx', 'src/components/InvoiceBadge.tsx', '.bridge/explorations/x.md'])).toEqual(['billing', 'invoicebadge']);
  });
});
