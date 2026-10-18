// bridge_visual_impact in plan mode: impact selection from real git refs (no build, no browser), over the
// built library, the stdio server and the CLI.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BridgeContext, ops } from '../dist/lib.js';
import { CLI, git, MCP_DIST, pinValue, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

let dir: string;
const BRAND = 'packages/tokens/src/brands/bridge.tokens.json';

beforeAll(() => {
  dir = tempGitRepo(REPO, REAL_PATHS);
  git(dir, 'checkout', '-q', '-b', 'bridge/darker-danger');
  // Change the bridge danger role to another shade, derived from its live value so it is always a real change.
  const text = readFileSync(join(dir, BRAND), 'utf8');
  const current = JSON.parse(text).palette.danger['600'].$value as string;
  const next = ['{color.crimson.700}', '{color.crimson.800}'].find((v) => v !== current)!;
  writeFileSync(join(dir, BRAND), pinValue(text, ['palette', 'danger', '600'], next));
  git(dir, 'commit', '-qam', 'darker danger');
});

describe('visual impact plan', () => {
  it('selects the components that read changed tokens, the app, and only the bridge brand modes', async () => {
    const ctx = await BridgeContext.create({ root: dir });
    const r = (await ops.visualImpact(ctx, { base: 'main', head: 'bridge/darker-danger', plan: true, out: 'out-plan' })) as any;
    expect(r.counts.shots).toBe(0);
    expect(r.selection.directTokens).toEqual(['palette.danger.600']);
    expect(r.selection.components.map((c: any) => c.id)).toContain('Button');
    expect(r.selection.components.find((c: any) => c.id === 'Button').why).toMatch(/^uses --/);
    expect(r.selection.stories).toBeGreaterThan(0);
    expect(r.selection.app).toEqual({ include: true, reason: expect.stringMatching(/token values? changed/) });
    expect(r.next).toMatch(/^Plan only/);
    const manifest = JSON.parse(readFileSync(r.manifest, 'utf8'));
    expect(manifest.selection.tokens.every((t: any) => t.modes.every((m: string) => m.includes('brand=bridge')))).toBe(true);
    expect(manifest.base.sha).toBe(git(dir, 'rev-parse', 'main').trim());
  });

  it('runs from the CLI with --plan --json', () => {
    const p = spawnSync(process.execPath, [CLI, 'impact', '--base', 'main', '--head', 'bridge/darker-danger', '--plan', '--json', '--out', join(dir, 'out-cli')], { cwd: dir, encoding: 'utf8' });
    expect(p.status, p.stderr).toBe(0);
    const out = JSON.parse(p.stdout);
    expect(out.shots).toBe(0);
    expect(out.selection.components.map((c: any) => c.id)).toContain('Button');
    expect(spawnSync(process.execPath, [CLI, 'impact', '--only', 'pixels', '--plan'], { cwd: dir, encoding: 'utf8' }).status).toBe(2);
  });
});

describe('bridge_visual_impact over stdio', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ name: 'bridge-visual', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(MCP_DIST, 'index.js'), '--root', dir], stderr: 'ignore' }));
  });
  afterAll(async () => {
    await client?.close();
  });

  it('returns the summary and the manifest path', async () => {
    const r: any = await client.callTool({ name: 'bridge_visual_impact', arguments: { base: 'main', head: 'bridge/darker-danger', plan: true, out: 'out-mcp' } });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0].text);
    expect(body.summary).toMatch(/^Plan: \d+ stories in 4 modes and 24 app screens/);
    expect(body.manifest).toBe(join(dir, 'out-mcp', 'manifest.json'));
  });
});
