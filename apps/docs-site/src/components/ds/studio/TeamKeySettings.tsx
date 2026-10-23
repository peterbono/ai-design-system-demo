// Settings of a team made in Bridge before any repository (`_team/<id>`, api/entry create-team), at
// /studio/workspace/settings/?team=<id> (pages/studio/workspace/settings.astro). The same structure as a team's
// Settings (board D9), the team first and in designer words:
//   General          the team's name, as everyone on it reads it
//   Members          who is in the team, who asks to join and the discovery Switch, invites and roles (MembersSection,
//                    which reads this team by its key: email members only, no GitHub side)
//   Your design system  how changes reach your code, review rules, safety and library access all come from the design
//                    system: "Connect your design system first", the admin's one action, or who can do it by name
//   Appearance       this browser's choice
// Never the sample team nor Bridge's own: a page without the team says how to get one.
import { useEffect, useState } from 'react';
import { Link2Off } from 'lucide-react';
import { Card, CardBody, EmptyState, Skeleton } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import MembersSection from './MembersSection';
import AppearanceSetting from './AppearanceSetting';
import { TEAM_NAME_WORDS } from '../../../lib/team-name';
import { adminOnlyText } from '../../../lib/settings-view';
import { signInHref } from '../../../lib/account';
import { WORKSPACE_HOME, workspaceTeamKey } from '../../../lib/start';
import { teamKeyId } from '../../../lib/team-path';
import type { TeamInfo } from '../../../lib/entry';

type State = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'no-team' } | { kind: 'team'; team: TeamInfo };

/** The words of this page. */
export const TEAM_KEY_WORDS = {
  signedOut: 'Sign in to see your team',
  signedOutText: 'Settings show your team once you are signed in.',
  noTeam: 'Create your team first',
  noTeamText: 'Name your team, then invite the people you work with. Settings live here once it exists.',
  createTeam: 'Create your team',
  signIn: 'Sign in',
  designSystem: 'Your design system',
  designSystemIntro: 'How changes reach your code, who checks them and who reads your library come with your design system.',
  connectFirst: 'Connect your design system first',
  connectText: 'Bridge reads your tokens and components from it. Then these settings show here.',
  connect: 'Connect your design system',
  nameHelp: 'Your teammates see it in Studio and in their invitations.',
} as const;

function Band({ id, title, intro, children, full = false }: { id: string; title: string; intro?: string; children: React.ReactNode; full?: boolean }) {
  return (
    <section className="set-band" id={id} aria-labelledby={`set-${id}`} data-full={full ? '' : undefined}>
      <div className="set-band-intro">
        <h2 id={`set-${id}`} className="set-h">
          {title}
        </h2>
        {intro && <p className="set-intro">{intro}</p>}
      </div>
      <div className="set-band-body">{children}</div>
    </section>
  );
}

export default function TeamKeySettings() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    void (async () => {
      const { getAccount } = await import('../../../scripts/account-session');
      const info = await getAccount().catch(() => null);
      const account = info?.account ?? null;
      if (!account) return live && setState({ kind: 'signed-out' });
      const key = workspaceTeamKey(account.teams, location.search);
      const id = key ? teamKeyId(key) : null;
      if (!key || !id) return live && setState({ kind: 'no-team' });
      // The address names the team, so Members (lib/team-path teamKeyOfPage) and a shared link read the same one.
      const url = new URL(location.href);
      url.searchParams.set('team', id);
      history.replaceState(history.state, '', url);
      document.documentElement.setAttribute('data-team-settings', '');
      void import('../../../scripts/workspace-nav').then(({ paintWorkspaceNav }) => paintWorkspaceNav());
      const { getTeam } = await import('../../../scripts/entry-session');
      const team = await getTeam(key).catch(() => null);
      if (!live) return;
      // Linked to a repository since: the team's Settings live there now.
      if (team?.repo) {
        const { teamHome } = await import('../../../lib/entry');
        return location.replace(`${teamHome(team.repo)}settings/`);
      }
      setState(team ? { kind: 'team', team } : { kind: 'no-team' });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === 'loading')
    return (
      <div className="mem-loading" role="status" aria-busy="true" aria-label="Reading your team">
        <Skeleton height="var(--size-10)" />
        <Skeleton height="var(--size-40)" />
      </div>
    );
  if (state.kind === 'signed-out')
    return (
      <EmptyState
        title={TEAM_KEY_WORDS.signedOut}
        description={TEAM_KEY_WORDS.signedOutText}
        align="start"
        headingLevel={2}
        actions={<ButtonLink variant="primary" href={signInHref(location.pathname + location.search)}>{TEAM_KEY_WORDS.signIn}</ButtonLink>}
      />
    );
  if (state.kind === 'no-team')
    return (
      <EmptyState
        title={TEAM_KEY_WORDS.noTeam}
        description={TEAM_KEY_WORDS.noTeamText}
        align="start"
        headingLevel={2}
        actions={<ButtonLink variant="primary" href={`${WORKSPACE_HOME}?setup=create`}>{TEAM_KEY_WORDS.createTeam}</ButtonLink>}
      />
    );

  const { team } = state;
  const admin = team.role === 'admin';
  const admins = team.people.filter((p) => p.role === 'admin').map((p) => p.name);
  return (
    <>
      <Band id="general" title={TEAM_NAME_WORDS.generalTitle} intro={TEAM_NAME_WORDS.generalIntro}>
        <Card>
          <CardBody>
            <div className="set-rows">
              <div className="set-row">
                <p className="set-row-label">{TEAM_NAME_WORDS.label}</p>
                <div className="set-row-value set-row-span">
                  <p className="set-who">{team.name}</p>
                  <p className="set-row-help">{TEAM_KEY_WORDS.nameHelp}</p>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </Band>

      <section className="set-band" id="team" aria-labelledby="set-members" data-full="">
        <MembersSection />
      </section>

      <Band id="design-system" title={TEAM_KEY_WORDS.designSystem} intro={TEAM_KEY_WORDS.designSystemIntro}>
        <Card>
          <CardBody>
            <EmptyState
              icon={Link2Off}
              title={TEAM_KEY_WORDS.connectFirst}
              description={admin ? TEAM_KEY_WORDS.connectText : `${TEAM_KEY_WORDS.connectText} ${adminOnlyText(admins, 'can connect it')}`}
              align="start"
              size="sm"
              headingLevel={3}
              actions={admin ? <ButtonLink variant="secondary" href={`${WORKSPACE_HOME}?team=${encodeURIComponent(team.id)}&setup=library`}>{TEAM_KEY_WORDS.connect}</ButtonLink> : undefined}
            />
          </CardBody>
        </Card>
      </Band>

      <Band id="appearance" title="Appearance" intro="How Bridge looks for you, only in this browser. It changes nothing for your team.">
        <AppearanceSetting />
      </Band>
    </>
  );
}
