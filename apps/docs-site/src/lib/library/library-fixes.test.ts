import { describe, expect, it } from 'vitest';
import { exampleCode, storyInIndex } from './component-page';
import { libraryNotes } from './home';
import { pairUsage } from '../explorer/flow';
import { sendBlocked } from '../explorer/contrast-summary';

describe('component preview without a published story', () => {
  it('finds the story in the Storybook index', () => {
    const entries = [{ id: 'actions-button--primary' }];
    expect(storyInIndex(entries, 'actions-button--primary')).toBe(true);
    expect(storyInIndex(entries, 'actions-chip--default')).toBe(false);
  });
  it('shows the component as code in its place', () => {
    expect(exampleCode('Button', 'Save')).toBe('<Button>Save</Button>');
    expect(exampleCode('Divider', null)).toBe('<Divider />');
  });
});

describe('Library home release notes', () => {
  const e = (kind: string, packages: string[], title = kind) => ({ kind, packages, title });
  it('keeps notes on the tokens and the components only', () => {
    const notes = [e('New', ['@bridge-ds/docs-site'], 'The demo (D1, D1b, D2)'), e('New', ['@bridge-ds/core'], '`remoteRenames(base, head)`'), e('Internal', []), e('Fix', ['@bridge-ds/react'], 'Button focus'), e('New', ['@bridge-ds/tokens', '@bridge-ds/core'], 'New token')];
    expect(libraryNotes(notes).map((n) => n.title)).toEqual(['Button focus', 'New token']);
  });
});

describe('contrast pair ranking and the send footer', () => {
  const usage = {
    'color.text.default': { used: true, usedBy: [{ name: 'Button', href: '' }, { name: 'Card', href: '' }] },
    'color.bg.default': { used: true, usedBy: [{ name: 'Card', href: '' }], styles: ['base.css'] },
    'color.text.unused': { used: false, usedBy: [] },
  };
  it('counts the components and styles that read a pair', () => {
    expect(pairUsage('color.text.default', 'color.bg.default', usage)).toBe(3);
    expect(pairUsage('color.text.unused', 'color.bg.missing', usage)).toBe(0);
  });
  it('names why the draft cannot be sent', () => {
    expect(sendBlocked([])).toBeNull();
    // One issue per pair and mode: 7 pairs failing in two brands are still 7 pairs.
    const seven = Array.from({ length: 14 }, (_, i) => ({ code: 'contrast', path: `text.${i % 7} on bg` }));
    expect(sendBlocked(seven)).toEqual({ note: '7 contrast pairs fail. Fix them to send for review.', button: 'Fix contrast to send', contrast: true });
    expect(sendBlocked([{ code: 'contrast' }])?.note).toBe('1 contrast pair fails. Fix it to send for review.');
    expect(sendBlocked([{ code: 'type-change' }])).toEqual({ note: '1 check fails. Fix it to send for review.', button: 'Fix the checks to send', contrast: false });
  });
});
