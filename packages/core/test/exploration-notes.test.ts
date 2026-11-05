import { describe, expect, it } from 'vitest';
import { explorationNote, mergeExplorationNotes, noteFileOf, notesCounts, notesEmpty, notesSpec, parseExplorationNotes, updateEmpty } from '../src';

const OLD = explorationNote({ name: 'Pill buttons', purpose: 'Do rounder buttons feel friendlier?', slug: 'pill-buttons', startedAt: '2026-11-01T10:00:00Z', author: 'ana' });

describe('exploration notes: parse', () => {
  it('reads an old note (only the marker text) as empty', () => {
    const n = parseExplorationNotes(OLD);
    expect(notesEmpty(n)).toBe(true);
    expect(parseExplorationNotes(null)).toEqual({ context: '', decisions: [], edgeCases: [], openQuestions: [], nextStep: '' });
  });

  it('reads the five sections, hand-written lines and other heading words included', () => {
    const md = [
      '# Exploration: Pill buttons',
      '',
      '## Context',
      '',
      'Checkout feels harsh.',
      'Users hesitate.',
      '',
      '## Decisions:',
      '',
      '- Pill radius on primary only',
      '* Secondary keeps the',
      '  control radius',
      '',
      'We dropped the ghost variant.',
      '',
      '## Edge cases',
      '',
      '### Button',
      '',
      '- [x] Loading: spinner replaces the label',
      '- [ ] Long label in German',
      '  needs a check',
      '',
      '### Icon button',
      '- [X] Pressed - darker fill',
      '',
      '## Questions',
      '',
      '- Do we keep it in dark mode?',
      '',
      '## Notes from Ana',
      '',
      'Anything goes here.',
      '',
      '## Next steps',
      '',
      'Try it in the cart.',
    ].join('\n');
    const n = parseExplorationNotes(md);
    expect(n.context).toBe('Checkout feels harsh.\nUsers hesitate.');
    expect(n.decisions).toEqual(['Pill radius on primary only', 'Secondary keeps the control radius', 'We dropped the ghost variant.']);
    expect(n.edgeCases).toEqual([
      { component: 'Button', state: 'Loading', covered: true, note: 'spinner replaces the label' },
      { component: 'Button', state: 'Long label in German', covered: false, note: 'needs a check' },
      { component: 'Icon button', state: 'Pressed', covered: true, note: 'darker fill' },
    ]);
    expect(n.openQuestions).toEqual(['Do we keep it in dark mode?']);
    expect(n.nextStep).toBe('Try it in the cart.');
    expect(notesCounts(n)).toEqual({ decisions: 3, edgeCases: 3, covered: 2, open: 1, questions: 1 });
  });

  it('never reads a heading inside pasted code', () => {
    const n = parseExplorationNotes('## Context\n\n```md\n## Decisions\n- not one\n```\n');
    expect(n.decisions).toEqual([]);
    expect(n.context).toContain('## Decisions');
  });

  it('reads "Component / state" lines under no component as that component', () => {
    expect(parseExplorationNotes('## Edge cases\n\n- [x] Table / Empty: illustration\n- Toast: stays 5 s')).toEqual(
      expect.objectContaining({ edgeCases: [{ component: 'Table', state: 'Empty', covered: true, note: 'illustration' }, { component: 'General', state: 'Toast', covered: false, note: 'stays 5 s' }] }),
    );
  });
});

describe('exploration notes: merge', () => {
  it('adds the sections below an old note, keeping the marker text, in the stable order', () => {
    const md = mergeExplorationNotes(OLD, { nextStep: 'Try the cart.', decisions: ['Pill on primary'], context: 'Checkout feels harsh.' });
    expect(md.startsWith(OLD.trim())).toBe(true);
    expect(md.indexOf('## Context')).toBeLessThan(md.indexOf('## Decisions'));
    expect(md.indexOf('## Decisions')).toBeLessThan(md.indexOf('## Next step'));
    expect(md).toContain('This file marks the branch as an exploration.');
    expect(parseExplorationNotes(md)).toMatchObject({ context: 'Checkout feels harsh.', decisions: ['Pill on primary'], nextStep: 'Try the cart.' });
    expect(md.endsWith('\n')).toBe(true);
  });

  it('merges section by section: lists add, text replaces, hand-written lines and unknown sections stay', () => {
    const before = [OLD.trim(), '', '## Decisions', '', 'We dropped the ghost variant.', '- Pill on primary', '', '## Notes from Ana', '', 'Keep me.', '', '## Next step', '', 'Old step.', ''].join('\n');
    const md = mergeExplorationNotes(before, { decisions: ['pill on primary.', 'Secondary keeps its radius'], nextStep: 'New step.' });
    expect(md).toContain('We dropped the ghost variant.');
    expect(md).toContain('## Notes from Ana\n\nKeep me.');
    expect(md.match(/Pill on primary/gi)).toHaveLength(1);
    expect(md).toContain('- Secondary keeps its radius');
    expect(md).toContain('## Next step\n\nNew step.');
    expect(md).not.toContain('Old step.');
    // A section the update does not name stays byte for byte.
    expect(mergeExplorationNotes(md, { nextStep: 'New step.' })).toBe(md);
  });

  it('updates an edge case in place, adds new ones to their component, keeps a note left out', () => {
    const before = '## Edge cases\n\n### Button\n\n- [ ] Loading: to do\n- [x] Disabled: grey\n\nAna: check focus too.\n';
    const md = mergeExplorationNotes(before, {
      edgeCases: [
        { component: 'button', state: 'loading', covered: true, note: 'spinner, width kept' },
        { component: 'Button', state: 'Disabled', covered: false },
        { component: 'Button', state: 'Focus', covered: false, note: 'ring on dark' },
        { component: 'Toast', state: 'Long text', covered: true },
      ],
    });
    expect(md).toContain('- [x] loading: spinner, width kept');
    expect(md).toContain('- [ ] Disabled: grey');
    expect(md).toContain('Ana: check focus too.');
    expect(md).toContain('### Toast\n\n- [x] Long text');
    const n = parseExplorationNotes(md);
    expect(n.edgeCases.map((e) => `${e.component}/${e.state}/${e.covered}`)).toEqual(['Button/loading/true', 'Button/Disabled/false', 'Button/Focus/false', 'Toast/Long text/true']);
  });

  it('takes answered questions out, never another line', () => {
    const before = '## Open questions\n\n- Dark mode?\n- Keep it on mobile?\n';
    const md = mergeExplorationNotes(before, { answeredQuestions: ['dark mode'], openQuestions: ['Who owns the copy?'] });
    expect(parseExplorationNotes(md).openQuestions).toEqual(['Keep it on mobile?', 'Who owns the copy?']);
    expect(mergeExplorationNotes(OLD, { answeredQuestions: ['x'] })).toBe(OLD);
  });

  it('replace writes the named lists as given (the in-place edit), and an emptied section goes', () => {
    const before = mergeExplorationNotes(OLD, { decisions: ['A', 'B'], openQuestions: ['Q'], edgeCases: [{ component: 'Button', state: 'Loading', covered: false }] });
    const md = mergeExplorationNotes(before, { decisions: ['B'], openQuestions: [], edgeCases: [{ component: 'Button', state: 'Loading', covered: true, note: 'done' }] }, { replace: true });
    const n = parseExplorationNotes(md);
    expect(n.decisions).toEqual(['B']);
    expect(n.openQuestions).toEqual([]);
    expect(md).not.toContain('## Open questions');
    expect(n.edgeCases).toEqual([{ component: 'Button', state: 'Loading', covered: true, note: 'done' }]);
  });

  it('writes no em dash and keeps one line per item', () => {
    const md = mergeExplorationNotes('', { decisions: ['Pill — primary only\nfor now'] });
    expect(md).toBe('## Decisions\n\n- Pill, primary only for now\n');
  });

  it('updateEmpty', () => {
    expect(updateEmpty({})).toBe(true);
    expect(updateEmpty(undefined)).toBe(true);
    expect(updateEmpty({ answeredQuestions: [] })).toBe(true);
    expect(updateEmpty({ nextStep: '' })).toBe(false);
  });
});

describe('exploration notes: spec for developers and the note file', () => {
  it('lists decisions, edge cases and questions; null without any', () => {
    expect(notesSpec(parseExplorationNotes(OLD))).toBeNull();
    const n = parseExplorationNotes(mergeExplorationNotes(OLD, { context: 'Friendlier checkout.', decisions: ['Pill on primary'], edgeCases: [{ component: 'Button', state: 'Loading', covered: true, note: 'spinner' }, { component: 'Button', state: 'Error', covered: false }], openQuestions: ['Dark mode?'], nextStep: 'x' }));
    const spec = notesSpec(n)!;
    expect(spec).toContain('**Decisions.**\n\n- Pill on primary');
    expect(spec).toContain('- [x] Button, Loading: spinner');
    expect(spec).toContain('- [ ] Button, Error');
    expect(spec).toContain('**Open questions.**\n\n- Dark mode?');
    expect(spec).not.toMatch(/^#/m);
  });

  it('finds the note file among the changed files', () => {
    expect(noteFileOf(['src/a.tsx', '.bridge/explorations/pill.md'])).toBe('.bridge/explorations/pill.md');
    expect(noteFileOf(['.bridge/figma/x.json'])).toBeNull();
    expect(noteFileOf(null)).toBeNull();
  });
});
