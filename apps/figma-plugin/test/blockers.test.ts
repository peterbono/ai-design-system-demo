// What stops a send, in designer words: one line per kind with its count, never one line per token pair.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Issue } from '@bridge-ds/core';
import { blockerLines } from '../src/sync/blockers';

const contrast = (i: number): Issue => ({ code: 'contrast', severity: 'error', message: `color.text.${i} on color.bg.default is 1.4:1 in Bridge light; contrast.checks.json needs 4.5:1 (WCAG AA for text).`, path: `color.text.${i}` });

test('a shared-color edit that breaks 107 pairs is one line, not 107', () => {
  const lines = blockerLines(Array.from({ length: 107 }, (_, i) => contrast(i)));
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.count, 107);
  assert.equal(lines[0]!.text, '107 color pairs are too low in contrast on their backgrounds. Pick a stronger color, or uncheck the edit.');
});

test('kinds are grouped, biggest first, in designer words without token or file jargon', () => {
  const lines = blockerLines([
    contrast(1),
    { code: 'raw-value', severity: 'error', message: 'palette.primary.700 uses a raw value in Bridge.', path: 'palette.primary.700' },
    contrast(2),
    { code: 'override-shadowed', severity: 'error', message: 'x' },
    { code: 'override-orphan', severity: 'error', message: 'y' },
  ]);
  assert.deepEqual(lines.map((l) => [l.code, l.count]), [['contrast', 2], ['override-orphan', 2], ['raw-value', 1]]);
  assert.equal(lines[2]!.text, '1 variable has a typed value where it must point to another variable. Pick a variable instead.');
  for (const l of lines) assert.doesNotMatch(l.text, /contrast\.checks\.json|palette\.|—/);
});

test('file problems keep their own message, one line each', () => {
  const lines = blockerLines([
    { code: 'file-problem', severity: 'error', message: 'brands/acme.tokens.json is not valid JSON.' },
    { code: 'file-problem', severity: 'error', message: 'density/compact.tokens.json is missing.' },
  ]);
  assert.deepEqual(lines.map((l) => l.text), ['brands/acme.tokens.json is not valid JSON.', 'density/compact.tokens.json is missing.']);
});
