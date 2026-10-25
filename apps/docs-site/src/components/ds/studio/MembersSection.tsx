// Settings > Members (boards I3 and I4): who is in the team and what each person can do. One sentence first, the
// count beside the title, and for an admin the page's one primary action, "Invite collaborators", on the title's line.
// Then a DS Table, Person and Role: each person's name, one muted line ("Reviews design"), and on the same row their
// role picker (RolePicker, the one the invite dialog uses) and a "More" menu with Make admin and Remove from team.
// Remove asks once, in the row itself, before anything happens. Pending invites close the list, with Resend on their
// line. Someone who is not an admin reads the same list with roles as text and no controls (board I4).
// An email member (lib/contribute.ts) reads as any member, with no tag of their own; an admin makes them Admin or Can
// edit (Reviewer is disabled in their picker, with the reason: reviewers approve on GitHub) or removes them.
// Contexts (scripts/members.ts): the sample team shows its sample people and every change opens the demo dialog; a real
// team reads GitHub and sends changes to the invites server; the browser workspace has no team yet.
// Mounted by both Settings pages (pages/studio/settings, pages/team-shell/settings), and it mounts the dialog.
// Admins of a real team on the hosted site also see who asks to join and who can find the team (JoinRequests.tsx,
// boards E7a and E7c): "Asks to join" above the members, the discovery Switch under the intro. Approve puts the person
// in the list at once (withJoined, BR-19), and a read after the row leaves confirms it.
import { useState } from 'react';
import { Link2Off, MoreHorizontal, UserPlus } from 'lucide-react';
import { Alert, Button, ButtonGroup, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import RolePicker from './RolePicker';
import { NoticeLine, PersonCell } from './MemberParts';
import InviteDialog from './InviteDialog';
import { memberActions, useMembers, type Notice } from './members-state';
import { DiscoveryLine, JoinRequests, useEntryAdmin } from './JoinRequests';
import { loadTeamRoles } from '../../../lib/recent-teams';
import { isHosted, isTeamKey, teamKeyOfPage } from '../../../lib/team-path';
import { adminCount, choiceOf, inviteChoice, memberActions as allowed, MEMBERS_WORDS, membersContext, memberLine, pendingLine, roleText, roleLabel, SAMPLE_NOW, sortMembers, type Member, type PendingInvite } from '../../../lib/invites';
import type { MembersData } from '../../../scripts/members';
import type { JoinRequest } from '../../../lib/entry';
import { repoContext } from '../../../scripts/repo-context';
import '../../../styles/invites.css';

/** This page's team and its context, known before anything is read: the join requests start with it. */
function pageTeam(): { repo: string; context: MembersData['context'] } {
  // A team made in Bridge, on its own Settings: real, by its key.
  const key = teamKeyOfPage();
  if (key) return { repo: key, context: 'real' };
  const ctx = repoContext();
  const repo = `${ctx.owner}/${ctx.repo}`;
  const noRepo = document.documentElement.hasAttribute('data-no-repo');
  return { repo, context: membersContext(noRepo ? null : repo, noRepo) };
}

/** The person who just joined, in the list at once (BR-19): Can edit, by email; the next read confirms them. */
export function withJoined(d: MembersData, r: JoinRequest): MembersData {
  const login = r.email.toLowerCase();
  if (d.members.some((m) => m.login.toLowerCase() === login || m.email?.toLowerCase() === login)) return d;
  return { ...d, members: [...d.members, { login, name: r.name, role: 'edit', reviews: [], email: login, via: 'email' }] };
}

const now = (data: MembersData) => (data.context === 'sample' ? SAMPLE_NOW : Date.now());

function MemberRow({ m, data, admins, act, onNotice }: { m: Member; data: MembersData; admins: number; act: ReturnType<typeof memberActions>; onNotice: (n: Notice | null) => void }) {
  const can = allowed(m, { canManage: data.canManage, admins });
  // An email member: Can edit or Admin, never Reviewer (reviewers approve on GitHub; the picker says why).
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
  const menu = can.makeAdmin || can.remove;
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
                  {can.makeAdmin && (
                    <MenuItem disabled={data.personal && !email} onClick={() => void run(() => act.changeRole(m, { role: 'admin' }))}>
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
  // Asked at once with the page's team, not after the members: the server says who is admin, and the rows paint first.
  // A team made in Bridge waits for its members (one quick read of this site's server, which says the role): its
  // members who are not admins never ask for what only admins may read.
  const [page] = useState(pageTeam);
  // Asked early only when this browser does not already know the person is not an admin there (their role, kept by
  // the team page): a Can edit member never sends requests that only answer 403.
  const [knownRole] = useState(() => loadTeamRoles()[page.repo.toLowerCase()] ?? null);
  const maybeAdmin = knownRole === null || knownRole === 'Admin';
  const entry = useEntryAdmin(ready?.repo ?? page.repo, (isHosted() || isTeamKey(page.repo)) && (ready ? ready.context === 'real' && ready.canManage : page.context === 'real' && !isTeamKey(page.repo) && maybeAdmin));
  const early = (
    <JoinRequests repo={page.repo} requests={entry.requests} />
  );

  if (load.status === 'loading')
    return (
      <>
        {early}
        <div className="mem-loading" role="status" aria-busy="true" aria-label="Reading who is in this team">
          <Skeleton height="var(--size-10)" />
          <Skeleton height="var(--size-40)" />
        </div>
      </>
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
          team={data.team}
          requests={entry.requests}
          onApproved={(r) => update((d) => withJoined(d, r))}
          onDone={(_r, approved) => {
            if (approved) reload();
          }}
          onUndone={() => reload()}
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
