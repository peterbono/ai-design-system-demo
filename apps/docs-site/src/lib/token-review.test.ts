import { describe, expect, it } from 'vitest';
import { parseContrastChecks } from '@bridge-ds/core';
import { reviewTokenChange } from './token-review';
import { mergeGate, parseChangeset, parseTier, summarizeApprovals, summarizeCi } from './review-rules';

const color = (hex: string) => ({
  colorSpace: 'srgb',
  components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
  hex,
});

const primitives = (bg50: string) =>
  JSON.stringify(
    {
      color: {
        $type: 'color',
        white: { $value: color('#ffffff') },
        gray: { 50: { $value: color(bg50) }, 600: { $value: color('#5b6573') }, 900: { $value: color('#111827') } },
        blue: { 600: { $value: color('#2557d6') } },
      },
    },
    null,
    2,
  );

const brand = (primary: string) =>
  JSON.stringify({ palette: { $type: 'color', neutral: { 0: { $value: '{color.white}' }, 50: { $value: '{color.gray.50}' }, 600: { $value: '{color.gray.600}' }, 900: { $value: '{color.gray.900}' } }, primary: { 600: { $value: `{${primary}}` } } } }, null, 2);

const semantic = (bg: string) =>
  JSON.stringify(
    {
      color: {
        $type: 'color',
        bg: { default: { $value: `{${bg}}` } },
        text: { default: { $value: '{palette.neutral.900}' }, muted: { $value: '{palette.neutral.600}' } },
        action: { primary: { bg: { $value: '{palette.primary.600}' } } },
      },
    },
    null,
    2,
  );

const darkSemantic = JSON.stringify(
  {
    color: {
      $type: 'color',
      bg: { default: { $value: '{palette.neutral.900}' } },
      text: { default: { $value: '{palette.neutral.0}' }, muted: { $value: '{palette.neutral.50}' } },
      action: { primary: { bg: { $value: '{palette.neutral.50}' } } },
    },
  },
  null,
  2,
);

const files = (o: { bg?: string; bg50?: string; primary?: string } = {}) => ({
  'primitives/color.tokens.json': primitives(o.bg50 ?? '#f6f7f9'),
  'brands/bridge.tokens.json': brand(o.primary ?? 'color.blue.600'),
  'semantic/light.tokens.json': semantic(o.bg ?? 'palette.neutral.0'),
  'semantic/dark.tokens.json': darkSemantic,
});

const checks = parseContrastChecks(
  JSON.stringify({
    pairs: [
      ['color.text.default', 'color.bg.default', 4.5],
      ['color.text.muted', 'color.bg.default', 4.5],
      ['color.action.primary.bg', 'color.bg.default', 3],
    ],
  }),
);

describe('reviewTokenChange', () => {
  it('fills contrast before -> after when color.bg.default changes (PR #4 regression)', () => {
    const r = reviewTokenChange(files(), files({ bg: 'palette.neutral.50' }), checks);
    expect(r.changes).toEqual([
      expect.objectContaining({ path: 'color.bg.default', kind: 'changed', context: 'light', before: expect.objectContaining({ alias: 'palette.neutral.0', hex: '#ffffff' }), after: expect.objectContaining({ alias: 'palette.neutral.50', hex: '#f6f7f9' }) }),
    ]);
    // Every pair on color.bg.default moves in light; nothing moves in dark.
    expect(r.contrast.map((c) => `${c.fg}|${c.where}`).sort()).toEqual(['color.action.primary.bg|Bridge light', 'color.text.default|Bridge light', 'color.text.muted|Bridge light']);
    for (const c of r.contrast) expect(c.after).toBeLessThan(c.before);
  });

  it('finds pairs reached only through aliases when a primitive changes', () => {
    // No semantic token changes: gray.50 is not used by bg.default in light (neutral.0 is), so only a primitive the
    // chain passes through matters. Change gray.900, which text.default resolves to via palette.neutral.900.
    const base = files();
    const head = { ...files(), 'primitives/color.tokens.json': primitives('#f6f7f9').replace('#111827', '#8a929e') };
    const r = reviewTokenChange(base, head, checks);
    expect(r.changes.map((c) => c.path)).toEqual(['color.gray.900']);
    const light = r.contrast.find((c) => c.fg === 'color.text.default' && c.where === 'Bridge light');
    expect(light).toBeDefined();
    expect(light!.after).toBeLessThan(light!.before);
    expect(light!.after).toBeLessThan(4.5);
    expect(r.failing).toBeGreaterThan(0);
  });

  it('lists a brand palette change and the pairs it moves', () => {
    const r = reviewTokenChange(files(), files({ primary: 'color.gray.50' }), checks);
    expect(r.changes[0]).toMatchObject({ path: 'palette.primary.600', tier: 'brand' });
    const p = r.contrast.find((c) => c.fg === 'color.action.primary.bg' && c.where === 'Bridge light');
    expect(p?.after).toBeLessThan(3);
  });

  it('reports no rows when only formatting changed', () => {
    const base = files();
    const head = { ...base, 'semantic/light.tokens.json': JSON.stringify(JSON.parse(base['semantic/light.tokens.json'])) };
    expect(reviewTokenChange(base, head, checks)).toMatchObject({ changes: [], contrast: [], failing: 0 });
  });
});

describe('review rules', () => {
  it('parses the tier from labels, checkboxes and "Risk tier" lines, highest wins', () => {
    expect(parseTier([{ name: 'tier-2' }], null)).toBe(2);
    expect(parseTier([], '## Risk tier\n\n- [ ] Tier 1\n- [x] Tier 3: token change')).toBe(3);
    expect(parseTier([], '**Risk tier:** 3, high')).toBe(3);
    expect(parseTier([{ name: 'tier 1' }], '- [x] Tier 2')).toBe(2);
    expect(parseTier([{ name: 'tokens' }], 'no tier here')).toBeNull();
  });

  it('summarizes CI: a failure wins over pending, nothing reported is none', () => {
    expect(summarizeCi([]).state).toBe('none');
    expect(summarizeCi([{ name: 'a', status: 'completed', conclusion: 'success' }]).state).toBe('pass');
    expect(summarizeCi([{ name: 'a', status: 'in_progress', conclusion: null }]).state).toBe('pending');
    expect(
      summarizeCi([
        { name: 'a', status: 'in_progress', conclusion: null },
        { name: 'b', status: 'completed', conclusion: 'failure' },
      ]).state,
    ).toBe('fail');
  });

  const approve = (login: string, at = '2026-10-16T10:00:00Z') => ({ user: { login }, state: 'APPROVED', submitted_at: at });

  it('needs a design and a tech owner for Tier 3, and keeps merge off while CI fails', () => {
    const owners = { design: ['dana'], tech: ['theo'] };
    const ci = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'success' }]);
    const onlyDesign = summarizeApprovals([approve('dana')], owners, 'author');
    expect(mergeGate({ tier: 3, ci, approvals: onlyDesign, draft: false, state: 'open' })).toMatchObject({ allowed: false });
    const both = summarizeApprovals([approve('dana'), approve('theo')], owners, 'author');
    expect(mergeGate({ tier: 3, ci, approvals: both, draft: false, state: 'open' })).toEqual({ allowed: true, reasons: [], overridable: false, missing: [] });
    const failing = summarizeCi([{ name: 'Guardrails', status: 'completed', conclusion: 'failure' }]);
    const gate = mergeGate({ tier: 3, ci: failing, approvals: both, draft: false, state: 'open' });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/CI fails: Guardrails/);
  });

  it('a later request for changes replaces an approval; the author never counts', () => {
    const owners = { design: [], tech: [] };
    const a = summarizeApprovals(
      [approve('dana'), { user: { login: 'dana' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-16T11:00:00Z' }, approve('author')],
      owners,
      'author',
    );
    expect(a).toMatchObject({ approvers: [], changesRequested: ['dana'], design: false, tech: false });
  });

  it('reads changeset bumps', () => {
    expect(parseChangeset("---\n'@bridge-ds/tokens': minor\n---\n\nNew bg.").bumps).toEqual([{ pkg: '@bridge-ds/tokens', bump: 'minor' }]);
  });
});
