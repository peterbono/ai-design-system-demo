import { describe, expect, it } from 'vitest';
import { branchThumb, fitScale, hexOf, pxOf, rankTokens, tokenVisual, type ThumbToken } from './branch-thumb';

const v = (css: string | null, hex: string | null = null) => ({ css, hex });
const tok = (over: Partial<ThumbToken> & { path: string }): ThumbToken => ({
  kind: 'changed',
  tier: 'semantic',
  context: '',
  before: null,
  after: null,
  ...over,
});

describe('pxOf', () => {
  it('reads px, rem, em and bare numbers', () => {
    expect(pxOf('16px')).toBe(16);
    expect(pxOf('1rem')).toBe(16);
    expect(pxOf('0.5rem')).toBe(8);
    expect(pxOf('.25rem')).toBe(4);
    expect(pxOf('1.5em')).toBe(24);
    expect(pxOf('12')).toBe(12);
    expect(pxOf(' 20PX ')).toBe(20);
  });

  it('gives null for anything that is not one length', () => {
    expect(pxOf(null)).toBeNull();
    expect(pxOf(undefined)).toBeNull();
    expect(pxOf('')).toBeNull();
    expect(pxOf('calc(1rem + 2px)')).toBeNull();
    expect(pxOf('50%')).toBeNull();
    expect(pxOf('8px 16px')).toBeNull();
    expect(pxOf('unresolved (missing)')).toBeNull();
  });
});

describe('hexOf', () => {
  it('prefers the resolved hex, lowercased', () => {
    expect(hexOf(v('#0B4A8B', '#0B4A8B'))).toBe('#0b4a8b');
  });
  it('falls back to a css value that is a hex', () => {
    expect(hexOf(v('#FFF'))).toBe('#fff');
    expect(hexOf(v('rgb(0 0 0)'))).toBeNull();
    expect(hexOf(null)).toBeNull();
  });
});

describe('tokenVisual', () => {
  it('reads the kind from the path', () => {
    expect(tokenVisual(tok({ path: 'color.text.link' }))).toBe('color');
    expect(tokenVisual(tok({ path: 'button.primary.color' }))).toBe('color');
    expect(tokenVisual(tok({ path: 'space.4' }))).toBe('space');
    expect(tokenVisual(tok({ path: 'size.11' }))).toBe('space');
    expect(tokenVisual(tok({ path: 'control.height.md' }))).toBe('space');
    expect(tokenVisual(tok({ path: 'control.gap' }))).toBe('space');
    expect(tokenVisual(tok({ path: 'control.padding-x.md' }))).toBe('space');
    expect(tokenVisual(tok({ path: 'layout.spacing' }))).toBe('space');
    expect(tokenVisual(tok({ path: 'icon.size' }))).toBe('space');
    expect(tokenVisual(tok({ path: 'radius.control' }))).toBe('radius');
    expect(tokenVisual(tok({ path: 'button.border-radius' }))).toBe('radius');
    expect(tokenVisual(tok({ path: 'font.size.300' }))).toBe('type');
    expect(tokenVisual(tok({ path: 'typography.body.size' }))).toBe('type');
    expect(tokenVisual(tok({ path: 'heading.font-size' }))).toBe('type');
  });

  it('a hex value makes it a colour, whatever the name', () => {
    expect(tokenVisual(tok({ path: 'button.primary.bg', after: v('#0b4a8b', '#0b4a8b') }))).toBe('color');
  });

  it('gives null when there is nothing to draw', () => {
    expect(tokenVisual(tok({ path: 'motion.duration.fast' }))).toBeNull();
    expect(tokenVisual(tok({ path: 'typography.body.family' }))).toBeNull();
    expect(tokenVisual(tok({ path: 'font.family.display' }))).toBeNull();
  });
});

describe('rankTokens', () => {
  it('orders changed before added before removed', () => {
    const r = rankTokens([tok({ path: 'a', kind: 'removed' }), tok({ path: 'b', kind: 'added' }), tok({ path: 'c', kind: 'changed' })]);
    expect(r.map((t) => t.path)).toEqual(['c', 'b', 'a']);
  });

  it('orders semantic, component, primitive, then other tiers', () => {
    const r = rankTokens([
      tok({ path: 'd', tier: 'density' }),
      tok({ path: 'p', tier: 'primitive' }),
      tok({ path: 'c', tier: 'component' }),
      tok({ path: 'b', tier: 'brand' }),
      tok({ path: 's', tier: 'semantic' }),
    ]);
    expect(r.map((t) => t.path)).toEqual(['s', 'c', 'p', 'd', 'b']);
  });

  it('kind wins over tier', () => {
    const r = rankTokens([tok({ path: 'added-semantic', kind: 'added' }), tok({ path: 'changed-primitive', tier: 'primitive' })]);
    expect(r[0].path).toBe('changed-primitive');
  });

  it('puts the viewer theme (or no context) first, keeps input order otherwise', () => {
    const rows = [tok({ path: 'x', context: 'light' }), tok({ path: 'x', context: 'dark' }), tok({ path: 'y', context: '' })];
    expect(rankTokens(rows, 'dark').map((t) => t.context)).toEqual(['dark', '', 'light']);
    expect(rankTokens(rows, 'light').map((t) => t.context)).toEqual(['light', '', 'dark']);
    expect(rankTokens(rows).map((t) => t.context)).toEqual(['light', 'dark', '']);
  });

  it('does not mutate its input', () => {
    const rows = [tok({ path: 'a', kind: 'added' }), tok({ path: 'b' })];
    rankTokens(rows);
    expect(rows[0].path).toBe('a');
  });
});

describe('fitScale', () => {
  it('shrinks the larger size to the max and never enlarges', () => {
    expect(fitScale(16, 64, 32)).toBe(0.5);
    expect(fitScale(8, 12, 32)).toBe(1);
    expect(fitScale(null, 40, 20)).toBe(0.5);
    expect(fitScale(null, null, 20)).toBe(1);
  });
});

describe('branchThumb: token branches', () => {
  it('a colour token: before and after swatches', () => {
    const s = branchThumb({
      tokens: [tok({ path: 'color.action.primary.bg', context: 'light', before: v('#0b4a8b', '#0b4a8b'), after: v('#0a3f78', '#0A3F78') })],
    });
    expect(s).toEqual({ kind: 'color', token: 'color.action.primary.bg', before: '#0b4a8b', after: '#0a3f78' });
  });

  it('an added colour has no before', () => {
    const s = branchThumb({ tokens: [tok({ path: 'color.bg.zone', kind: 'added', after: v('#cfe8ff', '#cfe8ff') })] });
    expect(s).toEqual({ kind: 'color', token: 'color.bg.zone', before: null, after: '#cfe8ff' });
  });

  it('a space token: px from rem and px', () => {
    const s = branchThumb({ tokens: [tok({ path: 'space.4', tier: 'primitive', before: v('1rem'), after: v('20px') })] });
    expect(s).toEqual({ kind: 'space', token: 'space.4', before: 16, after: 20 });
  });

  it('a density control height is space', () => {
    const s = branchThumb({ tokens: [tok({ path: 'control.height.md', tier: 'density', context: 'compact', before: v('36px'), after: v('40px') })] });
    expect(s).toEqual({ kind: 'space', token: 'control.height.md', before: 36, after: 40 });
  });

  it('a radius token', () => {
    const s = branchThumb({ tokens: [tok({ path: 'radius.control', tier: 'brand', before: v('12px'), after: v('0.5rem') })] });
    expect(s).toEqual({ kind: 'radius', token: 'radius.control', before: 12, after: 8 });
  });

  it('a type token', () => {
    const s = branchThumb({ tokens: [tok({ path: 'font.size.400', tier: 'primitive', before: v('21px'), after: v('22px') })] });
    expect(s).toEqual({ kind: 'type', token: 'font.size.400', before: 21, after: 22 });
  });

  it('picks the changed semantic token over added and primitive ones', () => {
    const s = branchThumb({
      tokens: [
        tok({ path: 'color.harbor.750', tier: 'primitive', kind: 'added', after: v('#09407a', '#09407a') }),
        tok({ path: 'color.harbor.700', tier: 'primitive', before: v('#0b4a8b', '#0b4a8b'), after: v('#0a4585', '#0a4585') }),
        tok({ path: 'color.text.link', tier: 'semantic', before: v('#0b4a8b', '#0b4a8b'), after: v('#09407a', '#09407a') }),
      ],
    });
    expect(s).toMatchObject({ kind: 'color', token: 'color.text.link' });
  });

  it('shows the mode that matches the viewer theme', () => {
    const tokens = [
      tok({ path: 'color.text.link', context: 'light', before: v('#0b4a8b', '#0b4a8b'), after: v('#09407a', '#09407a') }),
      tok({ path: 'color.text.link', context: 'dark', before: v('#aad2fe', '#aad2fe'), after: v('#cfe8ff', '#cfe8ff') }),
    ];
    expect(branchThumb({ tokens, theme: 'dark' })).toMatchObject({ before: '#aad2fe', after: '#cfe8ff' });
    expect(branchThumb({ tokens, theme: 'light' })).toMatchObject({ before: '#0b4a8b', after: '#09407a' });
    // No theme: the first in order.
    expect(branchThumb({ tokens })).toMatchObject({ before: '#0b4a8b' });
  });

  it('a colour without any hex falls back to the next candidate', () => {
    const s = branchThumb({
      tokens: [
        tok({ path: 'color.text.link', before: v('unresolved (missing)'), after: v(null) }),
        tok({ path: 'space.2', tier: 'primitive', before: v('8px'), after: v('6px') }),
      ],
    });
    expect(s).toEqual({ kind: 'space', token: 'space.2', before: 8, after: 6 });
  });

  it('a token with nothing to draw falls back to the next one, then to the token icon', () => {
    const motion = tok({ path: 'motion.duration.fast', before: v('150ms'), after: v('120ms') });
    expect(branchThumb({ tokens: [motion, tok({ path: 'radius.inset', tier: 'brand', after: v('4px'), kind: 'added' })] })).toMatchObject({ kind: 'radius' });
    expect(branchThumb({ tokens: [motion] })).toEqual({ kind: 'icon', icon: 'token' });
    expect(branchThumb({ tokens: [tok({ path: 'color.text.link' })] })).toEqual({ kind: 'icon', icon: 'token' });
  });

  it('tokens win over a visual run and component files', () => {
    const s = branchThumb({
      tokens: [tok({ path: 'space.4', before: v('16px'), after: v('20px') })],
      visual: { before: 'https://x/a.png', after: 'https://x/b.png', label: 'Button' },
      files: ['packages/react/src/components/Button/Button.module.css'],
    });
    expect(s.kind).toBe('space');
  });
});

describe('branchThumb: other branches', () => {
  it('a visual impact run: the two crops', () => {
    const s = branchThumb({
      files: ['packages/react/src/components/Badge/Badge.module.css'],
      visual: { before: 'https://x/before.png', after: 'https://x/after.png', label: 'Badge, subtle' },
    });
    expect(s).toEqual({ kind: 'image', before: 'https://x/before.png', after: 'https://x/after.png', label: 'Badge, subtle' });
  });

  it('component files without a visual run: the component icon', () => {
    expect(branchThumb({ files: ['.changeset/badge-subtle.md', 'packages/react/src/components/Badge/Badge.tsx'] })).toEqual({ kind: 'icon', icon: 'component' });
  });

  it('guidance: the flag, or only docs.json and changesets', () => {
    expect(branchThumb({ guidance: true, files: ['packages/react/src/components/Button/Button.tsx'] })).toEqual({ kind: 'text' });
    expect(branchThumb({ files: ['packages/react/src/components/Button/Button.docs.json', '.changeset/button-guidance.md'] })).toEqual({ kind: 'text' });
    // A changeset alone is not guidance.
    expect(branchThumb({ files: ['.changeset/x.md'] })).toEqual({ kind: 'icon', icon: 'branch' });
  });

  it('token source files before the diff is read: the token icon', () => {
    expect(branchThumb({ files: ['packages/tokens/src/semantic/light.tokens.json', '.changeset/link.md'] })).toEqual({ kind: 'icon', icon: 'token' });
    expect(branchThumb({ files: ['packages/tokens/src/semantic/light.tokens.json'], tokens: [] })).toEqual({ kind: 'icon', icon: 'token' });
    // Mixed with code elsewhere, it is not a token branch.
    expect(branchThumb({ files: ['packages/tokens/src/semantic/light.tokens.json', 'apps/docs-site/src/lib/x.ts'] })).toEqual({ kind: 'icon', icon: 'branch' });
  });

  it('falls back to the branch icon', () => {
    expect(branchThumb({})).toEqual({ kind: 'icon', icon: 'branch' });
    expect(branchThumb({ files: null, tokens: null, visual: null })).toEqual({ kind: 'icon', icon: 'branch' });
    expect(branchThumb({ files: ['apps/docs-site/src/pages/index.astro'] })).toEqual({ kind: 'icon', icon: 'branch' });
  });
});
