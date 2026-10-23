// The people of this page's team and what an admin does to them, shared by Settings > Members and the Invite
// collaborators dialog so both show the same list and say the same things. On the sample team every change opens the
// demo dialog ("This is a sample team.", board D2) and nothing is sent; on a real team each change
// goes to the invites server (scripts/invites-api.ts), which checks on GitHub that the caller is an admin.
import { useCallback, useEffect, useState } from 'react';
import type { MembersData } from '../../../scripts/members';
import { MEMBERS_WORDS, normalizeChoice, roleLabel, sentSummary, type Member, type PendingInvite, type RoleChoice, type KnownPerson } from '../../../lib/invites';
import { inviteePeople } from '../../../lib/invites';

export type MembersLoad = { status: 'loading' } | { status: 'ready'; data: MembersData } | { status: 'error'; message: string };

/** One calm line after an action: what happened, or how to fix what did not. */
export interface Notice {
  tone: 'success' | 'info' | 'danger';
  text: string;
  /** A settings change to approve (a Reviewer): its pull request. */
  link?: { label: string; href: string };
}

/** Loads the members once `enabled` (the dialog loads on open, Settings at once). */
export function useMembers(enabled = true): { load: MembersLoad; reload: () => void; update: (fn: (d: MembersData) => MembersData) => void } {
  const [load, setLoad] = useState<MembersLoad>({ status: 'loading' });
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void import('../../../scripts/members')
      .then(({ loadMembers }) => loadMembers())
      .then(
        (data) => live && setLoad({ status: 'ready', data }),
        () => live && setLoad({ status: 'error', message: 'Bridge could not read who is in this team. Try again in a minute.' }),
      );
    return () => {
      live = false;
    };
  }, [enabled, run]);
  // Painted before the team's settings were read (scripts/members.ts ownersOfTeam): read again, quietly, once they
  // land, so review roles fill in. The list stays on screen meanwhile.
  const waiting = load.status === 'ready' && load.data.ownersKnown === false;
  useEffect(() => {
    if (!enabled || !waiting || typeof document === 'undefined') return;
    const again = () => setRun((n) => n + 1);
    document.addEventListener('bridge:team-model', again, { once: true });
    return () => document.removeEventListener('bridge:team-model', again);
  }, [enabled, waiting]);
  const reload = useCallback(() => setRun((n) => n + 1), []);
  const update = useCallback((fn: (d: MembersData) => MembersData) => setLoad((l) => (l.status === 'ready' ? { status: 'ready', data: fn(l.data) } : l)), []);
  return { load, reload, update };
}

/** The demo dialog: the sample team never sends anything. */
async function demoGate() {
  const { openMakeItYours } = await import('../../../scripts/demo-gate');
  await openMakeItYours();
}

async function api() {
  return import('../../../scripts/invites-api');
}

function failure(err: unknown, unavailable: string): Notice {
  if (err instanceof Error && err.name === 'InvitesUnavailable') return { tone: 'info', text: unavailable };
  // A daily cap or a resend too soon is not a mistake: said calmly, with when to try again.
  if (err instanceof Error && (err as Error & { status?: number }).status === 429) return { tone: 'info', text: err.message || MEMBERS_WORDS.limitReached };
  return { tone: 'danger', text: err instanceof Error && err.message ? err.message : 'Something went wrong. Try again in a minute.' };
}

const prNotice = (text: string, pr?: { url: string }): Notice => (pr ? { tone: 'success', text: `${text} ${MEMBERS_WORDS.reviewerNote}`, link: { label: 'Open the settings change', href: pr.url } } : { tone: 'success', text });

/** The actions on members and invites. Each returns the notice to show, or null when the demo dialog opened. */
export function memberActions(data: MembersData, update: (fn: (d: MembersData) => MembersData) => void) {
  const sample = data.context === 'sample';
  const unavailable = MEMBERS_WORDS.unavailable;

  async function changeRole(m: Member, next: RoleChoice): Promise<Notice | null> {
    if (sample) return void (await demoGate()), null;
    const c = normalizeChoice(next);
    try {
      const a = await api();
      const r = m.via === 'email' ? await a.setEmailMemberRole(data.repo, m.email ?? m.login, c) : await a.setMemberRole(data.repo, m.login, c);
      update((d) => ({
        ...d,
        members: d.members.map((x) => (x.login === m.login ? { ...x, role: c.role, reviews: c.role === 'reviewer' ? [c.reviewAs!] : c.role === 'admin' ? x.reviews : [] } : x)),
      }));
      if (r.ownersError) return { tone: 'info', text: `${m.name} is now ${roleLabel(c)}. ${r.ownersError}` };
      return prNotice(`${m.name} is now ${roleLabel(c)}.`, r.ownersPr);
    } catch (err) {
      return failure(err, unavailable);
    }
  }

  async function remove(m: Member): Promise<Notice | null> {
    if (sample) return void (await demoGate()), null;
    try {
      const a = await api();
      await (m.via === 'email' ? a.removeEmailMember(data.repo, m.email ?? m.login) : a.removeMember(data.repo, m.login));
      update((d) => ({ ...d, members: d.members.filter((x) => x.login !== m.login) }));
      return { tone: 'success', text: `${m.name} was removed from ${data.team}.` };
    } catch (err) {
      return failure(err, unavailable);
    }
  }

  async function resend(p: PendingInvite): Promise<Notice | null> {
    if (sample) return void (await demoGate()), null;
    try {
      const r = await (await api()).resendInvite(data.repo, p.id);
      const next = r.invite;
      if (next) update((d) => ({ ...d, pending: d.pending.map((x) => (x.id === p.id ? next : x)) }));
      return { tone: 'success', text: `Invite sent again to ${p.email}.` };
    } catch (err) {
      return failure(err, unavailable);
    }
  }

  async function changeInviteRole(p: PendingInvite, next: RoleChoice): Promise<Notice | null> {
    if (sample) return void (await demoGate()), null;
    const c = normalizeChoice(next);
    try {
      const r = await (await api()).setInviteRole(data.repo, p.id, c);
      const inv = r.invite ?? { ...p, role: c.role, ...(c.reviewAs ? { reviewAs: c.reviewAs } : {}) };
      update((d) => ({ ...d, pending: d.pending.map((x) => (x.id === p.id ? { ...inv, ...(p.face ? { face: p.face } : {}) } : x)) }));
      return { tone: 'success', text: `${p.email} will join as ${roleLabel(c)}.` };
    } catch (err) {
      return failure(err, unavailable);
    }
  }

  async function cancel(p: PendingInvite): Promise<Notice | null> {
    if (sample) return void (await demoGate()), null;
    try {
      await (await api()).cancelInvite(data.repo, p.id);
      update((d) => ({ ...d, pending: d.pending.filter((x) => x.id !== p.id) }));
      return { tone: 'success', text: `The invite to ${p.email} was cancelled.` };
    } catch (err) {
      return failure(err, unavailable);
    }
  }

  /** Sends invites; the emails that did not go out stay in the field (returned in `left`). */
  async function send(emails: string[], choice: RoleChoice, people: readonly KnownPerson[]): Promise<{ notice: Notice | null; left: string[] }> {
    if (sample) return void (await demoGate()), { notice: null, left: emails };
    try {
      const results = await (await api()).sendInvites(data.repo, normalizeChoice(choice), inviteePeople(emails, people));
      const failed = results.filter((r) => r.status === 'failed');
      const ok = results.length > 0 && failed.length === 0;
      // The new pending invites come from the server: read them again.
      try {
        const r = await (await api()).listInvites(data.repo);
        update((d) => ({ ...d, pending: r.invites }));
      } catch {
        /* the list refreshes next time */
      }
      const text = [sentSummary(results), ...results.map((f) => f.message).filter(Boolean)].join(' ');
      return { notice: { tone: ok ? 'success' : 'danger', text: text || 'Nothing was sent. Try again in a minute.' }, left: failed.map((f) => f.email) };
    } catch (err) {
      return { notice: failure(err, unavailable), left: emails };
    }
  }

  return { changeRole, remove, resend, changeInviteRole, cancel, send };
}
