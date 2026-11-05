// The component map through the MCP ops: the figma field of bridge_list_components and bridge_get_component, the
// `bridge check` report, and bridge_propose_component_map (dry run, local branch, draft pull request, suggestion).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeContext, componentMap, ops } from '../dist/lib.js';
import { fakeGitHub, git, readTree, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

const FILE = 'AbCdEf0123456789XyZ';
const FILE_URL = `https://www.figma.com/design/${FILE}/Library`;
const PATHS = [...REAL_PATHS, 'packages/react/package.json', 'packages/react/src/index.ts'];
const LINKED = { version: 1, components: { Button: { figma: { file: FILE, key: 'k-button', node: '1:2', name: 'Button / Base' } } } };
// What Claude reads through the Figma connector: a set with its variant properties, a variant, a component only in Figma.
const FIGMA = [
  { name: 'Switch', key: 'k-switch', node: '3:4', type: 'COMPONENT_SET', properties: { Size: { type: 'VARIANT', values: ['sm', 'md'] }, 'Checked#1:0': { type: 'BOOLEAN' } } },
  { name: 'Size=sm, Checked=true', key: 'k-switch-variant' },
  { name: 'Button', key: 'k-other' },
  { name: 'Avatar', key: 'k-avatar' },
];

let dir: string;
let ctx: BridgeContext;

beforeAll(async () => {
  dir = tempGitRepo(REPO, PATHS);
  writeFileSync(join(dir, 'bridge.components.json'), `${JSON.stringify(LINKED, null, 2)}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'map');
  ctx = await BridgeContext.create({ root: dir });
});

describe('the figma field', () => {
  it('lists and gets each component with its Figma link, or says it is not linked yet', async () => {
    const l = (await ops.listComponentsOp(ctx, {})) as any;
    expect(l.components.map((c: any) => [c.name, c.figma])).toEqual([
      ['Button', { name: 'Button / Base', url: `https://www.figma.com/design/${FILE}/?node-id=1-2` }],
      ['Switch', 'not linked to Figma yet'],
    ]);
    expect(((await ops.getComponentOp(ctx, { name: 'switch' })) as any).figma).toBe('not linked to Figma yet');
    expect(((await ops.getComponentOp(ctx, { name: 'Button', include: [] })) as any).figma.name).toBe('Button / Base');
  });

  it('bridge check: linked and not linked components, no failure for those', async () => {
    const r = await componentMap.componentMapCheck(ctx);
    expect(r).toEqual({ present: true, problems: [], linked: ['Button'], unmapped: ['Switch'], unknown: [] });
    expect(componentMap.componentMapLines(r)[0]).toBe('component map: 1 of 2 components linked to Figma');
  });
});

describe('bridge_propose_component_map', () => {
  it('needs the Figma file: the argument, else figma.file of the config', async () => {
    await expect(componentMap.proposeComponentMapOp(ctx, { components: FIGMA })).rejects.toThrow(/Which Figma file\? .*Settings, Figma file/);
    await expect(componentMap.proposeComponentMapOp(ctx, { components: FIGMA, file: 'nope' })).rejects.toThrow('"nope" is not a Figma file link or key.');
  });

  it('dry run: links Switch with its properties, keeps the Button link a person made, says what stays out', async () => {
    const r = (await componentMap.proposeComponentMapOp(ctx, { components: FIGMA, file: FILE_URL, dryRun: true, changes: 'direct' })) as any;
    expect(r.status).toBe('dry-run');
    expect(r.linked).toEqual(['Switch']);
    expect(r.alreadyLinked).toEqual(['Button']);
    expect(r.figmaOnly).toEqual(['Avatar']);
    const file = JSON.parse(r.fileContents[0].content);
    expect(r.fileContents[0].path).toBe('bridge.components.json');
    expect(file.components.Button.figma.key).toBe('k-button');
    expect(file.components.Switch).toEqual({
      figma: { file: FILE, key: 'k-switch', node: '3:4', properties: { Size: { prop: 'size', values: { sm: 'sm', md: 'md' } }, 'Checked#1:0': { prop: 'checked' } } },
      code: { import: { package: '@bridge-ds/react', export: 'Switch' } },
    });
    expect(r.prBody).toContain('| Switch | Switch | name and properties |');
    // Suggest mode: the same file as a suggestion (kind config), nothing sent in a dry run.
    const s = (await componentMap.proposeComponentMapOp(ctx, { components: FIGMA, file: FILE, dryRun: true, changes: 'suggest' })) as any;
    expect(s.status).toBe('dry-run');
    expect(s.changesMode).toBe('suggest');
    expect(s.suggestion.labels).toContain('component-map');
  });

  it('nothing new: says so and writes nothing', async () => {
    const r = (await componentMap.proposeComponentMapOp(ctx, { components: [{ name: 'Button', key: 'x' }], file: FILE, changes: 'direct' })) as any;
    expect(r.status).toBe('nothing-to-propose');
    expect(r.alreadyLinked).toEqual(['Button']);
  });

  it('local: a new bridge/component-map-* branch with the file, main and the working tree untouched', async () => {
    const before = git(dir, 'rev-parse', 'main').trim();
    const r = (await componentMap.proposeComponentMapOp(ctx, { components: FIGMA, file: FILE, changes: 'direct' })) as any;
    expect(r.status).toBe('branch-created');
    expect(r.branch).toMatch(/^bridge\/component-map-\d{8}$/);
    expect(git(dir, 'rev-parse', 'main').trim()).toBe(before);
    expect(git(dir, 'status', '--porcelain').trim()).toBe('');
    expect(JSON.parse(git(dir, 'show', `${r.branch}:bridge.components.json`)).components.Switch.figma.key).toBe('k-switch');
  });

  it('GitHub with a token: a draft pull request labelled component-map, from figma.file of the config', async () => {
    const tree = readTree(REPO, PATHS);
    const cfg = JSON.parse(tree['bridge.config.json']!);
    tree['bridge.config.json'] = `${JSON.stringify({ ...cfg, figma: { file: FILE_URL } }, null, 2)}\n`;
    const gh = fakeGitHub('acme', 'ds', tree);
    const mainBefore = gh.refs.get('main');
    const remote = await BridgeContext.create({ repo: 'acme/ds', token: 'test-token', fetch: gh.fetch });
    const r = (await componentMap.proposeComponentMapOp(remote, { components: FIGMA, changes: 'direct' })) as any;
    expect(r.status).toBe('pr-opened');
    expect(r.draft).toBe(true);
    expect(r.labels).toEqual(['source: mcp', 'component-map']);
    expect(r.linked).toEqual(['Button', 'Switch']);
    expect(gh.refs.get('main')).toBe(mainBefore);
    expect(JSON.parse(gh.fileAt(r.branch, 'bridge.components.json')!).components.Button.figma.key).toBe('k-other');
    expect(gh.pulls[0]!.title).toBe('chore(components): link 2 Library components to Figma');
    // Suggest mode: an issue with the file, applied by a developer.
    const gh2 = fakeGitHub('acme', 'ds', tree);
    const remote2 = await BridgeContext.create({ repo: 'acme/ds', token: 'test-token', fetch: gh2.fetch });
    const s = (await componentMap.proposeComponentMapOp(remote2, { components: FIGMA, changes: 'suggest' })) as any;
    expect(s.status).toBe('suggested');
    expect(gh2.issues[0]!.labels.map((l: any) => l.name)).toContain('component-map');
    expect(gh2.pulls).toEqual([]);
  });
});
