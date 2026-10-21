import { describe, expect, it } from 'vitest';
import { DEMO_REPOS, demoWaitingLine, exploresDemo, isDemoRepo, makeItYoursLead } from './demo';

describe('the demo', () => {
  it('is the self-hosted repository and the hosted demo team, any case', () => {
    expect(DEMO_REPOS).toContain('peterbono/ai-design-system-demo');
    expect(DEMO_REPOS).toContain('peterbono/bridge-demo-ds');
    expect(isDemoRepo('Peterbono/Bridge-Demo-DS')).toBe(true);
    expect(isDemoRepo('acme/ds')).toBe(false);
    expect(isDemoRepo(null)).toBe(false);
  });

  it('lets a visitor explore, and its owner work as usual', () => {
    const repo = 'peterbono/bridge-demo-ds';
    expect(exploresDemo({ repo, signedIn: false, write: null })).toBe(true);
    expect(exploresDemo({ repo, signedIn: true, write: false })).toBe(true);
    // Signed in and not known yet: the Studio acts as usual, so the owner is never stopped.
    expect(exploresDemo({ repo, signedIn: true, write: null })).toBe(false);
    expect(exploresDemo({ repo, signedIn: true, write: true })).toBe(false);
    expect(exploresDemo({ repo: 'acme/ds', signedIn: false, write: null })).toBe(false);
  });

  it('says what the action needs, in designer words', () => {
    expect(makeItYoursLead('create branches')).toBe('In the demo you can look around and try everything. To create branches, connect your own design system: it takes two steps.');
    expect(makeItYoursLead(null)).toMatch(/^Bring your own design system into Bridge in two steps\./);
    for (const s of [makeItYoursLead('x'), makeItYoursLead(null)]) expect(s).not.toMatch(/\u2014|pull request|repository access|token/);
  });

  it('counts what waits for a review', () => {
    expect(demoWaitingLine(0)).toBe('Nothing waits for a review right now.');
    expect(demoWaitingLine(1)).toBe('1 change waits for a review.');
    expect(demoWaitingLine(16)).toBe('16 changes wait for a review.');
    expect(demoWaitingLine(0, 1)).toBe('1 usage draft waits for a review.');
    expect(demoWaitingLine(3, 2)).toBe('3 changes and 2 usage drafts wait for a review.');
  });
});
