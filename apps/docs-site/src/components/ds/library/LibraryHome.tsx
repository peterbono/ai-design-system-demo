// A team's Library, Home (multi-team PR 4a): one sentence on what the design system holds, the one way in (Browse
// components), then the three places as cards with their counts, and the line for AI agents (the team's llms.txt).
// The cards mirror Bridge's own Library home, so a reader of both finds the same layout.
import { useEffect, useState } from 'react';
import { Bot, ExternalLink } from 'lucide-react';
import { Icon, Link } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { Drawing } from '../studio/Drawing';
import { LibraryPage, LibrarySourceNote, usePageTeam } from './LibraryState';
import { libraryHome, llmsTxtUrl } from '../../../lib/library-view';
import { libraryHref } from '../../../lib/library-shells';
import { SNAPSHOT_TEMPLATE_URL } from '../../../lib/team-load';
import { loadTeamLlms, type TeamData } from '../../../scripts/team-data';
import { libraryFileUrl } from '../../../scripts/library-access-api';
import type { IllustrationName } from '../../../brand/illustrations';
import '../../../styles/home.css';
import { teamDisplayName } from '../../../lib/demo';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
  const home = libraryHome(data.model);
  const href = (route: string) => libraryHref(data.owner, data.repo, route);
  const topics: { art: IllustrationName; title: string; text: string; route: string }[] = [
    { art: 'foundations', title: 'Foundations', text: 'Color, type, space, radius and shadow, drawn from the tokens.', route: 'foundations/' },
    { art: 'tokens', title: 'Tokens', text: home.semantic ? `${plural(home.semantic, 'semantic token')} with their values per theme.` : `${plural(home.tokens, 'token')} with their values.`, route: 'tokens/' },
    { art: 'components', title: 'Components', text: home.components ? `${plural(home.components, 'component')}, ${home.documented} with usage guidance.` : 'No components found yet.', route: 'components/' },
  ];
  return (
    <>
      <section className="hm-topics ltm-topics" aria-label="In this Library">
        {topics.map((t) => (
          <Link key={t.route} variant="subtle" className="fg-card hm-topic" href={href(t.route)}>
            <h2 className="t-h3">{t.title}</h2>
            <p className="t-body t-muted">{t.text}</p>
            <Drawing name={t.art} width={104} className="hm-topic-art" />
          </Link>
        ))}
      </section>
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
      header={(data) => (
        <section className="zone hm-hero ltm-hero" aria-labelledby="ltm-hero-title">
          <div className="hm-hero-copy">
            <p className="ltm-eyebrow">Design system library</p>
            <h1 id="ltm-hero-title" className="t-display">
              {team ? `The ${teamDisplayName(`${team.owner}/${team.repo}`, data?.model.site)} design system` : 'Design system'}
            </h1>
            <p className="t-body">{data ? `${libraryHome(data.model).lead} Tokens, components and how to use them, published from the repository.` : 'Tokens, components and how to use them, published from the repository.'}</p>
            {team && (
              <ButtonLink variant="primary" href={libraryHref(team.owner, team.repo, 'components/')}>
                Browse components
              </ButtonLink>
            )}
          </div>
          <div className="hm-hero-art">
            <Drawing name="hero" width={400} />
          </div>
        </section>
      )}
      ready={(data, r) => <Ready data={data} {...r} />}
    />
  );
}

