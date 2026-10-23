// The rooms of Entry after the email code (lib/entry.ts routes there; SignIn.tsx hosts them in its Harbor zone):
//   E3  "Acme Design invited you": who invited which email, the team card ("You join as Can edit"), Join. A reviewer
//       or admin invite without GitHub linked says so calmly, with "Connect GitHub to accept".
//   E4  "Your colleagues already use Bridge": the teams open to the work domain, largest first, three then "Show N
//       more". One team: its card and the one primary action, Ask to join. Several: each card keeps its own button.
//       "Create a new team instead" stays quiet.
//   E4b "Request sent": the same card, waiting for the admin, the demo while they wait.
//   E5  "Pick a team": two or more teams and none opened recently in this browser; each row opens its Studio home.
// "Not you? Use another email" signs out and goes back to the email.
import { useState, type ReactNode } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Card, Icon, Link } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { roleWord } from '../../../lib/account';
import { CREATE_TEAM_HREF, ENTRY_WORDS as W, membersLabel, splitDomainTeams, teamHome, yourRole, type DomainTeam, type EntryInvite, type EntryTeam } from '../../../lib/entry';
import { DEMO_HOME } from '../../../lib/start';

/** The team's mark (its initials, like a team without a picture), its name, and up to two muted lines. */
function TeamCard({ name, lines, end, id }: { name: string; lines: ReactNode[]; end?: ReactNode; id?: string }) {
  return (
    <Card className="ent-card" padding="none">
      <span className="ent-card-body">
        <Avatar name={name} size="lg" className="ent-mark" decorative />
        <span className="ent-card-text">
          <strong className="ent-card-name" id={id}>
            {name}
          </strong>
          {lines.map((l, i) => (
            <span key={i} className="ent-card-line">
              {l}
            </span>
          ))}
        </span>
        {end && <span className="ent-card-end">{end}</span>}
      </span>
    </Card>
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
}

type Header = { title: string; lead: ReactNode };

// ---------------------------------------------------------------------------------------------------------------
// E3

export function InviteRoom({ invite, email, more, leave, onOtherEmail, onConnectGitHub, header }: RoomProps & { invite: EntryInvite; email: string; more: number; header: (h: Header) => ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [needsGitHub, setNeedsGitHub] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [onGitHub, setOnGitHub] = useState<{ repo: string; role: string; url: string; next: string } | null>(null);
  const role = roleWord(invite.role);

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
            {W.invitedBy(invite.invitedBy)} <strong className="ent-strong">{email}</strong>.
          </>
        ),
      })}
      <TeamCard
        name={invite.team}
        lines={[
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
        {needsGitHub ? (
          <>
            <p className="ent-note">{W.githubToAcceptWhy(role)}</p>
            <Button variant="primary" size="lg" fullWidth onClick={onConnectGitHub}>
              {W.githubToAccept}
            </Button>
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

// ---------------------------------------------------------------------------------------------------------------
// E4 and E4b

const teamLines = (t: DomainTeam) => [membersLabel(t.memberCount), ...(t.adminName ? [W.admin(t.adminName)] : [])];

export function DomainRoom({ domain, teams: initial, leave, onOtherEmail, header }: RoomProps & { domain: string; teams: DomainTeam[]; header: (h: Header) => ReactNode }) {
  const [teams, setTeams] = useState(initial);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // E4b: the request just sent (or sent before, for a lone team).
  const [sent, setSent] = useState<DomainTeam | null>(() => (initial.length === 1 && initial[0]!.requested ? initial[0]! : null));

  const ask = async (t: DomainTeam) => {
    setBusy(t.repo);
    setProblem(null);
    const api = await import('../../../scripts/entry-session');
    try {
      const r = await api.requestJoin(t.repo);
      if ('joined' in r) return leave(r.next || teamHome(r.repo));
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
