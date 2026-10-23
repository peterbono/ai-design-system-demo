import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_REPOS, demoDialog, DEMO_WORDS, demoLeadName, demoSettingsPeople, demoTour, demoWaiting, exploresDemo, humanizeRepo, onBridge, isDemoRepo, OWN_TEAM, teamDisplayName, tourSteps } from './demo';

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

  it("never calls Bridge's own design system the demo", () => {
    expect(demoDialog('peterbono/bridge-demo-ds').lead).toBe('In the demo, nothing is saved.');
    const own = demoDialog('peterbono/ai-design-system-demo');
    expect(`${own.title} ${own.lead}`).not.toMatch(/demo|for real/i);
  });

  it("frames the waiting line from the lead's seat (board D1b)", () => {
    expect(demoWaiting(8, { names: 'Ann, Leo and Claude AI', rest: ' are waiting on you.' }, 'Dana')).toEqual({
      count: '8 changes need your review.',
      rest: ' Ann, Leo and Claude AI are waiting on you.',
    });
    // A visitor without a persona (Bridge's own design system) is never asked to review.
    expect(demoWaiting(1, { names: 'Ann', rest: ' is waiting on you.' }, null)).toEqual({ count: '1 change waits for review.', rest: ' Ann is waiting on a reviewer.' });
    expect(demoWaiting(3, null, null)).toEqual({ count: '3 changes wait for review.', rest: '' });
    expect(demoWaiting(2, null, 'Dana')).toEqual({ count: '2 changes need your review.', rest: ' Dana leads this design system.' });
  });

  it('tours what the page shows, in order', () => {
    expect(tourSteps({ rows: true, more: true, branches: true })).toEqual(['rows', 'more', 'branches']);
    expect(tourSteps({ rows: true, more: false, branches: true })).toEqual(['rows', 'branches']);
  });

});

describe('the tour', () => {
  it("names the persona's role on its first step", () => {
    expect(demoTour('rows', 'DS lead').title).toBe('Changes wait for the DS lead');
    expect(demoTour('rows', null).title).toBe('Changes wait for the lead');
  });
});

describe('the demo Settings', () => {
  it('names the persona, never the repository accounts', () => {
    const p = demoSettingsPeople({ demo: { viewer: 'Dana' }, soloOwnerCanApproveBoth: true });
    expect(p.lead).toBe('Dana');
    expect(p.nameOf('peterbono')).toBe('Dana');
    expect(p.solo).toBe('As the only owner, Dana approves design and code in one review.');
    expect(demoSettingsPeople({ demo: { viewer: 'Dana' }, soloOwnerCanApproveBoth: false }).solo).toBeNull();
  });

  it('says the role when the demo has no persona', () => {
    expect(demoLeadName(undefined)).toBe('Your design system lead');
    expect(demoLeadName({ viewer: ' ' })).toBe('Your design system lead');
  });
});

describe('teamDisplayName', () => {
  it('a demo goes by its own name, any other team by its repository name in words, never owner/repo', () => {
    expect(teamDisplayName('peterbono/ai-design-system-demo')).toBe('Bridge DS');
    expect(teamDisplayName('PeterBono/Bridge-Demo-DS')).toBe('Acme Design');
    expect(teamDisplayName('acme/design-system')).toBe('Design system');
  });

  it("a team's own name from bridge.config.json wins, except on the sample team", () => {
    expect(teamDisplayName('acme/design-system', { name: '  Acme   Studio ' })).toBe('Acme Studio');
    expect(teamDisplayName('peterbono/ai-design-system-demo', { name: 'Bridge DS' })).toBe('Bridge DS');
    expect(teamDisplayName('peterbono/bridge-demo-ds', { name: 'Other' })).toBe('Acme Design');
    expect(teamDisplayName('acme/ds', { name: ' ' })).toBe('Ds');
    expect(teamDisplayName('acme/ds', null)).toBe('Ds');
  });

  it('says " on Bridge" after a team, except when the team is Bridge itself', () => {
    expect(`Join Acme${onBridge('Acme')}`).toBe('Join Acme on Bridge');
    expect(`Join Bridge${onBridge('Bridge')}`).toBe('Join Bridge');
    expect(onBridge(' bridge ')).toBe('');
    expect(onBridge('Bridge Labs')).toBe(' on Bridge');
  });

  it("names Bridge's own design system as the root bridge.config.json does", () => {
    const root = JSON.parse(readFileSync(new URL('../../../../bridge.config.json', import.meta.url), 'utf8')) as { name?: string };
    expect(root.name).toBe(OWN_TEAM);
    expect(teamDisplayName('peterbono/ai-design-system-demo', root)).toBe('Bridge DS');
  });

  it('puts a repository name in words', () => {
    expect(humanizeRepo('peterbono/ai-design-system-demo')).toBe('Ai design system demo');
    expect(humanizeRepo('acme_ui.kit')).toBe('Acme ui kit');
    expect(humanizeRepo('acme/ds')).toBe('Ds');
  });
});
