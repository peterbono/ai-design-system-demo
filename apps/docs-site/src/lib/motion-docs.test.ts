import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseComponentSpecs, type ComponentSpec } from '@bridge-ds/core';
import { loadComponents } from './components';
import { easingValue, motionDocs, motionMoments, partLabel, propertyWords } from './motion-docs';

const specs = parseComponentSpecs(readFileSync(join(__dirname, '../../../../packages/react/component-specs.json'), 'utf8'));
const coverage = new Map((specs.coverage ?? []).map((c) => [c.name, c]));
const info = new Map(loadComponents().map((c) => [c.name, c]));
const docs = (name: string) => motionDocs(name, specs.components, coverage.get(name), info.get(name)?.tokenPaths);

describe('Motion and interaction section', () => {
  it('Button: hover and press, the token with its value and the easing in words', () => {
    const d = docs('Button');
    expect(d.summary).toBe('Button animates on hover and press.');
    expect(d.rows).toEqual([
      { when: 'Hover', what: 'Background and text color', duration: { token: 'motion.duration.instant', value: '75 ms' }, easing: { token: 'motion.easing.standard', value: 'settles in place' } },
      { when: 'Press', what: 'Background', duration: { token: 'motion.duration.instant', value: '75 ms' }, easing: { token: 'motion.easing.standard', value: 'settles in place' } },
    ]);
    expect(d.reduced).toBe('With reduced motion turned on, every change happens at once.');
    expect(d.showPart).toBe(false);
  });

  it('Dialog: opens and closes at different speeds and curves', () => {
    const d = docs('Dialog');
    expect(d.summary).toBe('Dialog animates on open and close.');
    expect(d.rows.map((r) => `${r.when}: ${r.what}, ${r.duration.token} ${r.duration.value}, ${r.easing?.token}`)).toEqual([
      'Open: Fade and movement, motion.duration.moderate 200 ms, motion.easing.enter',
      'Close: Fade and movement, motion.duration.fast 150 ms, motion.easing.exit',
    ]);
  });

  it('check and uncheck at one speed read as one row; several parts get a Part column', () => {
    expect(docs('Switch').rows.map((r) => r.when)).toEqual(['Hover', 'Check and uncheck']);
    const select = docs('Select');
    expect(select.showPart).toBe(true);
    expect([...new Set(select.rows.map((r) => r.part))]).toEqual(['Trigger', 'Popup']);
  });

  it('loops: the spinner slows down under reduced motion, the shimmer stops', () => {
    expect(docs('Spinner')).toMatchObject({ summary: 'Spinner loops while it is shown.', reduced: 'With reduced motion turned on, the spinner keeps turning, slower, so it never looks frozen.' });
    expect(docs('Skeleton').reduced).toBe('With reduced motion turned on, the loop stops.');
    expect(docs('Spinner').rows[0]).toMatchObject({ when: 'While shown', duration: { token: 'motion.duration.spin', value: '700 ms' }, easing: null });
  });

  it('no motion in one line; motion the specs cannot place is said, never denied', () => {
    expect(docs('Badge')).toMatchObject({ summary: 'Badge does not animate: its states change at once.', rows: [], reduced: null });
    expect(docs('Stack').summary).toBe('Stack does not animate: it only lays out other components.');
    // Tag has a transition in its CSS but no state the specs draw: not "does not animate".
    expect(docs('Tag').summary).toBe('Tag has motion in code that this page cannot list yet: try it in the preview.');
    expect(docs('Toast').summary).toMatch(/^Toast has motion in code that this page cannot list yet \(it is shown from a hook/);
    // Tabs lists hover, and says the indicator's token is used for motion the table does not list.
    expect(docs('Tabs').unlisted).toEqual(['motion.duration.moderate']);
  });

  it('helpers', () => {
    expect(propertyWords(['background-color', 'border-color', 'color'])).toBe('Background, border and text color');
    expect(propertyWords(['letter-spacing'])).toBe('Letter spacing');
    expect(easingValue({ easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier: [0.1, 0.2, 0.3, 0.4] } })).toEqual({ token: undefined, value: 'cubic-bezier(0.1, 0.2, 0.3, 0.4)' });
    expect(partLabel({ name: 'MenuCheckboxItem', component: 'Menu' }, 'Menu')).toBe('Checkbox item');
    expect(partLabel({ name: 'Combobox', view: 'without-popup' }, 'Combobox')).toBe('Trigger');
    const still = { name: 'Still', variants: [] } as unknown as ComponentSpec;
    expect(motionMoments(still)).toEqual([]);
  });
});
