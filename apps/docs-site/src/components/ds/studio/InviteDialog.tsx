// Invite collaborators (board I1), a DS Dialog opened from the team chip menu and from Settings > Members. One
// sentence says what happens (MEMBERS_WORDS.intro: an email, then the team; only Reviewers also sign in with GitHub).
// Then the work email field, a DS Combobox that takes several emails as chips and suggests people Bridge
// already knows (on a real team, the people who committed to it; on the sample team, Acme's people), with the role
// picker on the same line (RolePicker, board I2). "Who has access" lists the team and the pending invites, with Resend
// on their line and a "More" menu with Cancel invite, as in the Settings table (MembersSection PendingRow). The
// footer ends with Cancel and the one primary action, "Send N invites". No team link, no GitHub words. Admins see no "only admins" note: it is for the people it stops, and they
// read it in the body (MEMBERS_WORDS.readOnly).
// Someone who is not an admin sees who has access and why they cannot invite. The browser workspace has no team: it
// says to connect the design system first. When this site cannot send invites, the dialog says so and sends nothing.
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Link2Off, MoreHorizontal } from 'lucide-react';
import { Alert, Button, ButtonGroup, Combobox, Dialog, DialogClose, DialogContent, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from '@bridge-ds/react';
import RolePicker from './RolePicker';
import { NoticeLine, PersonCell } from './MemberParts';
import { memberActions, noRepo, useMembers, type Notice } from './members-state';
import {
  adminCount,
  choiceOf,
  DEFAULT_CHOICE,
  inviteChoice,
  inviteOptions,
  MAX_INVITES,
  memberActions as allowed,
  MEMBERS_WORDS,
  memberLine, memberSeed,
  parseEmails,
  pendingLine,
  roleLabel,
  roleText,
  SAMPLE_NOW,
  closeLabel,
  sendLabel,
  sortMembers,
  type RoleChoice,
} from '../../../lib/invites';
import type { MembersData } from '../../../scripts/members';
import '../../../styles/invites.css';

export interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The members already read by the page (Settings): the dialog and the page then show one list. */
  shared?: { data: MembersData; update: (fn: (d: MembersData) => MembersData) => void };
  /** Once invites went out (onboarding's "Invite your team" is then done). */
  onSent?: () => void;
}

function AccessList({ data, update, notice, onNotice }: { data: MembersData; update: (fn: (d: MembersData) => MembersData) => void; notice: Notice | null; onNotice: (n: Notice | null) => void }) {
  const act = memberActions(data, update);
  const admins = adminCount(data.members);
  const now = data.context === 'sample' ? SAMPLE_NOW : Date.now();
  const members = sortMembers(data.members);
  // Pending invites carry a "More" menu at the row's end: member rows keep the same space, so every role lines up.
  const moreSpace = data.canManage && data.pending.length > 0;
  const run = async (fn: () => Promise<Notice | null>) => {
    const n = await fn();
    if (n) onNotice(n);
  };
  return (
    <section className="inv-access" aria-labelledby="inv-access-title">
      <h3 id="inv-access-title" className="inv-access-title">
        {MEMBERS_WORDS.who} <span className="mem-count">{data.members.length + data.pending.length}</span>
      </h3>
      <NoticeLine notice={notice} />
      <ul className="inv-access-list">
        {members.map((m) => {
          const can = allowed(m, { canManage: data.canManage, admins });
          return (
            <li key={m.login} className="inv-access-row">
              <PersonCell name={m.name} seed={memberSeed(m)} line={memberLine(m)} you={m.you} avatar={m.avatar} />
              {can.changeRole ? (
                <RolePicker label={`Role for ${m.name}`} value={choiceOf(m)} shown={roleText(m)} personal={data.personal} variant="ghost" onChange={(c) => void run(() => act.changeRole(m, c))} />
              ) : (
                <span className="mem-role-text">{roleText(m)}</span>
              )}
              {moreSpace && <span className="inv-more-space" aria-hidden="true" />}
            </li>
          );
        })}
        {data.pending.map((p) => (
          <li key={p.id} className="inv-access-row">
            {/* Resend on the person's line, as in the Settings table (MembersSection PendingRow): the same row both places. */}
            <PersonCell
              name={p.email}
              seed={p.face ?? p.email}
              pending
              line={
                <>
                  {pendingLine(p.sentAt, now)}
                  {data.canManage && (
                    <>
                      {' · '}
                      <Button variant="link" size="sm" className="mem-resend" data-demo-write={data.context === 'sample' ? 'send invites' : undefined} onClick={() => void run(() => act.resend(p))}>
                        {MEMBERS_WORDS.resend}
                      </Button>
                    </>
                  )}
                </>
              }
            />
            {data.canManage ? (
              <RolePicker label={`Role for ${p.email}`} value={inviteChoice(p)} personal={data.personal} variant="ghost" onChange={(c) => void run(() => act.changeInviteRole(p, c))} />
            ) : (
              <span className="mem-role-text">{roleLabel(inviteChoice(p))}</span>
            )}
            {data.canManage && (
              <Menu>
                <MenuTrigger render={<IconButton icon={MoreHorizontal} label={`More for ${p.email}`} variant="ghost" size="md" />} />
                <MenuContent align="end">
                  <MenuItem tone="danger" onClick={() => void run(() => act.cancel(p))}>
                    {MEMBERS_WORDS.cancelInvite}
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function InviteDialog({ open, onOpenChange, shared, onSent }: InviteDialogProps) {
  const own = useMembers(open && !shared);
  const load = shared ? ({ status: 'ready', data: shared.data } as const) : own.load;
  const update = shared?.update ?? own.update;
  const [emails, setEmails] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<RoleChoice>(DEFAULT_CHOICE);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** What a row's action said (Resend, a role, Cancel invite): shown at the list, by the rows. */
  const [listNotice, setListNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  /** Invites went out since the dialog opened: with nothing left to send, the way out reads Done, not Cancel. */
  const [sent, setSent] = useState(false);
  const inputId = `${useId()}-email`;
  const hintId = `${inputId}-hint`;
  const labelId = `${inputId}-label`;

  // Cleared when it closes, so it opens empty next time.
  useEffect(() => {
    if (open) return;
    setEmails([]);
    setQuery('');
    setChoice(DEFAULT_CHOICE);
    setNotice(null);
    setListNotice(null);
    setBusy(false);
    setSent(false);
  }, [open]);

  const data = load.status === 'ready' ? load.data : null;
  const options = useMemo(
    () => (data ? inviteOptions(query, { people: data.people, members: data.members, pending: data.pending, chosen: emails, team: data.team }) : []),
    [data, query, emails],
  );

  const add = (next: string[]) => setEmails((cur) => [...cur, ...parseEmails(next.join(' '), cur)].slice(0, MAX_INVITES));
  const onInput = (text: string) => {
    // Several addresses pasted or typed at once become chips; the rest of the text stays to edit.
    if (/[\s,;]/.test(text)) {
      const found = parseEmails(text, emails);
      if (found.length) {
        add(found);
        setQuery('');
        return;
      }
    }
    setQuery(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && parseEmails(query, emails).length) {
      e.preventDefault();
      add([query]);
      setQuery('');
    }
  };

  const canSend = Boolean(data && data.canManage && data.invites && emails.length > 0 && !busy);
  const send = async () => {
    if (!data) return;
    setBusy(true);
    const r = await memberActions(data, update).send(emails, choice, data.people);
    setBusy(false);
    if (r.notice) {
      setNotice(r.notice);
      setListNotice(null);
    }
    if (r.notice?.tone === 'success') {
      setEmails(r.left);
      setSent(true);
      onSent?.();
    }
  };

  const sample = data?.context === 'sample';
  const footer =
    data && data.context !== 'none' ? (
      <div className="inv-footer">
        <ButtonGroup>
          <DialogClose render={<Button variant="secondary" size="lg" />}>{closeLabel(data.canManage, sent, emails.length)}</DialogClose>
          {data.canManage && (
            <Button variant="primary" size="lg" disabled={!canSend} loading={busy} data-demo-write={sample ? 'send invites' : undefined} onClick={() => void send()}>
              {sendLabel(emails.length)}
            </Button>
          )}
        </ButtonGroup>
      </div>
    ) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={MEMBERS_WORDS.title} description={MEMBERS_WORDS.intro} size="md" footer={footer} className="inv-dialog">
        {load.status === 'loading' && (
          <div className="inv-loading" aria-busy="true" aria-label="Reading who is in this team">
            <Skeleton height="var(--size-10)" />
            <Skeleton height="var(--size-40)" />
          </div>
        )}
        {load.status === 'error' && <Alert tone="danger">{load.message}</Alert>}
        {data?.context === 'none' && <EmptyState icon={Link2Off} title={MEMBERS_WORDS.noRepo} description={MEMBERS_WORDS.noRepoText} align="start" size="sm" headingLevel={3} />}
        {data && data.context !== 'none' && (
          <>
            {data.canManage ? (
              <div className="inv-form">
                <label id={labelId} className="inv-label" htmlFor={inputId}>
                  {MEMBERS_WORDS.email}
                </label>
                <div className="inv-row">
                  <Combobox
                    id={inputId}
                    className="inv-emails"
                    multiple
                    options={options}
                    filter={null}
                    value={emails}
                    onValueChange={(v) => setEmails(Array.isArray(v) ? v.slice(0, MAX_INVITES) : [])}
                    inputValue={query}
                    onInputValueChange={onInput}
                    onKeyDown={onKeyDown}
                    placeholder={emails.length ? undefined : MEMBERS_WORDS.emailPlaceholder}
                    emptyMessage="Type a full work email to invite someone new."
                    aria-labelledby={labelId}
                    aria-describedby={hintId}
                    size="lg"
                    autoComplete="off"
                  />
                  <RolePicker label="Role" value={choice} onChange={setChoice} personal={data.personal} emailOnly={noRepo(data)} emailNote={noRepo(data) ? MEMBERS_WORDS.reviewerNeedsRepo : undefined} size="lg" />
                </div>
                <p id={hintId} className="inv-hint">
                  {MEMBERS_WORDS.emailHint}
                </p>
                {data.context === 'real' && !data.invites && <Alert tone="info">{MEMBERS_WORDS.unavailable}</Alert>}
              </div>
            ) : (
              <p className="inv-hint">{MEMBERS_WORDS.readOnly}</p>
            )}
            <NoticeLine notice={notice} />
            <AccessList data={data} update={update} notice={listNotice} onNotice={setListNotice} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
