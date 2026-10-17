import { describe, expect, it } from 'vitest';
import { foundationRow, groupRows, primitiveRows } from './foundations';
import { aliasSummary, copyValue, groupTitle, parseCopyFormat, roleOf, usageChip } from './library-rows';

describe('aliasSummary', () => {
  it('collapses the same palette role across modes', () => {
    expect(aliasSummary('palette.neutral.50', 'palette.neutral.950')).toBe('neutral 50 · 950');
  });
  it('shows one target when both modes agree', () => {
    expect(aliasSummary('palette.neutral.0', 'palette.neutral.0')).toBe('neutral 0');
  });
  it('keeps both roles when they differ', () => {
    expect(aliasSummary('palette.primary.900', 'palette.neutral.100')).toBe('primary 900 · neutral 100');
  });
  it('reads non-palette aliases and literals', () => {
    expect(aliasSummary('shadow.1', 'shadow.dark-1')).toBe('shadow 1 · dark-1');
    expect(aliasSummary('border.width.2', 'border.width.2')).toBe('border width 2');
    expect(aliasSummary('color.alpha.steel-48', null)).toBe('alpha steel-48');
    expect(aliasSummary(null, undefined)).toBe('');
  });
});

describe('roleOf', () => {
  it('uses the first sentence of the description', () => {
    expect(roleOf('color.surface.selected', 'Selected rows and items. Paired with a checked control.')).toBe('Selected rows and items.');
    expect(roleOf('x', 'Page canvas behind panels')).toBe('Page canvas behind panels.');
  });
  it('derives action, feedback and control roles from the path', () => {
    expect(roleOf('color.action.primary.bg-hover')).toBe('Primary action fill on hover.');
    expect(roleOf('color.action.secondary.border')).toBe('Secondary action edge.');
    expect(roleOf('color.feedback.danger.solid')).toBe('Danger message solid fill, for compact labels like badges.');
    expect(roleOf('color.control.checked.bg-hover')).toBe('Checked control fill on hover.');
  });
  it('knows a few undescribed tokens and stays quiet otherwise', () => {
    expect(roleOf('color.text.default')).toBe('Body text and icons.');
    expect(roleOf('space.4')).toBe('');
  });
});

describe('usageChip', () => {
  const button = { name: 'Button', href: '/components/button/' };
  it('counts components first', () => {
    expect(usageChip({ components: [button], base: ['base.css'], used: true })).toEqual({ kind: 'components', label: '1 component' });
    expect(usageChip({ components: [button, { ...button, name: 'Card' }], base: [], used: true }).label).toBe('2 components');
  });
  it('says base styles when only the global stylesheet reads it', () => {
    expect(usageChip({ components: [], base: ['base.css'], used: true })).toEqual({ kind: 'base', label: 'Base styles' });
  });
  it('says unused only when nothing reads it', () => {
    expect(usageChip({ components: [], base: [], used: false })).toEqual({ kind: 'unused', label: 'Unused' });
  });
});

describe('copy formats', () => {
  it('copies CSS, JS and Figma names', () => {
    expect(copyValue('color.bg.default', 'semantic', 'css')).toBe('var(--color-bg-default)');
    expect(copyValue('color.bg.default', 'semantic', 'js')).toBe("cssVar['color-bg-default']");
    expect(copyValue('space.4', 'primitive', 'js')).toBe("primitives['space-4']");
    expect(copyValue('color.bg.default', 'semantic', 'figma')).toBe('color/bg/default');
  });
  it('falls back to CSS for an unknown stored format', () => {
    expect(parseCopyFormat('figma')).toBe('figma');
    expect(parseCopyFormat('sass')).toBe('css');
    expect(parseCopyFormat(null)).toBe('css');
  });
});

describe('groupTitle', () => {
  it('names groups for people', () => {
    expect(groupTitle('color.bg')).toBe('Background');
    expect(groupTitle('color.feedback')).toBe('Feedback');
    expect(groupTitle('elevation')).toBe('Elevation');
  });
});

describe('foundation rows on this repo', () => {
  it('does not call the page background unused', () => {
    const row = foundationRow('color.bg.default');
    expect(row.used).toBe(true);
    expect(row.base).toContain('base.css');
    expect(row.chip.kind).not.toBe('unused');
    expect(row.alias).toBe('neutral 0 · 950');
  });
  it('lists the components the explorer lists for a token', () => {
    const row = foundationRow('color.action.primary.bg');
    expect(row.components.map((c) => c.name)).toContain('Button');
    expect(row.chip.label).toMatch(/^\d+ components?$/);
  });
  it('builds group and primitive rows without raw hex in the alias line', () => {
    const rows = groupRows('color.bg');
    expect(rows.map((r) => r.path)).toEqual(['color.bg.default', 'color.bg.subtle', 'color.bg.muted', 'color.bg.zone']);
    for (const r of rows) expect(r.alias).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(primitiveRows('space').length).toBeGreaterThan(10);
  });
});
