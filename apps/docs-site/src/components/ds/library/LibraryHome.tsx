// A team's Library, Home: the same view as Bridge's own Library home (views/LandingView.tsx: one sentence on what the
// design system holds, Browse components, the three places as cards with their counts), then the line for AI agents
// (the team's llms.txt) and where the page was read from.
import { useEffect, useState } from 'react';
import { Bot, ExternalLink } from 'lucide-react';
import { Icon } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { Drawing } from '../studio/Drawing';
import { LibraryPage, LibrarySourceNote, usePageTeam } from './LibraryState';
import { llmsTxtUrl } from '../../../lib/library/published';
import LandingView from './views/LandingView';
import { teamLibraryData } from './library-data';
import { SNAPSHOT_TEMPLATE_URL } from '../../../lib/team-load';
import { loadTeamLlms, type TeamData } from '../../../scripts/team-data';
import { libraryFileUrl } from '../../../scripts/library-access-api';
import '../../../styles/home.css';
import { teamDisplayName } from '../../../lib/demo';

/** Whether the team published an llms.txt (with its snapshot), once known. */
function useHasLlms(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void loadTeamLlms().then((s) => live && setHas(s));
    return () => {
      live = false;
    };
  }, []);
  return has;
}

function Agents({ data }: { data: TeamData }) {
  const has = useHasLlms();
  if (has === null) return null;
  return (
    <section className="ltm-agents fg-card" aria-labelledby="ltm-agents-title">
      <Icon icon={Bot} size="md" className="ltm-agents-icon" />
      <div className="ltm-agents-text">
        <h2 id="ltm-agents-title" className="ltm-agents-title">
          For AI agents
        </h2>
        <p className="ltm-muted">
          {has ? 'Every token and component guideline of this Library as plain text, ready for an agent to read.' : 'Publish a Bridge snapshot from CI to give agents this Library as plain text (llms.txt).'}
        </p>
      </div>
      {has ? (
        <ButtonLink variant="secondary" href={data.servedBy ? libraryFileUrl(`${data.owner}/${data.repo}`, 'llms') : llmsTxtUrl(data.owner, data.repo, data.private)} iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
          <span className="mono">llms.txt</span>
        </ButtonLink>
      ) : (
        <ButtonLink variant="secondary" href={SNAPSHOT_TEMPLATE_URL} iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
          Get the workflow
        </ButtonLink>
      )}
    </section>
  );
}

function Ready({ data, refreshing, onRefresh }: { data: TeamData; refreshing: boolean; onRefresh: () => void }) {
  return (
    <>
      <div>
        <LandingView data={teamLibraryData(data)} />
      </div>
      <Agents data={data} />
      <LibrarySourceNote data={data} refreshing={refreshing} onRefresh={onRefresh} />
    </>
  );
}

export default function LibraryHome() {
  const team = usePageTeam();
  return (
    <LibraryPage
      label="Reading the Library"
      // The home's hero comes with the view (views/LandingView.tsx, as on Bridge's own home); while it reads, the
      // team's name holds its place.
      header={(data) =>
        data ? null : (
          <section className="zone hm-hero ltm-hero" aria-labelledby="hero-title">
            <div className="hm-hero-copy">
              <p className="ltm-eyebrow">Design system library</p>
              <h1 id="hero-title" className="t-display">
                {team ? `The ${teamDisplayName(`${team.owner}/${team.repo}`)} design system` : 'Design system'}
              </h1>
              <p className="t-body">Tokens, components and how to use them, published from the repository.</p>
            </div>
            <div className="hm-hero-art">
              <Drawing name="hero" width={400} />
            </div>
          </section>
        )
      }
      ready={(data, r) => <Ready data={data} {...r} />}
    />
  );
}
