// The bridge CLI, run as a real process.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planCssFixes } from '@bridge-ds/core/audit';
import { loadDesignSystem } from '@bridge-ds/core/node';
import { CLI, FIXTURE, git, REAL_PATHS, REPO, tempGitRepo } from '../../mcp/test/helpers.js';

const bridge = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BRIDGE_OFFLINE: '1' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('bridge CLI', () => {
  it('check passes on the real repo (exit 0)', () => {
    const r = bridge(REPO, 'check');
    expect(r.code).toBe(0);
    // Every pair in every brand x theme, derived from the live files: a new brand or pair needs no test edit.
    const config = JSON.parse(readFileSync(join(REPO, 'bridge.config.json'), 'utf8')) as { modes: Record<string, { values: string[] }>; contrast: { path: string } };
    const { pairs } = JSON.parse(readFileSync(join(REPO, config.contrast.path), 'utf8')) as { pairs: unknown[] };
    const checks = pairs.length * config.modes.brand!.values.length * config.modes.theme!.values.length;
    expect(r.out).toContain(`contrast: ${checks} checks, 0 failing`);
    expect(r.out).toMatch(/OK$/m);
  });

  it('check fails with exit 1 on a broken alias and a contrast failure, --json for CI', () => {
    const dir = tempGitRepo(FIXTURE, ['.']);
    const f = join(dir, 'design/tokens/theme/dark.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('{color.ink.100}', '{color.ink.900}').replace('{color.green.500}', '{color.nope}'));
    const r = bridge(dir, 'check');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/broken-alias\s+fg\.accent/);
    expect(r.out).toMatch(/fail\s+fg\.default on bg\.page \[theme=dark\]/);
    const j = bridge(dir, 'check', '--json');
    expect(j.code).toBe(1);
    expect(JSON.parse(j.out).ok).toBe(false);
  });

  it('exit 2 on usage errors', () => {
    expect(bridge(REPO, 'diff').code).toBe(2);
    expect(bridge(REPO, 'nope').code).toBe(2);
    expect(bridge(REPO).code).toBe(2);
  });

  it('--help and help print the usage and exit 0', () => {
    for (const args of [['--help'], ['help']]) {
      const r = bridge(REPO, ...args);
      expect(r.code).toBe(0);
      expect(r.out).toContain('Usage:');
    }
  });

  it('docs draft <Component>: pre-fill and prompt, --json for the docs-draft Action', () => {
    const r = bridge(REPO, 'docs', 'draft', 'Icon');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Icon: packages\/react\/src\/components\/Icon\/Icon\.docs\.json/);
    // Icon has docs (a Claude draft): nothing is missing, and the anatomy keeps the labels written there.
    expect(r.out).toMatch(/Missing prose: none/);
    const j = JSON.parse(bridge(REPO, 'docs', 'draft', 'IconButton', '--json').out);
    expect(j.path).toBe('packages/react/src/components/IconButton/IconButton.docs.json');
    expect(Object.keys(j.prefill.inheritedTokens)).toEqual(['Button']);
    expect(j.prompt).toContain('IconButton.docs.json');
    expect(bridge(REPO, 'docs', 'draft').code).toBe(2);
    expect(bridge(REPO, 'docs', 'draft', 'Nope').code).toBe(2);
  });

  it('tokens <query>', () => {
    const r = bridge(REPO, 'tokens', 'danger', 'text');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/color\.feedback\.danger\.text/);
  });

  it('diff <base>: designer-readable, with alias impact and contrast', () => {
    const dir = tempGitRepo(REPO, REAL_PATHS);
    const f = join(dir, 'packages/tokens/src/semantic/light.tokens.json');
    const text = readFileSync(f, 'utf8');
    const i = text.indexOf('"muted"', text.indexOf('"text"'));
    writeFileSync(f, text.slice(0, i) + text.slice(i).replace(/"\$value": "[^"]*"/, '"$value": "{palette.neutral.700}"'));
    const r = bridge(dir, 'diff', 'main');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 token change\(s\) since main\s+\(Tier 3, minor\)/);
    // tempGitRepo pins muted text at 600; the hex values come from the live ramp, so only their shape is fixed.
    const moved = /~ color\.text\.muted\s+(#[0-9a-f]{6})\s+->\s+(#[0-9a-f]{6})/.exec(r.out);
    expect(moved, r.out).not.toBeNull();
    expect(moved![1]).not.toBe(moved![2]);
    expect(r.out).toMatch(/other token\(s\) change value through aliases/);
    const md = bridge(dir, 'diff', 'main', '--md');
    expect(md.out).toContain('| `color.text.muted` | value |');
  });

  it('propose creates a local branch; blocked proposals exit 1', () => {
    const dir = tempGitRepo(REPO, REAL_PATHS);
    const ok = bridge(dir, 'propose', '--title', 'Darken muted text', '--set', 'color.text.muted={palette.neutral.700}', '--mode', 'theme=light');
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/status: branch-created/);
    expect(git(dir, 'branch', '--list', 'bridge/*')).toContain('bridge/darken-muted-text');
    const bad = bridge(dir, 'propose', '--title', 'Too light', '--set', 'color.text.muted={palette.neutral.200}', '--file', 'semantic/light.tokens.json');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/status: blocked/);
  });

  it('init writes bridge.config.json and .mcp.json, prints the Claude Desktop snippet', () => {
    const dir = tempGitRepo(FIXTURE, ['.']);
    const r = bridge(dir, 'init');
    expect(r.code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(dir, 'bridge.config.json'), 'utf8'));
    expect(cfg.tokens.root).toBe('design/tokens');
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    // Outside the Bridge repo the server comes from npm, so the file works on every machine.
    expect(mcp.mcpServers.bridge).toEqual({ command: 'npx', args: ['-y', '@bridge-ds/mcp', '--root', '.'] });
    expect(r.out).toContain('claude_desktop_config.json');
    expect(r.out).toMatch(/claude mcp add bridge -- npx -y @bridge-ds\/mcp --root \S+/);
    // The detected config is a working config.
    expect(bridge(dir, 'check').code).toBe(0);
    expect(bridge(dir, 'init').out).toMatch(/exists, keeping it/);
  });

  describe('audit', () => {
    const APPS = join(REPO, 'packages/core/test/fixtures/audit');

    it('prints adoption, writes JSON and Markdown, exit 1 under --fail-under', () => {
      const dir = mkdtempSync(join(tmpdir(), 'bridge-test-audit-'));
      const r = bridge(REPO, 'audit', join(APPS, 'mui-app'), '--json', join(dir, 'a.json'), '--md', join(dir, 'a.md'), '--label', 'MUI', '--fail-under', '80');
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/token adoption\s+\d+(\.\d)?%/);
      expect(r.out).toMatch(/component adoption\s+0%/);
      expect(r.err).toMatch(/under 80%/);
      const report = JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8'));
      expect(report.schemaVersion).toBe(1);
      expect(report.label).toBe('MUI');
      expect(readFileSync(join(dir, 'a.md'), 'utf8')).toMatch(/## Design system adoption: MUI/);
      const clean = bridge(REPO, 'audit', join(APPS, 'clean-app'), '--fail-under', '80', '--json');
      expect(clean.code).toBe(0);
      expect(JSON.parse(clean.out).metrics).toMatchObject({ tokenAdoption: 100, componentAdoption: 100 });
      // From another folder: --ds points at the design system.
      expect(bridge(dir, 'audit', join(APPS, 'clean-app'), '--ds', REPO).code).toBe(0);
    });

    it('--baseline reports progress, --no-regress fails on a regression', () => {
      const dir = mkdtempSync(join(tmpdir(), 'bridge-test-audit-'));
      expect(bridge(REPO, 'audit', join(APPS, 'clean-app'), '--json', join(dir, 'clean.json')).code).toBe(0);
      const worse = bridge(REPO, 'audit', join(APPS, 'mui-app'), '--baseline', join(dir, 'clean.json'), '--no-regress');
      expect(worse.code).toBe(1);
      expect(worse.out).toMatch(/since baseline\s+tokens -/);
      expect(worse.err).toMatch(/regressed/);
      expect(bridge(REPO, 'audit', join(APPS, 'clean-app'), '--baseline', join(dir, 'clean.json'), '--no-regress').code).toBe(0);
    });

    it('--fix is a dry run unless --write; exit 2 without a path or a design system', () => {
      const dir = tempGitRepo(join(APPS, 'mui-app'), ['src']);
      const css = readFileSync(join(dir, 'src/styles.css'), 'utf8');
      // Which fixture literals match a token exactly depends on the live tokens: expect what the planner finds today.
      const plan = planCssFixes(css, 'css', loadDesignSystem(REPO).index);
      expect(plan.edits.length).toBeGreaterThan(0);
      const dry = bridge(REPO, 'audit', dir, '--fix');
      expect(dry.code).toBe(0);
      for (const e of plan.edits) expect(dry.out).toMatch(new RegExp(`src/styles\\.css:${e.line}:${e.column}\\s+${escapeRe(e.from)} -> ${escapeRe(e.to)}`));
      expect(dry.out).toMatch(new RegExp(`Would replace ${plan.edits.length} value`));
      expect(readFileSync(join(dir, 'src/styles.css'), 'utf8')).toBe(css);
      expect(bridge(REPO, 'audit', dir, '--fix', '--write').out).toMatch(new RegExp(`Replaced ${plan.edits.length} value`));
      expect(readFileSync(join(dir, 'src/styles.css'), 'utf8')).toBe(plan.output);
      expect(bridge(REPO, 'audit').code).toBe(2);
      expect(bridge(tmpdir(), 'audit', dir).code).toBe(2);
    });
  });

  it('brand list and brand create: dry run, blocked on contrast (exit 1), local branch never main', () => {
    const list = bridge(REPO, 'brand', 'list', '--json');
    expect(list.code).toBe(0);
    expect(JSON.parse(list.out).map((b: { slug: string }) => b.slug)).toEqual(['bridge', 'ocean']);
    const dry = bridge(REPO, 'brand', 'create', 'acme', '--from', 'bridge', '--primary', '#1F5F3A', '--neutral', '#2A2F2C', '--dry-run', '--json');
    expect(dry.code).toBe(0);
    const plan = JSON.parse(dry.out);
    expect(plan.status).toBe('dry-run');
    expect(plan.tier).toBe(3);
    expect(plan.contrast.failing).toEqual([]);
    const bad = bridge(REPO, 'brand', 'create', 'sunny', '--primary', '#8CC8FF', '--neutral', '#2A2F2C');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/pairs fail/);
    expect(bad.out).toMatch(/FAIL color\.action\.primary\.text on color\.action\.primary\.bg/);
    const dir = tempGitRepo(REPO, REAL_PATHS);
    const r = bridge(dir, 'brand', 'create', 'acme', '--name', 'Acme', '--primary', '#1F5F3A', '--neutral', '230', '--radius', 'crisp');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/branch: bridge\/brand-acme/);
    expect(r.out).toMatch(/All \d+ checks pass/);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git(dir, 'show', 'bridge/brand-acme:packages/tokens/src/brands/acme.tokens.json')).toContain('"name": "Acme"');
    expect(bridge(dir, 'brand', 'nope').code).toBe(2);
  });
});

describe('bridge snapshot', () => {
  const APPS = 'packages/core/test/fixtures/audit';
  it('writes snapshot.json and the audits for the bridge-data branch', () => {
    const out = mkdtempSync(join(tmpdir(), 'bridge-test-snapshot-'));
    const r = bridge(REPO, 'snapshot', '--out', out, '--audit', `${APPS}/clean-app=Clean app`, '--audit-report', 'apps/docs-site/src/data/audits/admin-after.json', '--json');
    expect(r.code, r.err).toBe(0);
    const res = JSON.parse(r.out) as { written: string[]; bytes: number; sourceSha: string; summary: { tokens: number; components: number; contrast: { failing: number }; figma: { inFigma: number } | null } };
    expect(res.written).toEqual(['snapshot.json', 'llms.txt', 'audits/admin-after.json', 'audits/clean-app.json']);
    // llms.txt for agents, linked from the hosted Library.
    const llms = readFileSync(join(out, 'llms.txt'), 'utf8');
    expect(llms).toMatch(/^# peterbono\/ai-design-system-demo design system\n/);
    expect(llms).toContain('`--color-bg-default`');
    expect(llms).toContain('### Button');
    expect(llms).not.toContain('\u2014');
    // component-specs.json is over 1 MB; the snapshot carries its coverage only.
    expect(res.bytes).toBeLessThan(1_000_000);
    expect(res.summary.contrast.failing).toBe(0);
    expect(res.summary.components).toBeGreaterThan(20);
    expect(res.summary.figma?.inFigma).toBeGreaterThan(20);
    const snap = JSON.parse(readFileSync(join(out, 'snapshot.json'), 'utf8')) as { kind: string; sourceSha: string; repo: { owner: string; name: string }; files: Record<string, string>; audits: { id: string; label?: string; path: string }[] };
    expect(snap.kind).toBe('bridge-snapshot');
    expect(snap.sourceSha).toBe(res.sourceSha);
    expect(snap.repo.name).toBe('ai-design-system-demo');
    expect(Object.keys(snap.files)).toContain('bridge.config.json');
    expect(Object.keys(snap.files)).not.toContain('packages/react/component-specs.json');
    expect(snap.audits.map((a) => [a.id, a.label])).toEqual([
      ['admin-after', 'Bridge admin, after migration'],
      ['clean-app', 'Clean app'],
    ]);
    const report = JSON.parse(readFileSync(join(out, 'audits/clean-app.json'), 'utf8')) as { schemaVersion: number; label: string };
    expect(report).toMatchObject({ schemaVersion: 1, label: 'Clean app' });

    // Text mode, and a second run leaves no stale audit behind.
    const t = bridge(REPO, 'snapshot', '--out', out);
    expect(t.code, t.err).toBe(0);
    expect(t.out).toMatch(/^Wrote .*snapshot\.json \(\d+ KB\) for peterbono\/ai-design-system-demo at [0-9a-f]{7}/);
    expect(t.out).toMatch(/contrast\s+\d+ checks over \d+ pairs, 0 failing/);
    expect(existsSync(join(out, 'audits'))).toBe(false);
  });

  it('exit 2 when a folder to audit does not exist', () => {
    const out = mkdtempSync(join(tmpdir(), 'bridge-test-snapshot-'));
    const r = bridge(REPO, 'snapshot', '--out', out, '--audit', 'no/such/app');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/No such file or folder to audit: no\/such\/app/);
  });
});
