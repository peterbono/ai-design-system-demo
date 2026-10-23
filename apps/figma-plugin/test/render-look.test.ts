// The render hash a Push compares: read from the layers' visual properties (an image export took about 0.3 s a variant
// in a big file). It moves when the look moves, not when layers are only regrouped or renamed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readComponent } from '../src/main/components';
import { RENDER_VERSION, buildSignature, diffSignatures } from '../src/sync/components';
import { SimFigma, type SimNode } from './figma-api';

type F = { createComponent: () => SimNode; createFrame: () => SimNode; createText: () => SimNode; loadFontAsync: (f: unknown) => Promise<void> };

async function variant() {
  const sim = new SimFigma();
  sim.install();
  const figma = (globalThis as unknown as { figma: F }).figma;
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const c = figma.createComponent();
  c.name = 'Chip';
  c.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  const dot = figma.createFrame();
  dot.name = 'Dot';
  dot.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
  c.appendChild(dot);
  const label = figma.createText();
  label.fontName = { family: 'Inter', style: 'Regular' };
  label.characters = 'Label';
  c.appendChild(label);
  const render = async () => (await readComponent(c as never)).variants[0]!.render!;
  return { figma, c, dot, label, render };
}

test('render: read from properties, versioned; a regroup or a rename keeps it, a fill, a text, a hidden layer or a size moves it', async () => {
  const { figma, c, dot, label, render } = await variant();
  const first = await render();
  assert.ok(first.startsWith(RENDER_VERSION));
  assert.equal(await render(), first, 'stable');
  // Renamed, then regrouped in a frame that paints nothing: same look.
  dot.name = 'Indicator';
  const wrap = figma.createFrame();
  wrap.fills = [];
  c.appendChild(wrap);
  wrap.appendChild(dot);
  wrap.appendChild(label);
  assert.equal(await render(), first, 'regroup and rename: same look');
  dot.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }];
  const blue = await render();
  assert.notEqual(blue, first, 'fill');
  label.characters = 'Other';
  const text = await render();
  assert.notEqual(text, blue, 'text');
  label.visible = false;
  const hidden = await render();
  assert.notEqual(hidden, text, 'hidden');
  dot.resize(20, 20);
  assert.notEqual(await render(), hidden, 'size');
});

test('render: an image hash from an older DS Bridge never compares with a new one, so an upgrade is not a visual change', async () => {
  const { c } = await variant();
  const now = buildSignature(await readComponent(c as never));
  const old = structuredClone(now);
  for (const v of Object.values(old.variants)) (v as { render?: string }).render = 'a1b2c3d4';
  assert.equal(diffSignatures(old, now).kind, undefined);
});

test('render: a bound paint reads as its variable; the fallback color Figma stores with it does not count', async () => {
  const { figma, dot, render } = await variant();
  const api = figma as unknown as { variables: { createVariableCollection: (n: string) => { id: string }; createVariable: (n: string, c: unknown, t: string) => { id: string }; setBoundVariableForPaint: (p: unknown, f: string, v: unknown) => Record<string, unknown> } };
  const col = api.variables.createVariableCollection('Semantic');
  const a = api.variables.createVariable('color/a', col, 'COLOR');
  const b = api.variables.createVariable('color/b', col, 'COLOR');
  dot.fills = [api.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', a)];
  const bound = await render();
  // Figma refreshes the stored color (as when a mode is added): the same look.
  dot.fills = [{ ...(dot.fills[0] as Record<string, unknown>), color: { r: 0.36, g: 0.4, b: 0.5 } }];
  assert.equal(await render(), bound);
  // Another variable: another look.
  dot.fills = [api.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', b)];
  assert.notEqual(await render(), bound);
});
