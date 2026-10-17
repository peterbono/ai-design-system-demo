// Change texts drafted with the designer's own Claude: the Figma plugin writes a pending drafts file on the
// bridge-requests branch, bridge_pending_drafts lists it (with the before and after PNGs as image content) and
// bridge_write_drafts writes the results back, retrying when the file changed in between (409). GitHub is in memory.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { composePendingDrafts, draftImagePath, draftSessionPath, type DraftItem, type PendingDrafts, serializePendingDrafts } from '@bridge-ds/core';
import { BridgeContext, createServer, drafts } from '../dist/lib.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const PNG = Buffer.from('fake png bytes').toString('base64');
const BIG = Buffer.alloc(800_000, 1).toString('base64');

const item = (id: string, sessionId: string, images = true): DraftItem => ({
  id,
  scope: 'request',
  component: 'Badge',
  kind: 'new-variant',
  changes: [{ field: 'Variant Tone', before: 'info, neutral', after: 'danger, info, neutral' }],
  draft: { title: 'Add a danger tone', summary: 'Badge gets a new Tone value, danger.' },
  ...(images
    ? {
        images: (['before', 'after'] as const).map((label) => ({ label, path: draftImagePath(sessionId, id, label), url: `https://github.com/acme/ds/blob/bridge-requests/${draftImagePath(sessionId, id, label)}?raw=true` })),
      }
    : {}),
});

/**
 * fakeGitHub plus a contents API for the bridge-requests branch: blob shas, 409 on a stale sha, and an optional
 * concurrent write between a read and the next write.
 */
function withDrafts(opts: { raceOnce?: boolean } = {}) {
  const gh = fakeGitHub('acme', 'ds', readTree(REPO, REAL_PATHS));
  const files = new Map<string, { content: string; sha: string }>();
  let n = 0;
  let race = opts.raceOnce ?? false;
  const puts: { path: string; sha?: string; status: number }[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const put = (path: string, text: string, b64 = false) => files.set(path, { content: b64 ? text : Buffer.from(text).toString('base64'), sha: `s${++n}` });
  const f = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const m = /^\/repos\/acme\/ds\/contents\/(\.bridge\/.+)$/.exec(url.pathname);
    const onBranch = url.searchParams.get('ref') === 'bridge-requests' || (init.body && JSON.parse(String(init.body)).branch === 'bridge-requests');
    if (!m || !onBranch) return gh.fetch(input, init);
    const path = decodeURIComponent(m[1]!);
    const method = (init.method ?? 'GET').toUpperCase();
    const authed = Boolean((init.headers as Record<string, string> | undefined)?.Authorization);
    if (method === 'GET') {
      const file = files.get(path);
      if (file) return json(200, { type: 'file', encoding: 'base64', content: file.content, sha: file.sha, size: Buffer.from(file.content, 'base64').length });
      const kids = [...files.entries()].filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
      return kids.length ? json(200, kids.map(([p, x]) => ({ name: p.split('/').pop(), path: p, type: 'file', sha: x.sha, size: 1 }))) : json(404, { message: 'Not Found' });
    }
    if (method === 'PUT') {
      if (!authed) return json(401, { message: 'Requires authentication' });
      const body = JSON.parse(String(init.body));
      if (race && files.has(path)) {
        race = false;
        const other = JSON.parse(Buffer.from(files.get(path)!.content, 'base64').toString('utf8')) as PendingDrafts;
        other.items[0]!.notes = 'Typed in Figma meanwhile';
        put(path, serializePendingDrafts(other));
      }
      const cur = files.get(path);
      const status = cur && body.sha !== cur.sha ? 409 : 200;
      puts.push({ path, sha: body.sha, status });
      if (status === 409) return json(409, { message: `${path} does not match ${body.sha}` });
      files.set(path, { content: body.content, sha: `s${++n}` });
      return json(200, { commit: { sha: `c${n}` } });
    }
    return json(404, { message: 'no route' });
  };
  /** What the Figma plugin writes: a session and its PNGs. */
  const seed = (p: PendingDrafts, png = PNG) => {
    put(draftSessionPath(p.sessionId), serializePendingDrafts(p));
    for (const i of p.items) for (const img of i.images ?? []) if (img.path) put(img.path, png, true);
  };
  const read = (sessionId: string) => JSON.parse(Buffer.from(files.get(draftSessionPath(sessionId))!.content, 'base64').toString('utf8')) as PendingDrafts;
  return { fetch: f as typeof fetch, files, puts, seed, read };
}

const session = (sessionId: string, createdAt: string, items?: DraftItem[]) => composePendingDrafts({ sessionId, now: new Date(createdAt), items: items ?? [item('item-1', sessionId)] });

async function connect(ctx: BridgeContext) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(ctx);
  await server.connect(a);
  const client = new Client({ name: 'drafts-test', version: '0.0.0' });
  await client.connect(b);
  return client;
}

describe('bridge_pending_drafts and bridge_write_drafts', () => {
  it('lists pending sessions newest first with briefs, the voice, the contract and the images as image content', async () => {
    const gh = withDrafts();
    gh.seed(session('older0001', '2026-10-16T09:00:00Z'));
    gh.seed(session('newer0001', '2026-10-17T09:00:00Z'));
    const done = session('done00001', '2026-10-17T10:00:00Z', [item('item-1', 'done00001', false)]);
    gh.seed({ ...done, status: 'drafted', results: [{ id: 'item-1', title: 'x', summary: 'y', by: 'claude', at: '2026-10-17T10:00:00Z' }] });
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });

    const { answer, images } = await drafts.pendingDrafts(ctx, {});
    expect(answer.sessions.map((s) => s.sessionId)).toEqual(['newer0001', 'older0001']);
    expect(answer.branch).toBe('bridge-requests');
    expect(answer.phrase).toBe('Draft my Bridge changes');
    expect(answer.sessions[0]!.briefs[0]).toContain('| Variant Tone | info, neutral | danger, info, neutral |');
    expect(answer.voice.join(' ')).toMatch(/Never use an em dash/);
    expect(answer.contract.join(' ')).toMatch(/bridge_write_drafts/);
    expect(images.map((i) => [i.sessionId, i.label])).toEqual([['newer0001', 'before'], ['newer0001', 'after'], ['older0001', 'before'], ['older0001', 'after']]);
    expect(images[0]!.base64).toBe(PNG);

    const client = await connect(ctx);
    const r = (await client.callTool({ name: 'bridge_pending_drafts', arguments: { sessionId: 'newer0001' } })) as any;
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text).sessions.map((s: any) => s.sessionId)).toEqual(['newer0001']);
    expect(r.content.filter((c: any) => c.type === 'image')).toEqual([
      { type: 'image', data: PNG, mimeType: 'image/png' },
      { type: 'image', data: PNG, mimeType: 'image/png' },
    ]);
    expect(r.content[1].text).toBe('Before (baseline): session newer0001, item item-1');
    await client.close();
  });

  it('links large images instead of inlining them, and says when nothing is waiting', async () => {
    const gh = withDrafts();
    gh.seed(session('large0001', '2026-10-17T09:00:00Z'), BIG);
    const ctx = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    const { answer, images } = await drafts.pendingDrafts(ctx, {});
    expect(images).toEqual([]);
    expect(answer.sessions[0]!.items[0]!.images![0]!.url).toMatch(/\?raw=true$/);

    const empty = withDrafts();
    const ctx2 = await BridgeContext.create({ repo: 'acme/ds', fetch: empty.fetch });
    const none = await drafts.pendingDrafts(ctx2, {});
    expect(none.answer.sessions).toEqual([]);
    expect(none.answer.next).toMatch(/Draft with my Claude/);
    await expect(drafts.pendingDrafts(ctx2, { sessionId: 'gone00001' })).rejects.toThrow(/sent or cancelled/);
  });

  it('writes sanitized results and marks the session drafted; refused without a token or with unknown ids', async () => {
    const gh = withDrafts();
    gh.seed(session('newer0001', '2026-10-17T09:00:00Z'));
    const ro = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    await expect(drafts.writeDrafts(ro, { sessionId: 'newer0001', results: [{ id: 'item-1', title: 'x', summary: 'y' }] })).rejects.toThrow(/GITHUB_TOKEN/);

    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    const client = await connect(ctx);
    const r = (await client.callTool({
      name: 'bridge_write_drafts',
      arguments: { sessionId: 'newer0001', results: [{ id: 'item-1', title: 'Add a danger tone — for tables.', summary: 'Badge gets a danger tone. It marks destructive rows. One. Two.' }] },
    })) as any;
    expect(r.isError).toBeFalsy();
    const out = JSON.parse(r.content[0].text);
    expect(out.status).toBe('drafted');
    const saved = gh.read('newer0001');
    expect(saved.status).toBe('drafted');
    expect(saved.results).toMatchObject([{ id: 'item-1', title: 'Add a danger tone, for tables', summary: 'Badge gets a danger tone. It marks destructive rows. One.', by: 'claude' }]);
    expect(gh.puts.every((p) => p.path.startsWith('.bridge/drafts/'))).toBe(true);

    const bad = (await client.callTool({ name: 'bridge_write_drafts', arguments: { sessionId: 'newer0001', results: [{ id: 'item-9', title: 'x', summary: 'y' }] } })) as any;
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/no item "item-9"/);
    // Drafted sessions no longer show up as pending.
    expect((await drafts.pendingDrafts(ctx, {})).answer.sessions).toEqual([]);
    await client.close();
  });

  it('retries on 409 with the fresh file, keeping what the plugin wrote meanwhile', async () => {
    const gh = withDrafts({ raceOnce: true });
    gh.seed(session('newer0001', '2026-10-17T09:00:00Z'));
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    const out = await drafts.writeDrafts(ctx, { sessionId: 'newer0001', results: [{ id: 'item-1', title: 'Add a danger tone', summary: 'For tables.' }] });
    expect(out.status).toBe('drafted');
    expect(gh.puts.map((p) => p.status)).toEqual([409, 200]);
    const saved = gh.read('newer0001');
    expect(saved.items[0]!.notes).toBe('Typed in Figma meanwhile');
    expect(saved.results![0]!.title).toBe('Add a danger tone');
  });

  it('partial results keep the session pending and say which items are left', async () => {
    const gh = withDrafts();
    gh.seed(session('multi0001', '2026-10-17T09:00:00Z', [item('item-1', 'multi0001', false), { ...item('item-2', 'multi0001', false), scope: 'push', component: undefined, kind: undefined, changes: [], variables: [{ path: 'color.text.muted', before: '#555555', after: '#444444' }] }]));
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    const out = await drafts.writeDrafts(ctx, { sessionId: 'multi0001', results: [{ id: 'item-1', title: 'Add a danger tone', summary: 'For tables.' }] });
    expect(out.status).toBe('pending');
    expect(out.waiting).toEqual(['item-2']);
    expect(out.next).toMatch(/item-2/);
  });
});
