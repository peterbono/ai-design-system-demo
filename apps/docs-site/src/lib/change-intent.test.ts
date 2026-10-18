import { describe, expect, it } from 'vitest';
import { CHANGE_INTENTS, NO_TOKEN_LINE, REQUEST_KIND_OF, changeFormCopy, changeFormProblems, changeRequest, formModeFor, intentOptions, isChangeIntent, sentLine, startedLines } from './change-intent';
import { REQUEST_KINDS } from '@bridge-ds/core';

const hasEmDash = (s: string) => s.includes(String.fromCharCode(0x2014));
const JARGON = /\b(pull request|PR|branch|commit|merge|changeset|CI|SHA|npm|workflow|Storybook)\b/;

describe('Change this component: intents', () => {
  it('asks three things, in the order a designer thinks of them', () => {
    expect(CHANGE_INTENTS.map((i) => i.label)).toEqual(['Adjust the look', 'Add a variant or option', 'Something looks wrong']);
    expect(CHANGE_INTENTS[0]!.line).toContain('You edit its tokens. The before and after goes to review.');
    expect(CHANGE_INTENTS[1]!.line).toContain('Claude builds it from your Figma frame in an exploration. You check it in the component sandbox, then send it for review.');
  });

  it('speaks without developer words or em dashes', () => {
    for (const i of CHANGE_INTENTS) {
      expect(JARGON.test(`${i.label} ${i.line}`)).toBe(false);
      expect(hasEmDash(i.line)).toBe(false);
    }
  });

  it('turns "Adjust the look" off when the component has no token', () => {
    expect(intentOptions(true).every((o) => !o.disabled)).toBe(true);
    const off = intentOptions(false);
    expect(off.find((o) => o.value === 'look')).toMatchObject({ disabled: true, line: NO_TOKEN_LINE });
    expect(off.filter((o) => o.disabled)).toHaveLength(1);
  });

  it('recognises an intent', () => {
    expect(isChangeIntent('look')).toBe(true);
    expect(isChangeIntent('request')).toBe(false);
    expect(isChangeIntent(null)).toBe(false);
  });
});

describe('Change this component: forms', () => {
  it('leads each intent to its flow', () => {
    expect(formModeFor('look')).toBeNull();
    expect(formModeFor('variant')).toBe('explore');
    expect(formModeFor('wrong')).toBe('mismatch');
  });

  it('sends existing request kinds only', () => {
    const known = new Set(REQUEST_KINDS.map((k) => k.value));
    expect(Object.values(REQUEST_KIND_OF).every((k) => known.has(k))).toBe(true);
    expect(REQUEST_KIND_OF.mismatch).toBe('bug');
    expect(REQUEST_KIND_OF.ask).toBe('new-variant');
  });

  it('words each form with a verb on its button', () => {
    expect(changeFormCopy('explore', 'Button')).toMatchObject({ heading: 'Describe the new option', submit: 'Start exploration', swap: { to: 'ask', label: 'Ask a developer instead' }, changes: false });
    expect(changeFormCopy('ask', 'Button')).toMatchObject({ heading: 'Ask a developer', submit: 'Send to a developer', swap: { to: 'explore', label: 'Let Claude build it instead' } });
    expect(changeFormCopy('mismatch', 'Button')).toMatchObject({ heading: 'Report a mismatch', submit: 'Send report', changes: true, swap: null });
    expect(changeFormCopy('explore', 'Button').summary.placeholder).toContain('Button');
    expect(changeFormCopy('explore', 'Button').connect).toBe('Connect GitHub to start');
    expect(changeFormCopy('explore', 'Button', true).connect).toBe('Sign in to start');
    expect(changeFormCopy('ask', 'Button', true).connect).toBe('Sign in to send');
    expect(changeFormCopy('mismatch', 'Button', true).connect).toBe('Sign in to send');
  });

  it('says what is missing in the words of the form', () => {
    expect(changeFormProblems('explore', { title: '', summary: ' ' })).toEqual(['Say what to add, for example "A danger ghost variant".', 'Say what it is for and where you need it.']);
    expect(changeFormProblems('mismatch', { title: 'Focus ring', summary: '' })).toEqual(['Add the details: where you saw it and what Figma shows.']);
    expect(changeFormProblems('ask', { title: 'A', summary: 'B' })).toEqual([]);
  });

  it('builds the request with the kind of its mode, rows only for a mismatch', () => {
    const f = { title: ' Add a ghost danger variant ', summary: 'For destructive actions in tables.', changes: [{ field: 'radius', before: '12', after: '6' }] };
    const ask = changeRequest('Button', 'ask', f, 'ana');
    expect(ask).toMatchObject({ component: 'Button', kind: 'new-variant', title: 'Add a ghost danger variant', source: 'studio', requestedBy: 'ana', changes: [] });
    const bug = changeRequest('Button', 'mismatch', f);
    expect(bug.kind).toBe('bug');
    expect(bug.changes).toEqual([{ field: 'radius', before: '12', after: '6' }]);
    expect(bug.requestedBy).toBeUndefined();
  });

  it('says what happens next', () => {
    expect(sentLine('mismatch', 12)).toBe('Report #12 sent. It closes when the fix ships.');
    expect(sentLine('ask', 13)).toBe('Request #13 sent. It closes when the change ships.');
    const s = startedLines('Button: add a ghost danger variant', 14);
    expect(s.lead).toBe('Button: add a ghost danger variant is ready to build.');
    expect(s.next).toContain('build Bridge request #14');
    expect(JARGON.test(s.next)).toBe(false);
  });
});
