// Push components from Figma: a component changed in Figma goes back to the library as a library branch. Exact token
// swaps become a token change (contrast gate included); new variants, properties and components go to a branch Claude
// AI drafts; what the scan cannot read is listed with what to do. After the branch ships, a pull rebuilds the component
// from the reviewed code. Runs the real main-thread code against the in-memory Figma (figma-api.ts) and FakeGitHub.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DRAFTED_BY_CLAUDE_LABEL, FROM_FIGMA_LABEL, WAITING_FOR_CLAUDE_LABEL, figmaChangeOnGitHub, figmaPushStatusesOnGitHub, markFigmaChangeDraftedOnGitHub, parseComponentSpecs, parseFigmaOrigin, parseFigmaSpec } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { markPushed, scanComponents } from '../src/main/components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, pushedInReview, pushedNumbers, writablePlan } from '../src/sync/component-pull';
import { onlyComponent, reviewUpdates } from '../src/sync/component-review';
import { componentPushes, rebindsOf, unknownOf } from '../src/sync/component-push';
import { type ComponentChangeItem, type RawComponent, type ScannedComponent, buildSignature, classifyComponents, fnv1a, suggestLine, suggestSummary, suggestTitle } from '../src/sync/components';
import { analyze, buildPull, buildPush } from '../src/sync/flows';
import { publish } from '../src/sync/publish';
import { startExploration, targetOf } from '../src/sync/explorations';
import { FakeGitHub } from './fake-github';
import { SimFigma, type SimNode } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const specsText = () => readFileSync(join(ROOT, SPECS_PATH), 'utf8');
const CODED = [...new Set(parseComponentSpecs(specsText()).components.map((c) => c.component ?? c.name))];
const TOKENS = DEFAULT_SETTINGS.tokensPath;

function repoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${TOKENS}/${rel}`] = text;
  out[`${TOKENS}/contrast.checks.json`] = realChecksText();
  out['bridge.config.json'] = realConfigText();
  out[SPECS_PATH] = specsText();
  for (const name of CODED) out[`packages/react/src/components/${name}/${name}.tsx`] = '';
  return out;
}

/** A file with the variables pulled and the Button set built from code (the real main-thread code). */
async function pulledButton() {
  const sim = new SimFigma();
  sim.install();
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const first = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(first, new Map()).plan);
  const loaded = (await loadComponentSpecs(client, first.headFiles.treeSha, first.headFiles.config))!;
  const plan = buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), first.head);
  await applyComponentPlan(onlyComponent(writablePlan(plan), 'Button'));
  const sync = { baseSha: first.headSha };
  const button = sim.root.children.find((p) => p.name === 'Components')!.children.find((s) => s.name === 'Button')!;
  return { sim, gh, client, sync, button };
}

const variable = (sim: SimFigma, name: string) => sim.variables.find((v) => v.name === name)!;
/** The designer binds the root fill of a variant to another variable. */
function bindFill(sim: SimFigma, set: SimNode, variant: string, name: string) {
  const v = set.children.find((c) => c.name === variant)!;
  v.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variable(sim, name).id } } }];
}
const PRIMARY_DEFAULT = ['sm', 'md', 'lg'].map((s) => `Variant=primary, Size=${s}, State=Default`);
/** The same variants as the signature keys them (axes sorted). */
const PRIMARY_KEYS = ['lg', 'md', 'sm'].map((s) => `Size=${s}, State=Default, Variant=primary`);

/** Scan, classify and route like the Push tab does. */
async function scanAndRoute(client: ReturnType<FakeGitHub['client']>, sync: { baseSha: string }) {
  const a = await analyze(client, DEFAULT_SETTINGS, sync, await takeSnapshot());
  const scanned = await scanComponents(() => undefined);
  const scan = classifyComponents(scanned.components, CODED);
  const pushes = componentPushes([...scan.changed, ...scan.candidates], { head: a.head, files: a.headFiles, pairs: a.pairs, scanned: scanned.components, coded: scan.coded, text: (i) => ({ title: suggestTitle(i), summary: suggestSummary(i), line: suggestLine(i) }) });
  return { a, scan, pushes, scanned };
}

async function send(client: ReturnType<FakeGitHub['client']>, r: Awaited<ReturnType<typeof scanAndRoute>>, extra: { image?: () => Promise<string> } = {}) {
  return publish(client, {
    analysis: r.a,
    proposal: buildPush(r.a, new Map()),
    components: r.scan.changed,
    pushes: r.pushes,
    unchecked: new Set(),
    description: '',
    descriptionIsDraft: true,
    title: '',
    fileName: 'Test file',
    coded: r.scan.coded,
    ...(extra.image ? { image: extra.image } : {}),
  });
}

test('exact: a component token swap becomes a token change, labelled from Figma, and a pull rebuilds the set once it ships', async () => {
  const { sim, gh, client, sync, button } = await pulledButton();
  for (const v of PRIMARY_DEFAULT) bindFill(sim, button, v, 'color/action/primary/bg-active');
  const r = await scanAndRoute(client, sync);
  const item = r.scan.changed.find((c) => c.component === 'Button')!;
  assert.equal(item.kind, 'token-binding');
  assert.deepEqual(rebindsOf(item.baseline!, item.signature), [{ kind: 'fill', variants: PRIMARY_KEYS, allVariants: false, before: ['button.primary.bg'], after: ['color.action.primary.bg-active'] }]);
  const push = r.pushes.find((p) => p.nodeId === item.nodeId)!;
  assert.equal(push.plan.route, 'token-change');
  assert.equal(push.blocked, undefined);
  assert.deepEqual(push.plan.edits.map((e) => [e.op, e.path, e.value]), [['set', 'button.primary.bg', '{color.action.primary.bg-active}']]);
  assert.match(push.plan.said, /^Exact, no AI: button\.primary\.bg points to the new variable/);

  const res = await send(client, r);
  assert.deepEqual(res.failed, []);
  assert.deepEqual(res.requests, [], 'no issue: the change is a library branch');
  assert.equal(res.branches.length, 1);
  const b = res.branches[0]!;
  assert.equal(b.route, 'token-change');
  const pr = gh.prs[b.number - 1]!;
  assert.ok(pr.labels.includes(FROM_FIGMA_LABEL) && pr.labels.includes('source: figma') && pr.labels.some((l) => l.startsWith('tier: ')), pr.labels.join());
  assert.equal(parseFigmaOrigin(pr.body)?.route, 'token-change');
  assert.match(pr.body, /Exact token change, no AI/);
  const tokens = gh.filesAt(b.branch)[`${TOKENS}/components/button.tokens.json`]!;
  assert.match(tokens, /"bg": \{\s*"\$value": "\{color\.action\.primary\.bg-active\}"/);
  assert.match(gh.filesAt('main')[`${TOKENS}/components/button.tokens.json`]!, /"bg": \{\s*"\$value": "\{color\.action\.primary\.bg\}"/, 'main is untouched');

  // The set remembers its library branch; while it is open, a pull keeps the Figma version and says it is in review.
  await markPushed(item.nodeId, JSON.stringify({ number: b.number, url: b.url, route: b.route }));
  let generated = await scanGenerated();
  assert.deepEqual(pushedNumbers(generated), [b.number]);
  let statuses = await figmaPushStatusesOnGitHub(client, pushedNumbers(generated));
  assert.deepEqual(pushedInReview(generated, statuses).map((x) => `${x.name} ${x.status.key}`), ['Button in-review']);

  // It ships: main gets the token change, the pull rebuilds Button from the reviewed code (bound to button/primary/bg).
  pr.state = 'merged';
  gh.pushToMain((files) => Object.assign(files, gh.filesAt(b.branch)));
  const a2 = await analyze(client, DEFAULT_SETTINGS, sync, await takeSnapshot());
  await applyPullPlan(buildPull(a2, new Map()).plan);
  generated = await scanGenerated();
  statuses = await figmaPushStatusesOnGitHub(client, pushedNumbers(generated));
  const loaded = (await loadComponentSpecs(client, a2.headFiles.treeSha, a2.headFiles.config))!;
  const plan = buildComponentPlan(loaded.specs, loaded.path, generated, a2.head, { pushed: statuses });
  const planned = plan.components.find((c) => c.componentId === 'Button')!;
  assert.equal(planned.status, 'updated', 'shipped from Figma: rebuilt even though the spec did not change');
  assert.equal(planned.fromFigma?.status.key, 'shipped');
  const now = await scanComponents(() => undefined);
  const review = reviewUpdates(plan, new Map(now.components.map((c) => [c.nodeId, c.signature])))[0]!;
  assert.deepEqual(review.changes[0], { field: 'Your change from Figma', before: `In Figma, sent as #${b.number}`, after: 'Shipped: rebuilt from the reviewed code' });
  assert.ok(review.changes.some((c) => c.field.startsWith('Fill') && /\bbutton\.primary\.bg\b/.test(c.after ?? '') && /bg-active/.test(c.before ?? '')), 'the update binds the component token again');
  await applyComponentPlan(onlyComponent(plan, 'Button'));
  const md = button.children.find((c) => c.name === PRIMARY_DEFAULT[1])!;
  const bound = (md.boundVariables.fills as { id: string }[])[0]!.id;
  assert.equal(sim.variables.find((v) => v.id === bound)!.name, 'button/primary/bg');
  assert.equal((await scanGenerated()).find((g) => g.componentId === 'Button')!.pushed, undefined, 'the mark goes once rebuilt');
  // Figma now matches the reviewed code: the next scan sends nothing.
  const again = await scanAndRoute(client, { baseSha: a2.headSha });
  assert.equal(again.scan.changed.filter((c) => c.component === 'Button').length, 0);
});

test('exact, to an exploration: the token change is committed on the exploration branch, no request, main untouched', async () => {
  const { sim, gh, client, sync, button } = await pulledButton();
  const exploration = await startExploration(client, undefined, 'main', { name: 'Darker primary', purpose: 'Does a darker primary read better?' });
  for (const v of PRIMARY_DEFAULT) bindFill(sim, button, v, 'color/action/primary/bg-active');
  const r = await scanAndRoute(client, sync);
  const item = r.scan.changed.find((c) => c.component === 'Button')!;
  assert.equal(r.pushes.find((p) => p.nodeId === item.nodeId)!.plan.route, 'token-change');
  const res = await publish(client, {
    analysis: r.a,
    proposal: buildPush(r.a, new Map()),
    components: r.scan.changed,
    pushes: r.pushes,
    unchecked: new Set(),
    description: '',
    descriptionIsDraft: true,
    title: '',
    fileName: 'Test file',
    coded: r.scan.coded,
    exploration: targetOf(exploration),
  });
  assert.deepEqual(res.failed, []);
  assert.deepEqual(res.requests, [], 'no issue: an exact token change needs no code');
  assert.deepEqual(res.branches, [], 'no library branch: it is in the exploration');
  assert.deepEqual(res.explorationTokens?.map((x) => x.component), ['Button']);
  const there = gh.filesAt(exploration.branch)[`${TOKENS}/components/button.tokens.json`]!;
  assert.match(there, /"bg": \{\s*"\$value": "\{color\.action\.primary\.bg-active\}"/, 'the exploration paints Button with the new variable');
  assert.match(gh.filesAt('main')[`${TOKENS}/components/button.tokens.json`]!, /"bg": \{\s*"\$value": "\{color\.action\.primary\.bg\}"/, 'main is untouched');
});

test('exact, gated: a token swap that breaks contrast is held back, never sent', async () => {
  const { sim, gh, client, sync, button } = await pulledButton();
  for (const v of PRIMARY_DEFAULT) bindFill(sim, button, v, 'color/action/primary/text');
  const r = await scanAndRoute(client, sync);
  const push = r.pushes.find((p) => p.diff.component === 'Button')!;
  assert.equal(push.plan.route, 'token-change');
  assert.match(push.blocked ?? '', /^Not sent: \d+ contrast pair\(s\) would fail/);
  const res = await send(client, r);
  assert.equal(res.branches.length, 0);
  assert.equal(res.held[0]?.component, 'Button');
  assert.equal(gh.prs.length, 0);
});

test('a swap on a token other variants still use goes to Claude AI, with the reason', async () => {
  const { sim, client, sync, button } = await pulledButton();
  bindFill(sim, button, PRIMARY_DEFAULT[1]!, 'color/action/primary/bg-active');
  const r = await scanAndRoute(client, sync);
  const push = r.pushes.find((p) => p.diff.component === 'Button')!;
  assert.equal(push.plan.route, 'claude-draft');
  assert.match(push.plan.reasons[0]!, /^button\.primary\.bg also paints primary sm and primary lg: pointing it to color\.action\.primary\.bg-active would change them too, so it needs a new token for primary md\.$/);
});

// ---------------------------------------------------------------------------------------------
// Claude AI drafts, and what Bridge cannot read

function raw(name: string, nodeId: string, sizes: string[], opts: { fill?: string; props?: RawComponent['definitions']; layers?: RawComponent['variants'][number]['layers']; render?: string } = {}): RawComponent {
  return {
    nodeId,
    name,
    definitions: [{ name: 'Size', type: 'VARIANT', default: sizes[0]!, options: sizes }, ...(opts.props ?? [])],
    variants: sizes.map((s) => ({
      props: { Size: s },
      bindings: [{ kind: 'fill', variable: opts.fill ?? 'button/primary/bg', value: '1,1,1,255' }],
      render: opts.render ?? fnv1a(`${name} ${s} ${opts.fill ?? ''}`),
      structure: fnv1a(name),
      ...(opts.layers ? { layers: opts.layers } : {}),
    })),
  };
}

function scanned(list: [RawComponent, RawComponent][]): ScannedComponent[] {
  return list.map(([base, cur]) => ({ nodeId: cur.nodeId, name: cur.name, signature: buildSignature(cur), baseline: buildSignature(base) }));
}

test('claude draft: a new variant opens a draft branch carrying the spec and a screenshot, waiting for Claude AI until it writes the code', async () => {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const found = scanned([[raw('Button', '1:1', ['sm', 'md']), raw('Button', '1:1', ['sm', 'md', 'lg'])]]);
  const scan = classifyComponents(found, CODED);
  const pushes = componentPushes(scan.changed, { head: a.head, files: a.headFiles, pairs: a.pairs, scanned: found, coded: scan.coded, fileKey: 'FILE', text: (i) => ({ title: suggestTitle(i), summary: suggestSummary(i), line: suggestLine(i) }) });
  assert.equal(pushes[0]!.plan.route, 'claude-draft');
  assert.equal(pushes[0]!.diff.needsCode, true);
  assert.deepEqual(pushes[0]!.diff.variantAxes, { Size: ['lg', 'md', 'sm'] });
  const res = await publish(client, { analysis: a, proposal: buildPush(a, new Map()), components: scan.changed, pushes, unchecked: new Set(), description: '', descriptionIsDraft: true, title: '', fileName: 'Test', fileKey: 'FILE', coded: scan.coded, image: async () => 'iVBORw0KGgo=' });
  assert.deepEqual(res.failed, []);
  const b = res.branches[0]!;
  assert.equal(b.route, 'claude-draft');
  assert.match(b.branch, /^bridge\/figma-button-/);
  const pr = gh.prs[b.number - 1]!;
  assert.equal(pr.draft, true);
  assert.deepEqual(pr.labels.filter((l) => [FROM_FIGMA_LABEL, WAITING_FOR_CLAUDE_LABEL, 'component-change', 'source: figma'].includes(l)).sort(), ['component-change', FROM_FIGMA_LABEL, 'source: figma', WAITING_FOR_CLAUDE_LABEL].sort());
  assert.match(pr.body, /^\*\*From Figma:\*\* \[Button\]\(https:\/\/www\.figma\.com\/design\/FILE\/\?node-id=1-1\)/);
  assert.match(pr.body, /\*\*Waiting for a developer:\*\* this branch carries the spec only, as a request/);
  const origin = parseFigmaOrigin(pr.body)!;
  const spec = parseFigmaSpec(gh.filesAt(b.branch)[origin.spec!])!;
  assert.equal(spec.component, 'Button');
  assert.deepEqual(spec.changes, [{ field: 'Variant Size', before: 'md, sm', after: 'lg, md, sm' }]);
  assert.equal(spec.images?.length, 1, 'the screenshot goes with the spec');
  assert.deepEqual(Object.keys(spec.bindings).sort(), ['Size=lg', 'Size=md', 'Size=sm']);

  // Claude reads the brief, writes the code on the branch, then says it is drafted. Never before the code is there.
  const view = await figmaChangeOnGitHub(client, b.number);
  assert.equal(view.status.key, 'waiting-for-claude');
  assert.match(view.brief!, /Draft the code for a component change made in Figma, on the library branch bridge\/figma-button-/);
  assert.match(view.brief!, /bridge_mark_figma_change_drafted \{ pr: 1 \}/);
  await assert.rejects(markFigmaChangeDraftedOnGitHub(client, b.number), /only carries the spec: write the component code there first/);
  const tip = gh.branches.get(b.branch)!;
  gh.branches.set(b.branch, gh.commit({ ...gh.filesAt(b.branch), 'packages/react/src/components/Button/Button.tsx': 'export const Button = 1;\n' }, [tip], 'feat(button): lg size'));
  const done = await markFigmaChangeDraftedOnGitHub(client, b.number);
  assert.equal(done.status.key, 'drafted');
  assert.ok(pr.labels.includes(DRAFTED_BY_CLAUDE_LABEL) && !pr.labels.includes(WAITING_FOR_CLAUDE_LABEL));
  assert.equal(pr.draft, false, 'marked ready for review in the same step');
  assert.match(pr.body, /\*\*Drafted with Claude\*\* from the Figma spec/);
});

test('fix in Figma: a detached layer, a raw value and a variable code lacks are listed with what to do, never sent', async () => {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const icon = { name: 'Icon', type: 'INSTANCE', main: 'Icon/Plus', visible: true, part: 'icon-start' };
  const label = { name: 'Label', type: 'TEXT', visible: true, part: 'text' };
  const found = scanned([
    // Card: the icon was detached (an instance became a frame with the same name).
    [raw('Card', '2:1', ['md'], { fill: 'card/bg', layers: [icon, label] }), raw('Card', '2:1', ['md'], { fill: 'card/bg', layers: [{ name: 'Icon', type: 'FRAME', visible: true }, label], render: 'changed' })],
    // Badge: the look changed with the same variables (a value set by hand).
    [raw('Badge', '3:1', ['md'], { fill: 'badge/neutral/bg' }), raw('Badge', '3:1', ['md'], { fill: 'badge/neutral/bg', render: 'changed' })],
    // Button: bound to a variable only Figma has.
    [raw('Button', '1:1', ['md']), raw('Button', '1:1', ['md'], { fill: 'brand-new/only-in-figma' })],
  ]);
  const scan = classifyComponents(found, CODED);
  const pushes = componentPushes(scan.changed, { head: a.head, files: a.headFiles, pairs: a.pairs, scanned: found, coded: scan.coded, text: (i) => ({ title: suggestTitle(i), summary: suggestSummary(i) }) });
  const by = (c: string) => pushes.find((p) => p.diff.component === c)!;
  assert.deepEqual(pushes.map((p) => `${p.diff.component}:${p.plan.route}`).sort(), ['Badge:manual', 'Button:manual', 'Card:manual']);
  assert.match(by('Card').plan.issues[0]!.what, /^"Icon" was detached from its component in Size=md/);
  assert.match(by('Card').plan.issues[0]!.todo, /Reset instance/);
  assert.match(by('Badge').plan.issues[0]!.what, /^The look of Size=md changed with the same variables: a value was set by hand/);
  assert.match(by('Button').plan.issues[0]!.what, /uses brand-new\.only-in-figma, a variable the library does not have yet/);
  assert.match(by('Button').plan.issues[0]!.todo, /^Send the variable first/);
  const res = await publish(client, { analysis: a, proposal: buildPush(a, new Map()), components: scan.changed, pushes, unchecked: new Set(), description: '', title: '', fileName: 'Test', coded: scan.coded });
  assert.deepEqual(res.branches, []);
  assert.deepEqual(res.held.map((x) => x.component).sort(), ['Badge', 'Button', 'Card']);
  assert.equal(gh.prs.length + gh.issues.length, 0);
  // Unknown edits are read from the change itself too (pure).
  const card = scan.changed.find((c) => c.component === 'Card') as ComponentChangeItem;
  assert.equal(unknownOf(card).length, 1);
});

test('a new component drawn in Figma goes to Claude AI as a new component spec', async () => {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const found: ScannedComponent[] = [{ nodeId: '9:1', name: 'Forms / Date picker', signature: buildSignature(raw('Forms / Date picker', '9:1', ['md'], { fill: 'color/bg/default' })) }];
  const scan = classifyComponents(found, CODED);
  const pushes = componentPushes(scan.candidates, { head: a.head, files: a.headFiles, pairs: a.pairs, scanned: found, coded: scan.coded, text: (i) => ({ title: suggestTitle(i), summary: suggestSummary(i) }) });
  assert.equal(pushes[0]!.diff.component, 'DatePicker');
  assert.equal(pushes[0]!.diff.coded, false);
  assert.equal(pushes[0]!.plan.route, 'claude-draft');
});
