// @vitest-environment jsdom
// Check the build (board R4): who checks, Looks right in one click, Needs changes asks what needs to change first.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildCheck } from './BuildCheck';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { buildRows } from '../../../lib/build-check-view';

afterEach(cleanup);

const rows = buildRows([{ role: 'designer', required: true, state: 'looks-right', byName: 'Mia' }, { role: 'pm', required: true, state: 'waiting' }], { designer: 'Mia', pm: 'Dino', lead: null });

describe('check the build', () => {
  it('lists who checks, and Needs changes sends the kind and the note', async () => {
    const onSay = vi.fn(async () => 'Sent.');
    const say = vi.fn();
    render(createElement(BuildCheck, { v: { line: 'Lee finished the build. Compare it with what was approved.', builder: 'Lee', designer: 'Mia', rows, onSay }, say }));
    expect(screen.getByText('Dino')).toBeTruthy();
    expect(screen.getByText('Not needed: no library piece changed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Needs changes' }));
    fireEvent.click(screen.getByRole('radio', { name: /The design must change/ }));
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'Keep the date' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(onSay).toHaveBeenCalledWith({ kind: 'changes', why: 'design', text: 'Keep the date' });
    expect(say).toHaveBeenCalledWith('Sent.');
    await expectNoAxeViolations(document.body);
  });

  it('Looks right in one click; someone who does not check only reads', async () => {
    const onSay = vi.fn(async () => undefined);
    render(createElement(BuildCheck, { v: { line: 'x', builder: 'Lee', designer: 'Mia', rows, onSay }, say: () => {} }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Looks right' }));
    });
    expect(onSay).toHaveBeenCalledWith({ kind: 'looks-right' });
    cleanup();
    render(createElement(BuildCheck, { v: { line: 'x', builder: 'Lee', designer: 'Mia', rows, onSay: null }, say: () => {} }));
    expect(screen.queryByRole('button', { name: 'Looks right' })).toBeNull();
  });
});
