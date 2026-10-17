// Push like Figma's library publishing: a Changes list grouped Variables / Components, a checkbox per item, an
// "Experimental" mark that unchecks an item by default, and one "Push for review" that sends only what is checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type RawComponent, buildSignature, classifyComponents, fnv1a } from '../src/sync/components';
import { analyze, buildPull, buildPush } from '../src/sync/flows';
import {
  componentDrafts,
  componentKey,
  defaultUnchecked,
  experimentalTokenIds,
  groupState,
  heldTokenIds,
  publish,
  publishItems,
  publishPlan,
  setGroup,
  variableKey,
} from '../src/sync/publish';
import { setExperimental, scanComponents } from '../src/main/components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { applyPullPlan } from '../src/main/apply';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { applyPlanToSnapshot, findIn } from './figma-sim';
import { realChecksText, realConfigText, realFiles } from './helpers';

const PREFIX = DEFAULT_SETTINGS.tokensPath;

function repoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${PREFIX}/${rel}`] = text;
  out[`${PREFIX}/contrast.checks.json`] = realChecksText();
  out['bridge.config.json'] = realConfigText();
  out['packages/react/src/components/Button/Button.tsx'] = '';
  out['packages/react/src/components/Card/Card.tsx'] = '';
  return out;
}

/** A pulled file with two variable edits: a radius (primitive) and a space step. */
async function edited() {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const first = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const pull = buildPull(first, new Map());
  const snapshot = applyPlanToSnapshot(pull.plan, 'single');
  findIn(snapshot, 'Primitives', 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 5 };
  findIn(snapshot, 'Primitives', 'space/3').valuesByMode['Primitives:value'] = { kind: 'float', value: 13 };
  return { gh, client, snapshot, sync: { baseSha: pull.plan.headSha } };
}

function component(name: string, nodeId: string, fill: string): RawComponent {
  return {
    nodeId,
    name,
    definitions: [{ name: 'Size', type: 'VARIANT', default: 'md', options: ['md'] }],
    variants: [{ props: { Size: 'md' }, bindings: [{ kind: 'fill', variable: fill, value: '1,1,1,255' }], render: fnv1a(`${name} ${fill}`), structure: fnv1a(name) }],
  };
}

/** Button rebound to another fill (a token-binding change), Card the same, Card marked experimental. */
function componentScan() {
  return classifyComponents(
    [
      { nodeId: '1:1', name: 'Button', signature: buildSignature(component('Button', '1:1', 'button/primary/bg-hover')), baseline: buildSignature(component('Button', '1:1', 'button/primary/bg')) },
      { nodeId: '2:1', name: 'Card', signature: buildSignature(component('Card', '2:1', 'color/bg/subtle')), baseline: buildSignature(component('Card', '2:1', 'card/bg')), experimental: true },
    ],
    ['Button', 'Card'],
  );
}

test('every push starts with all items checked except experimental ones; groups select all', async () => {
  const { client, snapshot, sync } = await edited();
  findIn(snapshot, 'Primitives', 'space/3').experimental = true;
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const experimental = experimentalTokenIds(a, snapshot);
  assert.deepEqual([...experimental], ['path:space.3']);
  const scan = componentScan();
  assert.deepEqual(scan.changed.map((c) => `${c.component}:${c.kind}:${!!c.experimental}`), ['Button:token-binding:false', 'Card:token-binding:true']);
  const items = publishItems(a, experimental, scan.changed);
  assert.deepEqual(items.map((i) => `${i.kind} ${i.label}${i.experimental ? ' (experimental)' : ''}`), [
    'variable radius.sm',
    'variable space.3 (experimental)',
    'component Button',
    'component Card (experimental)',
  ]);
  const unchecked = defaultUnchecked(items);
  assert.deepEqual([...unchecked].sort(), [componentKey('2:1'), variableKey('path:space.3')]);
  assert.equal(groupState(items, unchecked, 'variable'), 'some');
  setGroup(items, unchecked, 'variable', true);
  assert.equal(groupState(items, unchecked, 'variable'), 'all', 'an experimental item can still be checked');
  setGroup(items, unchecked, 'component', false);
  assert.equal(groupState(items, unchecked, 'component'), 'none');
  assert.equal(groupState([], unchecked, 'component'), 'empty');
});

test('unchecked variable edits stay in Figma: only checked ones reach the pull request, with the description first', async () => {
  const { gh, client, snapshot, sync } = await edited();
  findIn(snapshot, 'Primitives', 'space/3').experimental = true;
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const items = publishItems(a, experimentalTokenIds(a, snapshot), []);
  const unchecked = defaultUnchecked(items);
  const held = heldTokenIds(items, unchecked);
  const proposal = buildPush(a, new Map(), new Set(), held);
  assert.deepEqual(proposal.changes.map((c) => c.target!.path), ['radius.sm']);
  assert.deepEqual(proposal.held.map((e) => e.path), ['space.3']);
  assert.deepEqual(Object.keys(proposal.files), ['primitives/radius.tokens.json']);
  const description = 'Softer small radius for chips, agreed in the design crit.';
  const res = await publish(client, { analysis: a, proposal, components: [], unchecked, description, title: '', fileName: 'Test', coded: [], now: new Date(Date.UTC(2026, 9, 17, 9)) });
  assert.equal(gh.prs.length, 1);
  assert.equal(res.requests.length, 0);
  const body = gh.prs[0]!.body;
  assert.ok(body.startsWith(`## What changed and why\n\n${description}\n`), 'the description opens the pull request');
  assert.match(body, /`radius\.sm`/);
  assert.doesNotMatch(body, /space\.3/, 'the unchecked edit is not in the pull request');
  const commit = gh.commits.get(res.pr!.commitSha)!;
  assert.equal(commit.files[`${PREFIX}/primitives/space.tokens.json`], gh.filesAt('main')[`${PREFIX}/primitives/space.tokens.json`]);
  // Still a Figma edit: the next scan lists it again.
  const again = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  assert.ok(again.diff.local.some((e) => e.path === 'space.3'));
});

test('checked component changes become one request each, with the description as summary; unchecked ones are not sent', async () => {
  const { gh, client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const scan = componentScan();
  const items = publishItems(a, new Set(), scan.changed);
  const unchecked = defaultUnchecked(items);
  // Variables unchecked by the designer: no pull request at all, only requests.
  setGroup(items, unchecked, 'variable', false);
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  assert.deepEqual(publishPlan({ proposal, components: scan.changed, unchecked, description: '', fileName: 'Test' }).prFiles, 0);
  const drafts = componentDrafts(scan.changed, unchecked, '', 'Library.fig');
  assert.deepEqual(drafts.map((d) => [d.component, d.summary]), [['Button', 'Changed in Figma ("Library.fig") and sent for review with DS Bridge.']]);
  const res = await publish(client, {
    analysis: a,
    proposal,
    components: scan.changed,
    unchecked,
    description: 'Hover should use the hover token.',
    title: '',
    fileName: 'Library.fig',
    coded: ['Button', 'Card'],
    image: async (nodeId) => (nodeId === '1:1' ? 'iVBORw0KGgo=' : undefined),
  });
  assert.equal(res.pr, undefined);
  assert.equal(gh.prs.length, 0);
  assert.deepEqual(res.requests.map((x) => [x.component, x.nodeId]), [['Button', '1:1']]);
  assert.equal(gh.issues.length, 1, 'the experimental Card change is not sent');
  assert.match(gh.issues[0]!.title, /^Button: /);
  assert.match(gh.issues[0]!.body, /Hover should use the hover token\./);
  assert.match(gh.issues[0]!.body, /!\[Button design 1\]/, 'the component image is attached');
});

test('nothing checked: Push for review refuses to send', async () => {
  const { client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const items = publishItems(a, new Set(), []);
  const unchecked = new Set(items.map((i) => i.key));
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  await assert.rejects(publish(client, { analysis: a, proposal, components: [], unchecked, description: '', title: '', fileName: 'Test', coded: [] }), /Nothing is checked/);
});

test('the experimental mark is durable shared plugin data on the variable and the component set (a variant marks its set)', async () => {
  const sim = new SimFigma().install();
  const gh = new FakeGitHub(repoFiles());
  const a = await analyze(gh.client(), DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const v = sim.variables.find((x) => x.name === 'radius/sm')!;
  const f = (globalThis as unknown as { figma: { createComponent(): never; combineAsVariants(n: unknown[], p: unknown): { id: string; name: string } } }).figma;
  const c1 = f.createComponent() as unknown as { id: string; name: string };
  c1.name = 'Size=md';
  sim.currentPage.appendChild(c1 as never);
  const set = f.combineAsVariants([c1], sim.currentPage);
  set.name = 'Button';
  assert.equal(await setExperimental([{ kind: 'variable', id: v.id }, { kind: 'component', id: c1.id }], true), 2);
  assert.equal(v.getSharedPluginData('dsbridge', 'experimental'), 'true');
  const snap = await takeSnapshot();
  assert.equal(snap.variables.find((x) => x.id === v.id)!.experimental, true);
  assert.equal(snap.variables.filter((x) => x.experimental).length, 1);
  const scanned = await scanComponents(() => {});
  assert.equal(scanned.components.find((x) => x.nodeId === set.id)!.experimental, true, 'the variant marked its set');
  await setExperimental([{ kind: 'component', id: set.id }], false);
  assert.equal((await scanComponents(() => {})).components.find((x) => x.nodeId === set.id)!.experimental, undefined);
});

test('a component change an optional part already covers starts unchecked, with its hint; checking it sends it anyway', async () => {
  const { gh, client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const label = { name: 'Label', type: 'TEXT', visible: true, part: 'text' };
  const iconEnd = { name: 'Icon end', type: 'INSTANCE', main: 'Icon/Plus', visible: false, part: 'icon-end', visibleProp: 'Icon end' };
  const raw = (added: boolean): RawComponent => ({
    nodeId: '1:1',
    name: 'Button',
    definitions: [{ name: 'Size', type: 'VARIANT', default: 'md', options: ['md'] }],
    variants: [
      {
        props: { Size: 'md' },
        bindings: [],
        render: added ? 'r2' : 'r1',
        layers: added ? [label, { name: 'Icon', type: 'INSTANCE', main: 'Icon/Pencil', visible: true }, iconEnd] : [label, iconEnd],
      },
    ],
  });
  const scan = classifyComponents([{ nodeId: '1:1', name: 'Button', signature: buildSignature(raw(true)), baseline: buildSignature(raw(false)) }], ['Button']);
  const items = publishItems(a, new Set(), scan.changed);
  const button = items.find((i) => i.kind === 'component')!;
  assert.equal(button.hint, 'Icon end already does this: show it with the Icon end property');
  const unchecked = defaultUnchecked(items);
  assert.ok(unchecked.has(componentKey('1:1')), 'starts unchecked');
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  assert.equal(publishPlan({ proposal, components: scan.changed, unchecked, description: '', fileName: 'Test' }).drafts.length, 0);
  // "Keep it as a request": checked, it becomes a structure request.
  unchecked.delete(componentKey('1:1'));
  const res = await publish(client, { analysis: a, proposal, components: scan.changed, unchecked, description: '', descriptionIsDraft: true, title: '', fileName: 'Test', coded: ['Button'] });
  assert.equal(res.requests.length, 1);
  assert.deepEqual(gh.issues[0]!.labels.slice(0, 2), ['component-change', 'request: structure']);
  assert.equal(gh.issues[0]!.title, 'Button: add a layer after Label');
});

test("Claude's request title per component names the issue; components without one keep the drafted title", async () => {
  const { gh, client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const scan = componentScan();
  const items = publishItems(a, new Set(), scan.changed);
  const unchecked = new Set(items.filter((i) => i.kind === 'variable').map((i) => i.key));
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  await publish(client, { analysis: a, proposal, components: scan.changed, unchecked, description: '', descriptionIsDraft: true, title: '', fileName: 'Test', coded: ['Button', 'Card'], titles: new Map([['1:1', 'Use the hover fill for primary buttons']]) });
  assert.deepEqual(gh.issues.map((i) => i.title), ['Button: use the hover fill for primary buttons', 'Card: use color.bg.subtle for the fill']);
});
