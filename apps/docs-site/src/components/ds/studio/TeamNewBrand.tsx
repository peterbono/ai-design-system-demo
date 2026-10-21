// Studio New brand for a team (team shell /studio/<owner>/<repo>/brands/new/, multi-team): the self-hosted flow
// (NewBrandFlow) fed from the team's repository, read in the browser (scripts/team-data.ts), instead of the build
// checkout. It sends to the team's repository the way the team's bridge.config.json "changes" says: a suggestion, or
// a draft branch for review; in direct mode the first branch asks for Bridge Direct's OK (scripts/github-session.ts)
// before anything is sent. The draft is kept per team in this browser. Repo content as React text only.
import { Braces, FileCog } from 'lucide-react';
import { EmptyState, Link } from '@bridge-ds/react';
import NewBrandFlow from './NewBrandFlow';
import { TeamLoadError, TeamLoadProgress, TeamSourceNote, useTeamData } from './TeamState';
import { teamBrandInput, teamDraftScope } from '../../../lib/team-new-brand';
import { HOSTED_DOCS_URL } from '../../../lib/team-load';

export interface TeamNewBrandProps {
  /** The site has Sign in with GitHub (a GitHub App): the connect action says "Sign in". */
  signIn?: boolean;
}

export default function TeamNewBrand({ signIn = false }: TeamNewBrandProps) {
  const { load, retry } = useTeamData();
  if (load.status === 'loading') return <TeamLoadProgress label="Reading this team's brands" />;
  if (load.status === 'error') return <TeamLoadError failure={load.failure} onRetry={retry} />;
  const { data, refreshing } = load;
  const input = teamBrandInput(data.model);
  const name = `${data.owner}/${data.repo}`;
  const note = <TeamSourceNote data={data} refreshing={refreshing} onRefresh={retry} />;
  const howTo = (
    <Link href={HOSTED_DOCS_URL} target="_blank" rel="noopener noreferrer">
      How Bridge reads a repository
    </Link>
  );

  if (!input.ok) {
    return (
      <>
        {note}
        {input.reason === 'no-config' ? (
          <EmptyState
            size="lg"
            headingLevel={2}
            icon={FileCog}
            align="start"
            title="Add bridge.config.json first"
            description={`A new brand is listed in bridge.config.json, and ${name} has none yet. Add it at the root of the repository, then refresh.`}
            actions={howTo}
          />
        ) : (
          <EmptyState
            size="lg"
            headingLevel={2}
            icon={Braces}
            align="start"
            title={`No token files in ${data.model.tokens.root}`}
            description={`A new brand starts from the brands you already have. Bridge found no token files at ${data.model.tokens.root} in ${name}. Point tokens.root in bridge.config.json at the folder that holds them, then refresh.`}
            actions={howTo}
          />
        )}
      </>
    );
  }

  return (
    <>
      {note}
      <NewBrandFlow
        files={input.files}
        configText={input.configText}
        contrastText={input.contrastText}
        signIn={signIn}
        repo={{ owner: data.owner, name: data.repo, defaultBranch: data.defaultBranch }}
        draftScope={teamDraftScope(data)}
      />
    </>
  );
}
