// Saving baselines exports a small image of each component (the "before" of a request). An unchanged baseline keeps
// its image: a pull that refreshes every baseline of a big file only redraws the ones that changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveSignatures } from '../src/main/components';
import { SimFigma } from './figma-api';

test('saveSignatures: an unchanged baseline with its image is not exported again', async () => {
  const sim = new SimFigma();
  sim.install();
  const figma = (globalThis as unknown as { figma: { createComponent: () => { id: string } } }).figma;
  const a = figma.createComponent();
  const b = figma.createComponent();
  assert.equal(await saveSignatures([{ nodeId: a.id, signature: '{"v":1,"x":1}' }, { nodeId: b.id, signature: '{"v":1,"x":2}' }]), 2);
  assert.equal(sim.exports, 2);
  assert.equal(await saveSignatures([{ nodeId: a.id, signature: '{"v":1,"x":1}' }, { nodeId: b.id, signature: '{"v":1,"x":3}' }]), 2);
  assert.equal(sim.exports, 3, 'only the changed one');
});
