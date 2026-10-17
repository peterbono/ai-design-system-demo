// New brands through the MCP ops: plan (dry run), propose to a local branch or a draft PR, never main.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { brand, BridgeContext } from '../dist/lib.js';
import { fakeGitHub, git, readTree, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

let dir: string;
let ctx: BridgeContext;
const ACME = { slug: 'acme', name: 'Acme', from: 'bridge', primary: '#1F5F3A', neutral: '#2A2F2C' };

beforeAll(async () => {
  dir = tempGitRepo(REPO, REAL_PATHS);
  ctx = await BridgeContext.create({ root: dir });
});

describe('brands', () => {
  it('lists the brands of the repo', async () => {
    const r = await brand.listBrands(ctx);
    expect(r.brands.map((b) => b.slug)).toEqual(['bridge', 'ocean']);
    expect(r.brands[0]!.default).toBe(true);
  });

  it('plan: ramps, every pair in light and dark, tier 3 minor, PR body with the New brand section', async () => {
    const p = await brand.planBrand(ctx, ACME);
    expect(p.ok).toBe(true);
    expect(p.tier).toBe(3);
    expect(p.bump).toBe('minor');
    expect(p.contrast.line).toMatch(/^All \d+ checks pass$/);
    expect(p.contrast.themes).toEqual(['light', 'dark']);
    expect(p.ramps.primary![700]).toBe('#1f5f3a');
    expect(p.files.map((f) => f.path)).toEqual(['packages/tokens/src/brands/acme.tokens.json', 'bridge.config.json', '.changeset/bridge-brand-acme.md']);
    expect(p.prBody).toContain('## New brand');
    expect(p.prBody).toMatch(/AI agent \(Claude\)/);
    expect(p.prBody).not.toMatch(/—/);
  });

  it('plan: a too-light primary fails white text on primary buttons, and propose is blocked', async () => {
    const p = await brand.planBrand(ctx, { ...ACME, slug: 'sunny', primary: '#8CC8FF' });
    expect(p.ok).toBe(false);
    expect(p.contrast.failing.map((f) => f.pair)).toContain('color.action.primary.text on color.action.primary.bg');
    const r = (await brand.proposeBrand(ctx, { ...ACME, slug: 'sunny', primary: '#8CC8FF' })) as any;
    expect(r.status).toBe('blocked');
    expect(r.hint).toMatch(/never opens a PR that breaks the gate/);
    expect(git(dir, 'branch', '--list', 'bridge/brand-sunny').trim()).toBe('');
  });

  it('propose (local): new bridge/brand-acme branch with the files, working tree and main untouched', async () => {
    const mainBefore = git(dir, 'rev-parse', 'main').trim();
    const r = (await brand.proposeBrand(ctx, { ...ACME, radius: 'balanced', fonts: { heading: 'fraunces', text: 'plex-sans' } })) as any;
    expect(r.status).toBe('branch-created');
    expect(r.branch).toBe('bridge/brand-acme');
    expect(git(dir, 'rev-parse', 'main').trim()).toBe(mainBefore);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git(dir, 'status', '--porcelain').trim()).toBe('');
    const changed = git(dir, 'diff', '--name-only', 'main', 'bridge/brand-acme').trim().split('\n').sort();
    expect(changed).toEqual(['.changeset/bridge-brand-acme.md', 'bridge.config.json', 'packages/tokens/src/brands/acme.tokens.json']);
    expect(git(dir, 'show', 'bridge/brand-acme:bridge.config.json')).toContain('"values": ["bridge", "ocean", "acme"]');
    const doc = JSON.parse(git(dir, 'show', 'bridge/brand-acme:packages/tokens/src/brands/acme.tokens.json'));
    expect(doc.radius.control.$value).toBe('{radius.lg}');
    expect(git(dir, 'log', '-1', '--format=%B', 'bridge/brand-acme')).toMatch(/Tier 3\. Proposed through Bridge MCP \(source: mcp\)\./);
    // The working copy still has no acme file.
    expect(() => readFileSync(join(dir, 'packages/tokens/src/brands/acme.tokens.json'))).toThrow();
    // A second proposal gets a suffixed branch.
    const again = (await brand.proposeBrand(ctx, ACME)) as any;
    expect(again.branch).toBe('bridge/brand-acme-2');
  });

  it('propose (GitHub with a token): draft PR labelled source: mcp, tier: 3 and tokens; main untouched', async () => {
    const gh = fakeGitHub('acme', 'ds', readTree(REPO, REAL_PATHS));
    const mainBefore = gh.refs.get('main');
    const remote = await BridgeContext.create({ repo: 'acme/ds', token: 'test-token', fetch: gh.fetch });
    const r = (await brand.proposeBrand(remote, ACME)) as any;
    expect(r.status).toBe('pr-opened');
    expect(r.draft).toBe(true);
    expect(r.labels).toEqual(['source: mcp', 'tier: 3', 'tokens']);
    expect(gh.refs.get('main')).toBe(mainBefore);
    expect(gh.fileAt('bridge/brand-acme', 'packages/tokens/src/brands/acme.tokens.json')).toContain('"name": "Acme"');
    expect(gh.pulls[0]!.body).toContain('## New brand');
    // Without a token: a preview, nothing written.
    const gh2 = fakeGitHub('acme', 'ds', readTree(REPO, REAL_PATHS));
    const ro = await BridgeContext.create({ repo: 'acme/ds', fetch: gh2.fetch });
    expect(((await brand.proposeBrand(ro, ACME)) as any).status).toBe('preview');
    expect(gh2.log.filter((l) => l.method !== 'GET')).toEqual([]);
  });
});
