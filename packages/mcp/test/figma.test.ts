// Components pushed from Figma, from Claude and the terminal, over an in-memory GitHub: the same push as the DS Bridge
// plugin from a structured diff (an exact token change, contrast gated, or a branch with the spec for Claude AI), the
// brief to draft it, and the "drafted by Claude AI" mark once the code is pushed. Through @bridge-ds/core, like the plugin.
import { describe, expect, it } from 'vitest';
import { BridgeContext, figma } from '../dist/lib.js';
import { parseFigmaOrigin, type ComponentPushDiff } from '@bridge-ds/core';
import { runFigma } from '../../cli/src/figma.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

// The CLI runs in this repository: its config names the GitHub repository the fake stands for.
function setup(owner = 'peterbono', name = 'ai-design-system-demo') {
  const gh = fakeGitHub(owner, name, readTree(REPO, [...REAL_PATHS, 'packages/react/component-specs.json']));
  const ro = () => BridgeContext.create({ repo: `${owner}/${name}`, fetch: gh.fetch });
  const rw = () => BridgeContext.create({ repo: `${owner}/${name}`, token: 't', fetch: gh.fetch });
  return { gh, ro, rw };
}

const KEYS = ['lg', 'md', 'sm'].map((s) => `Size=${s}, State=Default, Variant=primary`);

function diff(over: Partial<ComponentPushDiff> = {}): ComponentPushDiff {
  return {
    v: 1,
    component: 'Button',
    figmaName: 'Button',
    coded: true,
    kind: 'token-binding',
    title: 'Use the active fill for primary',
    summary: 'Changed in Figma.',
    changes: [{ field: 'Fill (primary sm; primary md; primary lg)', before: 'button.primary.bg', after: 'color.action.primary.bg-active' }],
    rebinds: [{ kind: 'fill', variants: KEYS, allVariants: false, before: ['button.primary.bg'], after: ['color.action.primary.bg-active'] }],
    needsCode: false,
    unknown: [],
    variantAxes: { Size: ['sm', 'md', 'lg'] },
    properties: [],
    bindings: {},
    anatomy: {},
    source: 'figma',
    ...over,
  };
}

const labels = (pr: any) => pr.labels.map((l: any) => l.name);

describe('bridge_push_figma_component', () => {
  it('an exact swap opens a token change labelled from Figma; dry run first, read-only refused', async () => {
    const { gh, ro, rw } = setup();
    const dry = await figma.pushFigmaComponentOp(await ro(), { diff: diff(), dryRun: true });
    expect(dry).toMatchObject({ status: 'dry-run', route: 'exact token change', edits: [{ op: 'set', path: 'button.primary.bg', value: '{color.action.primary.bg-active}' }] });
    // Components that share button tokens change with it: the sentence says so (from component-specs.json).
    expect(dry.said).toMatch(/It also repaints AlertDialog\/Popup, Form and IconButton: they use the same token\.$/);
    expect(gh.pulls).toHaveLength(0);
    await expect(figma.pushFigmaComponentOp(await ro(), { diff: diff() })).rejects.toThrow(/needs a GitHub token/);

    const r = await figma.pushFigmaComponentOp(await rw(), { diff: diff() });
    expect(r.status).toBe('opened');
    expect(r.library).toMatchObject({ route: 'token-change' });
    const pr = gh.pulls[r.library!.number - 1]!;
    expect(labels(pr)).toEqual(expect.arrayContaining(['from-figma', 'source: mcp']));
    expect(parseFigmaOrigin(pr.body)).toMatchObject({ component: 'Button', route: 'token-change' });
    const file = gh.commits.get(gh.refs.get(pr.head.ref)!)!.files.get('packages/tokens/src/components/button.tokens.json')!;
    expect(file).toMatch(/"bg": \{\s*"\$value": "\{color\.action\.primary\.bg-active\}"/);
  });

  it('the component contrast pairs gate it: a swap that breaks text contrast is not sent', async () => {
    const { gh, rw } = setup();
    const bad = diff({ rebinds: [{ kind: 'fill', variants: KEYS, allVariants: false, before: ['button.primary.bg'], after: ['color.action.primary.text'] }] });
    await expect(figma.pushFigmaComponentOp(await rw(), { diff: bad })).rejects.toThrow(/Not sent: \d+ contrast pair\(s\) would fail/);
    expect(gh.pulls).toHaveLength(0);
  });

  it('reads where else a token paints from component-specs.json: one variant only goes to Claude AI', async () => {
    const { ro } = setup();
    const one = diff({ rebinds: [{ kind: 'fill', variants: [KEYS[1]!], allVariants: false, before: ['button.primary.bg'], after: ['color.action.primary.bg-active'] }] });
    const r = await figma.pushFigmaComponentOp(await ro(), { diff: one, dryRun: true });
    expect(r.route).toBe('Claude AI drafts');
    expect(r.reasons![0]).toMatch(/^button\.primary\.bg also paints primary sm and primary lg: pointing it to color\.action\.primary\.bg-active would change them too/);
  });
});

describe('Claude drafts a component change from Figma', () => {
  it('lists it, gives the brief, refuses "drafted" until the code is pushed, then labels it; the CLI does the same', async () => {
    const { gh, ro, rw } = setup();
    const lg = diff({ kind: 'new-variant', title: 'Add an xl size', needsCode: true, rebinds: [], changes: [{ field: 'Variant Size', before: 'lg, md, sm', after: 'lg, md, sm, xl' }], variantAxes: { Size: ['lg', 'md', 'sm', 'xl'] } });
    const r = await figma.pushFigmaComponentOp(await rw(), { diff: lg });
    expect(r).toMatchObject({ status: 'opened', route: 'Claude AI drafts', library: { route: 'claude-draft' } });
    const n = r.library!.number;
    const pr = gh.pulls[n - 1]!;
    expect(pr.draft).toBe(true);
    expect(labels(pr)).toEqual(expect.arrayContaining(['from-figma', 'waiting-for-claude', 'component-change']));

    const list = await figma.figmaChangesOp(await ro());
    expect(list.changes).toEqual([expect.objectContaining({ pr: n, component: 'Button', route: 'Claude AI drafts', status: 'Waiting for Claude AI' })]);
    const one = await figma.getFigmaChangeOp(await ro(), { pr: n });
    expect(one.spec).toMatchObject({ path: '.bridge/figma/button-add-an-xl-size.json', variantAxes: { Size: ['lg', 'md', 'sm', 'xl'] } });
    expect(one.brief).toMatch(/^Draft the code for a component change made in Figma, on the library branch bridge\/figma-button-add-an-xl-size/);
    expect(one.brief).toContain('packages/react/src/components/Button');

    await expect(figma.markFigmaDraftedOp(await rw(), { pr: n })).rejects.toThrow(/only carries the spec/);
    // Claude pushes the code to the branch.
    const tip = gh.refs.get(pr.head.ref)!;
    const files = new Map(gh.commits.get(tip)!.files);
    files.set('packages/react/src/components/Button/Button.module.css', `${files.get('packages/react/src/components/Button/Button.module.css')}\n.xl {}\n`);
    const c = gh.id();
    gh.commits.set(c, { files, parents: [tip] });
    gh.refs.set(pr.head.ref, c);
    pr.head.sha = c;

    const lines: string[] = [];
    const io = { print: (s: string) => lines.push(s), error: (s: string) => lines.push(s), env: { GITHUB_TOKEN: 't' }, fetch: gh.fetch, ghToken: () => null, hasClaude: () => false, runClaude: () => 0 } as any;
    expect(await runFigma({ _: ['figma', 'drafted', String(n)], flags: {} }, REPO, io)).toBe(0);
    expect(lines[0]).toBe(`#${n}: Drafted by Claude AI. Claude AI drafted the code. A person reviews it before it ships.`);
    expect(labels(pr)).toContain('drafted-by-claude');
    expect(labels(pr)).not.toContain('waiting-for-claude');
    expect(pr.body).toMatch(/\*\*Drafted by Claude AI\*\* from the Figma spec/);
    lines.length = 0;
    expect(await runFigma({ _: ['figma'], flags: {} }, REPO, io)).toBe(0);
    expect(lines[0]).toBe(`#${n} Button: add an xl size (Claude AI drafts): Drafted by Claude AI. Claude AI drafted the code. A person reviews it before it ships.`);
  });

  it('what cannot be read is listed with what to do, and nothing is opened', async () => {
    const { gh, rw } = setup();
    const r = await figma.pushFigmaComponentOp(await rw(), { diff: diff({ rebinds: [{ kind: 'fill', variants: KEYS, allVariants: false, before: ['button.primary.bg'], after: [] }] }) });
    expect(r.status).toBe('not-sent');
    expect(r.fixInFigma![0]!.what).toMatch(/no longer bound to a variable: it uses a raw value/);
    expect(gh.pulls).toHaveLength(0);
  });
});
