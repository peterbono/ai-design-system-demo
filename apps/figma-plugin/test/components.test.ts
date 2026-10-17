// Component signatures and change requests: what needs code becomes a request (a GitHub issue), what does not
// (Figma-only restructures, variable value edits) triggers nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REQUESTS_BRANCH, parseRequestIssue } from '@bridge-ds/core';
import {
  type RawComponent,
  type RawVariant,
  buildSignature,
  classifyComponents,
  codedComponentNames,
  diffSignatures,
  fnv1a,
  pullBaselines,
  suggestTitle,
  toRequest,
} from '../src/sync/components';
import { loadCodedComponents, sendComponentRequest } from '../src/sync/requests';
import { FakeGitHub } from './fake-github';

function variant(size: string, tone: string, patch: Partial<RawVariant> = {}): RawVariant {
  return {
    props: { Size: size, Tone: tone },
    bindings: [
      { kind: 'fill', variable: `button/${tone}/bg`, value: tone === 'primary' ? '11,74,139,255' : '255,255,255,255' },
      { kind: 'fill', variable: `button/${tone}/fg`, value: '255,255,255,255' },
      { kind: 'radius', variable: 'button/radius', value: '8' },
      { kind: 'padding', variable: `space/${size === 'md' ? '3' : '2'}`, value: size === 'md' ? '12' : '8' },
      { kind: 'typography', variable: 'font/size/sm', value: '14' },
    ],
    render: fnv1a(`render ${size} ${tone}`),
    structure: fnv1a(`tree ${size} ${tone}`),
    ...patch,
  };
}

function button(patch: (c: RawComponent) => void = () => {}): RawComponent {
  const c: RawComponent = {
    nodeId: '1:2',
    name: 'Button',
    page: 'Components',
    definitions: [
      { name: 'Size', type: 'VARIANT', default: 'md', options: ['sm', 'md'] },
      { name: 'Tone', type: 'VARIANT', default: 'primary', options: ['primary', 'secondary'] },
      { name: 'Label#1:0', type: 'TEXT', default: 'Button' },
      { name: 'Show icon#2:0', type: 'BOOLEAN', default: 'false' },
    ],
    variants: ['sm', 'md'].flatMap((size) => ['primary', 'secondary'].map((tone) => variant(size, tone))),
  };
  patch(c);
  return c;
}

const sig = (c: RawComponent) => buildSignature(c);
const find = (c: RawComponent, size: string, tone: string) => c.variants.find((v) => v.props?.Size === size && v.props?.Tone === tone)!;

test('identical signatures: no request', () => {
  const d = diffSignatures(sig(button()), sig(button()));
  assert.equal(d.kind, undefined);
  assert.deepEqual(d.changes, []);
  assert.equal(d.figmaOnly, false);
});

test('signature: axes sorted, props without the Figma id suffix, bindings grouped per kind', () => {
  const s = sig(button());
  assert.deepEqual(s.variantAxes, { Size: ['md', 'sm'], Tone: ['primary', 'secondary'] });
  assert.deepEqual(s.properties.map((p) => p.name), ['Label', 'Show icon', 'Size', 'Tone']);
  assert.deepEqual(s.bindings.radius, ['button/radius']);
  assert.deepEqual(Object.keys(s.variants), ['Size=sm, Tone=primary', 'Size=sm, Tone=secondary', 'Size=md, Tone=primary', 'Size=md, Tone=secondary']);
});

test('layers regrouped only (same API, bindings and render): no request, Figma-only', () => {
  const regrouped = button((c) => {
    for (const v of c.variants) {
      // A wrapper frame, renamed layers, auto layout refactor: the tree changes, bindings come in another order.
      v.structure = fnv1a(`${v.structure} wrapped`);
      v.bindings = [...v.bindings].reverse();
    }
  });
  const d = diffSignatures(sig(button()), sig(regrouped));
  assert.equal(d.kind, undefined);
  assert.deepEqual(d.changes, []);
  assert.equal(d.figmaOnly, true);
  const scan = classifyComponents([{ nodeId: '1:2', name: 'Button', signature: sig(regrouped), baseline: sig(button()) }], ['Button']);
  assert.equal(scan.changed.length, 0);
  assert.deepEqual(scan.figmaOnly, ['Button']);
});

test('variant added: new-variant', () => {
  const next = button((c) => {
    c.definitions[1]!.options = ['primary', 'secondary', 'danger'];
    c.variants.push(variant('sm', 'danger'), variant('md', 'danger'));
  });
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, 'new-variant');
  assert.deepEqual(d.changes, [{ field: 'Variant Tone', before: 'primary, secondary', after: 'danger, primary, secondary' }]);
  assert.equal(suggestTitle({ kind: d.kind!, changes: d.changes, component: 'Button' }), 'Add a danger tone');
});

test('variant removed: new-variant, with the removed value', () => {
  const next = button((c) => {
    c.definitions[0]!.options = ['md'];
    c.variants = c.variants.filter((v) => v.props?.Size === 'md');
  });
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, 'new-variant');
  assert.equal(suggestTitle({ kind: d.kind!, changes: d.changes, component: 'Button' }), 'Remove the sm size');
});

test('property default changed: prop-change', () => {
  const next = button((c) => (c.definitions[3]!.default = 'true'));
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, 'prop-change');
  assert.deepEqual(d.changes, [{ field: 'Prop Show icon', before: 'boolean, default false', after: 'boolean, default true' }]);
});

test('property added: prop-change', () => {
  const next = button((c) => c.definitions.push({ name: 'Loading#3:0', type: 'BOOLEAN', default: 'false' }));
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, 'prop-change');
  assert.equal(suggestTitle({ kind: d.kind!, changes: d.changes, component: 'Button' }), 'Add the Loading prop');
});

test('fill rebound to another variable: token-binding', () => {
  const next = button((c) => {
    const v = find(c, 'md', 'primary');
    v.bindings = v.bindings.map((b) => (b.variable === 'button/primary/bg' ? { ...b, variable: 'color/action/danger/bg', value: '200,30,30,255' } : b));
    v.render = fnv1a('red button');
  });
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, 'token-binding');
  assert.deepEqual(d.changes, [
    { field: 'Fill (Size=md, Tone=primary)', before: 'button.primary.bg, button.primary.fg', after: 'button.primary.fg, color.action.danger.bg' },
  ]);
});

test('render changed with the same bindings and values: visual', () => {
  const next = button((c) => (find(c, 'sm', 'secondary').render = fnv1a('icon moved')));
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, 'visual');
  assert.deepEqual(d.changes, [{ field: 'Look of Size=sm, Tone=secondary', before: 'As in the baseline', after: 'Changed in Figma, no variable explains it' }]);
});

test('render changed because a bound variable value changed (button.radius 8 -> 12): no request', () => {
  const next = button((c) => {
    for (const v of c.variants) {
      v.bindings = v.bindings.map((b) => (b.variable === 'button/radius' ? { ...b, value: '12' } : b));
      v.render = fnv1a(`${v.render} rounder`);
    }
  });
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, undefined);
  assert.equal(d.explainedByVariables, true);
  const scan = classifyComponents([{ nodeId: '1:2', name: 'Button', signature: sig(next), baseline: sig(button()) }], ['Button']);
  assert.equal(scan.changed.length, 0);
  assert.deepEqual(scan.explained, ['Button']);
});

test('unknown component: new-component candidate, never adopted; coded one without baseline: adopted silently', () => {
  const picker = button((c) => {
    c.nodeId = '9:9';
    c.name = 'Forms / Date picker';
  });
  const scan = classifyComponents(
    [
      { nodeId: '1:2', name: 'Button', signature: sig(button()) },
      { nodeId: '9:9', name: picker.name, signature: sig(picker) },
    ],
    ['Button', 'Checkbox'],
  );
  assert.deepEqual(scan.adopt.map((x) => x.nodeId), ['1:2']);
  assert.equal(scan.changed.length, 0);
  assert.equal(scan.candidates.length, 1);
  const c = scan.candidates[0]!;
  assert.equal(c.kind, 'new-component');
  assert.equal(c.component, 'DatePicker');
  assert.equal(suggestTitle(c), 'Add the DatePicker component');
  assert.ok(c.changes.some((x) => x.field === 'Variant Tone' && x.after === 'primary, secondary'));
});

test('pull baselines: refresh explained and unchanged ones, keep pending changes, skip candidates', () => {
  const pending = button((c) => (c.definitions[3]!.default = 'true'));
  const items = pullBaselines(
    [
      { nodeId: 'a', name: 'Button', signature: sig(pending), baseline: sig(button()) },
      { nodeId: 'b', name: 'Checkbox', signature: sig(button()) },
      { nodeId: 'c', name: 'Card', signature: sig(button()), baseline: sig(button()) },
      { nodeId: 'd', name: 'Mystery', signature: sig(button()) },
    ],
    ['Button', 'Checkbox', 'Card'],
  );
  assert.deepEqual(items.map((x) => x.nodeId), ['b', 'c']);
});

test('coded components are the folders under components.dir', () => {
  assert.deepEqual(
    codedComponentNames(['packages/react/src/components/Button/Button.tsx', 'packages/react/src/components/Button/index.ts', 'packages/react/src/components/Card/Card.tsx', 'packages/react/src/components/index.ts', 'packages/react/src/other/X/X.tsx'], 'packages/react/src/components'),
    ['Button', 'Card'],
  );
});

test('send: image on the requests branch (created from main), then one issue with labels, assignees and the JSON block', async () => {
  const gh = new FakeGitHub({ 'packages/react/src/components/Button/Button.tsx': 'export {}', 'README.md': '#' });
  const client = gh.client();
  assert.deepEqual(await loadCodedComponents(client, `t-${gh.branches.get('main')}`, undefined), ['Button']);
  const next = button((c) => {
    c.definitions[1]!.options = ['primary', 'secondary', 'danger'];
    c.variants.push(variant('md', 'danger'));
  });
  const scan = classifyComponents([{ nodeId: '1:2', name: 'Button', signature: sig(next), baseline: sig(button()) }], ['Button']);
  const item = scan.changed[0]!;
  const req = toRequest({ component: item.component, kind: item.kind, title: suggestTitle(item), summary: 'Destructive actions in settings need a danger tone.', changes: item.changes, nodeId: item.nodeId, nodeName: item.figmaName }, { fileKey: undefined });
  const res = await sendComponentRequest(client, {
    request: req,
    images: ['iVBORw0KGgo='],
    baseBranch: 'main',
    config: { integrations: { requests: { labels: ['design'], assignees: ['peterbono'] } }, components: { dir: 'packages/react/src/components' } } as never,
    coded: true,
    now: new Date('2026-10-17T10:00:00Z'),
  });
  assert.equal(gh.branches.get(REQUESTS_BRANCH), gh.branches.get('main'), 'requests branch starts at main');
  const path = '.bridge/requests/button-20261017T100000.png';
  assert.equal(gh.binaries.get(REQUESTS_BRANCH)?.get(path), 'iVBORw0KGgo=');
  assert.deepEqual(res.images, [`https://github.com/o/r/blob/${REQUESTS_BRANCH}/${path}?raw=true`]);
  assert.equal(gh.issues.length, 1);
  assert.equal(gh.prs.length, 0, 'never a pull request');
  const issue = gh.issues[0]!;
  assert.equal(issue.title, 'Button: add a danger tone');
  assert.deepEqual(issue.labels, ['component-change', 'request: new-variant', 'source: figma', 'design']);
  assert.deepEqual(issue.assignees, ['peterbono']);
  assert.match(issue.body, /\| Variant Tone \| primary, secondary \| danger, primary, secondary \|/);
  assert.match(issue.body, /!\[Button design 1\]\(https:\/\/github\.com\/o\/r\/blob\/bridge-requests\//);
  assert.match(issue.body, /\*\*Design:\*\* Button\n/, 'no file key: the node name, no link');
  assert.match(issue.body, /\*\*Component:\*\* https:\/\/github\.com\/o\/r\/tree\/main\/packages\/react\/src\/components\/Button/);
  assert.doesNotMatch(issue.body, new RegExp(String.fromCharCode(0x2014)));
  const parsed = parseRequestIssue(issue.body)!;
  assert.equal(parsed.source, 'figma');
  assert.equal(parsed.kind, 'new-variant');
  assert.equal(parsed.figma?.url, undefined);
  assert.equal(parsed.figma?.nodeName, 'Button');
  assert.equal(parsed.requestedBy, undefined);

  // A second request reuses the branch and never moves it.
  const before = gh.branches.get(REQUESTS_BRANCH);
  await sendComponentRequest(client, { request: { ...req, summary: 'Again' }, images: ['AAAA'], baseBranch: 'main', now: new Date('2026-10-17T11:00:00Z') });
  assert.equal(gh.branches.get(REQUESTS_BRANCH), before);
  assert.equal(gh.issues.length, 2);
});

test('send: Figma link when the file key is known; no images means no branch; summary required', async () => {
  const gh = new FakeGitHub({ 'README.md': '#' });
  const client = gh.client();
  const req = toRequest({ component: 'Card', kind: 'visual', title: 'Tighter padding', summary: 'Cards feel loose on mobile.', changes: [], nodeId: '12:34', nodeName: 'Card' }, { fileKey: 'ABC' });
  await sendComponentRequest(client, { request: req, baseBranch: 'main' });
  assert.equal(gh.branches.has(REQUESTS_BRANCH), false);
  assert.match(gh.issues[0]!.body, /\[Card\]\(https:\/\/www\.figma\.com\/design\/ABC\/\?node-id=12-34\)/);
  await assert.rejects(sendComponentRequest(client, { request: { ...req, summary: '  ' }, baseBranch: 'main' }), /summary/);
});
