// Settings > Members (boards I3 and I4): who is in the team and what each person can do. One sentence first, the
// count beside the title, and for an admin the page's one primary action, "Invite collaborators", on the title's line.
// Then a DS Table, Person and Role: each person's name, one muted line ("Reviews design"), and on the same row their
// role picker (RolePicker, the one the invite dialog uses) and a "More" menu with Make admin and Remove from team.
// Remove asks once, in the row itself, before anything happens. Pending invites close the list, with Resend on their
// line. Someone who is not an admin reads the same list with roles as text and no controls (board I4).
// An email contributor (lib/contribute.ts) reads as any member, with no tag of their own; they stay Can edit (Reviewer
// and Admin are disabled in their picker, with the reason) and an admin may remove them.
// Contexts (scripts/members.ts): the sample team shows its sample people and every change opens the demo dialog; a real
// team reads GitHub and sends changes to the invites server; the browser workspace has no team yet.
// Mounted by both Settings pages (pages/studio/settings, pages/team-shell/settings), and it mounts the dialog.
// Admins of a real team on the hosted site also see who asks to join and who can find the team (JoinRequests.tsx,
// boards E7a and E7c): "Asks to join" above the members, the discovery line under the intro.
import { useState } from 'react';
import { Link2Off, MoreHorizontal, UserPlus } from 'lucide-react';
import { Alert, Button, ButtonGroup, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import RolePicker from './RolePicker';
import { NoticeLine, PersonCell } from './MemberParts';
import InviteDialog from './InviteDialog';
import { memberActions, useMembers, type Notice } from './members-state';
import { DiscoveryLine, JoinRequests, useEntryAdmin } from './JoinRequests';
import { isHosted } from '../../../lib/team-path';
import { adminCount, choiceOf, inviteChoice, memberActions as allowed, MEMBERS_WORDS, memberLine, pendingLine, roleText, roleLabel, SAMPLE_NOW, sortMembers, type Member, type PendingInvite } from '../../../lib/invites';
import type { MembersData } from '../../../scripts/members';
import '../../../styles/invites.css';

const now = (data: MembersData) => (data.context === 'sample' ? SAMPLE_NOW : Date.now());

function MemberRow({ m, data, admins, act, onNotice }: { m: Member; data: MembersData; admins: number; act: ReturnType<typeof memberActions>; onNotice: (n: Notice | null) => void }) {
  const can = allowed(m, { canManage: data.canManage, admins });
  // An email contributor stays Can edit: Reviewer and Admin approve on GitHub (the picker says why).
  const email = m.via === 'email';
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<Notice | null>) => {
    setBusy(true);
    const n = await fn();
    setBusy(false);
    setConfirming(false);
    if (n) onNotice(n);
  };
  const menu = (can.makeAdmin && !email) || can.remove;
  return (
    <>
      <TableRow>
        <TableCell label="">
          <PersonCell name={m.name} seed={m.login} line={memberLine(m)} you={m.you} avatar={m.avatar} />
        </TableCell>
        <TableCell className="mem-role-cell" label="">
          <span className="mem-role">
            {can.changeRole ? (
              <RolePicker label={`Role for ${m.name}`} value={choiceOf(m)} personal={data.personal} emailOnly={email} disabled={busy} size="sm" onChange={(c) => void run(() => act.changeRole(m, c))} />
            ) : (
              <span className="mem-role-text">{roleText(m)}</span>
            )}
            {menu ? (
              <Menu>
                <MenuTrigger render={<IconButton icon={MoreHorizontal} label={`More for ${m.name}`} variant="ghost" size="sm" />} />
                <MenuContent align="end">
                  {can.makeAdmin && !email && (
                    <MenuItem disabled={data.personal} onClick={() => void run(() => act.changeRole(m, { role: 'admin' }))}>
                      {MEMBERS_WORDS.makeAdmin}
                    </MenuItem>
                  )}
                  {can.remove && (
                    <MenuItem tone="danger" onClick={() => setConfirming(true)}>
                      {MEMBERS_WORDS.remove}
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            ) : (
              data.canManage && <span className="mem-more-space" aria-hidden="true" />
            )}
          </span>
        </TableCell>
      </TableRow>
      {confirming && (
        <TableRow className="mem-confirm">
          <TableCell colSpan={2}>
            <span className="mem-confirm-body">
              <span>{email ? MEMBERS_WORDS.removeConfirmEmail(m.name, data.team) : MEMBERS_WORDS.removeConfirm(m.name, data.team)}</span>
              <ButtonGroup>
                <Button variant="secondary" onClick={() => setConfirming(false)} autoFocus>
                  Cancel
                </Button>
                <Button variant="danger" loading={busy} onClick={() => void run(() => act.remove(m))}>
                  Remove
                </Button>
              </ButtonGroup>
            </span>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function PendingRow({ p, data, act, onNotice }: { p: PendingInvite; data: MembersData; act: ReturnType<typeof memberActions>; onNotice: (n: Notice | null) => void }) {
  const run = async (fn: () => Promise<Notice | null>) => {
    const n = await fn();
    if (n) onNotice(n);
  };
  return (
    <TableRow>
      <TableCell label="">
        <PersonCell
          name={p.email}
          seed={p.face ?? p.email}
          pending
          line={
            <>
              {pendingLine(p.sentAt, now(data))}
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
      </TableCell>
      <TableCell className="mem-role-cell" label="">
        <span className="mem-role">
          {data.canManage ? (
            <RolePicker label={`Role for ${p.email}`} value={inviteChoice(p)} personal={data.personal} size="sm" onChange={(c) => void run(() => act.changeInviteRole(p, c))} />
          ) : (
            <span className="mem-role-text">{roleLabel(inviteChoice(p))}</span>
          )}
          {data.canManage && (
            <Menu>
              <MenuTrigger render={<IconButton icon={MoreHorizontal} label={`More for ${p.email}`} variant="ghost" size="sm" />} />
              <MenuContent align="end">
                <MenuItem tone="danger" onClick={() => void run(() => act.cancel(p))}>
                  {MEMBERS_WORDS.cancelInvite}
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}

export default function MembersSection() {
  const { load, update, reload } = useMembers();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const ready = load.status === 'ready' ? load.data : null;
  const entry = useEntryAdmin(ready?.repo ?? '', Boolean(ready && ready.context === 'real' && ready.canManage && isHosted()));

  if (load.status === 'loading')
    return (
      <div className="mem-loading" aria-busy="true" aria-label="Reading who is in this team">
        <Skeleton height="var(--size-10)" />
        <Skeleton height="var(--size-40)" />
      </div>
    );
  if (load.status === 'error') return <Alert tone="danger">{load.message}</Alert>;
  const data = load.data;
  if (data.context === 'none') return <EmptyState icon={Link2Off} title={MEMBERS_WORDS.noRepo} description={MEMBERS_WORDS.noRepoText} align="start" size="sm" headingLevel={3} />;

  const act = memberActions(data, update);
  const members = sortMembers(data.members);
  const admins = adminCount(data.members);
  const count = data.members.length + data.pending.length;
  return (
    <div className="mem">
      {data.canManage && data.context === 'real' && (
        <JoinRequests
          repo={data.repo}
          requests={entry.requests}
          onDone={(r, approved) => {
            entry.setRequests((xs) => xs.filter((x) => x.id !== r.id));
            if (approved) reload();
          }}
        />
      )}
      <div className="mem-head">
        <div className="mem-head-text">
          <h2 id="set-members" className="mem-title">
            {MEMBERS_WORDS.membersTitle} <span className="mem-count">{count}</span>
          </h2>
          <p className="mem-intro">{data.canManage ? MEMBERS_WORDS.membersIntro(data.team) : MEMBERS_WORDS.membersIntroReader(data.team)}</p>
          {data.canManage && data.context === 'real' && <DiscoveryLine repo={data.repo} discovery={entry.discovery} github={entry.github} onChange={entry.setDiscovery} />}
        </div>
        {data.canManage && (
          <Button variant="primary" size="lg" iconStart={UserPlus} onClick={() => setInviting(true)}>
            {MEMBERS_WORDS.title}
          </Button>
        )}
      </div>
      {data.context === 'real' && data.canManage && !data.invites && (
        <Alert tone="info" className="mem-alert">
          {MEMBERS_WORDS.unavailable}
        </Alert>
      )}
      <Table aria-label={`Members of ${data.team}`} narrowLayout="stack" className="mem-table">
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead className="mem-role-head">Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <MemberRow key={m.login} m={m} data={data} admins={admins} act={act} onNotice={setNotice} />
          ))}
          {data.pending.map((p) => (
            <PendingRow key={p.id} p={p} data={data} act={act} onNotice={setNotice} />
          ))}
        </TableBody>
      </Table>
      <NoticeLine notice={notice} />
      {data.canManage && <InviteDialog open={inviting} onOpenChange={setInviting} shared={{ data, update }} />}
    </div>
  );
}
