import { describe, expect, it } from 'vitest';
import { cardProblems, EXPECTED, ownErrors } from './demo-smoke.mjs';

describe('demo smoke test', () => {
  const card = (n, text) => ({ href: `/studio/acme-design-demo/bridge-demo-ds/changes/?exploration=${n}&product=account`, text });
  const all = [card(1, 'Team seats and roles Exploring'), card(2, 'Profile page Waiting for lead'), card(3, 'Notification channels Exploring'), card(4, 'Invoice status as badges In review'), card(5, 'Yearly prices on plans Shipped')];

  it('passes when every exploration is listed in its state', () => {
    expect(cardProblems(all)).toEqual([]);
    expect(EXPECTED).toHaveLength(5);
  });

  it('names a missing exploration and a card in the wrong state', () => {
    const problems = cardProblems([all[0], all[1], all[2], card(4, 'Invoice status as badges Exploring')]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/#4 .* does not say/);
    expect(problems[1]).toMatch(/#5 \(Yearly prices on plans\) is missing/);
  });

  it("keeps the page's own console errors, never a visitor's expected refusals", () => {
    expect(ownErrors(['Failed to load resource: the server responded with a status of 401 ()', 'Failed to load resource: the server responded with a status of 404 ()', 'TypeError: x is undefined'])).toEqual(['TypeError: x is undefined']);
  });
});
