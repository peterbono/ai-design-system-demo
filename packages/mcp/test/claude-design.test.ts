// The Bridge Library in Claude Design: bridge_get_claude_design_system hands the team's Claude the version the site
// serves, a manifest (path, size, sha256, url) and the steps; bridge_set_claude_design_system_url remembers the
// team's artifact, for admins and leads only, checked on the server.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BridgeContext, claudeDesign, createServer, type TeamClaudeDesign, type WhoAmI } from '../src/lib.js';
import { FIXTURE } from './helpers.js';

const SITE = 'https://bridge.test';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const FILES: Record<string, string> = {
  'project/README.md': '# Bridge Library\n',
  'project/components/bundle.js': 'window.Bridge={};',
  'project/tokens.css': ':root{--x:1}',
  'project/design-system.json': '{"v":3}',
};

function manifestOf(version: string, files = FILES) {
  const list = Object.entries(files).map(([path, text]) => ({ path, size: Buffer.byteLength(text), sha256: sha(text) }));
  return { format: 1, name: 'Bridge Library', package: '@bridge-ds/react', version, revision: 'abc1234', base: `/claude-design-system/${version}/`, count: list.length, bytes: list.reduce((n, f) => n + f.size, 0), files: list };
}

/** The site: the manifest and the files of one version. */
function site(version: string, files = FILES) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (url === `${SITE}/claude-design-system/manifest.json`) return new Response(JSON.stringify(manifestOf(version, files)), { status: 200 });
    const prefix = `${SITE}/claude-design-system/${version}/`;
    if (url.startsWith(prefix) && files[url.slice(prefix.length)] !== undefined) return new Response(files[url.slice(prefix.length)], { status: 200 });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const who = (role: WhoAmI['role']): (() => Promise<WhoAmI>) => async () => ({ name: 'Ana', role, via: 'github', team: 'Acme DS', writes: 'own' });

async function connect(opts: { role?: WhoAmI['role']; version?: string; files?: Record<string, string>; kept?: TeamClaudeDesign | null; noSetting?: boolean; readFails?: boolean }) {
  const store: { value: TeamClaudeDesign | null } = { value: opts.kept ?? null };
  const s = site(opts.version ?? '1.8.4', opts.files);
  const ctx = await BridgeContext.create({
    root: FIXTURE,
    identity: who(opts.role ?? 'Admin'),
    claudeDesign: {
      site: `${SITE}/`,
      fetch: s.fetch,
      ...(opts.noSetting
        ? {}
        : {
            read: async () => {
              if (opts.readFails) throw new Error('redis down');
              return store.value;
            },
            save: async (v: TeamClaudeDesign) => {
              store.value = v;
            },
          }),
    },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(ctx).connect(a);
  const client = new Client({ name: 'claude-design-test', version: '0.0.0' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]!.text;
    return { error: Boolean(r.isError), text, data: r.isError ? null : (JSON.parse(text) as Record<string, any>) };
  };
  return { call, store, calls: s.calls, close: () => client.close() };
}

describe('bridge_get_claude_design_system', () => {
  it('answers the version, the manifest with a url per file, and the steps to create the artifact the first time', async () => {
    const s = await connect({});
    const { data } = await s.call('bridge_get_claude_design_system');
    expect(Object.keys(data!).sort()).toEqual(['action', 'base', 'changed', 'instructions', 'manifest', 'name', 'package', 'removed', 'revision', 'team', 'teamKnown', 'version']);
    expect(data).toMatchObject({ name: 'Bridge Library', package: '@bridge-ds/react', version: '1.8.4', revision: 'abc1234', base: `${SITE}/claude-design-system/1.8.4/`, team: null, action: 'create', teamKnown: true, removed: [] });
    expect(data!.manifest).toMatchObject({ url: `${SITE}/claude-design-system/manifest.json`, count: 4 });
    const readme = data!.manifest.files.find((f: { path: string }) => f.path === 'project/README.md');
    expect(readme).toEqual({ path: 'project/README.md', size: 17, sha256: sha(FILES['project/README.md']!), url: `${SITE}/claude-design-system/1.8.4/project/README.md` });
    expect(data!.changed).toHaveLength(4);
    expect(data!.instructions).toMatch(/Design System type/);
    expect(data!.instructions).toMatch(/bridge_set_claude_design_system_url/);
    expect(data!.instructions).toMatch(/project\/design-system\.json last/);
    expect(data!.instructions).not.toMatch(/—/);
    await s.close();
  });

  it('gives the same manifest for the same version, call after call', async () => {
    const s = await connect({});
    const one = await s.call('bridge_get_claude_design_system');
    const two = await s.call('bridge_get_claude_design_system');
    expect(two.text).toBe(one.text);
    await s.close();
  });

  it('after an update, lists only the files whose sha256 changed and the ones gone, for the same artifact', async () => {
    const before = manifestOf('1.8.3', { ...FILES, 'project/old.md': 'gone' });
    const kept: TeamClaudeDesign = { url: 'https://claude.ai/artifact/YZ1z4WxSWErcMHVDcbFmkW', version: '1.8.3', files: Object.fromEntries(before.files.map((f) => [f.path, f.sha256])), at: '2026-11-01T00:00:00.000Z' };
    const s = await connect({ version: '1.8.4', files: { ...FILES, 'project/components/bundle.js': 'window.Bridge={v:2};' }, kept });
    const { data } = await s.call('bridge_get_claude_design_system');
    expect(data).toMatchObject({ action: 'update', changed: ['project/components/bundle.js'], removed: ['project/old.md'], team: { url: kept.url, version: '1.8.3' } });
    expect(data!.instructions).toContain(kept.url);
    expect(data!.instructions).toMatch(/ONLY the files listed in "changed"/);
    expect(data!.instructions).toMatch(/re-run its install at version 1\.8\.4/);
    await s.close();
  });

  it('says there is nothing to publish when the team already has this version', async () => {
    const m = manifestOf('1.8.4');
    const kept: TeamClaudeDesign = { url: 'https://claude.ai/artifact/YZ1z4WxSWErcMHVDcbFmkW', version: '1.8.4', files: Object.fromEntries(m.files.map((f) => [f.path, f.sha256])), at: '2026-11-04T00:00:00.000Z' };
    const s = await connect({ kept });
    const { data } = await s.call('bridge_get_claude_design_system');
    expect(data).toMatchObject({ action: 'none', changed: [], removed: [] });
    await s.close();
  });

  it('inlines small files on request and refuses paths outside the manifest', async () => {
    const s = await connect({});
    const { data } = await s.call('bridge_get_claude_design_system', { inline: ['project/README.md'] });
    expect(data!.files).toEqual({ 'project/README.md': FILES['project/README.md'] });
    const bad = await s.call('bridge_get_claude_design_system', { inline: ['../secrets'] });
    expect(bad.error).toBe(true);
    expect(bad.text).toMatch(/Not in the manifest/);
    await s.close();
  });

  it.each(['Can edit', 'Reader'] as const)('asks a %s to get an admin or lead to add it, never to create a second artifact', async (role) => {
    const s = await connect({ role });
    const { data } = await s.call('bridge_get_claude_design_system');
    expect(data).toMatchObject({ team: null, action: 'ask', teamKnown: true });
    expect(data!.instructions).toMatch(/ask an admin or lead/);
    expect(data!.instructions).toMatch(/Do not create one/);
    expect(data!.instructions).toMatch(/base URL/);
    expect(data!.instructions).not.toMatch(/—/);
    await s.close();
  });

  it('a Can edit member still gets the team artifact once an admin saved it', async () => {
    const m = manifestOf('1.8.4');
    const kept: TeamClaudeDesign = { url: 'https://claude.ai/artifact/YZ1z4WxSWErcMHVDcbFmkW', version: '1.8.4', files: Object.fromEntries(m.files.map((f) => [f.path, f.sha256])), at: '2026-11-04T00:00:00.000Z' };
    const s = await connect({ role: 'Can edit', kept });
    const { data } = await s.call('bridge_get_claude_design_system');
    expect(data).toMatchObject({ team: { url: kept.url }, action: 'none' });
    await s.close();
  });

  it('where the server keeps no team settings (the local server), says it cannot tell rather than "create"', async () => {
    const s = await connect({ noSetting: true });
    const { data } = await s.call('bridge_get_claude_design_system');
    expect(data).toMatchObject({ team: null, action: 'unknown', teamKnown: false });
    expect(data!.instructions).toMatch(/never create a second one/);
    expect(data!.instructions).toMatch(/Bridge connector/);
    await s.close();
  });

  it('says so when the team setting cannot be read, instead of asking for a new artifact', async () => {
    const s = await connect({ readFails: true });
    const r = await s.call('bridge_get_claude_design_system');
    expect(r.error).toBe(true);
    expect(r.text).toContain(claudeDesign.CLAUDE_DESIGN_WORDS.settingUnreadable);
    await s.close();
  });

  it('refuses a manifest it cannot trust', () => {
    expect(claudeDesign.parseManifest({ ...manifestOf('1.8.4'), files: [{ path: '../x', size: 1, sha256: sha('x') }] })).toBeNull();
    expect(claudeDesign.parseManifest({ format: 2 })).toBeNull();
    expect(claudeDesign.parseManifest(manifestOf('1.8.4'))).toMatchObject({ version: '1.8.4', count: 4 });
  });
});

describe('bridge_set_claude_design_system_url', () => {
  const url = 'https://claude.ai/artifact/YZ1z4WxSWErcMHVDcbFmkW';

  it.each(['Admin', 'Reviewer'] as const)('saves the artifact, the version and the published hashes for a team %s', async (role) => {
    const s = await connect({ role });
    const r = await s.call('bridge_set_claude_design_system_url', { url, version: '1.8.4' });
    expect(r.error).toBe(false);
    expect(r.data).toMatchObject({ saved: { url, version: '1.8.4', revision: 'abc1234', by: 'Ana' }, files: 4 });
    expect(s.store.value?.files?.['project/README.md']).toBe(sha(FILES['project/README.md']!));
    await s.close();
  });

  it.each(['Can edit', 'Reader'] as const)('refuses a %s and keeps nothing', async (role) => {
    const s = await connect({ role });
    const r = await s.call('bridge_set_claude_design_system_url', { url });
    expect(r.error).toBe(true);
    expect(r.text).toContain(claudeDesign.CLAUDE_DESIGN_WORDS.notAllowed);
    expect(s.store.value).toBeNull();
    await s.close();
  });

  it('refuses an address that is not a Claude artifact, and a version the site no longer serves', async () => {
    const s = await connect({});
    expect((await s.call('bridge_set_claude_design_system_url', { url: 'https://evil.example/artifact/abcdef' })).text).toContain(claudeDesign.CLAUDE_DESIGN_WORDS.badUrl);
    expect((await s.call('bridge_set_claude_design_system_url', { url, version: '1.8.3' })).text).toMatch(/serves the Library 1\.8\.4 now/);
    expect(s.store.value).toBeNull();
    await s.close();
  });

  it('says so where the server keeps no team settings (the local server)', async () => {
    const s = await connect({ noSetting: true });
    expect((await s.call('bridge_set_claude_design_system_url', { url })).text).toContain(claudeDesign.CLAUDE_DESIGN_WORDS.noSetting);
    await s.close();
  });
});
