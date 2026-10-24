import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleTeam } from './invites';
import { roleRows } from './roles-view';
import { DEMO_APPROVED_KEY, demoApprovedSet, markDemoApproved, DEMO_REPOS, demoApproved, demoBanner, demoDialog, DEMO_STASH_KEY, DEMO_VISIT_KEY, DEMO_WORDS, SHARED_DRAFT_KEY, swapDemoDrafts, demoLeadName, demoSettingsPeople, demoTour, demoWaiting, exploresDemo, humanizeRepo, onBridge, isDemoRepo, OWN_TEAM, teamDisplayName, tourSteps } from './demo';

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

  it('says the sample team sends nothing, in designer words, with one call to action (board D2)', () => {
    expect(DEMO_WORDS.getStarted).toBe('Get started');
    expect(demoBanner('peterbono/bridge-demo-ds')).toEqual({ title: 'Acme Design.', text: 'This is a sample team: your edits stay in this browser and nothing is sent.' });
    expect(demoDialog('peterbono/bridge-demo-ds')).toEqual({ title: 'This is a sample team.', lead: 'Nothing is sent from Acme Design. Get started to do this with your own team.' });
    // The sample team never sends a visitor to GitHub.
    for (const t of [...Object.values(demoBanner('peterbono/bridge-demo-ds')), ...Object.values(demoDialog('peterbono/bridge-demo-ds')), DEMO_WORDS.sampleNote, DEMO_WORDS.tryIt]) expect(t).not.toMatch(/GitHub|repo/);
    for (const t of Object.values(DEMO_WORDS)) expect(t).not.toMatch(/\u2014|pull request|token/);
  });

  it('lets a visitor try Approve: the result, what happens next, nothing sent', () => {
    expect(demoApproved('Ann Lee')).toEqual({
      title: 'Approved',
      next: 'On your team, Ann hears it at once, and a developer ships the change once the checks pass.',
      note: 'Sample data, nothing is sent.',
    });
    expect(demoApproved(null).next).toMatch(/^On your team, The teammate who asked hears it/);
    for (const t of Object.values(demoApproved('Ann'))) expect(t).not.toMatch(/\u2014|merge|pull request/);
  });

  it("never calls Bridge's own design system the demo", () => {
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
    // Claude AI's documentation drafts are in the queue too: the line counts them, so it agrees with Review all.
    expect(demoWaiting(15, null, 'Dana', 1).count).toBe('15 changes and 1 documentation draft need your review.');
    expect(demoWaiting(1, null, null, 1).count).toBe('1 change and 1 documentation draft wait for review.');
    expect(demoWaiting(0, null, null, 1).count).toBe('1 documentation draft waits for review.');
    expect(demoWaiting(0, null, 'Dana', 2).count).toBe('2 documentation drafts need your review.');
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
  it('names the sample members who review, as Members shows them, never the repository accounts', () => {
    const p = demoSettingsPeople({ demo: { viewer: 'Dana' } }, sampleTeam);
    expect(p.lead).toBe('Dana');
    // The same people and logins as Members (lib/invites.ts sampleTeam), so the faces match.
    const team = sampleTeam('Dana').members;
    expect(p.owners.design).toEqual(team.filter((m) => m.reviews.includes('design')).map((m) => m.login));
    expect(p.owners.design).toEqual(['~dana', '~ann-leroy']);
    expect(p.owners.tech).toEqual(['~malik-haddad']);
    expect(p.owners.design.map(p.nameOf)).toEqual(['Dana', 'Ann']);
    expect(p.owners.tech.map(p.nameOf)).toEqual(['Malik']);
    // Any other login (the repository's real accounts) reads as the lead.
    expect(p.nameOf('peterbono')).toBe('Dana');
  });

  it('follows the repository rights: each right names the people of its group', () => {
    const p = demoSettingsPeople({ demo: { viewer: 'Dana' } }, sampleTeam);
    const rows = roleRows(p.owners, { approveDesign: ['design'], approveTech: ['tech'], ship: ['tech'] });
    expect(rows.map((r) => r.logins.map(p.nameOf))).toEqual([['Dana', 'Ann'], ['Malik'], ['Malik']]);
  });

  it('names a persona-less lead by role, in the lead seat', () => {
    const p = demoSettingsPeople({}, sampleTeam);
    expect(p.nameOf('~dana')).toBe('Your design system lead');
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

/** A Storage stand-in. */
function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    dump: () => Object.fromEntries(m),
  };
}

describe('drafts on the sample team', () => {
  it('keeps the visit drafts apart from a real draft, and drops them on leaving', () => {
    const s = store({ [SHARED_DRAFT_KEY]: '{"edits":["real"]}', 'bridge.brand-draft:acme/ds': 'real brand' });
    expect(swapDemoDrafts(s, true)).toBe('entered');
    // On the sample team: the real draft waits apart, the visitor starts empty.
    expect(s.getItem(SHARED_DRAFT_KEY)).toBeNull();
    expect(s.getItem(DEMO_STASH_KEY)).toBe('{"edits":["real"]}');
    // Edits during the visit stay in this browser, page after page.
    s.setItem(SHARED_DRAFT_KEY, '{"edits":["sample"]}');
    s.setItem('bridge.brand-draft:peterbono/bridge-demo-ds', 'sample brand');
    s.setItem('bridge.draft.change.peterbono/bridge-demo-ds#12.v1', 'sample change');
    expect(swapDemoDrafts(s, true)).toBe('none');
    expect(s.getItem(SHARED_DRAFT_KEY)).toBe('{"edits":["sample"]}');
    // Leaving for a real team: the sample drafts go, the real draft comes back, untouched.
    expect(swapDemoDrafts(s, false)).toBe('left');
    expect(s.dump()).toEqual({ [SHARED_DRAFT_KEY]: '{"edits":["real"]}', 'bridge.brand-draft:acme/ds': 'real brand' });
    expect(swapDemoDrafts(s, false)).toBe('none');
  });

  it('leaves no draft behind when there was no real one', () => {
    const s = store();
    swapDemoDrafts(s, true);
    s.setItem(SHARED_DRAFT_KEY, '{"edits":["sample"]}');
    swapDemoDrafts(s, false);
    expect(s.dump()).toEqual({});
    expect(s.getItem(DEMO_VISIT_KEY)).toBeNull();
  });

  it('remembers Approve tried on sample branches for the visit, and drops it on leaving', () => {
    const s = store();
    swapDemoDrafts(s, true);
    markDemoApproved(s, 12);
    markDemoApproved(s, 7);
    markDemoApproved(s, 12);
    // Page after page of the visit.
    expect(swapDemoDrafts(s, true)).toBe('none');
    expect([...demoApprovedSet(s)].sort()).toEqual([12, 7].sort());
    markDemoApproved(s, 7, false);
    expect([...demoApprovedSet(s)]).toEqual([12]);
    // Leaving the sample team: gone, nothing reaches a real team.
    swapDemoDrafts(s, false);
    expect(s.getItem(DEMO_APPROVED_KEY)).toBeNull();
    expect(demoApprovedSet(s).size).toBe(0);
    // A malformed value reads as nothing approved.
    expect(demoApprovedSet(store({ [DEMO_APPROVED_KEY]: '{bad' })).size).toBe(0);
  });
});
