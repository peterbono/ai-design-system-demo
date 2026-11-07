// Check the build through Bridge's server (api/contribute actions build-state and build-word): the designer and the
// PM (who may only view) answer on the developers' build, Bridge signs it on their pull request and keeps the
// "Design check" on its head; nobody else answers, and nothing is said before the build is ready.
import { describe, expect, it } from 'vitest';
import { memberRef } from '../../api/_lib/exploration-member';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { clearDesignPathCache, clearProductPairCache, handleContribute, issueSession, type ContribDeps } from '../../api/contribute/index';
import { clearReadMemory } from '../../api/_lib/team-read';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const REPO = 'acme/design';
const COPY = 'acme/shop-design';
const CODE = 'acme/shop';
const T0 = Date.parse('2026-11-07T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const CONFIG = JSON.stringify({ products: [{ key: 'shop', name: 'Shop', repo: CODE, design: { repo: COPY } }], governance: { owners: { design: ['florian'] } } });
const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-contribute': '1', 'sec-fetch-site': 'same-origin' };
const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(o: { draft?: boolean; pieces?: string[] } = {}) {
  clearDesignPathCache();
  clearProductPairCache();
  clearReadMemory();
  const redis = memoryRedis(() => T0);
  const members = memberStore(redis);
  const block = { name: 'Late tag', startedAt: '2026-11-01T00:00:00Z', doneAt: '2026-11-05T00:00:00Z', member: memberRef('mia@acme.design'), memberName: 'Mia', task: `https://github.com/${CODE}/issues/7`, ...(o.pieces ? { leadPieces: o.pieces } : {}) };
  const world = { head: 'a'.repeat(40), comments: [] as string[], statuses: [] as { sha: string; state: string; context: string }[], writes: [] as string[], body: '' };
  const deps: ContribDeps = {
    fetch: async (url, init) => {
      const u = new URL(url);
      const m = init.method;
      if (m !== 'GET') world.writes.push(`${m} ${u.pathname}`);
      if (m === 'PATCH' && u.pathname === `/repos/${COPY}/pulls/5`) return (world.body = JSON.parse(init.body!).body), res(200, {});
      if (m === 'GET' && u.pathname === `/repos/${REPO}/contents/bridge.config.json`) return new Response(CONFIG, { status: 200 });
      if (m === 'GET' && u.pathname === `/repos/${COPY}/pulls/5`) return res(200, { number: 5, body: `x\n\n<!-- bridge-exploration ${JSON.stringify(block)} -->` });
      if (m === 'GET' && u.pathname === `/repos/${CODE}/issues/7/timeline`) return res(200, [{ event: 'cross-referenced', source: { issue: { number: 12, html_url: `https://github.com/${CODE}/pull/12`, state: 'open', draft: o.draft === true, pull_request: {}, repository: { full_name: CODE } } } }]);
      if (m === 'GET' && u.pathname === `/repos/${CODE}/pulls/12`) return res(200, { number: 12, state: 'open', draft: o.draft === true, head: { sha: world.head } });
      if (m === 'POST' && u.pathname === `/repos/${CODE}/issues/12/comments`) return world.comments.push(JSON.parse(init.body!).body), res(201, {});
      if (m === 'POST' && u.pathname.startsWith(`/repos/${CODE}/statuses/`)) {
        const b = JSON.parse(init.body!);
        world.statuses.push({ sha: u.pathname.split('/').pop()!, state: b.state, context: b.context });
        return res(201, {});
      }
      return res(404, { message: 'Not Found' });
    },
    now: () => T0,
    redis,
    email: { send: async () => undefined },
    app: { installationToken: async () => 'ghs_x' },
  };
  return { redis, members, deps, world };
}

async function as(s: ReturnType<typeof setup>, email: string, name: string, role: 'view' | 'edit' | 'admin', lead = false) {
  const m = { email, name, role, version: 1, addedBy: 'dana', at: new Date(T0).toISOString(), ...(lead ? { lead: true } : {}) };
  await s.members.put(REPO, m);
  return issueSession(m, REPO, SECRET, T0).split(';')[0]!;
}
const post = (body: unknown, cookie: string) => new Request(`${ORIGIN}/api/contribute`, { method: 'POST', headers: { ...H, cookie }, body: JSON.stringify(body) });
const at = { repo: REPO, product: 'shop', copy: COPY, number: 5 };
const say = (kind: string, extra: Record<string, unknown> = {}) => ({ action: 'build-word', ...at, kind, ...extra });

async function withPm(s: ReturnType<typeof setup>) {
  const admin = await as(s, 'ann@acme.design', 'Ann', 'admin');
  await as(s, 'dino@acme.design', 'Dino', 'view');
  await handleContribute(post({ action: 'set-pm', repo: REPO, product: 'shop', pm: { ref: memberRef('dino@acme.design') } }, admin), ENV, s.deps);
}

describe('check the build: the design must change', () => {
  it('moves the exploration back to its designer: a new round, the task leaves the developers', async () => {
    const s = setup();
    await withPm(s);
    const dino = await as(s, 'dino@acme.design', 'Dino', 'view');
    expect((await handleContribute(post(say('changes', { why: 'design', text: 'Keep the date visible' }), dino), ENV, s.deps)).status).toBe(200);
    const block = JSON.parse(/<!-- bridge-exploration (\{[\s\S]*?\}) -->/.exec(s.world.body)![1]!);
    expect(block.doneAt).toBeUndefined();
    expect(block.reopenedAt).toBe('2026-11-07T10:00:00.000Z');
    expect(block.decisions.at(-1)).toMatchObject({ kind: 'take-back', byName: 'Dino', text: 'Keep the date visible', round: 1 });
    expect(s.world.writes).toEqual(expect.arrayContaining([`POST /repos/${COPY}/issues/5/labels`, `DELETE /repos/${COPY}/issues/5/labels/ready-for-devs`, `POST /repos/${CODE}/issues/7/comments`, `PATCH /repos/${CODE}/issues/7`]));
  });

  it('the build is off: the exploration stays with the developers', async () => {
    const s = setup();
    await withPm(s);
    const dino = await as(s, 'dino@acme.design', 'Dino', 'view');
    await handleContribute(post(say('changes', { why: 'build', text: 'Date cut' }), dino), ENV, s.deps);
    expect(s.world.writes.some((w) => w.includes(COPY))).toBe(false);
  });
});

describe('the lists read the whole check', () => {
  it('who is still waiting, by name, once the check was opened; null before', async () => {
    const s = setup();
    await withPm(s);
    const mia = await as(s, 'mia@acme.design', 'Mia', 'edit');
    const lists = () => handleContribute(post({ action: 'build-checks', repo: REPO, pulls: [{ code: CODE, number: 12 }, { code: 'acme/other', number: 1 }] }, mia), ENV, s.deps).then((r) => r.json());
    expect((await lists()).checks).toEqual({ 'acme/shop#12': null, 'acme/other#1': null });
    await handleContribute(post(say('looks-right'), mia), ENV, s.deps);
    expect((await lists()).checks['acme/shop#12']).toEqual({ state: 'pending', waiting: ['Dino'], changesBy: null });
  });
});

describe('check the build', () => {
  it('the designer and the PM say it looks right; the Design check follows on the head', async () => {
    const s = setup();
    await withPm(s);
    const mia = await as(s, 'mia@acme.design', 'Mia', 'edit');
    const dino = await as(s, 'dino@acme.design', 'Dino', 'view');
    const first = await (await handleContribute(post({ action: 'build-state', ...at }, mia), ENV, s.deps)).json();
    expect(first).toMatchObject({ state: 'pending', role: 'designer', pull: { number: 12 } });
    expect(s.world.statuses.at(-1)).toEqual({ sha: s.world.head, state: 'pending', context: 'Design check' });
    expect((await handleContribute(post(say('looks-right'), mia), ENV, s.deps)).status).toBe(200);
    const done = await (await handleContribute(post(say('looks-right'), dino), ENV, s.deps)).json();
    expect(done.state).toBe('success');
    expect(s.world.statuses.at(-1)?.state).toBe('success');
    expect(s.world.comments.at(-1)).toContain('Dino (product manager)');
    // The developer pushes: everyone is asked again.
    s.world.head = 'b'.repeat(40);
    const again = await (await handleContribute(post({ action: 'build-state', ...at }, dino), ENV, s.deps)).json();
    expect(again.state).toBe('pending');
    expect(s.world.statuses.at(-1)).toMatchObject({ sha: 'b'.repeat(40), state: 'pending' });
  });

  it('Needs changes needs a note and says which kind', async () => {
    const s = setup();
    await withPm(s);
    const dino = await as(s, 'dino@acme.design', 'Dino', 'view');
    expect((await handleContribute(post(say('changes'), dino), ENV, s.deps)).status).toBe(400);
    const r = await (await handleContribute(post(say('changes', { why: 'design', text: 'Keep the date' }), dino), ENV, s.deps)).json();
    expect(r.state).toBe('failure');
    expect(r.rows.find((x: { role: string }) => x.role === 'pm')).toMatchObject({ state: 'changes', why: 'design', text: 'Keep the date' });
  });

  it('nobody else answers, and the lead is asked only when the library changed', async () => {
    const s = setup({ pieces: ['Late tag'] });
    const lee = await as(s, 'lee@acme.design', 'Lee', 'edit');
    expect((await handleContribute(post(say('looks-right'), lee), ENV, s.deps)).status).toBe(403);
    const mia = await as(s, 'mia@acme.design', 'Mia', 'edit');
    const st = await (await handleContribute(post(say('looks-right'), mia), ENV, s.deps)).json();
    expect(st).toMatchObject({ state: 'pending', description: 'Waiting for the lead' });
    const flo = await as(s, 'flo@acme.design', 'Flo', 'edit', true);
    expect((await (await handleContribute(post(say('looks-right'), flo), ENV, s.deps)).json()).state).toBe('success');
  });

  it('a signed-out visitor reads nothing of a real team (a demo team reads like a viewer, never answers)', async () => {
    const s = setup();
    expect((await handleContribute(post({ action: 'build-state', ...at }, ''), ENV, s.deps)).status).toBe(401);
    expect((await handleContribute(post(say('looks-right'), ''), ENV, s.deps)).status).toBe(401);
  });

  it('a read that changes nothing writes no new Design check (once per head and state)', async () => {
    const s = setup();
    const mia = await as(s, 'mia@acme.design', 'Mia', 'edit');
    await handleContribute(post({ action: 'build-state', ...at }, mia), ENV, s.deps);
    const after = s.world.statuses.length;
    expect(after).toBeGreaterThan(0);
    await handleContribute(post({ action: 'build-state', ...at }, mia), ENV, s.deps);
    expect(s.world.statuses.length).toBe(after);
    await handleContribute(post(say('looks-right'), mia), ENV, s.deps);
    expect(s.world.statuses.length).toBe(after + 1);
  });

  it('nothing before the build is ready', async () => {
    const s = setup({ draft: true });
    const mia = await as(s, 'mia@acme.design', 'Mia', 'edit');
    expect((await handleContribute(post({ action: 'build-state', ...at }, mia), ENV, s.deps)).status).toBe(409);
    expect(s.world.statuses).toEqual([]);
  });
});
