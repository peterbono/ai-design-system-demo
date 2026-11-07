import { describe, expect, it } from 'vitest';
import { decisionsOf, explorationPrBody, explorationStatus, isNotDoing, leadTurnOf, leadWordsForClaude, withKeeper, isWaitingForLead, needsLeadValidation, parseExplorationBody, withDoneExploring, withLeadAsked, withoutDoneExploring, withoutLeadAsked, withDecision, openDecisionOf } from '../src/explorations';

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
    const back = withDecision(withoutLeadAsked(asked), { kind: 'changes', at: '2026-11-06T11:00:00.000Z', by: 'flo', text: 'Use the warning tone' });
    expect(isWaitingForLead(back)).toBe(false);
    expect(openDecisionOf(back)?.text).toBe('Use the warning tone');
    expect(openDecisionOf(withLeadAsked(back, { at: '2026-11-07T10:00:00.000Z' }))).toBeNull();
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

describe('decisions', () => {
  const start = explorationPrBody({ name: 'Late tag', purpose: 'p', slug: 'late-tag' }, { owner: 'o', repo: 'r', packages: [], apps: {} });
  const asked = withLeadAsked(start, { at: '2026-11-07T10:00:00.000Z', byName: 'Ann', pieces: ['p1'], sha: 'abc' });

  it('reads an older leadNote as one round, and moves it on the next write', () => {
    const old = start.replace(/"slug":"late-tag"/, '"slug":"late-tag","leadNote":"Tighter","leadNoteBy":"flo"');
    const e = parseExplorationBody(old)!;
    expect(decisionsOf(e)).toMatchObject([{ kind: 'changes', text: 'Tighter', by: 'flo', round: 1 }]);
    const next = parseExplorationBody(withLeadAsked(old, { at: '2026-11-07T10:00:00.000Z' }))!;
    expect(next.leadNote).toBeUndefined();
    expect(next.decisions).toHaveLength(1);
  });

  it('counts rounds and keeps every word', () => {
    const one = withDecision(withoutLeadAsked(asked), { kind: 'changes', at: 't1', by: 'flo', text: 'First' });
    const two = withDecision(one, { kind: 'answer', at: 't2', byName: 'Ann', text: 'Done' });
    const three = withDecision(two, { kind: 'changes', at: 't3', by: 'flo', text: 'Second' });
    expect(parseExplorationBody(three)!.decisions!.map((d) => [d.kind, d.round, d.text])).toEqual([
      ['changes', 1, 'First'],
      ['answer', 2, 'Done'],
      ['changes', 2, 'Second'],
    ]);
  });

  it('never keeps an email in a decision', () => {
    const d = parseExplorationBody(withDecision(asked, { kind: 'handed', at: 't', by: 'a@b.co', byName: 'c@d.co', to: ['e@f.co', 'Ann'] }))!.decisions![0]!;
    expect(d.by).toBeUndefined();
    expect(d.byName).toBeUndefined();
    expect(d.to).toEqual(['Ann']);
  });

  it('says whose turn it is', () => {
    expect(leadTurnOf(start)).toBeNull();
    expect(leadTurnOf(asked)).toBe('lead');
    const q = withDecision(asked, { kind: 'question', at: 't', by: 'flo', text: 'Which tab?' });
    expect(leadTurnOf(q)).toBe('designer');
    expect(isWaitingForLead(q)).toBe(true);
    expect(leadTurnOf(withDecision(q, { kind: 'answer', at: 't', text: 'Orders' }))).toBe('lead');
    expect(leadTurnOf(withDecision(withoutLeadAsked(asked), { kind: 'changes', at: 't', text: 'x' }))).toBe('designer');
    const no = withDecision(withoutLeadAsked(asked), { kind: 'not-doing', at: 't', text: 'x' });
    expect(leadTurnOf(no)).toBeNull();
    expect(isNotDoing(no)).toBe(true);
  });

  it('keeps the ticked pieces for when the designer sends it back', () => {
    const back = withDecision(withoutLeadAsked(asked), { kind: 'changes', at: 't', text: 'x' });
    expect(parseExplorationBody(withLeadAsked(back, { at: 't2' }))!.leadPieces).toEqual(['p1']);
  });

  it('gives the words waiting on the designer to their Claude', () => {
    expect(leadWordsForClaude(asked)).toBeNull();
    expect(leadWordsForClaude(withDecision(asked, { kind: 'question', at: 't', by: 'flo', text: 'Which tab?' }))).toBe('flo asks: Which tab?');
    expect(leadWordsForClaude(withDecision(withoutLeadAsked(asked), { kind: 'changes', at: 't', byName: 'Florian', text: 'Tighter' }))).toBe('Florian asked for changes: Tighter');
  });

  it('forgets the lead yes on Back to exploring', () => {
    const done = withDoneExploring(asked, { branch: 'explore/late-tag', doneAt: '2026-11-07T11:00:00.000Z', leadOkBy: 'flo' });
    expect(parseExplorationBody(done)?.leadOkBy).toBe('flo');
    expect(parseExplorationBody(withoutDoneExploring(done, '2026-11-07T12:00:00.000Z'))?.leadOkBy).toBeUndefined();
  });

  it('moves the keeper and the Requested by line', () => {
    const body = `Requested by Ann through Bridge.\n\n${start.replace('"slug":"late-tag"', '"slug":"late-tag","member":"0123456789abcdef","memberName":"Ann"')}`;
    const to = withKeeper(body, { login: 'dino' });
    expect(parseExplorationBody(to)).toMatchObject({ author: 'dino' });
    expect(parseExplorationBody(to)?.member).toBeUndefined();
    expect(to).toContain('Requested by @dino through Bridge.');
    const email = withKeeper(to, { member: 'fedcba9876543210', name: 'Mia' });
    expect(parseExplorationBody(email)).toMatchObject({ member: 'fedcba9876543210', memberName: 'Mia' });
    expect(parseExplorationBody(email)?.author).toBeUndefined();
  });
});
