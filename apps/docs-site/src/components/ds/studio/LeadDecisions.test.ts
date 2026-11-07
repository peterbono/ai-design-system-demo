// The talk between a designer and their lead on the exploration page (boards L1 to L5).
// @vitest-environment jsdom
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Decisions, DesignerZone, LeadBar, NotDoingZone, WhyDialog, type LeadBarView } from './LeadDecisions';

const bar = (o: Partial<LeadBarView> = {}): LeadBarView => ({ onLooksRight: vi.fn(async () => 'ok'), onChanges: vi.fn(async () => 'ok'), onComment: vi.fn(async () => 'ok'), onNotDoing: vi.fn(async () => 'ok'), onAskOther: null, link: 'https://x', onCopy: async () => undefined, ...o });
const face = { login: 'flo', name: 'Florian', agent: false, avatar: null };
afterEach(cleanup);

describe('the lead bar', () => {
  it('asks for words before Comment and Needs changes, never before Looks right', async () => {
    const b = bar();
    render(h(LeadBar, { bar: b, say: () => undefined }));
    const comment = screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement;
    const changes = screen.getByRole('button', { name: 'Needs changes' }) as HTMLButtonElement;
    expect(comment.disabled).toBe(true);
    expect(changes.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Looks right' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'Tighter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Needs changes' }));
    await waitFor(() => expect(b.onChanges).toHaveBeenCalledWith('Tighter'));
  });
  it('sends the words of a Looks right', async () => {
    const b = bar();
    render(h(LeadBar, { bar: b, say: () => undefined }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'Mind the tag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }));
    await waitFor(() => expect(b.onLooksRight).toHaveBeenCalledWith('Mind the tag'));
  });
  it('says when it changed since the lead was asked', () => {
    render(h(LeadBar, { bar: bar({ changedSince: true }), say: () => undefined }));
    expect(screen.getByText(/Changed since you were asked/)).toBeTruthy();
  });
});

describe('the designer zone', () => {
  const z = { title: 'Florian has a question', who: face, when: 'today', text: 'Which tab?', sendLabel: 'Answer Florian', required: true, fieldLabel: 'Your answer', placeholder: '' };
  it('needs the words of an answer to a question', async () => {
    const onSend = vi.fn(async () => 'Sent');
    const say = vi.fn();
    render(h(DesignerZone, { z: { ...z, onSend }, say }));
    expect((screen.getByRole('button', { name: 'Answer Florian' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Orders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer Florian' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Sent'));
  });
  it('only says where it stands for anyone else', () => {
    render(h(DesignerZone, { z: { ...z, onSend: null }, say: () => undefined }));
    expect(screen.getByText('Which tab?')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the end and the record', () => {
  it('says why it ended, with a way forward for its designer only', () => {
    const v = { title: 'Florian decided not to do this', who: face, when: 'today', text: 'Billing covers it' };
    const { rerender } = render(h(NotDoingZone, { v: { ...v, onReopen: async () => undefined }, say: () => undefined }));
    expect(screen.getByRole('button', { name: 'Reopen as a new exploration' })).toBeTruthy();
    rerender(h(NotDoingZone, { v, say: () => undefined }));
    expect(screen.queryByRole('button', { name: 'Reopen as a new exploration' })).toBeNull();
  });
  it('lists the decisions with their round and reason, and nothing when there is none', () => {
    const { container, rerender } = render(h(Decisions, { rows: [], when: (x) => x }));
    expect(container.textContent).toBe('');
    rerender(h(Decisions, { rows: [{ key: '0', name: 'Florian', login: 'flo', verb: 'asked for changes', why: 'Tighter', round: 2, at: 'today' }], when: (x) => x }));
    expect(screen.getByText('Round 2')).toBeTruthy();
    expect(screen.getByText('Tighter')).toBeTruthy();
  });
  it('a reason is needed', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(h(WhyDialog, { open: true, onOpenChange: () => undefined, title: 'Take it back?', description: 'd', confirm: 'Take it back', onConfirm }));
    fireEvent.click(screen.getByRole('button', { name: 'Take it back' }));
    expect(await screen.findByText('Say why: they read it.')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
