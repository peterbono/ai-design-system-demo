// The bridge CLI, run as a real process.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, FIXTURE, git, REAL_PATHS, REPO, tempGitRepo } from '../../mcp/test/helpers.js';

const bridge = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

describe('bridge CLI', () => {
  it('check passes on the real repo (exit 0)', () => {
    const r = bridge(REPO, 'check');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/contrast: 296 checks, 0 failing/);
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
    writeFileSync(f, text.slice(0, i) + text.slice(i).replace('{palette.neutral.600}', '{palette.neutral.700}'));
    const r = bridge(dir, 'diff', 'main');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 token change\(s\) since main\s+\(Tier 3, minor\)/);
    expect(r.out).toMatch(/~ color\.text\.muted\s+#5b6672\s+->\s+#495562/);
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
    expect(mcp.mcpServers.bridge.command).toBe('node');
    expect(existsSync(mcp.mcpServers.bridge.args[0])).toBe(true);
    expect(r.out).toContain('claude_desktop_config.json');
    expect(r.out).toContain('claude mcp add bridge');
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
      const dry = bridge(REPO, 'audit', dir, '--fix');
      expect(dry.code).toBe(0);
      expect(dry.out).toMatch(/src\/styles.css:3:10\s+#15202b -> var\(--color-text-default\)/);
      expect(dry.out).toMatch(/Would replace 5 value/);
      expect(readFileSync(join(dir, 'src/styles.css'), 'utf8')).toBe(css);
      expect(bridge(REPO, 'audit', dir, '--fix', '--write').out).toMatch(/Replaced 5 value/);
      expect(readFileSync(join(dir, 'src/styles.css'), 'utf8')).toMatch(/padding: var\(--space-4\) 13px;/);
      expect(bridge(REPO, 'audit').code).toBe(2);
      expect(bridge(tmpdir(), 'audit', dir).code).toBe(2);
    });
  });
});
