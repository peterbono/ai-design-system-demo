import { describe, expect, it } from 'vitest';
import { DEMO_REPOS, DEMO_WORDS, demoWaiting, exploresDemo, isDemoRepo, tourSteps } from './demo';

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

  it('says the demo saves nothing, in designer words (board D2)', () => {
    expect(DEMO_WORDS.dialogTitle).toBe('Sign in with GitHub to do this for real.');
    for (const t of Object.values(DEMO_WORDS)) expect(t).not.toMatch(/\u2014|pull request|token/);
  });

  it("frames the waiting line from the lead's seat (board D1b)", () => {
    expect(demoWaiting(8, { names: 'Ann, Leo and Claude AI', rest: ' are waiting on you.' }, 'Dana')).toEqual({
      count: '8 changes need your review.',
      rest: ' Ann, Leo and Claude AI are waiting on Dana, who leads this design system.',
    });
    expect(demoWaiting(1, { names: 'Ann', rest: ' is waiting on you.' }, null).rest).toBe(' Ann is waiting on the lead of this design system.');
    expect(demoWaiting(2, null, 'Dana')).toEqual({ count: '2 changes need your review.', rest: ' Dana leads this design system.' });
  });

  it('tours what the page shows, in order', () => {
    expect(tourSteps({ rows: true, more: true, branches: true })).toEqual(['rows', 'more', 'branches']);
    expect(tourSteps({ rows: true, more: false, branches: true })).toEqual(['rows', 'branches']);
  });

});
