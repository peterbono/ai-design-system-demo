// @vitest-environment jsdom
// Settings > Review rules: the table of what each kind of change needs, and nothing else. The owner override is a
// rule of the merge flow, not a Settings row: designers never act on it.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import ChangeRules from './ChangeRules';

describe('ChangeRules', () => {
  it('lists the rules without an owner override row', async () => {
    const { container } = render(createElement(ChangeRules, { rules: [{ what: 'Tokens', who: 'A design approval' }] }));
    expect(screen.getByRole('table', { name: 'Approvals each kind of change needs' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Tokens' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/override/i);
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });
});
