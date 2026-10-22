// The empty state of a team shell (components/TeamShell.astro) for a page that does not read the team yet, rendered
// at build time, no client JS: one calm line and the same page on Bridge's own design system (the self-hosted Studio,
// a demo repository in lib/demo.ts). "See it on Bridge" carries
// data-demo-link so pointLinksAtTeam leaves it on the demo.
import { ArrowRight, Hourglass } from 'lucide-react';
import { EmptyState } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';

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
      title="Coming to team pages"
      description={`Bridge does not show your ${what} here yet. The same page is live on Bridge, our own design system.`}
      actions={
        <ButtonLink variant="primary" href={demoHref} iconEnd={ArrowRight} data-demo-link="">
          See it on Bridge
        </ButtonLink>
      }
    />
  );
}
