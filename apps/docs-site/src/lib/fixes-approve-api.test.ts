// Approving Claude's Figma fixes through /api/ship (api/_lib/fixes-approve.ts) with a mocked GitHub: who may approve
// (leads and admins only), the file guard (figma-fixes.json alone, valid, nothing taken out, nothing changed
// underneath), and how they land: one merge for one fix, one union merge commit for several.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppTokens } from '../../api/_lib/github-app';
import { APPROVE_ERROR_WORDS, APPROVE_WORDS } from '../../api/_lib/fixes-approve';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { issueSession } from '../../api/contribute/index';
import { handleShip, type FetchLike, type ShipDeps } from '../../api/ship/index';

const HOST = 'bridge.example.com';
const SECRET = 's'.repeat(48);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const MAIN = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OLD_BASE = 'o'.repeat(40);
const CONFIG = JSON.stringify({ governance: { owners: { design: ['dana', '@acme/design'], tech: ['malik'] } } });

const fix = (id: string, component: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'status', component, status: 'differs', reason: `${component} is drawn from its story, see the shot.`, by: 'claude', ...extra });
const file = (...fixes: unknown[]) => `${JSON.stringify({ version: 1, fixes }, null, 2)}\n`;
const MAIN_FIXES = [fix('toggle-note', 'Toggle')];

const LEAD = 'Bearer ghu_lead_dana_token_000000';
const ADMIN = 'Bearer ghu_admin_ada_token_000000';
const TEAM = 'Bearer ghu_team_tess_token_000000';
const WRITER = 'Bearer ghu_writer_kim_token_00000';
const READER = 'Bearer ghu_reader_riley_token_0000';
const CALLERS: Record<string, { login: string; push: boolean; admin?: boolean }> = {
  [LEAD]: { login: 'dana', push: true },
  [ADMIN]: { login: 'ada', push: true, admin: true },
  [TEAM]: { login: 'tess', push: true },
  [WRITER]: { login: 'kim', push: true },
  [READER]: { login: 'riley', push: false },
};

interface Pr {
  number: number;
  state?: string;
  ref?: string;
  head: string;
  /** Its merge base with main, and figma-fixes.json there. */
  base?: string;
  files?: { filename: string; status: string }[];
  text: string;
  labels?: string[];
  ci?: 'pass' | 'fail' | 'pending';
  draft?: boolean;
}

interface World {
  main: string;
  /** figma-fixes.json at each ref. */
  texts: Record<string, string | null>;
  prs: Record<number, Pr>;
  /** PATCH of the default branch: 200, or 422 when the branch rules refuse the push. */
  moveStatus: number;
  calls: { method: string; path: string; body?: any }[];
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const blob = (t: string | null | undefined) => (t == null ? null : createHash('sha1').update(t).digest('hex'));

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const p = u.pathname;
    const auth = init.headers.Authorization ?? '';
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path: p + u.search, body });
    const caller = CALLERS[auth];
    if (caller) {
      if (p === '/user') return res(200, { login: caller.login, name: caller.login === 'dana' ? 'Dana' : null });
      if (p === '/repos/acme/design') return res(200, { permissions: { pull: true, push: caller.push, admin: caller.admin === true } });
      return res(404, {});
    }
    expect(auth).toBe('Bearer ghs_app');
    const base = '/repos/acme/design';
    if (p === base) return res(200, { default_branch: 'main', allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true });
    if (p === `${base}/git/ref/heads/main`) return res(200, { object: { sha: w.main } });
    if (p.startsWith(`${base}/contents/`)) {
      const path = decodeURIComponent(p.slice(`${base}/contents/`.length));
      const ref = u.searchParams.get('ref') ?? '';
      if (path === 'bridge.config.json') return new Response(CONFIG, { status: 200 });
      if (path !== 'figma-fixes.json') return res(404, {});
      const t = w.texts[ref];
      if (t == null) return res(404, {});
      return init.headers.Accept === 'application/vnd.github.raw' ? new Response(t, { status: 200 }) : res(200, { sha: blob(t) });
    }
    const team = /^\/orgs\/acme\/teams\/design\/memberships\/(.+)$/.exec(p);
    if (team) return team[1] === 'tess' ? res(200, { state: 'active' }) : res(404, {});
    if (p === `${base}/pulls/99/merge`) return res(200, { merged: true, sha: 'm'.repeat(40) });
    const one = /^\/repos\/acme\/design\/pulls\/(\d+)(\/files|\/merge)?$/.exec(p);
    if (one) {
      const pr = w.prs[Number(one[1])];
      if (!pr) return res(404, {});
      if (one[2] === '/files') return res(200, pr.files ?? [{ filename: 'figma-fixes.json', status: 'modified' }]);
      if (one[2] === '/merge') {
        expect(body.sha).toBe(pr.head);
        pr.state = 'closed';
        return res(200, { merged: true, sha: 'c'.repeat(40) });
      }
      return res(200, { number: pr.number, state: pr.state ?? 'open', merged_at: null, draft: pr.draft ?? true, node_id: `PR_${pr.number}`, base: { ref: 'main' }, head: { ref: pr.ref ?? `bridge/figma-fixes-c${pr.number}`, sha: pr.head, repo: { full_name: 'acme/design' } }, labels: (pr.labels ?? ['figma-fixes', 'drafted-by-claude']).map((name) => ({ name })) });
    }
    const checks = /^\/repos\/acme\/design\/commits\/([^/]+)\/(check-runs|status)$/.exec(p);
    if (checks) {
      const pr = Object.values(w.prs).find((x) => x.head === checks[1]);
      const ci = pr?.ci ?? 'pass';
      if (checks[2] === 'status') return res(200, { statuses: [] });
      return res(200, { check_runs: [{ status: ci === 'pending' ? 'in_progress' : 'completed', conclusion: ci === 'fail' ? 'failure' : ci === 'pass' ? 'success' : null }] });
    }
    const cmp = /^\/repos\/acme\/design\/compare\/main\.\.\.(.+)$/.exec(p);
    if (cmp) {
      const pr = Object.values(w.prs).find((x) => x.head === cmp[1]);
      return res(200, { merge_base_commit: { sha: pr?.base ?? BASE } });
    }
    if (p === `${base}/git/commits/${w.main}`) return res(200, { sha: w.main, tree: { sha: 'tree-main' } });
    if (p === `${base}/git/blobs` && init.method === 'POST') return res(201, { sha: 'blob-union' });
    if (p === `${base}/git/trees` && init.method === 'POST') return res(201, { sha: 'tree-union' });
    if (p === `${base}/git/commits` && init.method === 'POST') return res(201, { sha: 'u'.repeat(40) });
    if (p === `${base}/git/refs/heads/main` && init.method === 'PATCH') return res(w.moveStatus, {});
    if (p === `${base}/git/refs` && init.method === 'POST') return res(201, {});
    if (p === `${base}/pulls` && init.method === 'POST') return res(201, { number: 99, node_id: 'PR_99' });
    if (p === `${base}/issues/99/labels`) return res(200, []);
    if (p === '/graphql') return res(200, { data: {} });
    return res(404, {});
  };
}

/** Two fixes Claude proposed (11: Avatar, 12: Badge), each on main's file as it was at their merge base. */
function setup(over: Partial<World> = {}, extraPrs: Pr[] = []) {
  const pr11: Pr = { number: 11, head: '1'.repeat(40), text: file(...MAIN_FIXES, fix('avatar-note', 'Avatar')) };
  const pr12: Pr = { number: 12, head: '2'.repeat(40), text: file(...MAIN_FIXES, fix('badge-note', 'Badge')) };
  const prs = Object.fromEntries([pr11, pr12, ...extraPrs].map((x) => [x.number, x]));
  const texts: Record<string, string | null> = { [MAIN]: file(...MAIN_FIXES), [BASE]: file(...MAIN_FIXES), ...Object.fromEntries(Object.values(prs).map((x) => [x.head, x.text])) };
  const w: World = { main: MAIN, texts, prs, moveStatus: 200, calls: [], ...over };
  const app: AppTokens = { installationToken: async () => 'ghs_app' };
  const deps: ShipDeps = { fetch: github(w), app };
  const call = async (body: unknown, headers: Record<string, string> = { authorization: LEAD }) => {
    const r = await handleShip(new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'content-type': 'application/json', host: HOST, ...headers }, body: JSON.stringify({ repo: 'acme/design', ...(body as object) }) }), ENV, deps);
    return { status: r.status, body: await r.json() };
  };
  const writes = () => w.calls.filter((c) => c.method !== 'GET');
  return { w, call, deps, writes };
}

describe('who approves Claude\'s fixes', () => {
  it('a design owner with write access, a repository admin and a member of a design team entry can', async () => {
    for (const auth of [LEAD, ADMIN, TEAM]) {
      const { call } = setup();
      expect((await call({ action: 'can-approve-fixes' }, { authorization: auth })).body).toEqual({ canApprove: true });
    }
  });

  it('a writer who is not a design owner, and a reader, cannot: they keep waiting for approval', async () => {
    for (const auth of [WRITER, READER]) {
      const { call } = setup();
      expect((await call({ action: 'can-approve-fixes' }, { authorization: auth })).body).toEqual({ canApprove: false });
    }
    const { call, writes } = setup();
    const r = await call({ action: 'approve-fixes', prs: [11] }, { authorization: WRITER });
    expect(r).toEqual({ status: 403, body: { error: 'not_lead', message: APPROVE_ERROR_WORDS.notLead } });
    expect(writes()).toEqual([]);
    expect((await call({ action: 'approve-fixes', prs: [11] }, { authorization: READER })).status).toBe(403);
  });

  it('an email member approves through the Bridge site only as an Admin of the team', async () => {
    const { deps } = setup();
    const redis = memoryRedis();
    const members = memberStore(redis);
    const asMember = async (email: string, role: 'edit' | 'admin') => {
      const m = { email, name: email.split('@')[0]!, role, version: 1, addedBy: 'dana', at: '2026-10-01T00:00:00Z' };
      await members.put('acme/design', m);
      const cookie = issueSession(m, 'acme/design', SECRET, Date.now()).split(';')[0]!;
      const headers = { 'content-type': 'application/json', host: HOST, origin: `https://${HOST}`, 'x-bridge-contribute': '1', cookie };
      const r = await handleShip(new Request(`https://${HOST}/api/ship`, { method: 'POST', headers, body: JSON.stringify({ repo: 'acme/design', action: 'can-approve-fixes' }) }), ENV, { ...deps, redis, members });
      return r.json();
    };
    expect(await asMember('mia@acme.design', 'edit')).toEqual({ canApprove: false });
    expect(await asMember('ali@acme.design', 'admin')).toEqual({ canApprove: true });
  });

  it('nobody signed in: 401, and without the Bridge app nobody sees the button', async () => {
    const { call } = setup();
    expect((await call({ action: 'can-approve-fixes' }, {})).status).toBe(401);
    const { deps } = setup();
    const r = await handleShip(
      new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'content-type': 'application/json', host: HOST, authorization: LEAD }, body: JSON.stringify({ repo: 'acme/design', action: 'can-approve-fixes' }) }),
      ENV,
      { ...deps, app: { installationToken: async () => null } },
    );
    expect(await r.json()).toEqual({ canApprove: false, code: 'app_missing' });
  });
});

describe('approve-fixes: how they land', () => {
  it('one fix on an unchanged fixes file: GitHub merges that pull request (ready first), one push', async () => {
    const { w, call, writes } = setup();
    const r = await call({ action: 'approve-fixes', prs: [11] });
    expect(r.body).toEqual({ approved: [{ pr: 11 }], refused: [], landed: true, how: 'merged', commit: 'c'.repeat(40) });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['POST /graphql', 'PUT /repos/acme/design/pulls/11/merge']);
    expect(writes()[1]!.body).toMatchObject({ merge_method: 'squash', commit_title: "fix(figma): land Claude's Figma fix #11 (#11)" });
    expect(writes()[1]!.body.commit_message).toMatch(/^Approved by Dana in the Figma plugin\./);
    expect(w.prs[11]!.state).toBe('closed');
  });

  it('several: one merge commit with main and every head as parents, holding the union by id, and main moves to it', async () => {
    const { call, writes } = setup();
    const r = await call({ action: 'approve-fixes', prs: [11, 12] });
    expect(r.body).toEqual({ approved: [{ pr: 11 }, { pr: 12 }], refused: [], landed: true, how: 'together', commit: 'u'.repeat(40) });
    const blobCall = writes().find((c) => c.path.endsWith('/git/blobs'))!;
    expect(JSON.parse(blobCall.body.content).fixes.map((x: { id: string }) => x.id)).toEqual(['toggle-note', 'avatar-note', 'badge-note']);
    const commit = writes().find((c) => c.path.endsWith('/git/commits'))!;
    expect(commit.body.parents).toEqual([MAIN, '1'.repeat(40), '2'.repeat(40)]);
    expect(commit.body.message).toMatch(/^fix\(figma\): land Claude's Figma fixes for 2 components in one merge\n\nApproved by Dana in the Figma plugin\. figma-fixes.json holds the fixes of #11 and #12/);
    expect(writes().find((c) => c.method === 'PATCH')).toMatchObject({ path: '/repos/acme/design/git/refs/heads/main', body: { sha: 'u'.repeat(40), force: false } });
    // One push to the default branch: no pull request merged one by one.
    expect(writes().some((c) => c.path.endsWith('/merge'))).toBe(false);
  });

  it('one fix whose base is behind a changed fixes file lands through the union too (no text merge of JSON)', async () => {
    const pr13: Pr = { number: 13, head: '3'.repeat(40), base: OLD_BASE, text: file(fix('chip-note', 'Chip')) };
    const { w, call, writes } = setup({}, [pr13]);
    w.texts[OLD_BASE] = file();
    const r = await call({ action: 'approve-fixes', prs: [13] });
    expect(r.body).toMatchObject({ approved: [{ pr: 13 }], landed: true, how: 'together' });
    const content = JSON.parse(writes().find((c) => c.path.endsWith('/git/blobs'))!.body.content);
    expect(content.fixes.map((x: { id: string }) => x.id)).toEqual(['toggle-note', 'chip-note']);
  });

  it('branch rules refuse the push: one pull request carries the commit, merged with a merge commit', async () => {
    const { call, writes } = setup({ moveStatus: 422 });
    const r = await call({ action: 'approve-fixes', prs: [11, 12] });
    expect(r.body).toMatchObject({ approved: [{ pr: 11 }, { pr: 12 }], landed: true, how: 'together' });
    expect(writes().find((c) => c.path === '/repos/acme/design/pulls')!.body).toMatchObject({ head: `bridge/figma-fixes-approved-${'u'.repeat(7)}`, base: 'main' });
    expect(writes().find((c) => c.path === '/repos/acme/design/pulls/99/merge')!.body).toEqual({ sha: 'u'.repeat(40), merge_method: 'merge' });
  });
});

describe('approve-fixes: the file guard, in designer words', () => {
  const refusedOf = async (pr: Pr, prep?: (w: World) => void) => {
    const { w, call, writes } = setup({}, [pr]);
    prep?.(w);
    const r = await call({ action: 'approve-fixes', prs: [11, pr.number] });
    return { body: r.body, writes: writes() };
  };

  it.each([
    ['not_only_fixes', { number: 20, head: '4'.repeat(40), text: file(...MAIN_FIXES), files: [{ filename: 'figma-fixes.json', status: 'modified' }, { filename: 'packages/react/src/x.tsx', status: 'modified' }] }],
    ['not_fix', { number: 21, head: '5'.repeat(40), text: file(...MAIN_FIXES), labels: ['source: figma'] }],
    ['not_fix', { number: 22, head: '6'.repeat(40), text: file(...MAIN_FIXES), ref: 'agent/sneaky' }],
    ['not_open', { number: 23, head: '7'.repeat(40), text: file(...MAIN_FIXES), state: 'closed' }],
    ['checks_failed', { number: 24, head: '8'.repeat(40), text: file(...MAIN_FIXES, fix('chip-note', 'Chip')), ci: 'fail' }],
    ['checks_pending', { number: 25, head: '9'.repeat(40), text: file(...MAIN_FIXES, fix('chip-note', 'Chip')), ci: 'pending' }],
    ['not_valid', { number: 26, head: 'd'.repeat(40), text: file(...MAIN_FIXES, fix('chip-note', 'Chip', { reason: 'Chip differs \u2014 see shot.' })) }],
    ['removes', { number: 27, head: 'e'.repeat(40), text: file(fix('chip-note', 'Chip')) }],
    ['same_fix', { number: 28, head: 'f'.repeat(40), text: file(...MAIN_FIXES, fix('avatar-note', 'Avatar', { status: 'cant-check' })) }],
  ] as [string, Pr][])('%s: refused with its sentence, the others still land', async (code, pr) => {
    const { body } = await refusedOf(pr);
    expect(body.refused).toEqual([{ pr: pr.number, code, reason: APPROVE_WORDS[code as keyof typeof APPROVE_WORDS] }]);
    expect(body.approved).toEqual([{ pr: 11 }]);
    expect(body.landed).toBe(true);
  });

  it('a fix the library changed since Claude proposed it: changed underneath', async () => {
    const pr: Pr = { number: 30, head: 'f'.repeat(39) + '0', base: OLD_BASE, text: file(fix('toggle-note', 'Toggle', { status: 'cant-check' })) };
    const { body } = await refusedOf(pr, (w) => {
      w.texts[OLD_BASE] = file(fix('toggle-note', 'Toggle', { reason: 'An older reason for the Toggle note.' }));
    });
    expect(body.refused).toEqual([{ pr: 30, code: 'changed_underneath', reason: APPROVE_WORDS.changed_underneath }]);
  });

  it('a fix that moved since the plugin showed it: refused, nothing written when nothing is left', async () => {
    const { call, writes } = setup();
    const r = await call({ action: 'approve-fixes', prs: [11], heads: { 11: '0'.repeat(40) } });
    expect(r.body).toEqual({ approved: [], refused: [{ pr: 11, code: 'moved', reason: APPROVE_WORDS.moved }], landed: false });
    expect(writes()).toEqual([]);
  });

  it('a change to a fix main still holds as it was at the base: the new version replaces it', async () => {
    const pr: Pr = { number: 31, head: 'f'.repeat(39) + '1', text: file(fix('toggle-note', 'Toggle', { status: 'cant-check' })) };
    const { w, call, writes } = setup({}, [pr]);
    void w;
    const r = await call({ action: 'approve-fixes', prs: [12, 31] });
    expect(r.body.refused).toEqual([]);
    const content = JSON.parse(writes().find((c) => c.path.endsWith('/git/blobs'))!.body.content);
    expect(content.fixes.find((x: { id: string }) => x.id === 'toggle-note').status).toBe('cant-check');
  });

  it('asks for at least one and at most 50', async () => {
    const { call } = setup();
    expect((await call({ action: 'approve-fixes', prs: [] })).status).toBe(400);
    expect((await call({ action: 'approve-fixes', prs: Array.from({ length: 51 }, (_, i) => i + 1) })).body.message).toBe(APPROVE_ERROR_WORDS.tooMany);
  });
});
