// api/_lib/figma-fixes-check.ts keeps the server's copy of `bridge fixes check` (core figma-fixes.ts validateFigmaFixes,
// with SPEC_FIELDS and COLOR_FIELDS): the /api functions load no workspace package at runtime. Both run on the same
// fixtures and on this repository's figma-fixes.json here: any drift fails.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_FIELDS as CORE_COLOR, DEFAULT_FIGMA_FIXES_FILE, FIGMA_FIXES_VERSION as CORE_VERSION, SPEC_FIELDS as CORE_FIELDS, validateFigmaFixes as coreValidate } from '@bridge-ds/core';
import { COLOR_FIELDS, FIGMA_FIXES_FILE, FIGMA_FIXES_VERSION, SPEC_FIELDS, validateFigmaFixes } from '../../api/_lib/figma-fixes-check';

const fx = (extra: Record<string, unknown>) => ({ id: 'a-fix', component: 'Toggle', reason: 'Because the shot says so.', ...extra });

const FILES: unknown[] = [
  null,
  [],
  { version: 2, fixes: [] },
  { version: 1, fixes: {} },
  { version: 1, fixes: [], extra: true },
  { version: 1, fixes: [fx({ kind: 'status' })] },
  { version: 1, fixes: [fx({ kind: 'status', status: 'matches' })] },
  { version: 1, fixes: [fx({ kind: 'status', reason: 'Short' })] },
  { version: 1, fixes: [fx({ kind: 'status', reason: 'It differs \u2014 see the shot.' })] },
  { version: 1, fixes: [fx({ kind: 'status' }), fx({ kind: 'status' })] },
  { version: 1, fixes: [fx({ id: 'Bad Id', kind: 'status' })] },
  { version: 1, fixes: [fx({ kind: 'wat' })] },
  { version: 1, fixes: [fx({ kind: 'part', part: 'root' })] },
  { version: 1, fixes: [fx({ kind: 'part', part: '.x', set: { cornerRadius: 'full', fill: null, paddingTop: 4 } })] },
  { version: 1, fixes: [fx({ kind: 'part', part: '.x', set: { fill: 4, nope: 1, paddingTop: 'full', textDecoration: 'BOLD' } })] },
  { version: 1, fixes: [fx({ kind: 'part', part: 'root', hide: true, width: 'fill' })] },
  { version: 1, fixes: [fx({ kind: 'part', part: '.x', width: -1, height: 'hug', direction: 'DIAGONAL', align: { primary: 'TOP' }, overlay: { top: 'x' } })] },
  { version: 1, fixes: [fx({ kind: 'axis', action: 'map', arg: 'kind', values: { a: 'X', b: 'X' } })] },
  { version: 1, fixes: [fx({ kind: 'axis', action: 'prune' })] },
  { version: 1, fixes: [fx({ kind: 'axis', action: 'ignore', arg: 'size', property: 'Size' })] },
  { version: 1, fixes: [fx({ kind: 'story', use: { story: 'x--y', extra: 1 }, where: { args: { size: 'sm' }, state: 'hover' } })] },
  { version: 1, fixes: [fx({ kind: 'story', use: { story: '' }, where: { mood: 1 } })] },
];

describe('the server copy of bridge fixes check', () => {
  it('has the same fields, version and file name as core', () => {
    expect([...SPEC_FIELDS]).toEqual([...CORE_FIELDS]);
    expect([...COLOR_FIELDS].sort()).toEqual([...CORE_COLOR].sort());
    expect(FIGMA_FIXES_VERSION).toBe(CORE_VERSION);
    expect(FIGMA_FIXES_FILE).toBe(DEFAULT_FIGMA_FIXES_FILE);
  });

  it.each(FILES.map((f, i) => [i, f]))('fixture %i: the same problems', (_i, f) => {
    expect(validateFigmaFixes(f)).toEqual(coreValidate(f));
  });

  it("this repository's figma-fixes.json: valid on both", () => {
    const data = JSON.parse(readFileSync(new URL('../../../../figma-fixes.json', import.meta.url), 'utf8'));
    expect(validateFigmaFixes(data)).toEqual([]);
    expect(coreValidate(data)).toEqual([]);
  });
});
