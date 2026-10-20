import { describe, expect, it } from 'vitest';
import { humanTitle } from './pr-title';

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
