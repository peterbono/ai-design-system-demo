import { describe, expect, it } from 'vitest';
import { explorationStatus, isWaitingForLead, needsLeadValidation, parseExplorationBody, withDoneExploring, withLeadAsked, withoutDoneExploring, withoutLeadAsked } from '../src/explorations';

const body = `## Exploration: Late tag\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Late tag', purpose: '', slug: 'late-tag', author: 'dino' })} -->`;
const asked = withLeadAsked(body, { at: '2026-11-06T10:00:00.000Z', by: 'dino', pieces: ['tag'] });

describe('the design lead validates before the developers', () => {
  it('asks a lead unless one is saying it, and never waits on nobody', () => {
    expect(needsLeadValidation({ viewer: 'dino', author: 'dino', leads: ['flo'] })).toBe(true);
    expect(needsLeadValidation({ viewer: null, author: 'a@b.c', leads: ['flo'] })).toBe(true);
    expect(needsLeadValidation({ viewer: 'flo', author: 'dino', leads: ['flo'] })).toBe(false);
    expect(needsLeadValidation({ viewer: 'flo', author: 'flo', leads: ['flo'] })).toBe(false);
    expect(needsLeadValidation({ viewer: 'flo', author: 'flo', leads: ['flo', 'sam'] })).toBe(true);
    expect(needsLeadValidation({ viewer: 'dino', author: 'dino', leads: [] })).toBe(false);
    expect(needsLeadValidation({ viewer: 'dino', author: 'dino', leads: ['acme/design'] })).toBe(false);
  });

  it('keeps it running while the lead has not answered', () => {
    expect(isWaitingForLead(asked)).toBe(true);
    expect(explorationStatus({ state: 'open', labels: ['exploration'], body: asked, draft: true })).toBe('active');
    expect(parseExplorationBody(asked)?.leadPieces).toEqual(['tag']);
  });

  it('returns to the designer with the lead\'s words, gone at the next ask', () => {
    const back = withoutLeadAsked(asked, { note: 'Use the warning tone', by: 'flo' });
    expect(isWaitingForLead(back)).toBe(false);
    expect(parseExplorationBody(back)?.leadNote).toBe('Use the warning tone');
    expect(parseExplorationBody(withLeadAsked(back, { at: '2026-11-07T10:00:00.000Z' }))?.leadNote).toBeUndefined();
  });

  it('ends at the hand-off, and Back to exploring does not bring the ask back', () => {
    const done = withDoneExploring(asked, { branch: 'explore/late-tag', doneAt: '2026-11-06T11:00:00.000Z', leadOkBy: 'flo' });
    expect(isWaitingForLead(done)).toBe(false);
    expect(parseExplorationBody(done)?.leadOkBy).toBe('flo');
    expect(isWaitingForLead(withoutDoneExploring(done, '2026-11-06T12:00:00.000Z'))).toBe(false);
  });

  it('never keeps an email as who asked', () => {
    expect(parseExplorationBody(withLeadAsked(body, { at: 'x', byName: 'a@b.c' }))?.leadAskedByName).toBeUndefined();
  });
});
