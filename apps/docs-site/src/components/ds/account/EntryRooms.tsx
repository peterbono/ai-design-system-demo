// The rooms of Entry after the email code (lib/entry.ts routes there; SignIn.tsx hosts them in its Harbor zone):
//   E3  "Acme Design invited you": who invited which email and when, the team card (its people: a few avatars, "+N"
//       and "12 members"; "You join as Reviewer: design"), Join. A reviewer or admin invite without GitHub linked says
//       so before the action, in one line (GitHub, the free account where the design system lives), with "Connect
//       GitHub to accept" and "New to GitHub?"; on a site without GitHub sign-in, that it is not available here and
//       whom to ask.
//   The invite link's own states (InviteLinkRoom, /studio/invite/): sent to another email ("Sign in as that email"),
//       already in the team (Open), a spent link (whom to ask), an incomplete link.
//   E4  "Your colleagues already use Bridge": the teams open to the work domain, largest first, three then "Show N
//       more". One team: its card and the one primary action, Ask to join. Several: each card keeps its own button.
//       "Create a new team instead" stays quiet.
//   E4b "Request sent": the same card, waiting for the admin, the demo while they wait. "Changed your mind? Cancel the
//       request" takes it back and returns to E4.
//   E5  "Pick a team": two or more teams and none opened recently in this browser; each row opens its Studio home.
// "Not you? Use another email" signs out and goes back to the email.
import { useState, type ReactNode } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Alert, Avatar, AvatarGroup, Badge, Button, Card, Icon, Link } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { ACCOUNT_WORDS, roleWord, SIGNIN_PAGE } from '../../../lib/account';
import { GITHUB_SIGNUP_URL } from '../../../lib/contribute';
import { CREATE_TEAM_HREF, ENTRY_WORDS as W, inviteRole, invitedOn, membersLabel, splitDomainTeams, teamAvatars, teamHome, yourRole, type DomainTeam, type EntryInvite, type EntryTeam, type InviteLink } from '../../../lib/entry';
import { DEMO_HOME } from '../../../lib/start';

/** The team's mark (its initials, like a team without a picture), its name, and up to two muted lines. */
function TeamCard({ name, lines, end, id }: { name: string; lines: ReactNode[]; end?: ReactNode; id?: string }) {
  return (
    <Card className="ent-card" padding="none">
      <div className="ent-card-body">
        <Avatar name={name} size="lg" className="ent-mark" decorative />
        <div className="ent-card-text">
          <strong className="ent-card-name" id={id}>
            {name}
          </strong>
          {lines.map((l, i) => (
            <div key={i} className="ent-card-line">
              {l}
            </div>
          ))}
        </div>
        {end && <div className="ent-card-end">{end}</div>}
      </div>
    </Card>
  );
}

/** Most "+N" counters a card builds (the counter shows the number, the avatars behind it are never drawn). */
const MAX_HIDDEN = 999;

/** The people line of a team card: a few initials avatars, "+N" for everyone else, then "12 members". Names only. */
export function TeamPeople({ team, people, count }: { team: string; people: string[]; count: number }) {
  const { names, more } = teamAvatars(people, count);
  return (
    <div className="ent-people">
      {names.length > 0 && (
        <div aria-hidden="true" className="ent-people-stack">
          <AvatarGroup aria-label={`People on ${team}`} max={names.length} size="md">
            {names.map((n, i) => (
              <Avatar key={`${i}-${n}`} name={n} size="md" decorative />
            ))}
            {Array.from({ length: Math.min(more, MAX_HIDDEN) }, (_, i) => (
              <Avatar key={`more-${i}`} name="" size="md" decorative />
            ))}
          </AvatarGroup>
        </div>
      )}
      <span>{membersLabel(count)}</span>
    </div>
  );
}

function NotYou({ onOtherEmail }: { onOtherEmail: () => void }) {
  return (
    <p className="acc-quiet">
      {W.notYou}{' '}
      <Button variant="link" size="sm" className="ent-inline" onClick={onOtherEmail}>
        {W.otherEmail}
      </Button>
    </p>
  );
}

export interface RoomProps {
  /** Leaves Entry for an address. */
  leave: (href: string) => void;
  /** Signs out, back to the email field. */
  onOtherEmail: () => void;
  /** Links GitHub and comes back here. */
  onConnectGitHub: () => void;
  /** Joined a team with the email account: its pages know the member before they open. */
  onJoined?: (repo: string, role: string) => Promise<void> | void;
}

type Header = { title: string; lead: ReactNode };

// ---------------------------------------------------------------------------------------------------------------
// E3

/** The site offers GitHub sign-in (a GitHub App, data-gh-app on <html>, components/../layouts/Layout.astro). */
const githubOnSite = () => typeof document !== 'undefined' && Boolean(document.documentElement.dataset.ghApp);

export function InviteRoom({
  invite,
  email,
  more,
  github,
  leave,
  onJoined,
  onOtherEmail,
  onConnectGitHub,
  header,
}: RoomProps & { invite: EntryInvite; email: string; more: number; /** The account has GitHub linked. */ github: boolean; header: (h: Header) => ReactNode }) {
  const [busy, setBusy] = useState(false);
  // Reviewers and admins approve on GitHub: said before Join, not after a refusal (the server's 409 still lands here).
  const [needsGitHub, setNeedsGitHub] = useState(() => (invite.role === 'reviewer' || invite.role === 'admin') && !github);
  const [problem, setProblem] = useState<string | null>(null);
  const [onGitHub, setOnGitHub] = useState<{ repo: string; role: string; url: string; next: string } | null>(null);
  const role = inviteRole(invite);

  const join = async () => {
    setBusy(true);
    setProblem(null);
    const api = await import('../../../scripts/entry-session');
    try {
      const r = await api.acceptInvite(invite.repo, invite.id);
      if (r.status === 'accept-on-github') {
        setOnGitHub({ repo: r.repo, role: roleWord(String(r.role)), url: r.acceptUrl ?? `https://github.com/${r.repo}/invitations`, next: r.next || teamHome(r.repo) });
        setBusy(false);
        return;
      }
      await onJoined?.(r.repo, String(r.role));
      leave(r.next || teamHome(r.repo));
    } catch (err) {
      setBusy(false);
      if (err instanceof api.EntryError && err.code === 'github-required') return setNeedsGitHub(true);
      setProblem(err instanceof api.EntryError && err.status === 410 ? W.inviteGone : err instanceof Error ? err.message : W.inviteGone);
    }
  };

  if (onGitHub)
    return (
      <>
        {header({ title: W.acceptOnGitHubTitle, lead: W.acceptOnGitHub(onGitHub.repo, onGitHub.role) })}
        <div className="ent-actions">
          <ButtonLink href={onGitHub.url} variant="primary" size="lg" fullWidth iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
            {W.acceptOnGitHubButton}
          </ButtonLink>
          <ButtonLink href={onGitHub.next} variant="ghost" size="lg" fullWidth>
            {W.openTeam}
          </ButtonLink>
        </div>
      </>
    );

  return (
    <>
      {header({
        title: W.invitedTitle(invite.team),
        lead: (
          <>
            {W.invitedBy(invite.invitedBy)} <strong className="ent-strong">{email}</strong>
            {W.invitedOn(invitedOn(invite.invitedAt))}.
          </>
        ),
      })}
      <TeamCard
        name={invite.team}
        lines={[
          ...(invite.memberCount > 0 ? [<TeamPeople key="people" team={invite.team} people={invite.people} count={invite.memberCount} />] : []),
          <>
            {W.joinAs} <strong className="ent-strong">{role}</strong>
          </>,
        ]}
      />
      {problem && (
        <Alert tone="warning" className="acc-alert">
          {problem}
        </Alert>
      )}
      <div className="ent-actions">
        {needsGitHub && githubOnSite() ? (
          <>
            <p className="ent-note">{W.githubWhy(role)}</p>
            <Button variant="primary" size="lg" fullWidth onClick={onConnectGitHub}>
              {W.githubToAccept}
            </Button>
            <p className="acc-quiet">
              {W.newToGitHub}{' '}
              <Link href={GITHUB_SIGNUP_URL} external>
                {W.createGitHub}
              </Link>
            </p>
          </>
        ) : needsGitHub ? (
          <>
            <p className="ent-note">{W.githubOff(role, invite.invitedBy)}</p>
            <ButtonLink href={DEMO_HOME} variant="secondary" size="lg" fullWidth>
              {ACCOUNT_WORDS.demo}
            </ButtonLink>
          </>
        ) : (
          !problem && (
            <Button variant="primary" size="lg" fullWidth loading={busy} onClick={() => void join()}>
              {W.join(invite.team)}
            </Button>
          )
        )}
        {problem && (
          <ButtonLink href={CREATE_TEAM_HREF} variant="secondary" size="lg" fullWidth>
            {W.createInstead}
          </ButtonLink>
        )}
      </div>
      {more > 0 && <p className="acc-quiet">{W.moreInvites(more)}</p>}
      <div className="acc-foot">
        <NotYou onOtherEmail={onOtherEmail} />
      </div>
    </>
  );
}

/**
 * The invite link's states besides E3: sent to another email, already in the team, spent, or incomplete. Never a dead
 * end: each one has its way on (sign in as the invited email, open the team, sign in, continue).
 */
export function InviteLinkRoom({
  link,
  email,
  header,
  onSignInAs,
  onContinue,
}: {
  link: InviteLink;
  /** The signed-in account's email, '' when signed out. */
  email: string;
  header: (h: Header) => ReactNode;
  onSignInAs: () => void;
  onContinue: () => void;
}) {
  const goOn = link.signedIn ? (
    <Button variant="secondary" size="lg" fullWidth onClick={onContinue}>
      {email ? W.continueAs(email) : W.continueToBridge}
    </Button>
  ) : (
    <ButtonLink href={SIGNIN_PAGE} variant="primary" size="lg" fullWidth>
      {W.signIn}
    </ButtonLink>
  );
  if (link.state === 'unknown')
    return (
      <>
        {header({ title: W.missingTitle, lead: W.missingLead })}
        <div className="ent-actions">{goOn}</div>
      </>
    );
  if (link.member && link.repo)
    return (
      <>
        {header({ title: W.alreadyIn(link.team), lead: W.alreadyInLead })}
        <div className="ent-actions">
          <ButtonLink href={teamHome(link.repo)} variant="primary" size="lg" fullWidth>
            {W.openNamed(link.team)}
          </ButtonLink>
        </div>
      </>
    );
  if (link.state === 'gone')
    return (
      <>
        {header({ title: W.goneTitle, lead: W.goneLead(link.invitedBy, link.team) })}
        <div className="ent-actions">{goOn}</div>
      </>
    );
  // Live, and signed in as someone else.
  return (
    <>
      {header({ title: W.otherTitle(link.sentTo), lead: W.otherLead(link.team) })}
      <div className="ent-actions">
        <Button variant="primary" size="lg" fullWidth onClick={onSignInAs}>
          {W.signInAsInvited}
        </Button>
        <Button variant="ghost" size="lg" fullWidth onClick={onContinue}>
          {W.continueAs(email)}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// E4 and E4b

const teamLines = (t: DomainTeam): ReactNode[] => [<TeamPeople key="people" team={t.name} people={t.people} count={t.memberCount} />, ...(t.adminName ? [W.admin(t.adminName)] : [])];

export function DomainRoom({ domain, teams: initial, leave, onJoined, onOtherEmail, header }: RoomProps & { domain: string; teams: DomainTeam[]; header: (h: Header) => ReactNode }) {
  const [teams, setTeams] = useState(initial);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // E4b: the request just sent (or sent before, for a lone team).
  const [sent, setSent] = useState<DomainTeam | null>(() => (initial.length === 1 && initial[0]!.requested ? initial[0]! : null));

  const ask = async (t: DomainTeam) => {
    setBusy(t.repo);
    setProblem(null);
    const api = await import('../../../scripts/entry-session');
    try {
      const r = await api.requestJoin(t.repo);
      if ('joined' in r) {
        if (r.status === 'joined') await onJoined?.(r.repo, String(r.role));
        return leave(r.next || teamHome(r.repo));
      }
      const done = { ...t, requested: true };
      setTeams((xs) => xs.map((x) => (x.repo === t.repo ? done : x)));
      setSent(done);
    } catch (err) {
      if (err instanceof api.EntryError && err.code === 'already') return leave(teamHome(t.repo));
      setProblem(err instanceof Error ? err.message : null);
    } finally {
      setBusy(null);
    }
  };

  // E4b: takes the request back, then E4 again with Ask to join.
  const cancel = async (t: DomainTeam) => {
    setCancelling(true);
    setProblem(null);
    const api = await import('../../../scripts/entry-session');
    try {
      await api.cancelJoinRequest(t.repo);
      setTeams((xs) => xs.map((x) => (x.repo === t.repo ? { ...x, requested: false } : x)));
      setSent(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : null);
    } finally {
      setCancelling(false);
    }
  };

  if (sent)
    return (
      <>
        {header({ title: W.sentTitle, lead: W.sentLead(sent.adminName) })}
        <TeamCard
          name={sent.name}
          lines={teamLines(sent)}
          end={
            <Badge tone="warning" size="sm">
              {W.waitingFor(sent.adminName)}
            </Badge>
          }
        />
        <div className="ent-actions">
          <ButtonLink href={DEMO_HOME} variant="secondary" size="lg" fullWidth>
            {W.exploreDemo}
          </ButtonLink>
          <ButtonLink href={CREATE_TEAM_HREF} variant="ghost" size="lg" fullWidth>
            {W.createInstead}
          </ButtonLink>
        </div>
        {problem && (
          <Alert tone="warning" className="acc-alert">
            {problem}
          </Alert>
        )}
        <div className="acc-foot">
          <p className="acc-quiet">
            {W.changedMind}{' '}
            <Button variant="link" size="sm" className="ent-inline" loading={cancelling} onClick={() => void cancel(sent)}>
              {W.cancelRequest}
            </Button>
          </p>
        </div>
      </>
    );

  const [before, after] = W.domainLead(teams.length);
  const lead = (
    <>
      {before} <strong className="ent-strong">@{domain}</strong>
      {after}
    </>
  );
  const one = teams.length === 1;
  const { shown, more } = splitDomainTeams(teams, all);
  return (
    <>
      {header({ title: W.domainTitle, lead })}
      {one ? (
        <TeamCard name={teams[0]!.name} lines={teamLines(teams[0]!)} />
      ) : (
        <ul className="ent-list" aria-label={`Teams for @${domain}`}>
          {shown.map((t) => (
            <li key={t.repo}>
              <TeamCard
                name={t.name}
                lines={teamLines(t)}
                end={
                  t.requested ? (
                    <Badge tone="warning" size="sm">
                      {W.asked}
                    </Badge>
                  ) : (
                    <Button variant="secondary" loading={busy === t.repo} disabled={Boolean(busy)} aria-label={W.askTeam(t.name)} onClick={() => void ask(t)}>
                      {W.ask}
                    </Button>
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <Button variant="link" size="sm" onClick={() => setAll(true)}>
          {W.showMore(more)}
        </Button>
      )}
      {problem && (
        <Alert tone="warning" className="acc-alert">
          {problem}
        </Alert>
      )}
      <div className="ent-actions">
        {one && (
          <Button variant="primary" size="lg" fullWidth loading={busy === teams[0]!.repo} onClick={() => void ask(teams[0]!)}>
            {W.ask}
          </Button>
        )}
        <ButtonLink href={CREATE_TEAM_HREF} variant="ghost" size="lg" fullWidth>
          {W.createInstead}
        </ButtonLink>
      </div>
      <div className="acc-foot">
        <NotYou onOtherEmail={onOtherEmail} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// E5

export function PickRoom({ teams, header }: { teams: EntryTeam[]; header: (h: Header) => ReactNode }) {
  return (
    <>
      {header({ title: W.pickTitle, lead: W.pickLead(teams.length) })}
      <ul className="ent-list" aria-label="Your teams">
        {teams.map((t) => (
          <li key={t.repo}>
            <Card interactive padding="none" className="ent-card">
              <span className="ent-card-body">
                <Avatar name={t.name} size="lg" className="ent-mark" decorative />
                <span className="ent-card-text">
                  <Link href={teamHome(t.repo)} variant="subtle" data-card-primary>
                    <strong className="ent-card-name">{t.name}</strong>
                  </Link>
                  <span className="ent-card-line">{yourRole(t.role)}</span>
                </span>
                <Icon icon={ChevronRight} size="md" className="ent-chevron" />
              </span>
            </Card>
          </li>
        ))}
      </ul>
      <div className="acc-foot">
        <p className="acc-quiet">
          {W.newLead} <Link href={CREATE_TEAM_HREF}>{W.createTeam}</Link>
        </p>
      </div>
    </>
  );
}
