// The demo's one write gate (api/contribute demoWriteRefusal): a visitor reads a demo team like a member who views it,
// and any write by someone not on it is refused once, in the demo dialog's words, with the `demo` code.
import { describe, expect, it } from 'vitest';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { type ContribDeps, cookieName, DEMO_REFUSAL, handleContribute, signSession } from '../../api/contribute/index';
import { DEMO_WORDS } from './demo';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const DEMO = 'acme-design-demo/bridge-demo-ds';
const TEAM = 'acme/design';
const T0 = Date.parse('2026-11-07T10:00:00Z');

function setup() {
  const redis = memoryRedis(() => T0);
  const writes: string[] = [];
  const deps: ContribDeps = {
    fetch: async (url, init) => {
      const u = new URL(url);
      if (init.method !== 'GET') writes.push(`${init.method} ${u.pathname}`);
      if (/^\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) return Response.json({ private: false, default_branch: 'main' });
      return Response.json({ ok: true }, { status: init.method === 'POST' ? 201 : 200 });
    },
    now: () => T0,
    redis,
    app: { installationToken: async () => 'ghs_x' },
  };
  const member = async (repo: string) => {
    await memberStore(redis).put(repo, { email: 'mia@acme.design', name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at: new Date(T0).toISOString() });
    return `${cookieName(repo)}=${signSession({ repo, email: 'mia@acme.design', name: 'Mia', v: 1, exp: T0 + 1e9 }, SECRET)}`;
  };
  const post = (query: string, body: unknown, cookie = '') =>
    handleContribute(
      new Request(`${ORIGIN}/api/contribute${query}`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-contribute': '1', 'x-real-ip': '203.0.113.9', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
      ENV,
      deps,
    );
  return { post, member, writes };
}

describe('the demo write gate', () => {
  it('refuses a visitor writing to the sample team, in the demo dialog words, and sends nothing to GitHub', async () => {
    const s = setup();
    const r = await s.post(`?repo=${encodeURIComponent(DEMO)}&gh=${encodeURIComponent(`/repos/${DEMO}/issues`)}`, { title: 'x' });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: DEMO_REFUSAL, message: DEMO_WORDS.dialogLead });
    const a = await s.post('', { action: 'set-pm', repo: DEMO, product: 'account', pm: null });
    expect(a.status).toBe(403);
    expect((await a.json()).error).toBe(DEMO_REFUSAL);
    expect(s.writes).toEqual([]);
  });

  it('lets anyone sign in or read the build state on the demo, and lets a member of the demo write', async () => {
    const s = setup();
    const signIn = await s.post('', { action: 'sign-in', repo: DEMO, email: 'someone@example.com' });
    expect((await signIn.json()).error).not.toBe(DEMO_REFUSAL);
    const cookie = await s.member(DEMO);
    const r = await s.post(`?repo=${encodeURIComponent(DEMO)}&gh=${encodeURIComponent(`/repos/${DEMO}/issues`)}`, { title: 'x' }, cookie);
    expect((await r.clone().json().catch(() => ({}))).error).not.toBe(DEMO_REFUSAL);
  });

  it('never gates a team that is not a demo', async () => {
    const s = setup();
    const r = await s.post(`?repo=${encodeURIComponent(TEAM)}&gh=${encodeURIComponent(`/repos/${TEAM}/issues`)}`, { title: 'x' });
    expect((await r.json()).error).not.toBe(DEMO_REFUSAL);
  });
});
