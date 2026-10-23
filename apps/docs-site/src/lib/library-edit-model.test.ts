import { describe, expect, it } from 'vitest';
import { formatDocsJson, type ComponentDocsJson } from '@bridge-ds/core';
import { docsFileText } from './docs-draft-model';
import {
  SECTIONS,
  authorship,
  claudeTextOf,
  continueLine,
  editBarLabel,
  sendBlockedReason,
  applyDraft,
  changedLabel,
  changedSections,
  changeTitle,
  discardDrafts,
  docsToSend,
  editMeta,
  getField,
  initEdit,
  isDirty,
  isEmptyValue,
  keepDrafts,
  pendingSections,
  replaceSelection,
  restoreMeta,
  sectionsToFill,
  sectionState,
  sendTitle,
  setField,
  setValue,
  toReview,
  cancelNeedsConfirm,
  EDIT_BAR_LABEL,
  editBarState,
  escapeIntent,
  keepAllLabel,
  type EditState,
} from './library-edit-model';

const base: ComponentDocsJson = {
  summary: 'Shows a glyph.',
  status: 'stable',
  whenToUse: ['Next to a label.'],
  whenNotToUse: [],
  dos: [{ title: 'Pair it', text: 'With a label.' }],
  donts: [],
  accessibility: ['Decorative by default.'],
};

describe('dirty tracking', () => {
  it('is clean until a section or the status changes, and ignores whitespace and empty items', () => {
    const s = initEdit(base);
    expect(isDirty(s)).toBe(false);
    expect(isDirty(setValue(s, 'whenToUse', ['Next to a label.', '  ']))).toBe(false);
    const edited = setValue(s, 'summary', 'Shows a glyph next to text.');
    expect(isDirty(edited)).toBe(true);
    expect(changedSections(edited)).toEqual(['summary']);
    const status = { ...s, docs: { ...s.docs, status: 'beta' as const } };
    expect(isDirty(status)).toBe(true);
    expect(changedLabel(status)).toBe('the status');
    expect(changedLabel(setValue(edited, 'dos', []))).toBe('2 sections');
    expect(changedLabel(s)).toBe('Nothing yet');
    const { status: _drop, ...noStatus } = base;
    expect(isDirty({ base: noStatus, docs: { ...noStatus, status: 'stable' } })).toBe(false);
  });

  it('knows an empty value', () => {
    expect(isEmptyValue('  ')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue([''])).toBe(true);
    expect(isEmptyValue([{ title: ' ', text: '' }])).toBe(true);
    expect(isEmptyValue(['a'])).toBe(false);
    expect(isEmptyValue(undefined)).toBe(true);
  });
});

describe('section states and the To review list', () => {
  it('marks empty and outdated sections, and editing an outdated one ticks it', () => {
    let s: EditState = { ...initEdit(base), outdated: ['accessibility'] };
    expect(sectionState(s, 'whenNotToUse')).toBe('empty');
    expect(sectionState(s, 'contentGuidelines')).toBe('empty');
    expect(sectionState(s, 'accessibility')).toBe('outdated');
    expect(sectionState(s, 'summary')).toBe('filled');
    expect(sectionsToFill(s)).toEqual(['whenNotToUse', 'accessibility', 'contentGuidelines']);
    expect(toReview(s)).toEqual([{ id: 'accessibility', label: 'Accessibility', done: false, words: 'Outdated' }]);
    s = setValue(s, 'accessibility', ['Decorative by default. Pass a label when it carries meaning.']);
    expect(sectionState(s, 'accessibility')).toBe('filled');
    expect(toReview(s)).toEqual([]);
    expect(s.reviewed).toEqual(['accessibility']);
  });
});

describe('Claude drafts', () => {
  const drafted = applyDraft(initEdit(base), { whenNotToUse: ['As a button: use IconButton.'], donts: [{ title: 'Alone', text: 'Without a label.' }] });

  it('shows drafts in place, pending, with the value they replaced', () => {
    expect(drafted.docs.whenNotToUse).toEqual(['As a button: use IconButton.']);
    expect(pendingSections(drafted)).toEqual(['whenNotToUse', 'doDont']);
    expect(sectionState(drafted, 'doDont')).toBe('drafted');
    expect(toReview(drafted).map((r) => [r.id, r.done, r.words])).toEqual([
      ['whenNotToUse', false, 'Drafted by Claude'],
      ['doDont', false, 'Drafted by Claude'],
    ]);
  });

  it('a second draft of the same key keeps the first "before"', () => {
    const again = applyDraft(drafted, { whenNotToUse: ['Other.'] });
    expect(discardDrafts(again, ['whenNotToUse']).docs.whenNotToUse).toEqual([]);
  });

  it('Keep keeps the text and ticks the section; Discard restores it', () => {
    const kept = keepDrafts(drafted, ['doDont']);
    expect(kept.docs.donts).toHaveLength(1);
    expect(pendingSections(kept)).toEqual(['whenNotToUse']);
    expect(toReview(kept).map((r) => r.id)).toEqual(['whenNotToUse']);
    expect(kept.kept).toEqual(['doDont']);
    const discarded = discardDrafts(kept, ['whenNotToUse']);
    expect(discarded.docs.whenNotToUse).toEqual([]);
    expect(pendingSections(discarded)).toEqual([]);
    expect(toReview(discarded)).toEqual([]);
  });

  it('Keep all keeps every pending draft', () => {
    const all = keepDrafts(drafted);
    expect(pendingSections(all)).toEqual([]);
    expect(all.kept).toEqual(['whenNotToUse', 'doDont']);
  });

  it('removes an optional key that did not exist before the draft', () => {
    const d = applyDraft(initEdit(base), { contentGuidelines: ['Sentence case.'] });
    expect('contentGuidelines' in discardDrafts(d, ['contentGuidelines']).docs).toBe(false);
  });

  it('credits kept drafts and flags pending ones when sending', () => {
    expect(docsToSend(initEdit(base)).draftedBy).toBeUndefined();
    expect(docsToSend(keepDrafts(drafted))).toMatchObject({ draftedBy: 'claude' });
    expect(docsToSend(keepDrafts(drafted)).needsReview).toBeUndefined();
    expect(docsToSend(drafted)).toMatchObject({ draftedBy: 'claude', needsReview: true, draftedSections: ['whenNotToUse', 'donts'] });
    expect(docsToSend(keepDrafts(drafted, ['doDont']))).toMatchObject({ needsReview: true, draftedSections: ['whenNotToUse'] });
  });

  it('labels a rewrite of written text as updated, and a checked section as still accurate', () => {
    const s = applyDraft({ ...initEdit(base), outdated: ['accessibility', 'whenToUse'] }, { accessibility: ['New.'] }, ['accessibility', 'whenToUse']);
    expect(toReview(s)).toEqual([{ id: 'accessibility', label: 'Accessibility', done: false, words: 'Updated by Claude', updated: true }]);
    expect(s.accurate).toEqual(['whenToUse']);
    expect(sectionState(s, 'whenToUse')).toBe('filled');
  });

  it('restores the drafts a file marks for review, and accepting them all clears the mark', () => {
    const file: ComponentDocsJson = { ...base, whenNotToUse: ['Drafted.'], draftedBy: 'claude', needsReview: true, draftedSections: ['whenNotToUse'] };
    const s = initEdit(file);
    expect(pendingSections(s)).toEqual(['whenNotToUse']);
    expect(isDirty(s)).toBe(false);
    const kept = keepDrafts(s);
    expect(isDirty(kept)).toBe(true);
    expect(docsToSend(kept)).toMatchObject({ draftedBy: 'claude', needsReview: false });
    expect(docsToSend(kept).draftedSections).toBeUndefined();
    expect(discardDrafts(s, ['whenNotToUse']).docs.whenNotToUse).toEqual([]);
  });

  it('survives a reload through its meta', () => {
    const back = restoreMeta(initEdit(base, drafted.docs), JSON.parse(JSON.stringify(editMeta(keepDrafts(drafted, ['doDont'])))));
    expect(pendingSections(back)).toEqual(['whenNotToUse']);
    expect(back.kept).toEqual(['doDont']);
    expect(restoreMeta(initEdit(base), { reviewed: ['nope' as never] }).reviewed).toEqual([]);
  });
});

describe('fields and selections', () => {
  it('reads and writes strings, list items and Do and don\'t parts', () => {
    expect(getField(base, { key: 'summary' })).toBe('Shows a glyph.');
    expect(getField(base, { key: 'dos', index: 0, part: 'title' })).toBe('Pair it');
    expect(getField(base, { key: 'whenToUse', index: 3 })).toBe('');
    expect(setField(base, { key: 'whenToUse', index: 0 }, 'Beside a label.')).toEqual(['Beside a label.']);
    expect(setField(base, { key: 'dos', index: 0, part: 'text' }, 'Always.')).toEqual([{ title: 'Pair it', text: 'Always.' }]);
    expect(setField(base, { key: 'summary' }, 'New.')).toBe('New.');
  });

  it('replaces the selected range, or the first match when the text moved', () => {
    expect(replaceSelection('Use it for big things.', { start: 11, end: 14, text: 'big' }, 'large')).toBe('Use it for large things.');
    expect(replaceSelection('Now: use it for big things.', { start: 11, end: 14, text: 'big' }, 'large')).toBe('Now: use it for large things.');
    expect(replaceSelection('Gone.', { start: 0, end: 3, text: 'big' }, 'large')).toBe('Gone.');
  });
});

describe('send', () => {
  it('prefills a designer title and keeps the repo convention on the change', () => {
    expect(sendTitle('Button')).toBe('Update Button usage guidance');
    expect(changeTitle('button', 'Update Button usage guidance')).toBe('docs(button): update Button usage guidance');
    expect(changeTitle('button', 'docs(button): fix a typo')).toBe('docs(button): fix a typo');
  });
});

describe('edit bar', () => {
  it('says what state the edit is in', () => {
    expect(editBarState({ dirty: false, sent: false, savesLocally: true })).toBe('clean');
    expect(editBarState({ dirty: true, sent: false, savesLocally: true })).toBe('saved');
    expect(editBarState({ dirty: false, sent: false, savesLocally: false })).toBe('clean');
    expect(editBarState({ dirty: true, sent: false, savesLocally: false })).toBe('unsaved');
    expect(editBarState({ dirty: true, sent: true, savesLocally: true })).toBe('sent');
    expect(EDIT_BAR_LABEL.saved).toBe('Draft saved in this browser');
    expect(EDIT_BAR_LABEL.unsaved).toBe('Unsaved changes');
    expect(EDIT_BAR_LABEL.sent).toBe('Sent for review');
  });

  it('offers Keep all only from two drafts, and names it', () => {
    expect(keepAllLabel(0)).toBeNull();
    expect(keepAllLabel(1)).toBeNull();
    expect(keepAllLabel(3)).toBe('Keep all 3 Claude drafts');
  });

  it('never discards on Escape', () => {
    expect(escapeIntent({ overlayOpen: true, inField: true })).toBe('none');
    expect(escapeIntent({ overlayOpen: false, inField: true })).toBe('leave-field');
    expect(escapeIntent({ overlayOpen: false, inField: false })).toBe('cancel');
    expect(cancelNeedsConfirm({ dirty: false, pending: 0 })).toBe(false);
    expect(cancelNeedsConfirm({ dirty: false, pending: 1 })).toBe(true);
    expect(cancelNeedsConfirm({ dirty: true, pending: 0 })).toBe(true);
  });
});

describe('who wrote the text, and the open proposal', () => {
  // The VisuallyHidden case (#148, #161): the open proposal holds Claude's whole-page draft, waiting for review.
  const drafted: ComponentDocsJson = {
    ...base,
    whenNotToUse: ['For visible text.'],
    donts: [{ title: 'Hide focus', text: 'Never.' }],
    contentGuidelines: ['Short.'],
    anatomy: { root: 'The clipped span' },
    draftedBy: 'claude',
    needsReview: true,
    draftedSections: ['summary', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines'],
  };
  const text = formatDocsJson(drafted);

  it('has nothing to send when the text is the open proposal as it is', () => {
    const s = initEdit(drafted);
    expect(pendingSections(s)).toHaveLength(6);
    const fileText = docsFileText(docsToSend(s), text);
    expect(fileText).toBe(text);
    expect(sendBlockedReason({ fileText, base: text, continuing: true })).toBe('Nothing changed since the open proposal');
    expect(sendBlockedReason({ fileText, base: text, continuing: false })).toBe('No changes yet');
    expect(sendBlockedReason({ fileText: docsFileText(docsToSend(keepDrafts(s)), text), base: text, continuing: true })).toBeNull();
    expect(sendBlockedReason({ fileText: '{}', base: null, continuing: false })).toBeNull();
  });

  it("keeps Claude's credit when nobody edited the draft, and names the edited sections", () => {
    const s = initEdit(drafted);
    expect(authorship(s)).toEqual({ claude: [], edited: [], written: [], pending: SECTIONS.map((x) => x.label) });
    const kept = keepDrafts(s);
    expect(authorship(kept)).toEqual({ claude: SECTIONS.map((x) => x.label), edited: [], written: [], pending: [] });
    const edited = setValue(kept, 'summary', 'Hides text from sight, not from screen readers.');
    expect(authorship(edited).edited).toEqual(['Summary']);
    expect(authorship(edited).claude).not.toContain('Summary');
  });

  it('credits a person alone when no Claude draft is in the text, and tracks drafts made here', () => {
    const s = initEdit(base);
    expect(authorship(setValue(s, 'summary', 'Shows a glyph next to text.'))).toEqual({ claude: [], edited: [], written: ['Summary'], pending: [] });
    const d = applyDraft(s, { contentGuidelines: ['Name the icon.'] });
    expect(authorship(d).pending).toEqual(['Content guidelines']);
    expect(authorship(keepDrafts(d)).claude).toEqual(['Content guidelines']);
    expect(authorship(discardDrafts(d, ['contentGuidelines']))).toEqual({ claude: [], edited: [], written: [], pending: [] });
    // Accepted earlier: the file still says Claude wrote it.
    expect(claudeTextOf({ ...base, draftedBy: 'claude', needsReview: false }).summary).toBe('Shows a glyph.');
    expect(claudeTextOf(base)).toEqual({});
    // Kept across reloads.
    expect(restoreMeta(initEdit(base), editMeta(d)).claude).toEqual({ contentGuidelines: ['Name the icon.'] });
  });

  it('says whose proposal the editor continues, in designer words', () => {
    expect(continueLine('peterbono', 'peterbono')).toBe('Continues the open proposal by you, waiting for review.');
    expect(continueLine('peterbono', 'ana')).toBe('Continues the open proposal by @peterbono, waiting for review.');
    expect(continueLine('peterbono', null)).toMatch(/by @peterbono/);
    expect(editBarLabel('clean', true)).toBe('Nothing changed since the open proposal');
    expect(editBarLabel('clean', false)).toBe(EDIT_BAR_LABEL.clean);
    expect(editBarLabel('unsaved', true)).toBe(EDIT_BAR_LABEL.unsaved);
    for (const t of [continueLine('a', 'b'), editBarLabel('clean', true)]) expect(t).not.toMatch(/\b(PR|pull request|branch|commit)\b/i);
  });
});
