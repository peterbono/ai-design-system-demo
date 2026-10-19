// Components and docs tools against the real repo.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeContext, ops } from '../dist/lib.js';
import { REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

let ctx: BridgeContext;
beforeAll(async () => {
  ctx = await BridgeContext.create({ root: REPO });
});

describe('components and docs (real repo)', () => {
  it('bridge_list_components: every component folder, with family and summary', async () => {
    const l = await ops.listComponentsOp(ctx, {});
    const dir = join(REPO, 'packages/react/src/components');
    const folders = readdirSync(dir).filter((n) => existsSync(join(dir, n, `${n}.tsx`)));
    expect(folders.length).toBeGreaterThanOrEqual(53);
    expect(l.total).toBe(folders.length);
    expect(l.components.map((c) => c.name)).toEqual(expect.arrayContaining(['Banner', 'Checklist', 'ChoiceCard', 'CodeBlock', 'TokenValue']));
    const button = l.components.find((c) => c.name === 'Button');
    expect(button?.family).toBe('Actions');
    expect(button?.summary).toMatch(/Triggers an action/);
    const forms = await ops.listComponentsOp(ctx, { family: 'Forms' });
    expect(forms.components.map((c) => c.name)).toContain('Switch');
  });

  it('bridge_get_component: props with defaults and union values, docs, tokens, stories', async () => {
    const b = await ops.getComponentOp(ctx, { name: 'Button' });
    expect(b.extends).toBe('ButtonHTMLAttributes<HTMLButtonElement>');
    expect(b.props.find((p) => p.name === 'variant')).toMatchObject({ default: "'primary'", values: ['primary', 'secondary', 'ghost', 'danger', 'link', 'inverse'] });
    expect(b.props.find((p) => p.name === 'loading')?.description).toMatch(/spinner/);
    expect(Object.keys(b.docs!)).toEqual(expect.arrayContaining(['whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'anatomy']));
    expect(b.tokens.used).toContain('--button-primary-bg');
    expect(b.tokens.notTokens).toEqual([]);
    expect(b.stories).toContain('AllStates');
    const slim = await ops.getComponentOp(ctx, { name: 'Button', include: ['accessibility'] });
    expect(Object.keys(slim.docs!)).toEqual(['accessibility']);
  });

  it('no component CSS references an invented design token (only Base UI runtime variables remain)', async () => {
    const l = await ops.listComponentsOp(ctx, { withSummaries: false });
    const runtime = new Set<string>();
    for (const c of l.components) {
      const d = await ops.getComponentOp(ctx, { name: c.name, include: [] });
      for (const v of d.tokens.notTokens ?? []) runtime.add(v);
    }
    expect([...runtime].filter((v) => /^--(color|space|size|radius|font|motion|shadow|layer|z|focus)-/.test(v))).toEqual([]);
  });

  it('bridge_draft_docs: deterministic pre-fill, inherited tokens and a prompt, nothing written', async () => {
    const icon = await ops.draftDocsOp(ctx, { name: 'Icon' });
    expect(icon.path).toBe('packages/react/src/components/Icon/Icon.docs.json');
    expect(icon.prefill.tokens).toContain('--icon-stroke');
    // Keyed by the CSS module classes, in source order; labels written in the docs win over the derived ones.
    expect(Object.keys(icon.prefill.anatomy)).toEqual(['icon', 'xs', 'sm', 'md', 'lg']);
    expect(icon.prefill.anatomy.sm).toMatch(/16px/);
    expect(icon.prefill.propsTable).toContain('`icon` (required)');
    expect(icon.prompt).toContain('Never invent');
    expect(icon.prompt).toContain('<example-docs-json>');
    expect(icon.prompt).toMatch(/Voice and tone/);
    expect(icon.instruction).toMatch(/"draftedBy": "claude" and "needsReview": true/);
    expect(await ops.draftDocsOp(ctx, { name: 'Icon' })).toEqual(icon);
    const ib = await ops.draftDocsOp(ctx, { name: 'IconButton' });
    expect(ib.prefill.tokens).toEqual(['--font-line-height-none']);
    expect(ib.prefill.inheritedTokens.Button!.length).toBeGreaterThan(20);
    expect(ib.prefill.propsTable).toContain('native <button> attribute');
    const button = await ops.draftDocsOp(ctx, { name: 'Button' });
    expect(button.exists).toBe(true);
    expect(button.prefill.missing).toEqual([]);
    expect(button.prefill.anatomy.primary).toMatch(/Primary variant/);
    expect(button.prefill.contrastNotes.length).toBeGreaterThan(0);
    expect(icon.prompt).not.toMatch(/\u2014/);
  });

  it('bridge_get_design_language: toc, by number, by title', async () => {
    const toc = (await ops.getDesignLanguage(ctx, {})) as any;
    expect(toc.sections.length).toBeGreaterThan(10);
    const motion = (await ops.getDesignLanguage(ctx, { section: '8' })) as any;
    expect(motion.text.startsWith('## 8. Motion')).toBe(true);
    const voice = (await ops.getDesignLanguage(ctx, { section: 'voice' })) as any;
    expect(voice.text).toMatch(/Voice and tone/);
  });

  it('bridge_get_guidelines: rule lists and risk tiers', async () => {
    const g = (await ops.getGuidelines(ctx, {})) as any;
    expect(g.never.some((r: string) => /push to `main`/.test(r))).toBe(true);
    expect(g.askBefore[0]).toMatch(/Tier 3/);
    expect(g.riskTiers).toMatch(/\| 3, high/);
    const checklist = (await ops.getGuidelines(ctx, { section: 'new component checklist' })) as any;
    expect(checklist.text).toMatch(/Base UI first/);
  });

  it('bridge_scaffold_component writes the checklist files locally and refuses to overwrite', async () => {
    const dir = tempGitRepo(REPO, REAL_PATHS);
    const local = await BridgeContext.create({ root: dir });
    const s = (await ops.scaffoldComponentOp(local, { name: 'SegmentedControl', family: 'Forms', summary: 'Picks one of a few views.', element: 'div', interactive: true })) as any;
    expect(s.written).toBe(true);
    const base = join(dir, 'packages/react/src/components/SegmentedControl');
    for (const f of ['SegmentedControl.tsx', 'SegmentedControl.module.css', 'SegmentedControl.stories.tsx', 'SegmentedControl.docs.json', 'SegmentedControl.test.tsx', 'index.ts']) expect(existsSync(join(base, f)), f).toBe(true);
    const css = readFileSync(join(base, 'SegmentedControl.module.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b|\d+px|\d+ms/);
    expect(css).toContain('var(--color-text-default)');
    const docs = JSON.parse(readFileSync(join(base, 'SegmentedControl.docs.json'), 'utf8'));
    expect(Object.keys(docs)).toEqual(Object.keys(JSON.parse(readFileSync(join(REPO, 'packages/react/src/components/Button/Button.docs.json'), 'utf8'))));
    expect(readFileSync(join(base, 'SegmentedControl.stories.tsx'), 'utf8')).toContain("title: 'Forms/SegmentedControl'");
    await expect(ops.scaffoldComponentOp(local, { name: 'SegmentedControl', family: 'Forms', summary: 'x', element: 'div', interactive: true })).rejects.toThrow(/already exists/);
  });
});
