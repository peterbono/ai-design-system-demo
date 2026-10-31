import { describe, expect, it } from 'vitest';
import { changelogPath, movedHistory, tokenChangesHref } from './history-moved';

const own = { owner: 'peterbono', repo: 'ai-design-system-demo' };
const team = { owner: 'acme', repo: 'ds' };

describe('changelogPath', () => {
  it("is the site's own changelog without a team or for the repository this site documents", () => {
    expect(changelogPath(null, own)).toBe('/changelog/');
    expect(changelogPath({ owner: 'PeterBono', repo: 'AI-Design-System-Demo' }, own)).toBe('/changelog/');
  });
  it("is the team's Library changelog for any other team", () => {
    expect(changelogPath(team, own)).toBe('/library/acme/ds/changelog/');
  });
});

describe('tokenChangesHref', () => {
  it('lands on the token changes, with the entry or the token', () => {
    expect(tokenChangesHref(null, own)).toBe('/changelog/#token-changes');
    expect(tokenChangesHref(null, own, { entry: 'pr-12' })).toBe('/changelog/?entry=pr-12#token-changes');
    expect(tokenChangesHref(team, own, { token: 'color.text.muted' })).toBe('/library/acme/ds/changelog/?token=color.text.muted#token-changes');
  });
});

describe('movedHistory', () => {
  const at = { changes: '/studio/changes/', building: '/studio/building/', changelog: (q: { entry: string | null; token: string | null }) => tokenChangesHref(null, own, q) };
  it('leaves any other address alone', () => {
    expect(movedHistory('', '', at)).toBeNull();
    expect(movedHistory('?state=shipped', '', at)).toBeNull();
    expect(movedHistory('?pr=3', '#hs-next', at)).toBeNull();
  });
  it('opens Shipped by default, other parameters kept', () => {
    expect(movedHistory('?view=history', '', at)).toBe('/studio/changes/?state=shipped');
    expect(movedHistory('?view=history&people=dana', '', at)).toBe('/studio/changes/?people=dana&state=shipped');
  });
  it('sends the release card to Being built', () => {
    expect(movedHistory('?view=history', '#hs-next', at)).toBe('/studio/building/#next-release');
    expect(movedHistory('?view=history', '#next-release', at)).toBe('/studio/building/#next-release');
  });
  it('sends an entry, a token filter or a timeline anchor to the Library changelog', () => {
    expect(movedHistory('?view=history&entry=pr-1', '', at)).toBe('/changelog/?entry=pr-1#token-changes');
    expect(movedHistory('?view=history&token=color.text.muted', '', at)).toBe('/changelog/?token=color.text.muted#token-changes');
    expect(movedHistory('?view=history', '#hs-timeline', at)).toBe('/changelog/#token-changes');
  });
});
