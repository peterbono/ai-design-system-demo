import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from '../Button';
import { Checklist, ChecklistRow } from './Checklist';

describe('Checklist', () => {
  it('is a labelled list; each row says its status in words before the detail', async () => {
    render(
      <Checklist label="What it needs to ship">
        <ChecklistRow status="done" title="Design rules" detail="All 14 rules pass." />
        <ChecklistRow status="failed" title="Developer tests" detail="2 of 212 tests fail." />
        <ChecklistRow status="warning" title="Contrast" detail="One pair is 4.3:1." />
        <ChecklistRow status="waiting" title="Design approval" detail="Waiting on a design owner." statusLabel="Not yet" />
      </Checklist>,
    );
    const list = screen.getByRole('list', { name: 'What it needs to ship' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Design rulesDone: All 14 rules pass.');
    expect(rows[1]).toHaveTextContent('Failed: 2 of 212 tests fail.');
    expect(rows[2]).toHaveTextContent('Needs attention: One pair is 4.3:1.');
    expect(rows[3]).toHaveTextContent('Not yet: Waiting on a design owner.');
    expect(rows[1]).toHaveAttribute('data-status', 'failed');
    await expectNoAxeViolations();
  });

  it('the row action is reachable with Tab after the row and works from the keyboard', async () => {
    const onApprove = vi.fn();
    render(
      <>
        <Checklist label="What it needs to ship">
          <ChecklistRow status="done" title="Developer tests" detail="212 tests pass." />
          <ChecklistRow
            status="waiting"
            title="Design approval"
            detail="Waiting on a design owner."
            action={<Button size="sm" variant="secondary" onClick={onApprove}>Approve</Button>}
          />
        </Checklist>
        <button type="button">After</button>
      </>,
    );
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve.closest('li')).toHaveTextContent('Design approval');
    await userEvent.tab();
    expect(approve).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onApprove).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await expectNoAxeViolations();
  });

  it('renders the footer as the last item of the list', () => {
    render(
      <Checklist label="What it needs to ship" footer={<p>Design approval waits on a design owner.</p>}>
        <ChecklistRow status="waiting" title="Design approval" />
      </Checklist>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent('Design approval waits on a design owner.');
  });
});
