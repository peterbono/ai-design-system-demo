// Component signatures and change requests: what needs code becomes a request (a GitHub issue), what does not
// (Figma-only restructures, variable value edits) triggers nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REQUESTS_BRANCH, parseRequestIssue } from '@bridge-ds/core';
import {
  type RawComponent,
  type RawLayer,
  type RawVariant,
  buildSignature,
  classifyComponents,
  codedComponentNames,
  diffSignatures,
  fnv1a,
  pullBaselines,
  suggestLine,
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
    // Only what moved: the label keeps button.primary.fg.
    { field: 'Fill (Size=md, Tone=primary)', before: 'button.primary.bg', after: 'color.action.danger.bg' },
  ]);
});

test('one variant removed while its values stay on their axes: a variants change, not nothing', () => {
  const next = button((c) => (c.variants = c.variants.filter((v) => !(v.props?.Size === 'md' && v.props?.Tone === 'secondary'))));
  const d = diffSignatures(sig(button()), sig(next));
  assert.equal(d.kind, 'new-variant');
  assert.deepEqual(d.changes, [{ field: 'Variants', before: 'Size=md, Tone=secondary', after: undefined }]);
  // A whole axis value gone is the axis row's: no Variants row on top of it.
  const noMd = button((c) => {
    c.variants = c.variants.filter((v) => v.props?.Size !== 'md');
    c.definitions[0] = { ...c.definitions[0]!, options: ['sm'] };
  });
  assert.deepEqual(diffSignatures(sig(button()), sig(noMd)).changes.map((x) => x.field), ['Variant Size']);
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

// ---------------------------------------------------------------------------------------------
// Structure: layers added, removed or moved

const L = (name: string, type: string, extra: Partial<RawLayer> = {}): RawLayer => ({ name, type, visible: true, ...extra });
const buttonLayers = (): RawLayer[] => [
  L('Icon start', 'INSTANCE', { main: 'Icon/Plus', visible: false, part: 'icon-start', visibleProp: 'Icon start' }),
  L('Label', 'TEXT', { part: 'text', textProp: 'Label' }),
  L('Icon end', 'INSTANCE', { main: 'Icon/Plus', visible: false, part: 'icon-end', visibleProp: 'Icon end' }),
];
function withLayers(edit?: (layers: RawLayer[], size: string, tone: string) => RawLayer[] | void, render?: (size: string, tone: string) => string | undefined): RawComponent {
  return button((c) => {
    for (const v of c.variants) {
      const size = v.props!.Size!;
      const tone = v.props!.Tone!;
      const layers = buttonLayers();
      v.layers = (edit?.(layers, size, tone) as RawLayer[] | undefined) ?? layers;
      const r = render?.(size, tone);
      if (r) v.render = r;
    }
  });
}
const smPrimary = (size: string, tone: string) => size === 'sm' && tone === 'primary';

test('structure: an instance before the label is a structure change, with the Icon start hint', () => {
  const cur = withLayers((ls, size, tone) => (smPrimary(size, tone) ? [ls[0]!, L('Leading', 'INSTANCE', { main: 'Icon/Pencil' }), ls[1]!, ls[2]!] : undefined), (s, t) => (smPrimary(s, t) ? 'new-render' : undefined));
  const d = diffSignatures(sig(withLayers()), sig(cur));
  assert.equal(d.kind, 'structure');
  assert.deepEqual(d.changes, [{ field: 'New layer "Leading" (Size=sm, Tone=primary)', after: 'instance Icon/Pencil, before "Label"' }]);
  assert.deepEqual(d.equivalents, ['Icon start already does this: show it with the Icon start property']);
  assert.equal(d.onlyEquivalents, true);
  assert.equal(suggestLine({ kind: d.kind!, changes: d.changes }), 'New instance layer "Leading" (Icon/Pencil) before "Label" in primary sm');
});

test('structure: a layer removed or moved in every variant', () => {
  const moved = withLayers((ls) => [ls[1]!, ls[0]!, ls[2]!], () => 'moved');
  const m = diffSignatures(sig(withLayers()), sig(moved));
  assert.equal(m.kind, 'structure');
  assert.equal(m.changes.length, 1);
  assert.match(m.changes[0]!.field, /^Moved layer "(Label|Icon start)"$/);
  assert.equal(m.onlyEquivalents, false);
  const removed = withLayers((ls) => [ls[0]!, ls[2]!], () => 'removed');
  const r = diffSignatures(sig(withLayers()), sig(removed));
  assert.deepEqual(r.changes, [{ field: 'Removed layer "Label"', before: 'text, after "Icon start"' }]);
  assert.equal(suggestTitle({ component: 'Button', kind: r.kind!, changes: r.changes }), 'Remove the Label layer');
});

test('structure: renames, wrappers and hidden unbound layers send nothing', () => {
  const renamed = withLayers((ls) => {
    ls[1]!.name = 'Text';
    return [L('Content', 'FRAME', { layout: 'HORIZONTAL', children: ls }), L('Note', 'TEXT', { visible: false })];
  });
  const d = diffSignatures(sig(withLayers()), sig(renamed));
  assert.equal(d.kind, undefined);
  assert.deepEqual(d.changes, []);
});

test('structure: a layer added with the same render and no property binding is not a change; old baselines fall back to visual', () => {
  const same = withLayers((ls) => [...ls, L('Spacer', 'FRAME')]);
  assert.equal(diffSignatures(sig(withLayers()), sig(same)).kind, undefined);
  // A baseline from an older plugin has no outline: the render change stays a visual change.
  const old = sig(button());
  const cur = sig(withLayers((ls, s, t) => (smPrimary(s, t) ? [...ls, L('Icon', 'INSTANCE', { main: 'Icon/Pencil' })] : undefined), (s, t) => (smPrimary(s, t) ? 'new' : undefined)));
  assert.equal(diffSignatures(old, cur).kind, 'visual');
});

test('structure: a text where an optional text exists gets the hint; other changes keep the item checked', () => {
  const base = withLayers((ls) => [...ls, L('Helper', 'TEXT', { visible: false, visibleProp: 'Show helper', textProp: 'Helper' })]);
  const cur = withLayers((ls, s, t) => [L('Note', 'TEXT'), ...ls, L('Helper', 'TEXT', { visible: false, visibleProp: 'Show helper', textProp: 'Helper' })].slice(smPrimary(s, t) ? 0 : 1), (s, t) => (smPrimary(s, t) ? 'r' : undefined));
  const d = diffSignatures(sig(base), sig(cur));
  assert.deepEqual(d.equivalents, ['Helper already does this: turn on Show helper']);
  const scan = classifyComponents(
    [{ nodeId: '1:2', name: 'Button', signature: sig(cur), baseline: sig(base) }],
    ['Button'],
  );
  assert.equal(scan.changed[0]!.suggestSkip, true);
  // Plus a prop change: the item stays checked, the hint still shows.
  const withProp = button((c) => {
    c.definitions.push({ name: 'Loading#3:0', type: 'BOOLEAN', default: 'false' });
    for (const [i, v] of c.variants.entries()) {
      v.layers = cur.variants[i]!.layers;
      v.render = cur.variants[i]!.render;
    }
  });
  const scan2 = classifyComponents([{ nodeId: '1:2', name: 'Button', signature: sig(withProp), baseline: sig(base) }], ['Button']);
  assert.equal(scan2.changed[0]!.kind, 'prop-change');
  assert.ok(scan2.changed[0]!.equivalent);
  assert.equal(scan2.changed[0]!.suggestSkip, undefined);
});

test('rebound to a variable another layer already uses: still bound, never "none"', () => {
  // The label already paints with button.primary.fg; the fill moves onto it too.
  const next = button((c) => {
    const v = find(c, 'md', 'primary');
    v.bindings = v.bindings.map((b) => (b.variable === 'button/primary/bg' ? { ...b, variable: 'button/primary/fg' } : b));
    v.render = fnv1a('fill like the label');
  });
  const d = diffSignatures(sig(button()), sig(next));
  assert.deepEqual(d.changes, [{ field: 'Fill (Size=md, Tone=primary)', before: 'button.primary.bg', after: 'button.primary.fg' }]);
});
