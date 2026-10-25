import assert from 'node:assert/strict';
import { test } from 'vitest';
import { remoteRenames } from '../src/id-map';
import type { LogicalToken } from '../src/types';

const tok = (path: string, values: Record<string, unknown>, type = 'color'): LogicalToken => ({
  id: `path:${path}`,
  path,
  type,
  tier: 'semantic',
  values,
  description: undefined,
  scopes: undefined,
  files: {},
});
const map = (...ts: LogicalToken[]) => new Map(ts.map((t) => [t.id, t]));
const pairs = (r: ReturnType<typeof remoteRenames>) => r.map((x) => `${x.from.path} -> ${x.to.path}`);

test('remoteRenames: removed and added with the same values and a close path is a rename', () => {
  const v = { light: '{palette.info.50}', dark: '{palette.info.950}' };
  const base = map(tok('color.feedback.info.bg', v), tok('color.feedback.info.text', { light: '{palette.info.700}' }));
  const head = map(tok('color.feedback.info.surface', v), tok('color.feedback.info.text', { light: '{palette.info.700}' }));
  assert.deepEqual(pairs(remoteRenames(base, head)), ['color.feedback.info.bg -> color.feedback.info.surface']);
});

test('remoteRenames: other values, another type or a far path is a removal and an addition', () => {
  assert.deepEqual(pairs(remoteRenames(map(tok('a.b.c', { v: 1 })), map(tok('a.b.d', { v: 2 })))), []);
  assert.deepEqual(pairs(remoteRenames(map(tok('a.b.c', { v: 1 }, 'number')), map(tok('a.b.d', { v: 1 }, 'dimension')))), []);
  assert.deepEqual(pairs(remoteRenames(map(tok('color.feedback.info.bg', { v: 1 })), map(tok('motion.duration.slow', { v: 1 })))), []);
});

test('remoteRenames: a tie is not guessed', () => {
  const v = { light: '#fff' };
  // Two added tokens fit the removed one equally (one letter each): neither is chosen.
  assert.deepEqual(pairs(remoteRenames(map(tok('surface.card.a1', v)), map(tok('surface.card.a2', v), tok('surface.card.a3', v)))), []);
});
