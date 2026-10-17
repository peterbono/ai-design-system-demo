// Pull components: the coded components (packages/react/component-specs.json, generated from the TSX and CSS modules)
// become Figma component sets bound to the pulled variables. Runs the real main-thread code (apply.ts,
// build-components.ts, components.ts) against an in-memory Figma API (figma-api.ts), and GitHub against FakeGitHub.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ComponentSpecsFile, hashSpec, parseComponentSpecs } from '@bridge-ds/core';
import { SPEC_COMPONENTS, generateRepoComponentSpecs } from '@bridge-ds/core/node';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { scanComponents } from '../src/main/components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, pendingComponents, writablePlan } from '../src/sync/component-pull';
import { classifyComponents, pullBaselines } from '../src/sync/components';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma, type SimNode } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const specsText = () => readFileSync(join(ROOT, SPECS_PATH), 'utf8');
const CODED = ['Badge', 'Button', 'Card', 'IconButton', 'Input', 'Tag'];

function repoFiles(specs = specsText()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  out[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  out['bridge.config.json'] = realConfigText();
  out[SPECS_PATH] = specs;
  for (const name of CODED) out[`packages/react/src/components/${name}/${name}.tsx`] = '';
  return out;
}

/** A Figma file with the variables pulled (real apply.ts), and the component plan for it. */
async function pulledFile(opts: { fonts?: { family: string; style: string }[]; specs?: string; sim?: SimFigma; gh?: FakeGitHub } = {}) {
  const sim = opts.sim ?? new SimFigma(opts.fonts ? { fonts: opts.fonts } : {});
  sim.install();
  const gh = opts.gh ?? new FakeGitHub(repoFiles(opts.specs));
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  const pull = buildPull(a, new Map());
  const variables = await applyPullPlan(pull.plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  assert.ok(loaded, 'component-specs.json is read from the repo');
  const plan = buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  return { sim, gh, client, a, variables, plan, specs: loaded.specs };
}

const variantOf = (set: SimNode, name: string) => set.children.find((c) => c.name === name)!;
const partOf = (variant: SimNode, id: string) => (id === 'root' ? variant : variant.findOne((n) => n.getSharedPluginData('dsbridge', 'part') === id)!);
function boundName(sim: SimFigma, node: SimNode, field: string): string | undefined {
  const b = node.boundVariables[field] as { id: string } | { id: string }[] | undefined;
  const alias = Array.isArray(b) ? b[0] : b;
  const v = alias && sim.variables.find((x) => x.id === alias.id);
  if (!v) return undefined;
  return `${sim.collections.find((c) => c.id === v.variableCollectionId)!.name}:${v.name}`;
}

test('spec: Button axes, properties and token bindings come from Button.tsx and Button.module.css', () => {
  const specs = parseComponentSpecs(specsText());
  const button = specs.components.find((c) => c.name === 'Button')!;
  assert.equal(button.hash, hashSpec(button));
  assert.deepEqual(
    button.axes.map((a) => `${a.name}=${a.values.join('|')}`),
    ['Variant=primary|secondary|ghost|danger', 'Size=sm|md|lg', 'State=Default|Hover|Pressed|Disabled'],
  );
  assert.equal(button.variants.length, 48);
  assert.deepEqual(
    button.properties.map((p) => `${p.type} ${p.name}`),
    ['TEXT Label', 'BOOLEAN Icon start', 'BOOLEAN Icon end'],
  );
  assert.deepEqual(button.parts.map((p) => `${p.id}:${p.kind}`), ['root:frame', 'icon-start:icon', 'text:text', 'icon-end:icon']);
  const danger = button.variants.find((v) => v.props.Variant === 'danger' && v.props.Size === 'sm' && v.props.State === 'Pressed')!;
  assert.deepEqual(danger.values.root, {
    fill: 'button.danger.bg-active',
    cornerRadius: 'button.radius',
    paddingTop: 0,
    paddingRight: 'control.padding-x.sm',
    paddingBottom: 0,
    paddingLeft: 'control.padding-x.sm',
    itemSpacing: 'space.1-5',
    minWidth: 'control.height.sm',
    minHeight: 'control.height.sm',
    strokeWeight: 'border-width.default',
    stroke: null,
  });
  assert.equal(danger.values.text!.textFill, 'button.danger.text');
  assert.equal(danger.values['icon-start']!.width, 'icon.size.sm');
  // The generator reads the code: the committed JSON is what it produces today.
  assert.deepEqual(generateRepoComponentSpecs(ROOT, ['Button']).components[0], button);
  assert.deepEqual(specs.components.map((c) => c.name), SPEC_COMPONENTS);
});

test('plan: every spec is new on a first pull, fields resolve to variables of the right tier, problems are listed', async () => {
  const { plan } = await pulledFile();
  assert.deepEqual(plan.components.map((c) => `${c.name}:${c.status}`), SPEC_COMPONENTS.map((n) => `${n}:new`));
  const button = plan.components.find((c) => c.name === 'Button')!;
  const md = button.variants.find((v) => v.name === 'Variant=primary, Size=md, State=Default')!;
  const fill = md.parts.root!.find((f) => f.field === 'fill')!.value;
  assert.deepEqual(fill.kind === 'variable' && [fill.collection, fill.name], ['Component', 'button/primary/bg']);
  const pad = md.parts.root!.find((f) => f.field === 'paddingLeft')!.value;
  assert.deepEqual(pad.kind === 'variable' && [pad.collection, pad.name], ['Density', 'control/padding-x/md']);
  const lh = md.parts.text!.find((f) => f.field === 'lineHeight')!.value;
  assert.equal(lh.kind, 'percent', 'unitless line heights are set as a percent, not bound');
  // CSS that has no Figma equivalent is reported before anything is written.
  assert.ok(plan.problems.some((p) => p.component === 'Badge' && p.property === 'min-height' && /calc/.test(p.reason)));
  assert.ok(plan.problems.some((p) => p.component === 'Input' && p.property === 'prop prefix'));
});

test('apply: 6 component sets on a Components page, bound to the variables, with text and boolean properties', async () => {
  const { sim, plan } = await pulledFile();
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual([report.created, report.updated, report.unchanged], [6, 0, 0]);
  assert.deepEqual(report.problems, []);
  assert.equal(report.fontNote, undefined);
  const page = sim.root.children.find((p) => p.name === 'Components')!;
  assert.deepEqual(page.children.map((s) => `${s.type}:${s.name}`), SPEC_COMPONENTS.map((n) => `COMPONENT_SET:${n}`));
  const button = page.children[0]!;
  assert.equal(button.children.length, 48);
  const defs = button.componentPropertyDefinitions;
  assert.deepEqual(
    Object.entries(defs).map(([k, d]) => `${k.replace(/#.*$/, '')}:${d.type}`).sort(),
    ['Icon end:BOOLEAN', 'Icon start:BOOLEAN', 'Label:TEXT', 'Size:VARIANT', 'State:VARIANT', 'Variant:VARIANT'],
  );
  const v = variantOf(button, 'Variant=secondary, Size=lg, State=Hover');
  assert.equal(boundName(sim, v, 'fills'), 'Component:button/secondary/bg-hover');
  assert.equal(boundName(sim, v, 'strokes'), 'Component:button/secondary/border');
  assert.equal(boundName(sim, v, 'topLeftRadius'), 'Component:button/radius');
  assert.equal(boundName(sim, v, 'paddingLeft'), 'Density:control/padding-x/lg');
  assert.equal(boundName(sim, v, 'minHeight'), 'Density:control/height/lg');
  assert.equal(boundName(sim, v, 'strokeWeight'), 'Base:border-width/default');
  const label = partOf(v, 'text');
  assert.equal(label.type, 'TEXT');
  assert.equal(label.characters, 'Button');
  assert.deepEqual(label.fontName, { family: 'Instrument Sans', style: 'Medium' });
  assert.equal(boundName(sim, label, 'fills'), 'Component:button/secondary/text');
  assert.equal(boundName(sim, label, 'fontSize'), 'Primitives:font/size/300');
  assert.match(String(Object.keys(defs).find((k) => k.startsWith('Label#'))), /^Label#/);
  assert.deepEqual(label.componentPropertyReferences, { characters: Object.keys(defs).find((k) => k.startsWith('Label#')) });
  const icon = partOf(v, 'icon-start');
  assert.deepEqual(icon.componentPropertyReferences, { visible: Object.keys(defs).find((k) => k.startsWith('Icon start#')) });
  assert.equal(boundName(sim, icon, 'width'), 'Base:icon/size/sm');
  // Disabled ghost: no fill at all, disabled text color.
  const ghost = variantOf(button, 'Variant=ghost, Size=md, State=Disabled');
  assert.deepEqual(ghost.fills, []);
  assert.equal(boundName(sim, partOf(ghost, 'text'), 'fills'), 'Semantic:color/action/disabled/text');
  // Card: compound parts with their own text properties.
  const card = page.children.find((s) => s.name === 'Card')!;
  assert.deepEqual(
    partOf(variantOf(card, 'Padding=default'), 'root').children.map((c) => c.name),
    ['Header', 'Body', 'Footer'],
  );
});

test('baseline: a fresh pull never shows a component request in Push', async () => {
  const { plan } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const scanned = await scanComponents(() => {});
  assert.equal(scanned.components.length, 6);
  for (const c of scanned.components) assert.deepEqual(c.baseline, c.signature, `${c.name} baseline equals its signature`);
  const scan = classifyComponents(scanned.components, CODED);
  assert.deepEqual([scan.changed.length, scan.candidates.length, scan.adopt.length], [0, 0, 0]);
  // The UI's after-pull refresh stores the same baselines again.
  assert.equal(pullBaselines(scanned.components, CODED).length, 6);
});

test('idempotent: a second pull finds the sets, writes nothing new and never duplicates them', async () => {
  const first = await pulledFile();
  await applyComponentPlan(writablePlan(first.plan));
  const ids = first.sim.sets().map((s) => s.id);
  const variantIds = first.sim.sets()[0]!.children.map((c) => c.id);
  const again = await pulledFile({ sim: first.sim, gh: first.gh });
  assert.deepEqual(again.plan.components.map((c) => c.status), SPEC_COMPONENTS.map(() => 'unchanged'));
  assert.equal(pendingComponents(again.plan).length, 0);
  // Forcing an update rebuilds in place: same sets, same variants, same layers.
  const forced = { ...again.plan, components: again.plan.components.map((c) => ({ ...c, status: 'updated' as const })) };
  const report = await applyComponentPlan(forced);
  assert.deepEqual([report.created, report.updated], [0, 6]);
  assert.deepEqual(first.sim.sets().map((s) => s.id), ids);
  assert.deepEqual(first.sim.sets()[0]!.children.map((c) => c.id), variantIds);
  const scanned = await scanComponents(() => {});
  assert.equal(classifyComponents(scanned.components, CODED).changed.length, 0);
});

test('code removes a variant: the Figma variant is flagged [orphan], kept, and nothing else moves', async () => {
  const first = await pulledFile();
  await applyComponentPlan(writablePlan(first.plan));
  const designerNote = (globalThis as unknown as { figma: { createFrame(): SimNode } }).figma.createFrame();
  first.sim.currentPage.appendChild(designerNote);
  // Code drops the danger tone of Badge.
  const specs: ComponentSpecsFile = structuredClone(first.specs);
  const badge = specs.components.find((c) => c.name === 'Badge')!;
  badge.axes[0]!.values = badge.axes[0]!.values.filter((v) => v !== 'danger');
  badge.variants = badge.variants.filter((v) => v.props.Tone !== 'danger');
  badge.hash = hashSpec(badge);
  const gh = new FakeGitHub(repoFiles(JSON.stringify(specs)));
  const next = await pulledFile({ sim: first.sim, gh });
  const planned = next.plan.components.find((c) => c.name === 'Badge')!;
  assert.equal(planned.status, 'updated');
  assert.equal(planned.removedVariants.length, 4);
  const report = await applyComponentPlan(writablePlan(next.plan));
  assert.deepEqual([report.created, report.updated, report.orphaned], [0, 1, 4]);
  const set = first.sim.sets().find((s) => s.name === 'Badge')!;
  assert.equal(set.children.length, 20, 'removed variants are kept');
  const orphans = set.children.filter((c) => c.getSharedPluginData('dsbridge', 'orphan') === 'true');
  assert.deepEqual(orphans.map((o) => o.description.slice(0, 9)), ['[orphan] ', '[orphan] ', '[orphan] ', '[orphan] ']);
  assert.ok(first.sim.nodes.has(designerNote.id), 'layers outside generated sets are untouched');
  const after = await scanGenerated();
  assert.equal(after.find((g) => g.componentId === 'Badge')!.variants.length, 16);
});

test('fonts: a brand font missing in Figma falls back to Inter, said once', async () => {
  const fonts = ['Regular', 'Medium', 'Semi Bold', 'Bold'].map((style) => ({ family: 'Inter', style }));
  const { sim, plan } = await pulledFile({ fonts });
  const report = await applyComponentPlan(writablePlan(plan));
  assert.match(report.fontNote ?? '', /^Instrument Sans.* not available in this Figma, so text uses Inter/);
  const label = partOf(variantOf(sim.sets()[0]!, 'Variant=primary, Size=md, State=Default'), 'text');
  assert.deepEqual(label.fontName, { family: 'Inter', style: 'Medium' });
});

test('variables missing in Figma: the part is reported, never bound to something else', async () => {
  const { sim, plan } = await pulledFile();
  // Someone deleted the Component collection after the pull.
  sim.collections = sim.collections.filter((c) => c.name !== 'Component');
  const report = await applyComponentPlan(writablePlan(plan));
  assert.equal(report.created, 6);
  assert.ok(report.problems.some((p) => /Button Variant=primary, Size=sm, State=Default, Button, fill: no variable "button\/primary\/bg" in Component/.test(p)));
});
