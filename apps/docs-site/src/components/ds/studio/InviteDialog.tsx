// Invite collaborators (board I1), a DS Dialog opened from the team chip menu and from Settings > Members. One
// sentence says what happens (MEMBERS_WORDS.intro: an email, then the team; only Reviewers also sign in with GitHub).
// Then the work email field, a DS Combobox that takes several emails as chips and suggests people Bridge
// already knows (on a real team, the people who committed to it; on the sample team, Acme's people), with the role
// picker on the same line (RolePicker, board I2). "Who has access" lists the team and the pending invites, with Resend
// on their line. The footer says who may invite on the left, and ends with Cancel and the one primary action, "Send N
// invites". No team link, no GitHub words.
// Someone who is not an admin sees who has access and why they cannot invite. The browser workspace has no team: it
// says to connect the design system first. When this site cannot send invites, the dialog says so and sends nothing.
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Link2Off } from 'lucide-react';
import { Alert, Button, ButtonGroup, Combobox, Dialog, DialogClose, DialogContent, EmptyState, Skeleton } from '@bridge-ds/react';
import RolePicker from './RolePicker';
import { NoticeLine, PersonCell } from './MemberParts';
import { memberActions, useMembers, type Notice } from './members-state';
import {
  adminCount,
  choiceOf,
  DEFAULT_CHOICE,
  inviteChoice,
  inviteOptions,
  MAX_INVITES,
  memberActions as allowed,
  MEMBERS_WORDS,
  memberLine,
  parseEmails,
  pendingLine,
  roleLabel,
  roleText,
  SAMPLE_NOW,
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
}

function AccessList({ data, update, onNotice }: { data: MembersData; update: (fn: (d: MembersData) => MembersData) => void; onNotice: (n: Notice | null) => void }) {
  const act = memberActions(data, update);
  const admins = adminCount(data.members);
  const now = data.context === 'sample' ? SAMPLE_NOW : Date.now();
  const members = sortMembers(data.members);
  const run = async (fn: () => Promise<Notice | null>) => {
    const n = await fn();
    if (n) onNotice(n);
  };
  return (
    <section className="inv-access" aria-labelledby="inv-access-title">
      <h3 id="inv-access-title" className="inv-access-title">
        {MEMBERS_WORDS.who} <span className="mem-count">{data.members.length + data.pending.length}</span>
      </h3>
      <ul className="inv-access-list">
        {members.map((m) => {
          const can = allowed(m, { canManage: data.canManage, admins });
          return (
            <li key={m.login} className="inv-access-row">
              <PersonCell name={m.name} seed={m.login} line={memberLine(m)} you={m.you} avatar={m.avatar} />
              {can.changeRole ? (
                <RolePicker label={`Role for ${m.name}`} value={choiceOf(m)} personal={data.personal} variant="ghost" onChange={(c) => void run(() => act.changeRole(m, c))} />
              ) : (
                <span className="mem-role-text">{roleText(m)}</span>
              )}
            </li>
          );
        })}
        {data.pending.map((p) => (
          <li key={p.id} className="inv-access-row">
            <PersonCell name={p.email} seed={p.face ?? p.email} line={pendingLine(p.sentAt, now)} pending />
            {data.canManage && (
              <Button variant="link" size="sm" data-demo-write={data.context === 'sample' ? 'send invites' : undefined} onClick={() => void run(() => act.resend(p))}>
                {MEMBERS_WORDS.resend}
              </Button>
            )}
            {data.canManage ? (
              <RolePicker label={`Role for ${p.email}`} value={inviteChoice(p)} personal={data.personal} variant="ghost" onChange={(c) => void run(() => act.changeInviteRole(p, c))} />
            ) : (
              <span className="mem-role-text">{roleLabel(inviteChoice(p))}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function InviteDialog({ open, onOpenChange, shared }: InviteDialogProps) {
  const own = useMembers(open && !shared);
  const load = shared ? ({ status: 'ready', data: shared.data } as const) : own.load;
  const update = shared?.update ?? own.update;
  const [emails, setEmails] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<RoleChoice>(DEFAULT_CHOICE);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = `${useId()}-email`;
  const hintId = `${inputId}-hint`;

  // Cleared when it closes, so it opens empty next time.
  useEffect(() => {
    if (open) return;
    setEmails([]);
    setQuery('');
    setChoice(DEFAULT_CHOICE);
    setNotice(null);
    setBusy(false);
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
    if (r.notice) setNotice(r.notice);
    if (r.notice?.tone === 'success') setEmails(r.left);
  };

  const sample = data?.context === 'sample';
  const footer =
    data && data.context !== 'none' ? (
      <div className="inv-footer">
        <span className="inv-footer-note">{MEMBERS_WORDS.onlyAdmins}</span>
        <ButtonGroup>
          <DialogClose render={<Button variant="secondary" size="lg" />}>{data.canManage ? 'Cancel' : 'Close'}</DialogClose>
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
                <label className="inv-label" htmlFor={inputId}>
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
                    aria-describedby={hintId}
                    size="lg"
                    autoComplete="off"
                  />
                  <RolePicker label="Role" value={choice} onChange={setChoice} personal={data.personal} size="lg" />
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
            <AccessList data={data} update={update} onNotice={setNotice} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
