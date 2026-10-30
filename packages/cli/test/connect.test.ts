// bridge connect: run once in a product repository, it writes .mcp.json, .bridge/product.json and a Bridge section in
// CLAUDE.md (or AGENTS.md), idempotent and without overwriting what the team wrote; then bridge explore works there.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bridgeSection, mergeMcpJson, mergeSection, runConnect, SECTION_END, SECTION_START, toolbarSetup } from '../src/connect.js';
import { runExplore } from '../src/explore.js';
import type { RequestIO } from '../src/request.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from '../../mcp/test/helpers.js';

function ds() {
  const tree = readTree(REPO, REAL_PATHS);
  const cfg = JSON.parse(tree['bridge.config.json']!);
  cfg.products = [
    { key: 'shop', name: 'Demo shop', repo: 'acme/shop' },
    { key: 'library', name: 'Library', default: true },
  ];
  const gh = fakeGitHub('acme', 'ds', { ...tree, 'bridge.config.json': `${JSON.stringify(cfg, null, 2)}\n` });
  const shop = fakeGitHub('acme', 'shop', { 'package.json': '{}' });
  const body = `<!-- bridge-exploration ${JSON.stringify({ name: 'Wishlist button', purpose: '', slug: 'wishlist-button' })} -->`;
  shop.refs.set('explore/wishlist-button', shop.refs.get('main')!);
  shop.pulls.push({ number: 1, node_id: 'PR_1', title: 'Exploration: Wishlist button', body, state: 'open', draft: true, user: { login: 'ann' }, head: { ref: 'explore/wishlist-button', sha: shop.refs.get('main')! }, base: { ref: 'main' }, labels: [{ name: 'exploration' }], html_url: 'https://github.com/acme/shop/pull/1', updated_at: '2026-10-29T00:00:00Z' });
  const fetch = ((url: string, init?: RequestInit) => (String(url).includes('/repos/acme/shop') ? shop.fetch(url, init) : gh.fetch(url, init))) as typeof globalThis.fetch;
  return { fetch };
}

function io(fetch: typeof globalThis.fetch) {
  const out: string[] = [];
  const err: string[] = [];
  const value: RequestIO = { print: (s) => out.push(s), error: (s) => err.push(s), env: {}, fetch, ghToken: () => undefined, hasClaude: () => false, runClaude: () => 0 };
  return { io: value, out: () => out.join('\n'), err: () => err.join('\n') };
}

const args = (...argv: string[]) => {
  const a = { _: [] as string[], flags: {} as Record<string, string[]> };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x.startsWith('--')) {
      const k = x.slice(2);
      const next = argv[i + 1];
      (a.flags[k] ??= []).push(next !== undefined && !next.startsWith('--') && !['json', 'dry-run', 'force', 'no-checkout'].includes(k) ? argv[++i]! : 'true');
    } else a._.push(x);
  }
  return a;
};

function productRepo(origin = 'https://github.com/acme/shop.git'): string {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir });
  return dir;
}

const read = (dir: string, p: string) => readFileSync(join(dir, p), 'utf8');

describe('bridge connect', () => {
  it('writes the three files, finds the product from the origin, and a second run changes nothing', async () => {
    const { fetch } = ds();
    const dir = productRepo();
    const first = io(fetch);
    expect(await runConnect(args('connect', '--ds', 'acme/ds'), dir, first.io)).toBe(0);
    expect(first.out()).toContain('Connected Demo shop (shop) to the design system acme/ds.');
    expect(first.out()).toContain('Created .mcp.json: the Bridge MCP server');
    expect(first.out()).toContain('Created .bridge/product.json');
    expect(first.out()).toContain('Created CLAUDE.md');
    expect(JSON.parse(read(dir, '.mcp.json'))).toEqual({ mcpServers: { bridge: { command: 'npx', args: ['-y', '@bridge-ds/mcp', '--repo', 'acme/ds'] } } });
    expect(JSON.parse(read(dir, '.bridge/product.json'))).toEqual({ version: 1, designSystem: 'acme/ds', product: 'shop' });
    const claude = read(dir, 'CLAUDE.md');
    expect(claude).toContain('bridge_start_exploration');
    expect(claude).toContain('No brief');
    expect(claude).toContain('the designer picks the pieces');
    expect(claude).not.toContain(String.fromCharCode(0x2014));
    // The same link in this clone's git config, for branches made before the files are committed.
    expect(execFileSync('git', ['config', '--local', '--get', 'bridge.product'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('shop');

    const second = io(fetch);
    expect(await runConnect(args('connect', '--ds', 'acme/ds'), dir, second.io)).toBe(0);
    expect(second.out()).toContain('Unchanged .mcp.json');
    expect(second.out()).toContain('Unchanged CLAUDE.md');
    expect(second.out()).toContain('Already connected, nothing changed.');
    expect(read(dir, 'CLAUDE.md')).toBe(claude);
  });

  it('keeps the team content: other servers, its CLAUDE.md, a different bridge server unless --force', async () => {
    const { fetch } = ds();
    const dir = productRepo();
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' }, bridge: { command: 'node', args: ['mine.js'] } }, extra: 1 }));
    writeFileSync(join(dir, 'CLAUDE.md'), '# Shop\n\nOur rules.\n');
    const r = io(fetch);
    expect(await runConnect(args('connect', '--ds', 'acme/ds'), dir, r.io)).toBe(0);
    expect(r.out()).toContain('Kept .mcp.json');
    expect(r.err()).toContain('already has a "bridge" server that does not name acme/ds');
    expect(JSON.parse(read(dir, '.mcp.json')).mcpServers.bridge).toEqual({ command: 'node', args: ['mine.js'] });
    expect(read(dir, 'CLAUDE.md')).toMatch(/^# Shop\n\nOur rules\.\n\n<!-- bridge:start -->/);

    expect(await runConnect(args('connect', '--ds', 'acme/ds', '--force'), dir, io(fetch).io)).toBe(0);
    expect(JSON.parse(read(dir, '.mcp.json'))).toMatchObject({ extra: 1, mcpServers: { other: { command: 'x' }, bridge: { args: ['-y', '@bridge-ds/mcp', '--repo', 'acme/ds'] } } });
  });

  it('only AGENTS.md: the section goes there; --dry-run writes nothing; mistakes say how to fix them', async () => {
    const { fetch } = ds();
    const dir = productRepo('https://github.com/acme/elsewhere.git');
    writeFileSync(join(dir, 'AGENTS.md'), 'Agents.\n');
    await expect(runConnect(args('connect', '--ds', 'acme/ds'), dir, io(fetch).io)).rejects.toThrow(/No product in acme\/ds has this repository \(acme\/elsewhere\).*--product <key>: shop \(Demo shop\), library/);
    await expect(runConnect(args('connect', '--ds', 'acme/ds', '--product', 'nope'), dir, io(fetch).io)).rejects.toThrow(/has no product "nope"/);
    await expect(runConnect(args('connect'), dir, io(fetch).io)).rejects.toThrow(/Usage: bridge connect --ds <owner\/name>/);

    const dry = io(fetch);
    expect(await runConnect(args('connect', '--ds', 'https://github.com/acme/ds', '--product', 'shop', '--dry-run'), dir, dry.io)).toBe(0);
    expect(dry.out()).toContain('Dry run, nothing written. Would connect Demo shop (shop)');
    expect(dry.out()).toContain('Updated AGENTS.md');
    expect(dry.err()).toContain("this checkout's origin is acme/elsewhere");
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
    expect(read(dir, 'AGENTS.md')).toBe('Agents.\n');

    const ds2 = mkdtempSync(join(tmpdir(), 'bridge-test-'));
    writeFileSync(join(ds2, 'bridge.config.json'), '{}');
    await expect(runConnect(args('connect', '--ds', 'acme/ds'), ds2, io(fetch).io)).rejects.toThrow(/design system repository, not a product/);
  });

  it('then bridge explore works from the product repository: #1 is the shop exploration', async () => {
    const { fetch } = ds();
    const dir = productRepo();
    await runConnect(args('connect', '--ds', 'acme/ds'), dir, io(fetch).io);
    const c = io(fetch);
    expect(await runExplore(args('explore', 'continue', '#1', '--no-checkout'), dir, c.io)).toBe(0);
    expect(c.out()).toMatch(/^shop#1 Wishlist button \(Demo shop\): /);
    const l = io(fetch);
    expect(await runExplore(args('explore', 'list'), dir, l.io)).toBe(0);
    expect(l.out()).toContain('shop#1 Wishlist button  Running  explore/wishlist-button in acme/shop');
  });
});

describe('connect merges', () => {
  it('replaces only its own section between the markers', () => {
    const section = bridgeSection({ designSystem: 'acme/ds', product: { key: 'shop', name: 'Shop' } });
    const old = `# Mine\n\n${SECTION_START}\nold\n${SECTION_END}\n\nAfter.\n`;
    expect(mergeSection(old, section)).toBe(`# Mine\n\n${section}\n\nAfter.\n`);
    expect(mergeSection(null, section)).toBe(`${section}\n`);
    expect(section).toContain('- Mark each new or changed area of the UI with data-bridge-change="<short plain label>"');
    expect(mergeMcpJson(null, 'acme/ds').change).toBe('created');
    expect(() => mergeMcpJson('{', 'acme/ds')).toThrow(/not valid JSON/);
  });
});

describe('the Bridge toolbar in a React product', () => {
  const x = { designSystem: 'acme/ds', product: 'shop' };

  it('prints the install and the one-line mount for a React product without it, and nothing to install once it is there', () => {
    expect(toolbarSetup('{"dependencies":{"react":"18.3.1"}}', x)).toEqual({
      state: 'suggested',
      lines: ['npm i @bridge-ds/toolbar', "import { BridgeToolbar } from '@bridge-ds/toolbar';", '<BridgeToolbar ds="acme/ds" product="shop" />'],
    });
    expect(toolbarSetup('{"dependencies":{"react":"18.3.1","@bridge-ds/toolbar":"^0.1.0"}}', x).state).toBe('installed');
    expect(toolbarSetup(null, { ...x, framework: 'react' }).state).toBe('suggested');
  });

  it('says nothing for a product that is not React, or a package.json it cannot read', () => {
    expect(toolbarSetup('{"dependencies":{"vue":"3.5.0"}}', x)).toEqual({ state: 'none', lines: [] });
    expect(toolbarSetup('not json', { ...x, framework: 'vue' }).state).toBe('none');
  });

  it('prints the mount in a React product repository and warns when the product has no production URL', async () => {
    const { fetch } = ds();
    const dir = productRepo();
    writeFileSync(join(dir, 'package.json'), '{"dependencies":{"react":"18.3.1"}}');
    const c = io(fetch);
    await runConnect(args('connect', '--ds', 'acme/ds'), dir, c.io);
    expect(c.out()).toContain("Before and after in Demo shop (Studio's Try it in the product)");
    expect(c.out()).toContain('  <BridgeToolbar ds="acme/ds" product="shop" />');
    expect(c.err()).toContain('Demo shop has no "production" URL');
    expect(read(dir, 'package.json')).toBe('{"dependencies":{"react":"18.3.1"}}');
  });
});
