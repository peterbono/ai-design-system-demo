import { describe, expect, it } from 'vitest';
import { explorationNote, mergeExplorationNotes, normalizeExplorationNotes, noteFileOf, notesCounts, notesEmpty, notesSpec, parseExplorationNotes, updateEmpty } from '../src';

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

// The note file Claude (Opus, claude.ai) wrote itself on admin-app#8 on 2026-11-05, instead of sending notes.
const REAL = [
  '## Context',
  '',
  'A test of exploration notes. File: `src/explorations/notes-test/OrdersEmptyPage.tsx`.',
  '',
  '## Decisions',
  '',
  '1. EmptyState at size lg with headingLevel 2: it fills the whole page, so its title is the page heading.',
  '2. One primary Button, "Add a print", size lg with a Plus icon: the one action of the page.',
  '',
  '## Edge cases',
  '',
  '- EmptyState, title or description in a long language (German, Finnish): covered. The text column wraps and the page grows.',
  '- Button, "Add a print" while the catalog is being created (slow network): not covered. The button has no loading state yet, so a second tap creates two prints.',
  '',
  '## Open question',
  '',
  '- Should "Add a print" open a dialog on this page or take the shop owner to the catalog? The dialog keeps the context.',
  '',
  '## Next step',
  '',
  '- Wire `loading` on the Button to the create call, then check the page in the preview at phone width.',
  '',
].join('\n');

describe('exploration notes: tolerant of what AI tools write', () => {
  it('reads the real file Claude wrote: 2 decisions, EmptyState covered, Button not covered, 1 question, a clean next step', () => {
    const n = parseExplorationNotes(REAL);
    expect(n.context).toBe('A test of exploration notes. File: `src/explorations/notes-test/OrdersEmptyPage.tsx`.');
    expect(n.decisions).toEqual([
      'EmptyState at size lg with headingLevel 2: it fills the whole page, so its title is the page heading.',
      'One primary Button, "Add a print", size lg with a Plus icon: the one action of the page.',
    ]);
    expect(n.edgeCases).toEqual([
      { component: 'EmptyState', state: 'title or description in a long language (German, Finnish)', covered: true, note: 'The text column wraps and the page grows.' },
      { component: 'Button', state: '"Add a print" while the catalog is being created (slow network)', covered: false, note: 'The button has no loading state yet, so a second tap creates two prints.' },
    ]);
    expect(n.openQuestions).toEqual(['Should "Add a print" open a dialog on this page or take the shop owner to the catalog? The dialog keeps the context.']);
    expect(n.nextStep).toBe('Wire `loading` on the Button to the create call, then check the page in the preview at phone width.');
    expect(notesCounts(n)).toEqual({ decisions: 2, edgeCases: 2, covered: 1, open: 1, questions: 1 });
  });

  it('reads numbered and "*" lists, and heading words in any case, singular or plural', () => {
    const n = parseExplorationNotes('## DECISION\n\n1) One\n2) Two\n* Three\n\n## open Questions:\n\n* Why?\n\n## Edge Case\n\n### Toast\n\n1. [x] Long text: wraps\n\n## Next Steps\n\n1. Try the cart.\n\n## context\n\n* Checkout.\n');
    expect(n.decisions).toEqual(['One', 'Two', 'Three']);
    expect(n.openQuestions).toEqual(['Why?']);
    expect(n.edgeCases).toEqual([{ component: 'Toast', state: 'Long text', covered: true, note: 'wraps' }]);
    expect(n.nextStep).toBe('Try the cart.');
    expect(n.context).toBe('Checkout.');
  });

  it('reads every edge case form', () => {
    const md = [
      '## Edge cases',
      '',
      '- [x] Button / Loading: spinner',
      '- [x] Toast: long text, wraps on two lines',
      '- Table, empty: yes. illustration',
      '- Table, error: no',
      '- Dialog / Small screen (covered) full height',
      '- Dialog / Escape (not covered)',
      '- ✅ Menu / Keyboard: arrows move',
      '',
      '### Input',
      '',
      '- [ ] Invalid: red border',
      '- Input, disabled: covered',
      '- Long label: not covered - truncates',
      '- Loading: no spinner yet',
    ].join('\n');
    expect(parseExplorationNotes(md).edgeCases).toEqual([
      { component: 'Button', state: 'Loading', covered: true, note: 'spinner' },
      { component: 'Toast', state: 'long text', covered: true, note: 'wraps on two lines' },
      { component: 'Table', state: 'empty', covered: true, note: 'illustration' },
      { component: 'Table', state: 'error', covered: false },
      { component: 'Dialog', state: 'Small screen', covered: true, note: 'full height' },
      { component: 'Dialog', state: 'Escape', covered: false },
      { component: 'Menu', state: 'Keyboard', covered: true, note: 'arrows move' },
      { component: 'Input', state: 'Invalid', covered: false, note: 'red border' },
      { component: 'Input', state: 'disabled', covered: true },
      { component: 'Input', state: 'Long label', covered: false, note: 'truncates' },
      { component: 'Input', state: 'Loading', covered: false, note: 'no spinner yet' },
    ]);
  });

  it('never loses text: a stray line becomes a case or the note of the one above, a subheading in a list stays a line', () => {
    const n = parseExplorationNotes('## Edge cases\n\nChecked at phone width.\n\n### Button\n\n- [x] Loading: spinner\n\nAlso on dark.\n\n## Decisions\n\n### Visual\n\n- Pill radius\n');
    expect(n.edgeCases).toEqual([
      { component: 'General', state: 'Checked at phone width.', covered: false },
      { component: 'Button', state: 'Loading', covered: true, note: 'spinner Also on dark.' },
    ]);
    expect(n.decisions).toEqual(['Visual', 'Pill radius']);
  });
});

describe('exploration notes: normalize (a note file written by hand, rewritten in Bridge format)', () => {
  it('rewrites the real file in the canonical format, which parses the same', () => {
    const md = normalizeExplorationNotes(REAL);
    expect(md).toBe(
      [
        '## Context',
        '',
        'A test of exploration notes. File: `src/explorations/notes-test/OrdersEmptyPage.tsx`.',
        '',
        '## Decisions',
        '',
        '- EmptyState at size lg with headingLevel 2: it fills the whole page, so its title is the page heading.',
        '- One primary Button, "Add a print", size lg with a Plus icon: the one action of the page.',
        '',
        '## Edge cases',
        '',
        '### EmptyState',
        '',
        '- [x] title or description in a long language (German, Finnish): The text column wraps and the page grows.',
        '',
        '### Button',
        '',
        '- [ ] "Add a print" while the catalog is being created (slow network): The button has no loading state yet, so a second tap creates two prints.',
        '',
        '## Open questions',
        '',
        '- Should "Add a print" open a dialog on this page or take the shop owner to the catalog? The dialog keeps the context.',
        '',
        '## Next step',
        '',
        'Wire `loading` on the Button to the create call, then check the page in the preview at phone width.',
        '',
      ].join('\n'),
    );
    expect(parseExplorationNotes(md)).toEqual(parseExplorationNotes(REAL));
    expect(normalizeExplorationNotes(md)).toBe(md);
  });

  it("leaves the writer's own output byte for byte, and keeps the preamble and unknown sections in place", () => {
    const written = mergeExplorationNotes(OLD, {
      context: 'Friendlier checkout.',
      decisions: ['Pill on primary', 'Secondary keeps its radius'],
      edgeCases: [
        { component: 'Button', state: 'Loading', covered: true, note: 'spinner, width kept' },
        { component: 'Button', state: 'Error', covered: false },
        { component: 'Toast', state: 'Long text', covered: false, note: 'wraps badly' },
      ],
      openQuestions: ['Dark mode?'],
      nextStep: 'Try the cart.',
    });
    expect(normalizeExplorationNotes(written)).toBe(written);
    const hand = `${OLD.trim()}\n\n## Decision\n\n1. A\n\n## Notes from Ana\n\nKeep me.\n\n## Context\n\n- Why\n`;
    const md = normalizeExplorationNotes(hand);
    expect(md).toBe(`${OLD.trim()}\n\n## Context\n\nWhy\n\n## Notes from Ana\n\nKeep me.\n\n## Decisions\n\n- A\n`);
    expect(parseExplorationNotes(md)).toEqual(parseExplorationNotes(hand));
    // A file without any of the five is left alone.
    expect(normalizeExplorationNotes(OLD)).toBe(OLD);
  });

  it('round-trips: what the writer writes parses back as given, even notes that look like status words', () => {
    const update = {
      context: 'Why we look at it.',
      decisions: ['1 radius for all', 'Keep: the old icon'],
      edgeCases: [
        { component: 'Button', state: 'Loading', covered: true, note: 'done' },
        { component: 'Button', state: 'Empty', covered: false, note: 'no. Needs a design' },
        { component: 'Table', state: 'Error (network)', covered: true, note: 'covered, by a toast' },
        { component: 'General', state: 'Phone width', covered: false },
      ],
      openQuestions: ['Dark mode?'],
      nextStep: 'Try the cart.',
    };
    const md = mergeExplorationNotes('', update);
    const n = parseExplorationNotes(md);
    expect(n).toEqual({ context: update.context, decisions: update.decisions, edgeCases: update.edgeCases.map((e) => ({ ...e })), openQuestions: update.openQuestions, nextStep: update.nextStep });
    expect(normalizeExplorationNotes(md)).toBe(md);
  });

  it('merges an update into a normalized hand-written file', () => {
    const md = mergeExplorationNotes(normalizeExplorationNotes(REAL), { edgeCases: [{ component: 'Button', state: '"Add a print" while the catalog is being created (slow network)', covered: true }] });
    expect(parseExplorationNotes(md).edgeCases.map((e) => e.covered)).toEqual([true, true]);
    expect(parseExplorationNotes(md).edgeCases[1]!.note).toContain('no loading state yet');
  });
});
