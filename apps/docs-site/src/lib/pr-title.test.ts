import { describe, expect, it } from 'vitest';
import { explorationTitle, humanTitle } from './pr-title';

describe('humanTitle', () => {
  it('drops the conventional-commit prefix and capitalizes', () => {
    expect(humanTitle('feat(card): lift interactive cards on hover')).toBe('Lift interactive cards on hover');
    expect(humanTitle('fix!: keep focus in the dialog')).toBe('Keep focus in the dialog');
  });

  it('keeps titles without a prefix', () => {
    expect(humanTitle('Badge subtle')).toBe('Badge subtle');
    expect(humanTitle('Release v1.2: notes')).toBe('Release v1.2: notes');
    // A library branch named after its component (a product branch's missing piece) keeps the component.
    expect(humanTitle('Badge: overdue tone')).toBe('Badge: overdue tone');
    expect(humanTitle('DS-87 Exploration: billing screen with overdue invoices')).toBe('Billing screen with overdue invoices');
    expect(humanTitle('Fix: keep focus')).toBe('Keep focus');
  });
});

describe("humanTitle with a Jira key", () => {
  it("drops the leading key too", () => {
    expect(humanTitle("DS-42 tokens: darker primary")).toBe("Darker primary");
  });
});

describe('explorationTitle', () => {
  it('reads the name the designer typed, never the pull request title that turned its colon into a comma', () => {
    const body = '## Exploration\n\n<!-- bridge-exploration {"name":"Dashboard: orders waiting to ship"} -->';
    expect(explorationTitle({ title: 'Exploration: Dashboard, orders waiting to ship', body })).toBe('Dashboard: orders waiting to ship');
  });

  it('falls back to the pull request title for people', () => {
    expect(explorationTitle({ title: 'Exploration: billing screen', body: null })).toBe('Billing screen');
  });
});
