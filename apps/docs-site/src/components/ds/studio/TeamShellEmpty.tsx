// The empty state of a team shell (components/TeamShell.astro), rendered at build time, no client JS. The team's
// GitHub link is filled in the browser (scripts/team-links.ts fillTeamShell); "See it on the demo" carries
// data-demo-link so pointLinksAtTeam leaves it on the demo.
import { ArrowRight, Hourglass } from 'lucide-react';
import { EmptyState } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from './brand-icons';

export interface TeamShellEmptyProps {
  /** What the page shows, said as "your <what>". */
  what: string;
  /** The same page on the demo (self-hosted Studio). */
  demoHref: string;
}

export default function TeamShellEmpty({ what, demoHref }: TeamShellEmptyProps) {
  return (
    <EmptyState
      size="lg"
      headingLevel={2}
      icon={Hourglass}
      title="Team pages open here soon"
      description={`Bridge will read your ${what} from this repository on GitHub, in your browser. Until then, the same page is live on the Bridge demo.`}
      actions={
        <>
          <ButtonLink variant="primary" href={demoHref} iconEnd={ArrowRight} data-demo-link="">
            See it on the demo
          </ButtonLink>
          <ButtonLink variant="secondary" href="https://github.com/" iconStart={GitHubMark} data-team-github="" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </ButtonLink>
        </>
      }
    />
  );
}
