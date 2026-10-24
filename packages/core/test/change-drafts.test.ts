import { describe, expect, it } from 'vitest';
import { type DiffEntry, type FieldChange, type LogicalToken, REQUEST_KINDS, cleanDraftText, draftChangeLine, draftPushDescription, draftRequestText, parseStructureChange, pushChangeRows, sanitizeDraftLine, shortVariant } from '../src/index';

const EM = '\u2014';

const token = (path: string, values: Record<string, unknown>, type = 'color'): LogicalToken => ({ id: path, path, type, tier: 'semantic', values, description: undefined, scopes: undefined, files: {} });

function entry(kind: 'added' | 'changed' | 'renamed' | 'removed', path: string, opts: { from?: string; modes?: string[]; fields?: ('value' | 'description')[] } = {}): DiffEntry {
  const before = kind === 'added' ? undefined : token(opts.from ?? path, { light: '#000000', dark: '#ffffff' });
  const after = kind === 'removed' ? undefined : token(path, { light: '#111111', dark: '#ffffff' });
  const fields: FieldChange[] = (opts.fields ?? ['value']).flatMap((f): FieldChange[] => (f === 'value' ? (opts.modes ?? ['light']).map((mode): FieldChange => ({ field: 'value', mode, before: '#000000', after: '#111111' })) : [{ field: 'description', before: 'a', after: 'b' }]));
  return { id: path, path, base: before, head: before, figma: after, local: { kind, fields }, conflict: false };
}

describe('request drafts', () => {
  it('adds a variant value', () => {
    expect(draftRequestText('Badge', 'new-variant', [{ field: 'Variant Tone', before: 'info, neutral', after: 'danger, info, neutral' }])).toEqual({
      title: 'Add a danger tone',
      summary: 'Badge gets a new Tone value, danger.',
    });
    expect(draftRequestText('Badge', 'new-variant', [{ field: 'Variant Tone', before: 'info', after: 'danger, info, success' }]).title).toBe('Add danger and success to Tone');
    expect(draftRequestText('Button', 'new-variant', [{ field: 'Variant Size', before: 'md, sm', after: 'md' }])).toEqual({ title: 'Remove the sm size', summary: 'Button no longer has the Size value sm.' });
    expect(draftRequestText('Button', 'new-variant', [{ field: 'Variant Density', after: 'compact, comfortable' }]).title).toBe('Add a Density variant axis');
  });

  it('describes props, token bindings, visual changes and new components', () => {
    expect(draftRequestText('Button', 'prop-change', [{ field: 'Prop Loading', after: 'boolean, default false' }])).toEqual({
      title: 'Add the Loading prop',
      summary: 'Button gets a new boolean prop, Loading, default false.',
    });
    expect(draftRequestText('Button', 'prop-change', [{ field: 'Prop Size', before: 'variant, default md', after: 'variant, default sm' }]).title).toBe('Change the Size default to sm');
    expect(draftRequestText('Button', 'token-binding', [{ field: 'Fill (Variant=primary)', before: 'color.action.primary.bg', after: 'color.action.danger.bg' }])).toEqual({
      title: 'Use color.action.danger.bg for the fill',
      summary: 'The fill of Button in primary moves from color.action.primary.bg to color.action.danger.bg.',
    });
    expect(draftRequestText('Card', 'visual', [{ field: 'Look of every variant', before: 'As in the baseline', after: 'Changed in Figma, no variable explains it' }]).summary).toBe(
      'Card looks different in Figma, and no variable edit explains it.',
    );
    expect(draftRequestText('DatePicker', 'new-component', [{ field: 'Variant Size', after: 'md, sm' }, { field: 'Prop Label', after: 'text, default Date' }])).toEqual({
      title: 'Add the DatePicker component',
      summary: 'DatePicker is not in code yet. The Figma component has 1 variant axis and 1 prop.',
    });
  });

  it('counts the other changes, and says nothing without detected changes', () => {
    const d = draftRequestText('Button', 'prop-change', [{ field: 'Prop Loading', after: 'boolean, default false' }, { field: 'Prop Icon', after: 'boolean, default false' }]);
    expect(d.summary).toBe('Button gets a new boolean prop, Loading, default false. 1 other change is listed below.');
    expect(draftRequestText('Button', 'bug', [])).toEqual({ title: '', summary: '' });
  });

  it('never writes an em dash, even from names that hold one', () => {
    const d = draftRequestText(`Button ${EM} ghost`, 'new-variant', [{ field: 'Variant Tone', before: 'a', after: 'a, b' }]);
    expect(`${d.title} ${d.summary}`).not.toContain(EM);
    expect(cleanDraftText(`Darker buttons ${EM} better contrast`)).toBe('Darker buttons, better contrast');
  });
});

describe('push description drafts', () => {
  it('names the variable edits by kind', () => {
    expect(draftPushDescription([entry('changed', 'color.action.primary.bg', { modes: ['light', 'dark'] })])).toBe('Changes color.action.primary.bg in Light and Dark.');
    expect(draftPushDescription([entry('changed', 'color.a'), entry('changed', 'color.b'), entry('added', 'radius.pill')])).toBe('Changes color.a and color.b and adds radius.pill.');
    expect(draftPushDescription([entry('renamed', 'color.text.subtle', { from: 'color.text.muted' })])).toBe('Renames color.text.muted to color.text.subtle.');
    expect(draftPushDescription([entry('removed', 'color.old')])).toBe('Removes color.old.');
    expect(draftPushDescription([entry('changed', 'color.a', { fields: ['description'] })])).toBe('Updates the description of color.a.');
  });

  it('shortens long lists and adds the component requests', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((x) => entry('changed', `color.${x}`));
    expect(draftPushDescription(many, [{ component: 'Button', kind: 'new-variant' }, { component: 'DatePicker', kind: 'new-component' }])).toBe(
      'Changes 5 tokens, including color.a and color.b. Requests a change to Button and the new DatePicker component.',
    );
    expect(draftPushDescription([], [{ component: 'Button', kind: 'visual' }, { component: 'Badge', kind: 'new-variant' }])).toBe('Requests changes to Button and Badge.');
    expect(draftPushDescription([])).toBe('');
  });

  it('lists the edits as a change table', () => {
    expect(pushChangeRows([entry('changed', 'color.a')])).toEqual([{ field: 'color.a', before: 'Light #000000; Dark #ffffff', after: 'Light #111111; Dark #ffffff' }]);
    expect(pushChangeRows([entry('added', 'color.n')])[0]).toMatchObject({ field: 'color.n', before: undefined });
  });
});

describe('draftChangeLine', () => {
  it('says what changed in one sentence, from the diff only', () => {
    expect(draftChangeLine('visual', [{ field: 'Look of Size=sm, State=Default, Variant=primary', before: 'As in the baseline', after: 'Changed in Figma, no variable explains it' }])).toBe('Looks different in Size=sm, State=Default, Variant=primary; no variable explains it');
    expect(draftChangeLine('new-variant', [{ field: 'Variant Tone', before: 'info, neutral', after: 'danger, info, neutral' }])).toBe('Danger added to Tone');
    expect(draftChangeLine('prop-change', [{ field: 'Prop Loading', after: 'boolean, default false' }])).toBe('New boolean prop Loading, default false');
    expect(draftChangeLine('token-binding', [{ field: 'Fill (Size=sm)', before: 'color.action.bg', after: 'color.danger.bg' }, { field: 'Radius', before: 'radius.sm', after: 'radius.md' }])).toBe('Fill uses color.danger.bg instead of color.action.bg in sm (and 1 more)');
    expect(draftChangeLine('visual', [{ field: 'Swapped instance (Size=sm)', before: 'Icon/Plus', after: 'Icon/Pencil' }])).toBe('Shows Icon/Pencil instead of Icon/Plus in Size=sm');
    expect(draftChangeLine('new-component', [{ field: 'Variant Size', after: 'sm, md' }, { field: 'Prop Label', after: 'text, default Go' }])).toBe('New component with 1 variant axis and 1 prop, not in code yet');
    expect(draftChangeLine('bug', [])).toBe('');
  });

  it('sanitizeDraftLine: one line, no em dash, at most 120 characters, no trailing period', () => {
    expect(sanitizeDraftLine(`icon added ${EM} after the label.\nSecond line.`)).toBe('Icon added, after the label. Second line');
    expect(sanitizeDraftLine('word '.repeat(60)).length).toBeLessThanOrEqual(120);
    expect(sanitizeDraftLine(42)).toBe('');
  });
});

describe('structure changes', () => {
  const added = { field: 'New layer "Icon" (Size=sm, State=Default, Variant=primary)', after: 'instance Icon/Pencil, after "Label"' };

  it('is a request kind with its label and hint', () => {
    expect(REQUEST_KINDS.find((k) => k.value === 'structure')).toEqual({ value: 'structure', label: 'Structure change', hint: 'A part was added, removed or moved.' });
  });

  it('shortens variant keys the way designers say them', () => {
    expect(shortVariant('Size=sm, State=Default, Variant=primary')).toBe('primary sm');
    expect(shortVariant('Size=md, Tone=danger')).toBe('danger md');
    expect(shortVariant('Default')).toBe('Default');
  });

  it('reads the rows back', () => {
    expect(parseStructureChange(added)).toEqual({ op: 'added', name: 'Icon', where: 'in primary sm', type: 'instance', main: 'Icon/Pencil', at: 'after "Label"' });
    expect(parseStructureChange({ field: 'Fill', before: 'a', after: 'b' })).toBeUndefined();
  });

  it('names the new layer, its component and its place in one line', () => {
    expect(draftChangeLine('structure', [added])).toBe('New instance layer "Icon" (Icon/Pencil) after "Label" in primary sm');
    expect(draftChangeLine('structure', [{ field: 'Removed layer "Helper"', before: 'text, after "Label"' }])).toBe('Removed text layer "Helper" after "Label" in every variant');
    expect(draftChangeLine('structure', [{ field: 'Moved layer "Icon start" (Size=md)', before: 'before "Label"', after: 'after "Label"' }])).toBe('Moved layer "Icon start" after "Label" (was before "Label") in md');
  });

  it('drafts a title and a summary for each kind of layer change', () => {
    expect(draftRequestText('Button', 'structure', [added])).toEqual({ title: 'Add a layer after Label', summary: 'Button gets an instance layer, Icon (Icon/Pencil) after Label in primary sm.' });
    expect(draftRequestText('Button', 'structure', [{ field: 'Removed layer "Helper"', before: 'text, after "Label"' }]).title).toBe('Remove the Helper layer');
    expect(draftRequestText('Button', 'structure', [{ field: 'Moved layer "Icon start"', before: 'before "Label"', after: 'after "Label"' }]).title).toBe('Move the Icon start layer');
  });

  it('names a removed or added variant the short way', () => {
    expect(draftRequestText('Badge', 'new-variant', [{ field: 'Variants', before: 'Appearance=solid, Size=md, Tone=info' }])).toEqual({
      title: 'Remove the info solid md variant',
      summary: 'Badge no longer has the info solid md variant (Appearance=solid, Size=md, Tone=info).',
    });
    expect(draftChangeLine('new-variant', [{ field: 'Variants', before: 'Size=md, Tone=info', after: 'Size=lg, Tone=info' }])).toBe('New variant info lg; info md variant removed');
  });
});
