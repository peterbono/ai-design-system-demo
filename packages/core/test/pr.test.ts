import assert from 'node:assert/strict';
import { test } from 'vitest';
import { composeChangeset, changesetBump } from '../src/changeset';
import { composeFiles } from '../src/compose';
import { type PrOrigin, affectedContrast, composePrBody } from '../src/pr-composer';
import { classifyRisk } from '../src/risk';
import { buildTokenSet } from '../src/token-set';
import type { LogicalToken } from '../src/types';
import { validateProposal } from '../src/validators';
import { parseContrastChecks } from '../src/wcag';
import { clone, realChecksText, realConfig, realFiles, realSet } from './helpers';
import { layoutOptions } from '../src/token-set';

const pairs = parseContrastChecks(realChecksText());
const origin: PrOrigin = { tool: 'the Bridge CLI', surface: 'the terminal', authoredBy: 'Agent, reviewed by a human' };

/** Apply token edits to the real files and validate, like a push would. */
function propose(edit: (head: ReturnType<typeof realSet>) => { current: LogicalToken; target: LogicalToken }[]) {
  const head = realSet();
  const changes = edit(head);
  const { allFiles, files } = composeFiles(head, realFiles(), changes);
  const proposed = buildTokenSet(allFiles, layoutOptions(realConfig()));
  const validation = validateProposal(proposed, head, pairs);
  return { head, proposed, changes, files, validation };
}

const ratioLine = /^(Bridge|Ocean) (light|dark), \S+ on \S+: [\d.]+ -> [\d.]+/;

test('PR body: changing color.bg.default fills the contrast column (PR #4 regression)', () => {
  const p = propose((head) => {
    const t = head.byPath.get('color.bg.default')!;
    return [{ current: t, target: clone(t, { values: { ...t.values, light: '{palette.neutral.0}' } }) }];
  });
  assert.deepEqual(Object.keys(p.files), ['semantic/light.tokens.json']);
  const body = composePrBody({ ...p, baseBranch: 'main', headSha: 'a'.repeat(40), baseSha: undefined, origin, title: 't', notes: '', upstreamPaths: [], resolvedConflicts: [] });
  const row = body.split('\n').find((l) => l.startsWith('| `color.bg.default` |'))!;
  const cell = row.split(' | ')[4]!;
  const lines = cell.split('<br>');
  assert.ok(lines.length >= 2 && lines.every((l) => ratioLine.test(l)), cell);
  assert.match(cell, /Bridge light, color\.text\.default on color\.bg\.default/);
  assert.match(cell, /Ocean light, color\.text\.default on color\.bg\.default/);
  assert.doesNotMatch(cell, /dark/);
  assert.match(body, /Opened from the Bridge CLI\. the terminal is the editing surface/i);
  assert.match(body, /- \[x\] Tier 3: token change/);
});

test('PR body: a primitive change reaches pairs through palette roles, only in the brands that use it', () => {
  const p = propose((head) => {
    const t = head.byPath.get('color.steel.50')!;
    return [{ current: t, target: clone(t, { values: { value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' } } }) }];
  });
  const affected = affectedContrast(p.changes[0]!, p.validation.contrastBefore, p.validation.contrastAfter);
  assert.ok(affected.length > 0);
  // Ocean maps its neutral palette to another ramp: steel only reaches Bridge.
  assert.ok(affected.every((x) => x.after!.brand === 'bridge'));
  assert.ok(affected.some((x) => x.before!.ratio !== x.after!.ratio));
});

test('a semantic edit a brand overrides does not count for that brand', () => {
  const p = propose((head) => {
    const t = head.byPath.get('color.action.primary.bg')!;
    return [{ current: t, target: clone(t, { values: { ...t.values, light: '{palette.primary.700}' } }) }];
  });
  const affected = affectedContrast(p.changes[0]!, p.validation.contrastBefore, p.validation.contrastAfter);
  assert.ok(affected.length > 0);
  assert.ok(affected.every((x) => x.after!.brand === 'bridge' && x.after!.theme === 'light'));
});

test('risk tiers follow docs/GOVERNANCE.md, highest wins', () => {
  const t = realSet().byPath.get('color.bg.default')!;
  const config = realConfig();
  assert.equal(classifyRisk({ files: [{ path: 'docs/GUIDE.md' }, { path: 'packages/react/src/components/Button/Button.stories.tsx' }] }).tier, 1);
  assert.equal(classifyRisk({ files: [{ path: 'packages/react/src/components/Button/Button.tsx' }], config }).tier, 2);
  assert.equal(classifyRisk({ files: [{ path: 'packages/tokens/src/contrast.checks.json' }], config }).tier, 3);
  assert.equal(classifyRisk({ files: [{ path: '.github/workflows/ci.yml' }] }).tier, 3);
  const changed = classifyRisk({ tokenChanges: [{ current: t, target: clone(t, { description: 'x' }) }] });
  assert.deepEqual([changed.tier, changed.bump], [3, 'minor']);
  assert.match(changed.label, /^Tier 3: token change/);
  const renamed = classifyRisk({ tokenChanges: [{ current: t, target: clone(t, { path: 'color.bg.canvas' }) }], files: [{ path: 'README.md' }] });
  assert.deepEqual([renamed.tier, renamed.bump, renamed.reasons[0]], [3, 'major', 'Token renamed: color.bg.canvas']);
});

test('changeset names the configured package and bumps major for removals', () => {
  const t = realSet().byPath.get('color.bg.default')!;
  assert.equal(changesetBump([{ current: t, target: undefined }]), 'major');
  const cs = composeChangeset([{ current: t, target: clone(t, { description: 'x' }) }], { title: 'Tint', branch: 'tokens/tint-20261016-1200', packageName: '@acme/tokens' });
  assert.equal(cs.path, '.changeset/ds-bridge-tint-20261016-1200.md');
  assert.match(cs.content, /^---\n"@acme\/tokens": minor\n---\n\nTint\.\n\n- changed `color\.bg\.default`\n$/);
});
