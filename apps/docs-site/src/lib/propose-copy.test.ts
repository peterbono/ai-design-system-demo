import { describe, expect, it } from 'vitest';
import { prTitleFrom, proposalTitle, reviewSentence, suggestionTitleFrom, tokenNoun } from './propose-copy';

describe('tokenNoun', () => {
  it('names what a color token paints', () => {
    expect(tokenNoun('color.action.primary.bg')).toBe('primary action fill');
    expect(tokenNoun('color.action.primary.bg-hover')).toBe('primary action hover fill');
    expect(tokenNoun('color.bg.subtle')).toBe('subtle background');
    expect(tokenNoun('color.text.link-hover')).toBe('link hover text');
    expect(tokenNoun('color.feedback.danger.icon')).toBe('danger feedback icon');
    expect(tokenNoun('color.control.bg')).toBe('control fill');
    expect(tokenNoun('color.chart.series.1')).toBe('chart series 1 color');
    expect(tokenNoun('palette.primary.700')).toBe('primary 700 palette color');
  });

  it('names other tokens with the role first', () => {
    expect(tokenNoun('radius.control')).toBe('control radius');
    expect(tokenNoun('motion.duration.fast')).toBe('fast motion duration');
    expect(tokenNoun('focus.ring.width')).toBe('focus ring width');
    expect(tokenNoun('space.4')).toBe('space 4');
  });
});

describe('proposalTitle', () => {
  it('says the direction of a color edit', () => {
    expect(proposalTitle([{ kind: 'value', path: 'color.action.primary.bg', type: 'color', before: '#0b4a8b', after: '#043e70' }])).toBe('Darker primary action fill');
    expect(proposalTitle([{ kind: 'value', path: 'color.bg.subtle', type: 'color', before: '#edeff2', after: '#f5f7f9' }])).toBe('Lighter subtle background');
  });

  it('says New when the modes move in opposite directions or the value is not comparable', () => {
    expect(
      proposalTitle([
        { kind: 'value', path: 'color.text.link', type: 'color', before: '#0b4a8b', after: '#043e70' },
        { kind: 'value', path: 'color.text.link', type: 'color', before: '#aad2fe', after: '#cfe8ff' },
      ]),
    ).toBe('New link text');
    expect(proposalTitle([{ kind: 'value', path: 'elevation.raised', type: 'shadow' }])).toBe('New raised elevation');
  });

  it('handles dimensions, durations and the other edit kinds', () => {
    expect(proposalTitle([{ kind: 'value', path: 'radius.control', type: 'dimension', before: 12, after: 8 }])).toBe('Smaller control radius');
    expect(proposalTitle([{ kind: 'value', path: 'motion.duration.fast', type: 'duration', before: 150, after: 200 }])).toBe('Longer fast motion duration');
    expect(proposalTitle([{ kind: 'description', path: 'color.bg.muted' }])).toBe('New description for the muted background');
    expect(proposalTitle([{ kind: 'add', path: 'color.bg.canvas' }])).toBe('New canvas background token');
    expect(proposalTitle([{ kind: 'delete', path: 'color.border.emphasis' }])).toBe('Remove the emphasis border token');
  });

  it('counts the other tokens', () => {
    const e = (path: string) => ({ kind: 'value' as const, path, type: 'color', before: '#ffffff', after: '#000000' });
    expect(proposalTitle([e('color.bg.default'), e('color.bg.subtle'), e('color.bg.muted')])).toBe('Darker default background and 2 more changes');
    expect(proposalTitle([e('color.bg.default'), e('color.bg.subtle')])).toBe('Darker default background and 1 more change');
    expect(proposalTitle([])).toBe('');
  });
});

describe('prTitleFrom', () => {
  it('adds the conventional prefix once', () => {
    expect(prTitleFrom('Darker primary action fill')).toBe('tokens: darker primary action fill');
    expect(prTitleFrom('tokens: soften the page')).toBe('tokens: soften the page');
    expect(prTitleFrom('  ')).toBe('');
  });
});

describe('reviewSentence', () => {
  it('names both approvers for a token change', () => {
    expect(reviewSentence(3)).toBe('A design owner and a tech owner approve it before it reaches the library.');
    expect(reviewSentence(3, { approveDesign: ['design'], approveTech: ['tech'], ship: ['tech'] })).toBe(
      'A design owner and a tech owner approve it before it reaches the library.',
    );
  });

  it('a token value change needs the design owner only (decision TV-1)', () => {
    expect(reviewSentence(3, null, 'direct', true)).toBe('A design owner approves it, then it reaches the library once the automatic checks pass.');
    expect(reviewSentence(3, null, 'suggest', true)).toBe('A design owner approves it, then a developer applies it to the code.');
  });

  it('follows the configured rights', () => {
    expect(reviewSentence(3, { approveDesign: ['design', 'tech'], approveTech: ['tech'], ship: ['tech'] })).toBe(
      'A design owner or a tech owner approves the design and a tech owner the code before it reaches the library.',
    );
    expect(reviewSentence(3, { approveDesign: ['design'], approveTech: ['design'], ship: ['design'] })).toBe(
      'A design owner approves the design and the code before it reaches the library.',
    );
  });

  it('asks one approval for a description change', () => {
    expect(reviewSentence(1)).toBe('One reviewer approves it before it reaches the library.');
  });
});

describe('suggest mode words', () => {
  it('says a developer applies it instead of the merge', () => {
    expect(reviewSentence(3, null, 'suggest')).toBe('A design owner and a tech owner approve it, then a developer applies it to the code.');
    expect(reviewSentence(1, null, 'suggest')).toBe('One reviewer approves it, then a developer applies it to the code.');
    expect(reviewSentence(3, null, 'direct')).toBe(reviewSentence(3));
  });

  it('titles a suggestion in plain words, without the tokens: prefix', () => {
    expect(suggestionTitleFrom('tokens: darker primary action fill')).toBe('Darker primary action fill');
    expect(suggestionTitleFrom('  Darker primary action fill ')).toBe('Darker primary action fill');
    expect(suggestionTitleFrom('')).toBe('');
  });
});
