// A tiny repo with a different structure and no bridge.config.json: hex-string colors, tokens in design/,
// components in src/ui, object-form contrast pairs. Proves the tools are not tied to the Bridge repo layout.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeContext, ops } from '../dist/lib.js';
import { FIXTURE, git, tempGitRepo } from './helpers.js';

let ctx: BridgeContext;
beforeAll(async () => {
  ctx = await BridgeContext.create({ root: FIXTURE });
});

describe('fixture repo (detected config)', () => {
  it('detects root, tiers, layers and the theme mode', async () => {
    const c = await ops.getConfig(ctx);
    expect(c.configOrigin).toMatch(/detected/);
    expect(c.config.tokens.root).toBe('design/tokens');
    expect(c.config.tokens.layers.map((l) => l.files)).toEqual(['core.json', 'theme/{theme}.json', 'component/*.json']);
    expect(c.config.modes.theme?.values).toEqual(['light', 'dark']);
    expect(c.config.components?.dir).toBe('src/ui');
    expect(c.config.contrast?.path).toBe('design/contrast.json');
  });

  it('validates (hex strings are warnings, not errors) and checks contrast', async () => {
    const v = await ops.validateTokens(ctx, {});
    expect(v.errors).toEqual([]);
    expect(v.warningCount).toBeGreaterThan(0);
    const c = await ops.checkContrast(ctx, {});
    expect('checks' in c && c.checks).toBe(6);
  });

  it('resolves tokens per theme and finds component usage through component tokens', async () => {
    const t = await ops.getToken(ctx, { path: 'fg.default' });
    expect(t.values.map((v) => v.value)).toEqual(['#111827', '#f1f3f5']);
    expect(t.usedIn).toEqual([{ component: 'Card', file: 'src/ui/Card/Card.css', via: 'card.text' }]);
  });

  it('components, props and docs', async () => {
    const l = await ops.listComponentsOp(ctx, {});
    expect(l.components.map((c) => c.name)).toEqual(['Card', 'Chip']);
    const card = await ops.getComponentOp(ctx, { name: 'card' });
    expect(card.props.find((p) => p.name === 'tone')).toMatchObject({ default: "'plain'", values: ['plain', 'raised'] });
    expect(card.props.find((p) => p.name === 'title')?.optional).toBe(false);
    expect(card.tokens.notTokens).toEqual([]);
  });

  it('design language and guidelines from differently named files', async () => {
    const d = (await ops.getDesignLanguage(ctx, { section: 'space' })) as any;
    expect(d.text).toContain('Multiples of 8');
    const g = (await ops.getGuidelines(ctx, {})) as any;
    expect(g.never).toEqual(['Push to main.']);
  });

  it('proposes in hex-string format and keeps the repo style', async () => {
    const dir = tempGitRepo(FIXTURE, ['.']);
    const local = await BridgeContext.create({ root: dir });
    const p = (await ops.proposeTokenChange(local, { title: 'Deeper accent', edits: [{ op: 'set', path: 'color.green.700', value: '#166534' }] })) as any;
    expect(p.status).toBe('branch-created');
    const text = git(dir, 'show', 'bridge/deeper-accent:design/tokens/core.json');
    expect(text).toContain('"700": { "$value": "#166534" }');
    expect(p.files).toEqual(['design/tokens/core.json']);
  });

  it('scaffolds a component into the detected components dir (returns files when write is false)', async () => {
    const s = (await ops.scaffoldComponentOp(ctx, { name: 'Badge', family: 'Display', summary: 'Shows a status.', element: 'span', interactive: false, write: false })) as any;
    expect(s.written).toBe(false);
    const paths = s.files.map((f: any) => f.path);
    expect(paths).toContain('src/ui/Badge/Badge.tsx');
    expect(paths).toContain('src/ui/Badge/Badge.css');
    const docs = JSON.parse(s.files.find((f: any) => f.path.endsWith('.docs.json')).content);
    expect(Object.keys(docs)).toEqual(['summary', 'whenToUse', 'accessibility']);
    expect(existsSync(join(FIXTURE, 'src/ui/Badge'))).toBe(false);
  });

  it('audit snippet suggests fixture tokens', async () => {
    const f = await ops.auditUi(ctx, '.x {\n  color: #111827;\n  padding: 16px;\n}');
    expect(f[0]!.suggestions[0]!.cssVar).toBe('var(--fg-default)');
    expect(f[1]!.suggestions.map((s) => s.path)).toContain('space.4');
  });

  it('fixture files are untouched by the suite', () => {
    expect(readFileSync(join(FIXTURE, 'design/tokens/core.json'), 'utf8')).toContain('"700": { "$value": "#15803d" }');
  });
});
