// The browser workspace's home (board EmptyB), mounted by pages/studio/workspace.astro: the Studio home of someone who
// started "Connect my design system" and left before picking a repository. Rules and words in lib/start.ts.
//   - The Harbor zone: "Welcome, Ann.", what is missing in one sentence, the one primary action (it resumes the setup
//     where the visitor left it) with how long it takes beside it, and "1 of 6 connected" by the greeting.
//   - Your library: three dashed placeholders that say what shows there once connected.
//   - Your branches: one dashed row.
// With a Storybook added (the quick start), the zone and the Components card say what was found instead.
// A team made in Bridge with no repository yet (`team`, api/entry create-team) gets the same calm home, as that team: one
// sentence on what to connect next (an admin's action; a member reads who does it), its size and who can find it on one
// muted line, and for its admin the people asking to join (JoinRequests.tsx, the rows of the home's queue).
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { Button, Link } from '@bridge-ds/react';
import { TEAM_HOME_WORDS as TW, WORKSPACE_WORDS as W } from '../../../lib/start';
import { JoinRequests, useEntryAdmin } from './JoinRequests';
import { storybookHost, type WorkspaceStorybook } from '../../../lib/workspace';
import { STORYBOOK_PAGE } from './StorybookField';
import '../../../styles/workspace.css';
import '../../../styles/invites.css';

export interface WorkspaceTeam {
  /** `_team/<id>`. */
  key: string;
  name: string;
  /** The viewer administers it: they connect the design system and let people in. */
  admin: boolean;
  memberCount: number;
  discovery: { domain: string; enabled: boolean } | null;
}

export interface WorkspaceHomeProps {
  /** The viewer's first name; null signed out. */
  name: string | null;
  /** The team made in Bridge this home belongs to, when there is one. */
  team?: WorkspaceTeam | null;
  /** The Storybook added in this browser with the quick start. */
  storybook: WorkspaceStorybook | null;
  /** "1 of 6 connected" and its checklist (Onboarding.tsx FinishConnecting), by the greeting. */
  setup?: ReactNode;
  /** Opens the setup where the visitor left it. */
  onConnect: () => void;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The placeholder shapes of one card, drawn with dashed outlines: the Field Guide's "nothing here yet". */
function Placeholder({ kind }: { kind: 'tokens' | 'components' | 'products' }) {
  return (
    <span className="ws-shapes" data-kind={kind} aria-hidden="true">
      {kind === 'tokens' && [0, 1, 2, 3].map((i) => <span key={i} className="ws-shape" />)}
      {kind === 'components' && (
        <>
          <span className="ws-shape ws-shape-wide" />
          <span className="ws-shape ws-shape-small" />
          <span className="ws-shape ws-shape-wide" />
        </>
      )}
      {kind === 'products' && (
        <>
          <span className="ws-shape ws-shape-tall" />
          <span className="ws-shape ws-shape-tall" />
        </>
      )}
    </span>
  );
}

function LibraryCard({ kind, title, line, filled }: { kind: 'tokens' | 'components' | 'products'; title: string; line: ReactNode; filled?: boolean }) {
  return (
    <li className="ws-card" data-filled={filled ? '' : undefined}>
      <Placeholder kind={kind} />
      <span className="ws-card-text">
        <span className="ws-card-title">{title}</span>
        <span className="t-ui t-muted">{line}</span>
      </span>
    </li>
  );
}

/** "2 members · People with @northwind.io can find it": the team in one muted line. */
const teamLine = (t: WorkspaceTeam) => `${TW.members(t.memberCount)} · ${t.discovery?.enabled ? TW.findable(t.discovery.domain) : TW.inviteOnly}`;

/** The people asking to join a team made in Bridge, for its admin: the queue rows of the home (JoinRequests.tsx). */
function TeamRequests({ team }: { team: WorkspaceTeam }) {
  const { requests } = useEntryAdmin(team.key, team.admin);
  if (!requests.length) return null;
  return <JoinRequests repo={team.key} team={team.name} requests={requests} />;
}

export function WorkspaceHome({ name, team = null, storybook, setup, onConnect }: WorkspaceHomeProps) {
  const host = storybook ? storybookHost(storybook.url) : null;
  // A member of a team made in Bridge waits for its admin: no action of their own here.
  const connects = !team || team.admin;
  return (
    <div className="sh ws">
      <section className="zone sh-zone" aria-labelledby="ws-hello">
        <div className="sh-head-text">
          <div className="sh-hello-row">
            <h1 id="ws-hello" className="sh-hello">
              {W.welcome(name)}
            </h1>
            {setup && <div className="sh-setup">{setup}</div>}
          </div>
          <p className="t-body">
            {team ? (
              storybook ? TW.storybook(team.name) : team.admin ? TW.ready(team.name) : TW.waiting(team.name)
            ) : storybook ? (
              <>
                Your Storybook is connected: {plural(storybook.components, 'component')} from <span className="mono">{host}</span>. Connect the repository too and your tokens and changes show up here.
              </>
            ) : (
              W.nothing
            )}
          </p>
          {team && <p className="t-ui t-muted">{teamLine(team)}</p>}
          {connects && (
            <div className="ws-connect">
              <Button variant="primary" onClick={onConnect}>
                {storybook ? 'Connect the repository' : W.connect}
              </Button>
              <span className="t-ui t-muted">{storybook ? 'Read only. Bridge writes nothing in your code.' : W.hint}</span>
            </div>
          )}
        </div>
      </section>

      {team?.admin && <TeamRequests team={team} />}

      <section className="sh-section" aria-labelledby="ws-library">
        <header className="ws-head">
          <h2 id="ws-library" className="sh-h2">
            {W.library}
          </h2>
          <span className="t-ui t-muted">{storybook ? 'Storybook' : W.notConnected}</span>
        </header>
        <ul className="ws-cards">
          <LibraryCard kind="tokens" title={W.tokens.title} line={W.tokens.line} />
          {storybook ? (
            <LibraryCard
              kind="components"
              filled
              title={W.components.title}
              line={
                <>
                  {plural(storybook.components, 'component')} from your Storybook. <Link href={STORYBOOK_PAGE}>See them</Link>
                </>
              }
            />
          ) : (
            <LibraryCard kind="components" title={W.components.title} line={W.components.line} />
          )}
          <LibraryCard kind="products" title={W.products.title} line={W.products.line} />
        </ul>
      </section>

      <section className="ws-branches" aria-labelledby="ws-branches">
        <h2 id="ws-branches" className="ws-branches-title">
          {W.branches}
        </h2>
        <p className="t-ui t-muted">{W.noBranches}</p>
      </section>
    </div>
  );
}

/** Mounts the home into `el` once; later calls repaint it. */
export function paintWorkspaceHome(el: HTMLElement, props: WorkspaceHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<WorkspaceHome {...props} />);
  return r;
}
