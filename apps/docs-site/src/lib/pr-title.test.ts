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
  });
});
