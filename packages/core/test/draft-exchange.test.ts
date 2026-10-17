// Draft exchange: the pending drafts file the Figma plugin writes and the Bridge MCP server answers, on the requests
// branch. Pure helpers, then the GitHub helpers over a contents API in memory (sha checks, 409 retry, cleanup).
import { describe, expect, it } from 'vitest';
import {
  DRAFTS_DIR,
  type DraftItem,
  type FetchLike,
  GitHubClient,
  REQUESTS_BRANCH,
  composePendingDrafts,
  createPendingDrafts,
  deletePendingDrafts,
  draftImagePath,
  draftItemBrief,
  draftSessionPath,
  listPendingDrafts,
  mergeDraftResults,
  newDraftSessionId,
  parsePendingDrafts,
  readPendingDrafts,
  sanitizeDraftText,
  serializePendingDrafts,
  validatePendingDrafts,
  writeDraftResults,
} from '../src/index';

const EM = '—';

const item: DraftItem = {
  id: 'item-1',
  scope: 'request',
  component: 'Badge',
  kind: 'new-variant',
  changes: [{ field: 'Variant Tone', before: 'info, neutral', after: 'danger, info, neutral' }],
  notes: 'For destructive states in tables.',
  images: [
    { label: 'before', url: 'https://github.com/o/r/blob/bridge-requests/.bridge/drafts/s/item-1-before.png?raw=true', path: '.bridge/drafts/s/item-1-before.png' },
    { label: 'after', url: 'https://github.com/o/r/blob/bridge-requests/.bridge/drafts/s/item-1-after.png?raw=true' },
  ],
  draft: { title: 'Add a danger tone', summary: 'Badge gets a new Tone value, danger.' },
};

const push: DraftItem = {
  id: 'item-2',
  scope: 'push',
  changes: [],
  variables: [{ path: 'color.text.muted', before: '#555555', after: '#444444' }],
  components: ['Badge'],
  draft: { title: 'Darken muted text', summary: 'Changes color.text.muted.' },
};

const NOW = new Date('2026-10-17T09:00:00Z');

describe('pure helpers', () => {
  it('session ids are random, file-safe and validated', () => {
    const id = newDraftSessionId();
    expect(id).toMatch(/^[a-z0-9]{16}$/);
    expect(newDraftSessionId()).not.toBe(id);
    expect(newDraftSessionId(() => 0)).toBe('0000000000000000');
    expect(draftSessionPath('abc123def')).toBe('.bridge/drafts/abc123def.json');
    expect(() => draftSessionPath('../main')).toThrow(/not a draft session id/);
    expect(draftImagePath('abc123def', 'Item 1', 'before')).toBe('.bridge/drafts/abc123def/item-1-before.png');
  });

  it('compose, serialize and parse round trip; invalid sessions are refused', () => {
    const p = composePendingDrafts({ items: [item, push], sessionId: 'session01', now: NOW });
    expect(p).toMatchObject({ version: 1, sessionId: 'session01', createdAt: NOW.toISOString(), status: 'pending', source: 'figma' });
    expect(parsePendingDrafts(serializePendingDrafts(p))).toEqual(p);
    expect(parsePendingDrafts('not json')).toBeUndefined();
    expect(parsePendingDrafts(JSON.stringify({ ...p, version: 2 }))).toBeUndefined();
    expect(() => composePendingDrafts({ items: [] })).toThrow(/at least one item/);
    expect(() => composePendingDrafts({ items: [item, item] })).toThrow(/repeats the id/);
    expect(validatePendingDrafts({ ...p, items: [{ ...item, variables: [{ path: 'x' }] }] })).toEqual(['Item 1: only a push item has variables.']);
    expect(validatePendingDrafts({ ...p, items: [{ ...item, kind: 'nope' }] })).toEqual(['Item 1: unknown kind "nope".']);
    expect(validatePendingDrafts({ ...p, items: [{ ...item, images: [{ label: 'side', url: 'x' }] }] })).toHaveLength(1);
  });

  it('sanitize: no em dash, title at most 70 characters without a period, summary at most 3 sentences', () => {
    const long = 'Add a quieter danger tone for destructive states in dense data tables and toolbars everywhere';
    const s = sanitizeDraftText({ title: `${long}.`, summary: `One ${EM} two. Three. Four. Five.` });
    expect(s.title.length).toBeLessThanOrEqual(70);
    expect(s.title).not.toMatch(/\.$/);
    expect(s.summary).toBe('One, two. Three. Four.');
    expect(`${s.title}${s.summary}`).not.toContain(EM);
    expect(sanitizeDraftText({ title: 3, summary: null })).toEqual({ title: '', summary: '' });
  });

  it('merge: sanitized results replace earlier ones; drafted once every item has one; unknown ids refused', () => {
    const p = composePendingDrafts({ items: [item, push], sessionId: 'session01', now: NOW });
    const one = mergeDraftResults(p, [{ id: 'item-1', title: `Add a danger tone ${EM} for tables.`, summary: 'Badge gets danger.' }], NOW);
    expect(one.status).toBe('pending');
    expect(one.results).toEqual([{ id: 'item-1', title: 'Add a danger tone, for tables', summary: 'Badge gets danger.', by: 'claude', at: NOW.toISOString() }]);
    const both = mergeDraftResults(one, [{ id: 'item-2', title: 'Darken muted text', summary: 'Muted text reads better.' }, { id: 'item-1', title: 'Add a danger tone', summary: 'Better.' }], NOW);
    expect(both.status).toBe('drafted');
    expect(both.results!.map((r) => [r.id, r.title])).toEqual([['item-1', 'Add a danger tone'], ['item-2', 'Darken muted text']]);
    expect(() => mergeDraftResults(p, [{ id: 'item-9', title: 'x', summary: 'y' }])).toThrow(/no item "item-9".*item-1, item-2/);
    expect(() => mergeDraftResults(p, [{ id: 'item-1', title: '', summary: '' }])).toThrow(/no title and no summary/);
  });

  it('change lines: sanitized per line id, unknown ids refused, results without lines still work', () => {
    const withLines: DraftItem = { ...item, lines: [{ id: '12:34', component: 'Badge', kind: 'new-variant', changes: item.changes, line: 'Danger added to Tone' }] };
    const p = composePendingDrafts({ items: [withLines, push], sessionId: 'session02', now: NOW });
    const long = `Icon added after the label ${EM} primary sm: Pencil, 16px. ${'and more words '.repeat(12)}`;
    const out = mergeDraftResults(p, [{ id: 'item-1', title: 'Add a danger tone', summary: 'Badge gets danger.', lines: [{ id: '12:34', line: long }] }, { id: 'item-2', title: 'Darken muted text', summary: 'Better.' }], NOW);
    const line = out.results![0]!.lines![0]!.line;
    expect(line.startsWith('Icon added after the label, primary sm: Pencil, 16px')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(120);
    expect(line).not.toMatch(/\u2014|\.$/);
    expect(out.results![1]!.lines).toBeUndefined();
    expect(out.status).toBe('drafted');
    expect(parsePendingDrafts(JSON.stringify(out))).toBeDefined();
    expect(mergeDraftResults(p, [{ id: 'item-1', title: '', summary: '', lines: [{ id: '12:34', line: 'Danger tone added' }] }], NOW).results![0]!.lines).toEqual([{ id: '12:34', line: 'Danger tone added' }]);
    expect(() => mergeDraftResults(p, [{ id: 'item-1', title: 'x', summary: 'y', lines: [{ id: '99:1', line: 'x' }] }])).toThrow(/no change line "99:1".*12:34/);
    expect(() => mergeDraftResults(p, [{ id: 'item-2', title: 'x', summary: 'y', lines: [{ id: '12:34', line: 'x' }] }])).toThrow(/lists no lines/);
    const brief = draftItemBrief(withLines);
    expect(brief).toMatch(/Change lines to write/);
    expect(brief).toMatch(/Line 12:34, Badge \(New variant\)\. Starting line: Danger added to Tone/);
  });

  it('change lines carry the request title: sanitized to the title contract, optional, a title alone is enough', () => {
    const withLines: DraftItem = { ...item, lines: [{ id: '12:34', component: 'Button', kind: 'structure', changes: item.changes, line: 'New layer', title: 'Add a layer after Label' }] };
    const p = composePendingDrafts({ items: [withLines], sessionId: 'session03', now: NOW });
    const out = mergeDraftResults(p, [{ id: 'item-1', title: 'Add an icon', summary: 'S.', lines: [{ id: '12:34', line: 'Icon added after the label', title: `add an icon after the label ${EM} ${'for toolbars '.repeat(8)}.` }] }], NOW);
    const t = out.results![0]!.lines![0]!.title!;
    expect(t.startsWith('Add an icon after the label, for toolbars')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(70);
    expect(t).not.toMatch(/\u2014|\.$/);
    expect(parsePendingDrafts(JSON.stringify(out))).toBeDefined();
    expect(mergeDraftResults(p, [{ id: 'item-1', title: '', summary: '', lines: [{ id: '12:34', line: '', title: 'Add an icon after the label' }] }], NOW).results![0]!.lines).toEqual([{ id: '12:34', line: '', title: 'Add an icon after the label' }]);
    expect(draftItemBrief(withLines)).toMatch(/Starting title: Add a layer after Label/);
    expect(validatePendingDrafts({ ...p, items: [{ ...withLines, lines: [{ ...withLines.lines![0]!, title: 4 }] }] }).join(' ')).toMatch(/lines must be a list/);
  });

  it('brief: the change table, variables, starting draft, notes and image links', () => {
    const b = draftItemBrief(item);
    expect(b).toContain('Component: Badge');
    expect(b).toContain('Kind: New variant');
    expect(b).toContain('| Variant Tone | info, neutral | danger, info, neutral |');
    expect(b).toContain('Title: Add a danger tone');
    expect(b).toContain('For destructive states in tables.');
    expect(b).toContain('Images: before https://');
    const pb = draftItemBrief(push);
    expect(pb).toContain('| color.text.muted | #555555 | #444444 |');
    expect(pb).toContain('Components with a change request: Badge');
    expect(`${b}${pb}`).not.toContain(EM);
  });
});

// --- a contents API in memory: one branch, blob shas, 409 on a stale sha ------------------------------------------

function contents(opts: { raceOnce?: string } = {}) {
  const files = new Map<string, { content: string; sha: string }>();
  let n = 0;
  let race = opts.raceOnce;
  const calls: string[] = [];
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/repos\/o\/r\/contents\//, ''));
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${path}`);
    if (method === 'GET') {
      const f = files.get(path);
      if (f) return reply(200, { type: 'file', encoding: 'base64', content: f.content, sha: f.sha, size: f.content.length });
      const kids = [...files.entries()].filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
      const dirs = [...new Set([...files.keys()].filter((p) => p.startsWith(`${path}/`) && p.slice(path.length + 1).includes('/')).map((p) => p.slice(0, p.indexOf('/', path.length + 1))))];
      if (!kids.length && !dirs.length) return reply(404, { message: 'Not Found' });
      return reply(200, [...kids.map(([p, f]) => ({ name: p.split('/').pop(), path: p, type: 'file', sha: f.sha, size: 1 })), ...dirs.map((d) => ({ name: d.split('/').pop(), path: d, type: 'dir', sha: 'd', size: 0 }))]);
    }
    if (method === 'PUT') {
      const cur = files.get(path);
      if (race === path && cur) {
        // Someone else writes the file between our read and our write.
        race = undefined;
        const other = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
        other.items[0].notes = 'Edited elsewhere';
        files.set(path, { content: Buffer.from(JSON.stringify(other)).toString('base64'), sha: `s${++n}` });
      }
      const now = files.get(path);
      if (now && body.sha !== now.sha) return reply(409, { message: `${path} does not match ${body.sha}` });
      if (!now && body.sha) return reply(404, { message: 'Not Found' });
      if (now && !body.sha) return reply(422, { message: 'Invalid request. "sha" wasn\'t supplied.' });
      files.set(path, { content: body.content, sha: `s${++n}` });
      return reply(now ? 200 : 201, { commit: { sha: `c${n}` } });
    }
    if (method === 'DELETE') {
      const now = files.get(path);
      if (!now) return reply(404, { message: 'Not Found' });
      if (body.sha !== now.sha) return reply(409, { message: 'conflict' });
      files.delete(path);
      return reply(200, { commit: { sha: `c${++n}` } });
    }
    return reply(404, {});
  };
  const client = new GitHubClient('o/r', 'token', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
  const text = (p: string) => (files.has(p) ? Buffer.from(files.get(p)!.content, 'base64').toString('utf8') : undefined);
  return { client, files, calls, text };
}

describe('GitHub helpers', () => {
  it('create, list newest first, read with sha, write results, delete with images', async () => {
    const gh = contents();
    const older = composePendingDrafts({ items: [push], sessionId: 'older0001', now: new Date('2026-10-16T09:00:00Z') });
    const p = composePendingDrafts({ items: [item, push], sessionId: 'session01', now: NOW });
    await createPendingDrafts(gh.client, older);
    await createPendingDrafts(gh.client, p);
    gh.files.set(`${DRAFTS_DIR}/session01/item-1-before.png`, { content: 'iVBOR', sha: 'img1' });
    gh.files.set(`${DRAFTS_DIR}/broken.json`, { content: Buffer.from('{').toString('base64'), sha: 'x' });

    expect((await listPendingDrafts(gh.client)).map((x) => x.sessionId)).toEqual(['session01', 'older0001']);
    expect(await gh.client.getFileBase64(`${DRAFTS_DIR}/session01/item-1-before.png`, REQUESTS_BRANCH)).toEqual({ base64: 'iVBOR', size: 5 });
    const read = await readPendingDrafts(gh.client, 'session01');
    expect(read?.drafts).toEqual(p);
    expect(read?.sha).toMatch(/^s/);

    const done = await writeDraftResults(gh.client, 'session01', [{ id: 'item-1', title: 'Add a danger tone', summary: 'For tables.' }, { id: 'item-2', title: 'Darken muted text', summary: 'Reads better.' }], { now: NOW });
    expect(done.status).toBe('drafted');
    expect(parsePendingDrafts(gh.text(draftSessionPath('session01')))?.results).toHaveLength(2);
    expect((await listPendingDrafts(gh.client, { status: 'pending' })).map((x) => x.sessionId)).toEqual(['older0001']);

    expect(await deletePendingDrafts(gh.client, 'session01')).toBe(true);
    expect(gh.files.has(draftSessionPath('session01'))).toBe(false);
    expect(gh.files.has(`${DRAFTS_DIR}/session01/item-1-before.png`)).toBe(false);
    expect(await deletePendingDrafts(gh.client, 'session01')).toBe(false);
    expect(await readPendingDrafts(gh.client, 'session01')).toBeUndefined();
  });

  it('retries on 409 with the fresh file, keeping the other writer\'s change', async () => {
    const gh = contents({ raceOnce: draftSessionPath('session01') });
    await createPendingDrafts(gh.client, composePendingDrafts({ items: [item], sessionId: 'session01', now: NOW }));
    const out = await writeDraftResults(gh.client, 'session01', [{ id: 'item-1', title: 'Add a danger tone', summary: 'For tables.' }], { now: NOW });
    expect(out.items[0]!.notes).toBe('Edited elsewhere');
    expect(out.status).toBe('drafted');
    expect(gh.calls.filter((c) => c.startsWith('PUT')).length).toBe(3);
  });

  it('gives up after the attempts, and says when the session is gone', async () => {
    const gh = contents({ raceOnce: draftSessionPath('session01') });
    await createPendingDrafts(gh.client, composePendingDrafts({ items: [item], sessionId: 'session01', now: NOW }));
    await expect(writeDraftResults(gh.client, 'session01', [{ id: 'item-1', title: 'x', summary: 'y' }], { attempts: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(writeDraftResults(gh.client, 'nothere01', [{ id: 'item-1', title: 'x', summary: 'y' }])).rejects.toThrow(/sent or cancelled/);
  });

  it('a missing folder lists nothing; writes refuse protected branches', async () => {
    const gh = contents();
    expect(await listPendingDrafts(gh.client)).toEqual([]);
    await expect(createPendingDrafts(gh.client, composePendingDrafts({ items: [item], sessionId: 'session01' }), 'main')).rejects.toThrow(/protected/);
    await expect(gh.client.deleteFile({ path: 'a', branch: 'main', message: 'm', sha: 's' })).rejects.toThrow(/protected/);
  });
});
