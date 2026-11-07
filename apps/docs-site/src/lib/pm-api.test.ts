// The product manager through Bridge's server (api/contribute actions set-pm and pm-word): a lead or an admin picks
// them, the PM (who may only view) says what they think on an exploration of their product, the designer says the PM
// agreed in a call, and nobody else, nor the proxy, writes those words.
import { describe, expect, it } from 'vitest';
import { pmOpinionOf } from '@bridge-ds/core';
import { memberRef } from '../../api/_lib/exploration-member';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { clearDesignPathCache, clearProductPairCache, handleContribute, issueSession, type ContribDeps } from '../../api/contribute/index';
import { clearReadMemory } from '../../api/_lib/team-read';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const REPO = 'acme/design';
const COPY = 'acme/shop-design';
const T0 = Date.parse('2026-11-07T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const CONFIG = JSON.stringify({ products: [{ key: 'shop', name: 'Shop', repo: 'acme/shop', design: { repo: COPY } }], governance: { owners: { design: ['florian'] } } });
const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-contribute': '1', 'sec-fetch-site': 'same-origin' };

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(block: Record<string, unknown>) {
  clearDesignPathCache();
  clearProductPairCache();
  clearReadMemory();
  const redis = memoryRedis(() => T0);
  const members = memberStore(redis);
  const pull = { body: `Notes\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Late tag', startedAt: '2026-11-01T00:00:00Z', ...block })} -->` };
  const patches: string[] = [];
  const deps: ContribDeps = {
    fetch: async (url, init) => {
      const u = new URL(url);
      if (init.method === 'GET' && u.pathname === `/repos/${REPO}/contents/bridge.config.json`) return new Response(CONFIG, { status: 200 });
      if (init.method === 'GET' && u.pathname === `/repos/${COPY}/pulls/5`) return res(200, { number: 5, body: pull.body });
      if (init.method === 'PATCH' && u.pathname === `/repos/${COPY}/pulls/5`) {
        pull.body = JSON.parse(init.body!).body;
        patches.push(pull.body);
        return res(200, { number: 5 });
      }
      return res(404, { message: 'Not Found' });
    },
    now: () => T0,
    redis,
    email: { send: async () => undefined },
    app: { installationToken: async () => 'ghs_x' },
  };
  return { redis, members, deps, pull, patches };
}

async function as(s: ReturnType<typeof setup>, email: string, name: string, role: 'view' | 'edit' | 'admin', lead = false) {
  const m = { email, name, role, version: 1, addedBy: 'dana', at: new Date(T0).toISOString(), ...(lead ? { lead: true } : {}) };
  await s.members.put(REPO, m);
  return issueSession(m, REPO, SECRET, T0).split(';')[0]!;
}

const post = (body: unknown, cookie: string) => new Request(`${ORIGIN}/api/contribute`, { method: 'POST', headers: { ...H, cookie }, body: JSON.stringify(body) });
const word = (kind: string, text?: string) => ({ action: 'pm-word', repo: REPO, product: 'shop', copy: COPY, number: 5, kind, ...(text ? { text } : {}) });

describe('the product manager', () => {
  it('is picked by a lead or an admin, never by anyone else', async () => {
    const s = setup({});
    const admin = await as(s, 'ann@acme.design', 'Ann', 'admin');
    const editor = await as(s, 'mia@acme.design', 'Mia', 'edit');
    await as(s, 'dino@acme.design', 'Dino', 'view');
    const pick = { action: 'set-pm', repo: REPO, product: 'shop', pm: { ref: memberRef('dino@acme.design') } };
    expect((await handleContribute(post(pick, editor), ENV, s.deps)).status).toBe(403);
    const r = await handleContribute(post(pick, admin), ENV, s.deps);
    expect(r.status).toBe(200);
    expect((await r.json()).pm).toEqual({ name: 'Dino', ref: memberRef('dino@acme.design') });
    // Someone not on the team: refused.
    expect((await handleContribute(post({ ...pick, pm: { ref: 'f'.repeat(16) } }, admin), ENV, s.deps)).status).toBe(404);
  });

  it('says what they think, even with Can view; nobody else says it for them', async () => {
    const s = setup({ member: memberRef('mia@acme.design'), memberName: 'Mia', leadAskedAt: '2026-11-06T00:00:00Z' });
    const admin = await as(s, 'ann@acme.design', 'Ann', 'admin');
    const pm = await as(s, 'dino@acme.design', 'Dino', 'view');
    const designer = await as(s, 'mia@acme.design', 'Mia', 'edit');
    const lead = await as(s, 'flo@acme.design', 'Flo', 'edit', true);
    await handleContribute(post({ action: 'set-pm', repo: REPO, product: 'shop', pm: { ref: memberRef('dino@acme.design') } }, admin), ENV, s.deps);
    // Needs changes needs a note.
    expect((await handleContribute(post(word('pm-changes'), pm), ENV, s.deps)).status).toBe(400);
    // The designer and a lead are not the PM.
    expect((await handleContribute(post(word('pm-ok'), designer), ENV, s.deps)).status).toBe(403);
    expect((await handleContribute(post(word('pm-ok'), lead), ENV, s.deps)).status).toBe(403);
    const r = await handleContribute(post(word('pm-changes', 'Show how many days late'), pm), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(pmOpinionOf(s.pull.body)).toMatchObject({ kind: 'pm-changes', byName: 'Dino', text: 'Show how many days late', round: 1 });
    expect(s.pull.body).not.toContain('dino@acme.design');
  });

  it('the designer, and only them, says the PM agreed in a call', async () => {
    const s = setup({ member: memberRef('mia@acme.design'), memberName: 'Mia' });
    const admin = await as(s, 'ann@acme.design', 'Ann', 'admin');
    const pm = await as(s, 'dino@acme.design', 'Dino', 'view');
    const designer = await as(s, 'mia@acme.design', 'Mia', 'edit');
    // No PM yet: nothing to say.
    expect((await handleContribute(post(word('pm-call'), designer), ENV, s.deps)).status).toBe(409);
    await handleContribute(post({ action: 'set-pm', repo: REPO, product: 'shop', pm: { ref: memberRef('dino@acme.design') } }, admin), ENV, s.deps);
    expect((await handleContribute(post(word('pm-call'), pm), ENV, s.deps)).status).toBe(403);
    expect((await handleContribute(post(word('pm-call'), designer), ENV, s.deps)).status).toBe(200);
    expect(pmOpinionOf(s.pull.body)).toMatchObject({ kind: 'pm-call', byName: 'Mia', to: ['Dino'] });
  });

  it('never once it went to the developers, never in another product\'s repository', async () => {
    const s = setup({ doneAt: '2026-11-06T00:00:00Z' });
    const admin = await as(s, 'ann@acme.design', 'Ann', 'admin');
    const pm = await as(s, 'dino@acme.design', 'Dino', 'view');
    await handleContribute(post({ action: 'set-pm', repo: REPO, product: 'shop', pm: { ref: memberRef('dino@acme.design') } }, admin), ENV, s.deps);
    expect((await handleContribute(post(word('pm-ok'), pm), ENV, s.deps)).status).toBe(409);
    expect((await handleContribute(post({ ...word('pm-ok'), copy: 'acme/other' }, pm), ENV, s.deps)).status).toBe(404);
    expect(s.patches).toEqual([]);
  });
});
