// Pull components: the coded components (packages/react/component-specs.json, generated from the TSX and CSS modules)
// become Figma component sets bound to the pulled variables. Runs the real main-thread code (apply.ts,
// build-components.ts, components.ts) against an in-memory Figma API (figma-api.ts), and GitHub against FakeGitHub.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ComponentSpecsFile, hashSpec, parseComponentSpecs } from '@bridge-ds/core';
import { generateRepoComponentSpecs } from '@bridge-ds/core/node';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, layoutVariants, scanGenerated } from '../src/main/build-components';
import { exportThumbnails, scanComponents } from '../src/main/components';
import { onlyComponent, plannedSignature, reviewUpdates, withoutComponents } from '../src/sync/component-review';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, coverageView, evaluateCalc, loadComponentSpecs, pendingComponents, writablePlan } from '../src/sync/component-pull';
import { classifyComponents, pullBaselines, suggestLine, suggestTitle } from '../src/sync/components';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma, type SimNode } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const specsText = () => readFileSync(join(ROOT, SPECS_PATH), 'utf8');
/** The generated sets of the committed file, in file order, and the component folders they come from. */
const SPEC_COMPONENTS = parseComponentSpecs(specsText()).components.map((c) => c.name);
const CODED = [...new Set(parseComponentSpecs(specsText()).components.map((c) => c.component ?? c.name))];

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
    ['Variant=primary|secondary|ghost|danger|link|inverse', 'Size=sm|md|lg', 'State=Default|Hover|Pressed|Disabled'],
  );
  assert.equal(button.variants.length, 72);
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
  assert.ok(plan.problems.some((p) => p.component === 'Badge' && p.property === 'minHeight' && /^calc\(size\.6 \+ space\.0-5\) = 26, set, not bound$/.test(p.reason)));
  // Optional content is drawn behind a boolean, not reported (an input's prefix).
  assert.ok(plan.components.find((c) => c.name === 'Input')!.properties.some((p) => p.name === 'Show prefix' && p.type === 'BOOLEAN'));
});

test('apply: every generated set on a Components page, bound to the variables, with text and boolean properties', async () => {
  const { sim, plan } = await pulledFile();
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual([report.created, report.updated, report.unchanged], [SPEC_COMPONENTS.length, 0, 0]);
  assert.deepEqual(report.problems, []);
  assert.equal(report.fontNote, undefined);
  const page = sim.root.children.find((p) => p.name === 'Components')!;
  assert.deepEqual(page.children.map((s) => `${s.type}:${s.name}`), SPEC_COMPONENTS.map((n) => `COMPONENT_SET:${n}`));
  const button = page.children.find((s) => s.name === 'Button')!;
  assert.equal(button.children.length, 72);
  const defs = button.componentPropertyDefinitions;
  assert.deepEqual(
    Object.entries(defs).map(([k, d]) => `${k.replace(/#.*$/, '')}:${d.type}`).sort(),
    ['Icon end:BOOLEAN', 'Icon end:INSTANCE_SWAP', 'Icon start:BOOLEAN', 'Icon start:INSTANCE_SWAP', 'Label:TEXT', 'Size:VARIANT', 'State:VARIANT', 'Variant:VARIANT'],
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
  const key = (name: string, type: string) => Object.keys(defs).find((k) => k.replace(/#.*$/, '') === name && defs[k]!.type === type);
  assert.deepEqual(icon.componentPropertyReferences, { mainComponent: key('Icon start', 'INSTANCE_SWAP'), visible: key('Icon start', 'BOOLEAN') });
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
  assert.equal(scanned.components.length, SPEC_COMPONENTS.length);
  for (const c of scanned.components) assert.deepEqual(c.baseline, c.signature, `${c.name} baseline equals its signature`);
  const scan = classifyComponents(scanned.components, CODED);
  assert.deepEqual([scan.changed.length, scan.candidates.length, scan.adopt.length], [0, 0, 0]);
  // The UI's after-pull refresh stores the same baselines again.
  assert.equal(pullBaselines(scanned.components, CODED).length, SPEC_COMPONENTS.length);
});

test('idempotent: a second pull finds the sets, writes nothing new and never duplicates them', async () => {
  const first = await pulledFile();
  await applyComponentPlan(writablePlan(first.plan));
  const ids = first.sim.sets().map((s) => s.id);
  const buttonSet = () => first.sim.sets().find((s) => s.name === 'Button')!;
  const variantIds = buttonSet().children.map((c) => c.id);
  const again = await pulledFile({ sim: first.sim, gh: first.gh });
  assert.deepEqual(again.plan.components.map((c) => c.status), SPEC_COMPONENTS.map(() => 'unchanged'));
  assert.equal(pendingComponents(again.plan).length, 0);
  // Forcing an update rebuilds in place: same sets, same variants, same layers.
  const forced = { ...again.plan, components: again.plan.components.map((c) => ({ ...c, status: 'updated' as const })) };
  const report = await applyComponentPlan(forced);
  assert.deepEqual([report.created, report.updated], [0, SPEC_COMPONENTS.length]);
  assert.deepEqual(first.sim.sets().map((s) => s.id), ids);
  assert.deepEqual(buttonSet().children.map((c) => c.id), variantIds);
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
  const label = partOf(variantOf(sim.sets().find((s) => s.name === 'Button')!, 'Variant=primary, Size=md, State=Default'), 'text');
  assert.deepEqual(label.fontName, { family: 'Inter', style: 'Medium' });
});

test('variables missing in Figma: the part is reported, never bound to something else', async () => {
  const { sim, plan } = await pulledFile();
  // Someone deleted the Component collection after the pull.
  sim.collections = sim.collections.filter((c) => c.name !== 'Component');
  const report = await applyComponentPlan(writablePlan(plan));
  assert.equal(report.created, SPEC_COMPONENTS.length);
  assert.ok(report.problems.some((p) => /Button Variant=primary, Size=sm, State=Default, Button, fill: no variable "button\/primary\/bg" in Component/.test(p)));
});

// ---------------------------------------------------------------------------------------------
// Fixes seen in real Figma on the Components page (Badge md padding, Card layout, Tag wrapper, grid spacing).

test('calc(): Badge md padding and min height are resolved from the tokens and set, not bound', async () => {
  const { sim, plan, a } = await pulledFile();
  assert.equal(evaluateCalc('calc(space.2 + space.0-5)', a.head), 10);
  assert.equal(evaluateCalc('calc((size.6 - space.1) * 2)', a.head), 40);
  assert.deepEqual(evaluateCalc('calc(space.2 + nope.1)', a.head), { problem: 'nope.1 is not a token on this branch' });
  const badge = plan.components.find((c) => c.name === 'Badge')!;
  const md = badge.variants.find((v) => v.props.Size === 'md')!;
  assert.deepEqual(md.parts.root!.find((f) => f.field === 'paddingLeft')!.value, { kind: 'number', value: 10, expr: 'calc(space.2 + space.0-5)' });
  assert.ok(plan.problems.some((p) => p.component === 'Badge' && p.property === 'paddingLeft' && p.reason === 'calc(space.2 + space.0-5) = 10, set, not bound'));
  await applyComponentPlan(writablePlan(plan));
  const set = sim.sets().find((s) => s.name === 'Badge')!;
  const v = variantOf(set, 'Tone=neutral, Appearance=subtle, Size=md');
  assert.deepEqual([v.paddingLeft, v.paddingRight, v.minHeight], [10, 10, 26], 'the label no longer touches the edges');
  assert.equal(boundName(sim, v, 'paddingLeft'), undefined, 'a calc() is set, not bound');
  // sm stays bound: a single token.
  assert.equal(boundName(sim, variantOf(set, 'Tone=neutral, Appearance=subtle, Size=sm'), 'paddingLeft'), 'Primitives:space/1-5');
});

test('Card: fixed width from the size scale, parts fill the card, body text wraps, content clipped, h3 header', async () => {
  const { sim, plan } = await pulledFile();
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.problems, []);
  const set = sim.sets().find((s) => s.name === 'Card')!;
  for (const padding of ['none', 'compact', 'default']) {
    const v = variantOf(set, `Padding=${padding}`);
    assert.equal(v.clipsContent, true, 'overflow: hidden: the footer fill stays inside the rounded corners');
    assert.equal(boundName(sim, v, 'width'), 'Primitives:size/80', 'the coded card fills its container: drawn 320 wide');
    assert.equal(v.layoutSizingHorizontal, 'FIXED');
    for (const id of ['header', 'body', 'footer']) assert.equal(partOf(v, id).layoutSizingHorizontal, 'FILL', `${padding}: ${id} fills the card width`);
    const body = partOf(v, 'body-text');
    assert.equal(body.type, 'INSTANCE', `${padding}: the body is a swappable slot`);
    assert.equal(body.layoutSizingHorizontal, 'FILL', `${padding}: the body slot is as wide as the body, never 0`);
    if (padding !== 'none') assert.equal(body.findOne((n) => n.type === 'TEXT')!.textAutoResize, 'HEIGHT', 'body text wraps');
  }
  // The header uses the h3 role of Card.module.css (21 / 28, semibold), not a bigger one.
  const header = partOf(variantOf(set, 'Padding=default'), 'header-text');
  assert.equal(boundName(sim, header, 'fontSize'), 'Brand:typography/h3/size');
  assert.equal(boundName(sim, header, 'lineHeight'), 'Brand:typography/h3/line-height');
  const resolved = (field: string) => sim.resolveVariable(sim.variables.find((x) => x.id === (header.boundVariables[field] as { id: string }).id)!);
  assert.deepEqual([resolved('fontSize'), resolved('lineHeight'), resolved('fontWeight')], [21, 28, 600]);
  // Inline components still hug.
  const button = variantOf(sim.sets().find((s) => s.name === 'Button')!, 'Variant=primary, Size=md, State=Default');
  assert.equal(button.layoutSizingHorizontal, 'HUG');
  assert.equal(button.clipsContent, false);
});

test('Tag: no wrapper frame, the icon and the Label text sit in the tag like Badge; a re-pull migrates the old layers', async () => {
  // The previous spec had a "label" wrapper frame between the tag and its content.
  const { specs } = await pulledFile();
  const old: ComponentSpecsFile = structuredClone(specs);
  const tag = old.components.find((c) => c.name === 'Tag')!;
  assert.deepEqual(tag.parts.map((p) => `${p.id}<${p.parent ?? ''}`), ['root<', 'icon<root', 'text<root']);
  tag.parts.splice(1, 0, { id: 'label', name: 'label', kind: 'frame', parent: 'root', layout: { direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' } });
  for (const p of tag.parts) if (p.id === 'icon' || p.id === 'text') p.parent = 'label';
  for (const v of tag.variants) {
    const { paddingTop, paddingRight, paddingBottom, paddingLeft, itemSpacing, ...rest } = v.values.root!;
    v.values.root = rest;
    v.values.label = { paddingTop, paddingRight, paddingBottom, paddingLeft, itemSpacing } as typeof rest;
  }
  tag.hash = hashSpec(tag);
  const first = await pulledFile({ gh: new FakeGitHub(repoFiles(JSON.stringify(old))) });
  await applyComponentPlan(writablePlan(first.plan));
  const set = first.sim.sets().find((s) => s.name === 'Tag')!;
  const v = variantOf(set, 'Tone=neutral, Size=md, State=Default');
  assert.deepEqual(v.children.map((c) => c.name), ['label']);
  const textId = partOf(v, 'text').id;
  // Pull the current spec: the wrapper goes, the text layer is the same node (instances keep their overrides).
  const next = await pulledFile({ sim: first.sim });
  assert.equal(next.plan.components.find((c) => c.name === 'Tag')!.status, 'updated');
  await applyComponentPlan(writablePlan(next.plan));
  assert.deepEqual(v.children.map((c) => `${c.type}:${c.name}`), ['INSTANCE:Icon', 'TEXT:Label']);
  assert.equal(partOf(v, 'text').id, textId);
  assert.equal(boundName(first.sim, v, 'paddingLeft'), 'Primitives:space/2');
  assert.equal(boundName(first.sim, v, 'itemSpacing'), 'Primitives:space/1');
  assert.equal(v.findAll((n) => n.name === 'label').length, 0);
});

test('grid: rows of different heights are evenly spaced, columns as wide as their widest variant', async () => {
  const { sim, plan } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const set = sim.sets().find((s) => s.name === 'Button')!;
  const comp = plan.components.find((c) => c.name === 'Button')!;
  // What Figma measures after auto layout: sm 32, md 44, lg 48 tall; Hover a bit wider.
  for (const c of set.children) {
    c.height = /Size=sm/.test(c.name) ? 32 : /Size=md/.test(c.name) ? 44 : 48;
    c.width = /State=Hover/.test(c.name) ? 120 : 100;
  }
  layoutVariants(set as unknown as ComponentSetNode, comp);
  const rows = [...new Set(set.children.map((c) => c.y))].sort((x, y) => x - y);
  assert.equal(rows.length, 18);
  const rowOf = (y: number) => set.children.filter((c) => c.y === y);
  const gaps = rows.slice(1).map((y, i) => y - (rows[i]! + Math.max(...rowOf(rows[i]!).map((c) => c.height))));
  assert.deepEqual([...new Set(gaps)], [24], 'the same gap between every row');
  const cols = [...new Set(set.children.map((c) => c.x))].sort((x, y) => x - y);
  assert.deepEqual(cols, [24, 148, 292, 416]);
  assert.equal(set.height, rows[17]! + 48 + 24);
});

// ---------------------------------------------------------------------------------------------
// Review updates (like Figma): what an update changes per set, before and after, one by one or all

/** Code changes after a first pull: Badge drops its danger tone, Card's plate uses color.bg.subtle. */
async function changedInCode() {
  const first = await pulledFile();
  await applyComponentPlan(writablePlan(first.plan));
  const specs: ComponentSpecsFile = structuredClone(first.specs);
  const badge = specs.components.find((c) => c.name === 'Badge')!;
  badge.axes[0]!.values = badge.axes[0]!.values.filter((v) => v !== 'danger');
  badge.variants = badge.variants.filter((v) => v.props.Tone !== 'danger');
  badge.hash = hashSpec(badge);
  const card = specs.components.find((c) => c.name === 'Card')!;
  for (const v of card.variants) v.values.root!.fill = 'color.bg.subtle';
  card.hash = hashSpec(card);
  const next = await pulledFile({ sim: first.sim, gh: new FakeGitHub(repoFiles(JSON.stringify(specs))) });
  return { first, next };
}

test('review: a fresh build matches its planned signature, so unchanged sets have nothing to review', async () => {
  const { sim, plan } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const scanned = await scanComponents(() => {});
  const forced = { ...plan, components: plan.components.map((c) => ({ ...c, status: 'updated' as const, nodeId: sim.sets().find((s) => s.name === c.name)!.id })) };
  const reviews = reviewUpdates(forced, new Map(scanned.components.map((c) => [c.nodeId, c.signature])));
  assert.equal(reviews.length, SPEC_COMPONENTS.length);
  for (const r of reviews) assert.deepEqual(r.changes.map((c) => c.field), ['Values set from code'], `${r.name}: no variant, prop or binding difference`);
  assert.deepEqual(plannedSignature(forced.components.find((c) => c.name === 'Button')!).variantAxes.Size, ['lg', 'md', 'sm']);
});

test('review: per set, the variants, props and bound variables an update changes', async () => {
  const { next } = await changedInCode();
  assert.deepEqual(next.plan.components.filter((c) => c.status === 'updated').map((c) => c.name), ['Badge', 'Card']);
  const scanned = await scanComponents(() => {});
  const reviews = reviewUpdates(next.plan, new Map(scanned.components.map((c) => [c.nodeId, c.signature])));
  assert.deepEqual(reviews.map((r) => r.name), ['Badge', 'Card']);
  const badge = reviews[0]!;
  assert.deepEqual(badge.changes[0], { field: 'Variant Tone', before: 'danger, info, neutral, success, warning', after: 'info, neutral, success, warning' });
  assert.equal(badge.removedVariants.length, 4);
  const card = reviews[1]!;
  // Padding none shows the Media slot: its plate (color.bg.muted) is one more fill there.
  assert.deepEqual(card.changes, [
    { field: 'Fill (Padding=compact; Padding=default)', before: 'card.bg, color.bg.subtle, color.text.default', after: 'color.bg.subtle, color.text.default' },
    { field: 'Fill (Padding=none)', before: 'card.bg, color.bg.muted, color.bg.subtle, color.text.default', after: 'color.bg.muted, color.bg.subtle, color.text.default' },
  ]);
});

test('update one by one: only that set is rebuilt; Update all builds the rest, never twice', async () => {
  const { first, next } = await changedInCode();
  const ids = first.sim.sets().map((s) => s.id);
  const one = await applyComponentPlan(onlyComponent(next.plan, 'Card'));
  assert.deepEqual([one.created, one.updated], [0, 1]);
  const card = first.sim.sets().find((s) => s.name === 'Card')!;
  assert.equal(boundName(first.sim, variantOf(card, 'Padding=default'), 'fills'), 'Semantic:color/bg/subtle');
  // Badge waits: still the old variants, still to update on the next check.
  const badge = first.sim.sets().find((s) => s.name === 'Badge')!;
  assert.equal(badge.children.filter((c) => c.getSharedPluginData('dsbridge', 'orphan') === 'true').length, 0);
  const again = await pulledFile({ sim: first.sim, gh: next.gh });
  assert.deepEqual(again.plan.components.map((c) => `${c.name}:${c.status}`).filter((x) => !x.endsWith(':unchanged')), ['Badge:updated']);
  // Update all after that: the updated Card is not built twice.
  const rest = withoutComponents(writablePlan(next.plan), new Set(['Card']));
  assert.deepEqual(rest.components.map((c) => c.name), ['Badge']);
  const all = await applyComponentPlan(rest);
  assert.deepEqual([all.created, all.updated, all.orphaned], [0, 1, 4]);
  assert.deepEqual(first.sim.sets().map((s) => s.id), ids, 'updated in place, same nodes');
});

test('thumbnails: a PNG per set for the before and after previews', async () => {
  const { sim, plan } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const sets = sim.sets().slice(0, 2).map((s) => s.id);
  const thumbs = await exportThumbnails([...sets, '999:999'], 196);
  assert.deepEqual(Object.keys(thumbs).sort(), [...sets].sort(), 'a missing node has no thumbnail');
  assert.ok(Object.values(thumbs).every((b) => typeof b === 'string' && b.length > 0));
});

// ---------------------------------------------------------------------------------------------
// Real icons and content slots: generated components swapped through INSTANCE_SWAP properties, like a Figma library

const mainOf = async (n: SimNode) => (await n.getMainComponentAsync())!.name;
const pageNamed = (sim: SimFigma, name: string) => sim.root.children.filter((p) => p.name === name);
const defsOf = (set: SimNode) => set.componentPropertyDefinitions;
const propKey = (set: SimNode, name: string, type: string) => Object.keys(defsOf(set)).find((k) => k.replace(/#.*$/, '') === name && defsOf(set)[k]!.type === type);

/** The spec as it was before swaps: icon placeholders, Card body as a TEXT property, no icons or slots. */
function specsBeforeSwaps(specs: ComponentSpecsFile): ComponentSpecsFile {
  const old: ComponentSpecsFile = structuredClone(specs);
  delete old.icons;
  delete old.iconStyle;
  delete old.slots;
  for (const c of old.components) {
    for (const p of c.parts) {
      if (p.swap?.options) p.text = p.name;
      delete p.swap;
    }
    for (const v of c.variants) delete v.slots;
    if (c.name === 'Card') c.properties.splice(1, 0, { name: 'Body', type: 'TEXT', default: 'Body' });
    c.hash = hashSpec(c);
  }
  return old;
}

test('icons: one component per icon on an Icons page, drawn from the SVG, bound to the icon tokens, built once', async () => {
  const { sim, plan, specs } = await pulledFile();
  assert.ok(specs.icons!.some((i) => i.name === 'Pencil' && /^<svg [^>]*viewBox="0 0 24 24"[^>]*stroke="currentColor"/.test(i.svg)));
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.problems, []);
  assert.equal(report.parts?.created, specs.icons!.length + specs.slots!.length);
  const [page] = pageNamed(sim, 'Icons');
  assert.ok(page);
  assert.deepEqual(page.children.map((c) => c.name), specs.icons!.map((i) => `Icon/${i.name}`));
  const plus = page.children.find((c) => c.name === 'Icon/Plus')!;
  assert.equal(plus.type, 'COMPONENT');
  assert.equal(plus.getSharedPluginData('dsbridge', 'iconId'), 'Plus');
  assert.deepEqual(plus.children.map((c) => `${c.type}:${c.name}`), ['VECTOR:Icon'], 'the SVG shapes are flattened into one vector');
  assert.equal(plus.children[0]!.paths, '<path d="M5 12h14"/><path d="M12 5v14"/>');
  assert.equal(boundName(sim, plus.children[0]!, 'strokes'), 'Semantic:color/text/default');
  assert.equal(boundName(sim, plus.children[0]!, 'strokeWeight'), 'Base:icon/stroke');
  assert.equal(boundName(sim, plus, 'width'), 'Base:icon/size/lg');
  assert.equal(boundName(sim, plus, 'height'), 'Base:icon/size/lg');
  // Aliases fold into one icon: MoreHorizontal and Ellipsis are the same Lucide icon.
  assert.deepEqual(specs.icons!.find((i) => i.name === 'MoreHorizontal')!.aliases, ['Ellipsis']);
  // Pull again: nothing redrawn, nothing duplicated, same nodes.
  const ids = page.children.map((c) => c.id);
  const again = await pulledFile({ sim, gh: undefined });
  const forced = { ...again.plan, components: again.plan.components.map((c) => ({ ...c, status: 'updated' as const })) };
  const second = await applyComponentPlan(forced);
  assert.equal(second.parts, undefined, 'unchanged icons are not redrawn');
  assert.equal(pageNamed(sim, 'Icons').length, 1);
  assert.equal(pageNamed(sim, 'Slots').length, 1);
  assert.deepEqual(page.children.map((c) => c.id), ids);
  assert.equal(sim.root.findAll((n) => n.type === 'COMPONENT' && !!n.getSharedPluginData('dsbridge', 'iconId')).length, specs.icons!.length);
});

test('IconButton: every variant holds an instance of the default icon, sized and colored by the variant, swappable', async () => {
  const { sim, plan, specs } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const set = sim.sets().find((s) => s.name === 'IconButton')!;
  const spec = specs.components.find((c) => c.name === 'IconButton')!;
  assert.equal(spec.parts.find((p) => p.id === 'icon')!.swap!.default, 'Icon/Pencil', 'default from the docs preview');
  for (const v of set.children) {
    const icon = partOf(v, 'icon');
    assert.equal(icon.type, 'INSTANCE', v.name);
    assert.equal(await mainOf(icon), 'Icon/Pencil', v.name);
    assert.equal(icon.getSharedPluginData('dsbridge', 'slotDefault'), 'Icon/Pencil');
  }
  const md = partOf(variantOf(set, 'Variant=primary, Size=md, State=Default'), 'icon');
  assert.equal(boundName(sim, md, 'width'), 'Base:icon/size/sm');
  assert.equal(boundName(sim, md, 'height'), 'Base:icon/size/sm');
  assert.equal(boundName(sim, md.children[0]!, 'strokes'), 'Component:button/primary/text');
  assert.equal(boundName(sim, md.children[0]!, 'strokeWeight'), 'Base:icon/stroke');
  const lg = partOf(variantOf(set, 'Variant=danger, Size=lg, State=Disabled'), 'icon');
  assert.equal(boundName(sim, lg, 'width'), 'Base:icon/size/md');
  assert.equal(boundName(sim, lg.children[0]!, 'strokes'), 'Semantic:color/action/disabled/text');
  // The swap property: default Pencil, every icon preferred; no visibility toggle (the icon is the button).
  const key = propKey(set, 'Icon', 'INSTANCE_SWAP')!;
  const def = defsOf(set)[key]!;
  assert.equal(sim.nodes.get(String(def.defaultValue))!.name, 'Icon/Pencil');
  const icons = pageNamed(sim, 'Icons')[0]!.children;
  assert.deepEqual(def.preferredValues, icons.map((c) => ({ type: 'COMPONENT', key: c.key })));
  assert.equal(propKey(set, 'Icon', 'BOOLEAN'), undefined);
  assert.deepEqual(md.componentPropertyReferences, { mainComponent: key });
  // Button: start and end icons from the AllStates story, BOOLEAN visibility kept next to each swap.
  const button = sim.sets().find((s) => s.name === 'Button')!;
  const bv = variantOf(button, 'Variant=primary, Size=md, State=Default');
  assert.deepEqual([await mainOf(partOf(bv, 'icon-start')), await mainOf(partOf(bv, 'icon-end'))], ['Icon/Plus', 'Icon/ChevronDown']);
  assert.ok(propKey(button, 'Icon start', 'BOOLEAN') && propKey(button, 'Icon start', 'INSTANCE_SWAP') && propKey(button, 'Icon end', 'INSTANCE_SWAP'));
  const badge = sim.sets().find((s) => s.name === 'Badge')!;
  assert.equal(await mainOf(partOf(badge.children[0]!, 'icon')), 'Icon/CircleCheck');
});

test('swap rule: another icon in a variant is a visual change; back to the code default, nothing to send', async () => {
  const { sim, plan } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const fresh = await scanComponents(() => {});
  assert.equal(classifyComponents(fresh.components, CODED).changed.length, 0, 'a fresh pull stores a baseline with no request');
  const set = sim.sets().find((s) => s.name === 'IconButton')!;
  const icon = partOf(variantOf(set, 'Variant=primary, Size=md, State=Default'), 'icon');
  const star = pageNamed(sim, 'Icons')[0]!.children.find((c) => c.name === 'Icon/Star')!;
  const pencil = pageNamed(sim, 'Icons')[0]!.children.find((c) => c.name === 'Icon/Pencil')!;
  icon.swapComponent(star);
  assert.equal(boundName(sim, icon.children[0]!, 'strokes'), 'Component:button/primary/text', 'the color override survives the swap');
  const swapped = classifyComponents((await scanComponents(() => {})).components, CODED);
  assert.equal(swapped.changed.length, 1);
  assert.equal(swapped.changed[0]!.kind, 'visual');
  assert.deepEqual(swapped.changed[0]!.changes, [{ field: 'Swapped instance (Size=md, State=Default, Variant=primary)', before: 'Icon/Pencil', after: 'Icon/Star' }]);
  icon.swapComponent(pencil);
  assert.equal(classifyComponents((await scanComponents(() => {})).components, CODED).changed.length, 0, 'back to the default: no request');
  // Changing the property default is an API change.
  set.editComponentProperty(propKey(set, 'Icon', 'INSTANCE_SWAP')!, { defaultValue: star.id });
  const prop = classifyComponents((await scanComponents(() => {})).components, CODED).changed[0]!;
  assert.equal(prop.kind, 'prop-change');
  assert.deepEqual(prop.changes, [{ field: 'Prop Icon', before: 'instance swap, default Icon/Pencil', after: 'instance swap, default Icon/Star' }]);
});

test('Card body slot: Media for padding none, body text otherwise, a Body swap with both slots, filling the card', async () => {
  const { sim, plan, specs } = await pulledFile();
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.problems, []);
  assert.deepEqual(specs.slots!.map((s) => s.name), ['Slot/Card body text', 'Slot/Media']);
  const slotsPage = pageNamed(sim, 'Slots')[0]!;
  const media = slotsPage.children.find((c) => c.name === 'Slot/Media')!;
  const text = slotsPage.children.find((c) => c.name === 'Slot/Card body text')!;
  assert.equal(boundName(sim, media, 'fills'), 'Semantic:color/bg/muted');
  assert.equal(boundName(sim, media, 'width'), 'Primitives:size/80');
  assert.equal(media.height, 180, '16:9 of the 320 wide card');
  const mediaIcon = media.children[0]!;
  assert.equal(await mainOf(mediaIcon), 'Icon/Image');
  assert.equal(boundName(sim, mediaIcon.children[0]!, 'strokes'), 'Semantic:color/text/muted');
  assert.deepEqual([media.primaryAxisAlignItems, media.counterAxisAlignItems], ['CENTER', 'CENTER']);
  const t = text.children[0]!;
  assert.equal(t.characters, 'Body');
  assert.equal(boundName(sim, t, 'fontSize'), 'Primitives:font/size/200');
  assert.equal(boundName(sim, t, 'fills'), 'Semantic:color/text/default');
  assert.ok(Object.keys(text.componentPropertyDefinitions).some((k) => k.startsWith('Text#')));

  const card = sim.sets().find((s) => s.name === 'Card')!;
  const none = partOf(variantOf(card, 'Padding=none'), 'body-text');
  assert.equal(await mainOf(none), 'Slot/Media');
  assert.equal(none.layoutSizingHorizontal, 'FILL', 'the media fills the card width');
  for (const p of ['compact', 'default']) assert.equal(await mainOf(partOf(variantOf(card, `Padding=${p}`), 'body-text')), 'Slot/Card body text');
  const key = propKey(card, 'Body', 'INSTANCE_SWAP')!;
  assert.ok(key);
  assert.equal(propKey(card, 'Body', 'TEXT'), undefined, 'the text moved into the slot');
  assert.equal(sim.nodes.get(String(defsOf(card)[key]!.defaultValue))!.name, 'Slot/Card body text');
  assert.deepEqual(defsOf(card)[key]!.preferredValues, [text, media].map((c) => ({ type: 'COMPONENT', key: c.key })));
  // Swap rule: text in padding none is a visual change; Media back is nothing.
  none.swapComponent(text);
  const changed = classifyComponents((await scanComponents(() => {})).components, CODED).changed;
  assert.deepEqual(changed.map((c) => [c.component, c.kind, c.changes]), [['Card', 'visual', [{ field: 'Swapped instance (Padding=none)', before: 'Slot/Media', after: 'Slot/Card body text' }]]]);
  none.swapComponent(media);
  assert.equal(classifyComponents((await scanComponents(() => {})).components, CODED).changed.length, 0);
});

test('migration: a file pulled before swaps gets instances in place of placeholders, and still no request', async () => {
  const { specs } = await pulledFile();
  const first = await pulledFile({ gh: new FakeGitHub(repoFiles(JSON.stringify(specsBeforeSwaps(specs)))) });
  await applyComponentPlan(writablePlan(first.plan));
  const card = first.sim.sets().find((s) => s.name === 'Card')!;
  assert.ok(propKey(card, 'Body', 'TEXT'));
  const button = first.sim.sets().find((s) => s.name === 'Button')!;
  assert.equal(partOf(button.children[0]!, 'icon-start').type, 'FRAME');
  const setIds = first.sim.sets().map((s) => s.id);
  const next = await pulledFile({ sim: first.sim });
  const before = specsBeforeSwaps(specs);
  const withSwaps = specs.components.filter((c) => before.components.find((x) => x.name === c.name)!.hash !== c.hash).map((c) => c.name);
  for (const n of ['Button', 'IconButton', 'Badge', 'Tag', 'Card']) assert.ok(withSwaps.includes(n), n);
  assert.deepEqual(next.plan.components.filter((c) => c.status === 'updated').map((c) => c.name), withSwaps);
  const report = await applyComponentPlan(writablePlan(next.plan));
  assert.deepEqual(report.problems, []);
  assert.deepEqual(first.sim.sets().map((s) => s.id), setIds, 'sets updated in place');
  for (const v of button.children) for (const id of ['icon-start', 'icon-end']) assert.equal(v.findAll((n) => n.getSharedPluginData('dsbridge', 'part') === id).map((n) => n.type).join(), 'INSTANCE');
  assert.equal(propKey(card, 'Body', 'TEXT'), undefined);
  assert.ok(propKey(card, 'Body', 'INSTANCE_SWAP'));
  const scanned = await scanComponents(() => {});
  assert.equal(scanned.components.length, SPEC_COMPONENTS.length, 'icon and slot components are never Push candidates');
  const scan = classifyComponents(scanned.components, CODED);
  assert.deepEqual([scan.changed.length, scan.candidates.length], [0, 0]);
});

test('real case: a third icon layer after Label in Button primary sm is a structure change, with the Icon end hint', async () => {
  const { sim, plan } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const button = sim.sets().find((s) => s.name === 'Button')!;
  const v = variantOf(button, 'Variant=primary, Size=sm, State=Default');
  const label = partOf(v, 'text');
  const pencil = pageNamed(sim, 'Icons')[0]!.children.find((c) => c.name === 'Icon/Pencil')!;
  // The designer drops an instance of an icon after the label; Icon start and Icon end stay hidden.
  const icon = pencil.createInstance();
  icon.name = 'Icon';
  label.parent!.insertChild(label.parent!.children.indexOf(label) + 1, icon);
  // As in the owner's file: both optional icons hidden by their BOOLEAN default.
  partOf(v, 'icon-start').visible = false;
  partOf(v, 'icon-end').visible = false;
  const scan = classifyComponents((await scanComponents(() => {})).components, CODED);
  assert.equal(scan.changed.length, 1);
  const item = scan.changed[0]!;
  assert.equal(item.component, 'Button');
  assert.equal(item.kind, 'structure', 'not a vague visual change');
  assert.deepEqual(item.changes, [{ field: 'New layer "Icon" (Size=sm, State=Default, Variant=primary)', after: 'instance Icon/Pencil, after "Label"' }]);
  assert.equal(suggestLine(item), 'New instance layer "Icon" (Icon/Pencil) after "Label" in primary sm');
  assert.equal(suggestTitle(item), 'Add a layer after Label');
  assert.equal(item.equivalent, 'Icon end already does this: show it with the Icon end property');
  assert.equal(item.suggestSkip, true, 'starts unchecked: the designer may only need the Icon end property');
});

test('structure: renaming or wrapping layers of a generated variant sends nothing', async () => {
  const { sim, plan } = await pulledFile();
  await applyComponentPlan(writablePlan(plan));
  const button = sim.sets().find((s) => s.name === 'Button')!;
  const v = variantOf(button, 'Variant=primary, Size=md, State=Default');
  partOf(v, 'text').name = 'Text';
  const scan = classifyComponents((await scanComponents(() => {})).components, CODED);
  assert.equal(scan.changed.length, 0);
});

test('coverage sets: every generated set binds variables in every variant; states, covers, layouts and underlines are drawn', async () => {
  const { sim, gh, plan } = await pulledFile();
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.problems, []);
  for (const s of sim.sets())
    for (const v of s.children) {
      const bound = [v, ...v.findAll()].some((n) => Object.keys(n.boundVariables).length > 0);
      assert.ok(bound, `${s.name} ${v.name} binds at least one variable`);
    }
  const set = (name: string) => sim.sets().find((s) => s.name === name)!;
  // Checkbox: the check mark shows only when checked, the minus only when mixed.
  const box = (props: string, id: string) => partOf(variantOf(set('Checkbox'), props), id);
  assert.equal(box('Checked=false, State=Default', 'indicator').visible, false);
  assert.equal(box('Checked=true, State=Default', 'icon').visible, true);
  assert.equal(box('Checked=true, State=Default', 'icon-2').visible, false);
  assert.equal(box('Checked=mixed, State=Default', 'icon').visible, false);
  // Switch: the thumb sits at the end of the track when on.
  const track = (checked: string) => partOf(variantOf(set('Switch'), `Label placement=end, Size=md, Checked=${checked}, State=Default`), 'track');
  assert.equal(track('false').primaryAxisAlignItems, 'MIN');
  assert.equal(track('true').primaryAxisAlignItems, 'MAX');
  // Avatar: the initials cover the circle (and the photo, when shown).
  assert.equal(partOf(variantOf(set('Avatar'), 'Size=md'), 'fallback').layoutPositioning, 'ABSOLUTE');
  // Link: underlined text. RadioGroup: the preview's option is the checked one.
  assert.equal(partOf(variantOf(set('Link'), 'Variant=inline, State=Default'), 'text').textDecoration, 'UNDERLINE');
  const group = variantOf(set('RadioGroup'), 'Orientation=vertical, State=Default');
  assert.deepEqual(
    ['radio', 'radio-2', 'radio-3'].map((id) => boundName(sim, partOf(group, id), 'fills')),
    ['Component:checkbox/bg', 'Component:checkbox/bg-checked', 'Component:checkbox/bg'],
  );
  // A filled button's transparent 1px border still takes its room, like CSS border-box (fidelity check, PR 137).
  const primary = variantOf(set('Button'), 'Variant=primary, Size=md, State=Default');
  assert.deepEqual([primary.strokes.length, primary.strokes[0]!.opacity, primary.strokesIncludedInLayout, primary.strokeAlign], [1, 0, true, 'INSIDE']);
  assert.equal(boundName(sim, primary, 'strokeWeight'), 'Base:border-width/default');
  // A second pull finds every set again: nothing to build, nothing duplicated.
  const ids = sim.sets().map((s) => s.id);
  const again = await pulledFile({ sim, gh });
  assert.equal(pendingComponents(again.plan).length, 0);
  assert.deepEqual(sim.sets().map((s) => s.id), ids);
});

test('coverage: the count of components in Figma, the others with a plain reason, layout helpers apart; never complete without the list', async () => {
  const { plan, specs } = await pulledFile();
  const view = coverageView(plan);
  const cov = specs.coverage!;
  const visual = cov.filter((c) => c.status !== 'layout');
  assert.equal(view.headline, `${visual.filter((c) => c.status === 'generated').length} of ${visual.length} components are in Figma`);
  assert.equal(view.missing.length, visual.filter((c) => c.status === 'unsupported').length);
  assert.ok(view.missing.every((m) => m.reason.startsWith('Not supported yet: ')));
  assert.ok(view.missing.some((m) => m.name === 'Tabs' && m.reason === 'Not supported yet: draws with ::before or ::after'));
  assert.deepEqual(view.layout, cov.filter((c) => c.status === 'layout').map((c) => c.name));
  assert.equal(view.complete, false);
  // An older file with no coverage list: the count of what it has, and no claim that nothing is missing.
  const old = coverageView({ components: plan.components.slice(0, 6) });
  assert.equal(old.headline, '6 components are in Figma. The code does not list the others yet.');
  assert.equal(old.complete, false);
  assert.equal(coverageView({ components: plan.components, coverage: [{ name: 'Button', status: 'generated' }, { name: 'Box', status: 'unsupported' }] }).missing[0]!.reason, 'Not added yet');
});
