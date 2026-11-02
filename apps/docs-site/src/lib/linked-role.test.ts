// A Bridge account whose linked GitHub is on the team, in a browser without the GitHub sign-in: its role words, the
// reconnect banner, and the one read per page (scripts/linked-role.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkedAccessState, linkedMember, reconnectScreen, RECONNECT_WORDS } from './linked-role';
import { memberRole, roleBadge } from './access-view';
import { exploresDemo } from './demo';
import { linkedRole, onLinkedRole, readLinkedRole, resetLinkedRole } from '../scripts/linked-role';

describe('linked GitHub role', () => {
  it('reads as the role GitHub gives, never Can view for an admin', () => {
    expect(memberRole(linkedAccessState('admin'), true)).toBe('Admin');
    expect(memberRole(linkedAccessState('edit'), true)).toBe('Can edit');
    expect(memberRole(linkedAccessState('view'), true)).toBe('Can view');
    expect(linkedAccessState(null)).toBeNull();
    expect(roleBadge(linkedAccessState('admin'), true, false)).toEqual({ label: 'Admin', tone: 'success' });
  });

  it('an admin or editor is a member: Bridge own team is not explored as a visitor', () => {
    expect(linkedMember('admin')).toBe(true);
    expect(linkedMember('edit')).toBe(true);
    expect(linkedMember('view')).toBe(false);
    expect(linkedMember(null)).toBe(false);
    // What scripts/demo-gate.ts asks once the session counts the linked member as signed in and able to write.
    expect(exploresDemo({ repo: 'peterbono/ai-design-system-demo', signedIn: false, write: null })).toBe(true);
    expect(exploresDemo({ repo: 'peterbono/ai-design-system-demo', signedIn: true, write: true })).toBe(false);
  });

  it('the reconnect banner names the role and the GitHub account, one action, no em dash', () => {
    const s = reconnectScreen({ owner: 'peterbono', repo: 'ai-design-system-demo', role: 'admin', login: 'peterbono', name: 'Bridge DS' });
    expect(s.layout).toBe('banner');
    expect(s.title).toBe(RECONNECT_WORDS.title);
    expect(s.body).toBe('You are an admin of Bridge DS on GitHub as peterbono. Sign in with GitHub again in this browser to review, approve and ship.');
    expect(s.primary).toEqual({ kind: 'signin', label: 'Reconnect GitHub' });
    expect(`${s.title}${s.body}`).not.toMatch(/—/);
    const e = reconnectScreen({ owner: 'acme', repo: 'ds', role: 'edit', block: true });
    expect(e.layout).toBe('block');
    expect(e.body).toMatch(/^You are on Ds and can edit it on GitHub\. /);
  });
});

describe('the read, once per page', () => {
  afterEach(() => resetLinkedRole());

  it('asks the server only for an account with GitHub linked, once per team', async () => {
    const role = vi.fn(async () => 'admin' as const);
    const seen: unknown[] = [];
    onLinkedRole((r) => seen.push(r));
    const refresh = vi.fn(async () => undefined);
    const deps = { account: async () => ({ github: { login: 'peterbono', id: 1 }, teams: [] }), role, refresh };
    const [a, b] = await Promise.all([readLinkedRole('Peterbono/ai-design-system-demo', deps), readLinkedRole('peterbono/ai-design-system-demo', deps)]);
    expect(a).toBe('admin');
    expect(b).toBe('admin');
    expect(await readLinkedRole('peterbono/ai-design-system-demo', deps)).toBe('admin');
    expect(role).toHaveBeenCalledTimes(1);
    expect(linkedRole('peterbono/ai-design-system-demo')).toBe('admin');
    expect(linkedRole('acme/other')).toBeNull();
    expect(seen).toEqual(['admin']);
    // The account is read again once, so its "Your teams" lists the team now.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an email-only account never asks; an error reads as no role', async () => {
    const role = vi.fn(async () => 'admin' as const);
    expect(await readLinkedRole('acme/ds', { account: async () => ({ github: null }), role })).toBeNull();
    expect(role).not.toHaveBeenCalled();
    resetLinkedRole();
    const refresh = vi.fn(async () => undefined);
    expect(await readLinkedRole('acme/ds', { account: async () => ({ github: { id: 1 } }), role: async () => Promise.reject(new Error('down')), refresh })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
