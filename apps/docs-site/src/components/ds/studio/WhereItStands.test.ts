// @vitest-environment jsdom
// "Where it stands" on the exploration page: the next step and the counts first, details on demand, edited in place
// by whoever can edit, read only for the others, a quiet line while nothing is noted. No technical words.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import type { ExplorationNotes } from '@bridge-ds/core';
import { WhereItStands, type WhereItStandsView } from './WhereItStands';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { NOTES_WORDS } from '../../../lib/exploration-notes-view';

const NOTES: ExplorationNotes = {
  context: 'Checkout feels harsh.',
  decisions: ['Pill radius on primary only', 'Secondary keeps its radius'],
  edgeCases: [
    { component: 'Button', state: 'Loading', covered: true, note: 'spinner, width kept' },
    { component: 'Button', state: 'Long label', covered: false },
    { component: 'Toast', state: 'Two lines', covered: true },
  ],
  openQuestions: ['Dark mode?'],
  nextStep: 'Try it in the cart.',
};
const EMPTY: ExplorationNotes = { context: '', decisions: [], edgeCases: [], openQuestions: [], nextStep: '' };

const paint = (view: WhereItStandsView, say = vi.fn()) => ({ say, ...render(createElement(WhereItStands, { view, say })) });

afterEach(cleanup);

describe('Where it stands', () => {
  it('shows the next step and the counts, the details on Show details', async () => {
    const { container } = paint({ notes: NOTES });
    expect(screen.getByRole('heading', { name: 'Where it stands' })).toBeTruthy();
    expect(screen.getByText('Try it in the cart.')).toBeTruthy();
    expect(screen.getByText('2 decisions · 2 of 3 edge cases covered · 1 open question')).toBeTruthy();
    expect(screen.queryByText('Pill radius on primary only')).toBeNull();
    const show = screen.getByRole('button', { name: 'Show details' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await act(async () => fireEvent.click(show));
    expect(screen.getByRole('button', { name: 'Hide details' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Pill radius on primary only')).toBeTruthy();
    expect(screen.getByText('Checkout feels harsh.')).toBeTruthy();
    const button = screen.getByRole('list', { name: 'Button' });
    expect(within(button).getAllByRole('listitem')).toHaveLength(2);
    expect(within(button).getByText(/spinner, width kept/)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Toast' })).toBeTruthy();
    expect(screen.getByText('Dark mode?')).toBeTruthy();
    // A reader: no Edit.
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    // Designers never read a technical word here.
    expect(container.textContent).not.toMatch(/markdown|branch|commit|file|—/i);
    await expectNoAxeViolations(container);
  });

  it('a quiet line while nothing is noted; Write it yourself only for someone who can edit', () => {
    paint({ notes: EMPTY });
    expect(screen.getByText(/When someone works on it in Claude/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: NOTES_WORDS.write })).toBeNull();
    cleanup();
    paint({ notes: EMPTY, onSave: async () => undefined });
    expect(screen.getByRole('button', { name: NOTES_WORDS.write })).toBeTruthy();
  });

  it('edits in place: only the changed sections are saved, then says so', async () => {
    const onSave = vi.fn(async (_u: unknown) => undefined);
    const { say, container } = paint({ notes: NOTES, onSave });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Edit' })));
    await expectNoAxeViolations(container);
    const next = screen.getByRole('textbox', { name: 'Next step' });
    await userEvent.clear(next);
    await userEvent.type(next, 'Check the empty cart.');
    // Mark the long label covered, and add an edge case.
    const covered = screen.getAllByRole('checkbox', { name: 'Covered' });
    await act(async () => fireEvent.click(covered[1]!));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add an edge case' })));
    const states = screen.getAllByRole('textbox', { name: 'State' });
    await userEvent.type(states[states.length - 1]!, 'Empty');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(onSave).toHaveBeenCalledTimes(1);
    const update = onSave.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual(['edgeCases', 'nextStep']);
    expect(update.nextStep).toBe('Check the empty cart.');
    expect(update.edgeCases).toEqual([
      { component: 'Button', state: 'Loading', covered: true, note: 'spinner, width kept' },
      { component: 'Button', state: 'Long label', covered: true },
      { component: 'Toast', state: 'Two lines', covered: true },
      { component: 'Toast', state: 'Empty', covered: false },
    ]);
    expect(say).toHaveBeenCalledWith(NOTES_WORDS.saved);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('a refused save stays in the form with the reason', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('You can only change your own explorations.');
    });
    paint({ notes: NOTES, onSave });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Edit' })));
    await userEvent.type(screen.getByRole('textbox', { name: 'Next step' }), ' Soon.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(screen.getByRole('alert').textContent).toBe('You can only change your own explorations.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
