// The "Demo workspace" banner over every Studio page of the demo, for a visitor who cannot change it (board D1): what
// the demo is, "See it on GitHub" (the demo repository) and "Use your own repo", which opens "Create a new team"
// (NewTeamDialog.tsx) to connect the visitor's own design system. A DS Banner, neutral: the page's mode, quietly.
// Mounted by scripts/demo-gate.ts into the layout's [data-demo-strip].
import { Info } from 'lucide-react';
import { Banner, Button } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { DEMO_WORDS } from '../../../lib/demo';
import '../../../styles/demo-home.css';

export interface DemoBannerProps {
  /** The demo repository on GitHub. */
  repoUrl: string;
  /** Opens "Create a new team". */
  onUseOwn: () => void;
}

export function DemoBanner({ repoUrl, onUseOwn }: DemoBannerProps) {
  return (
    <Banner
      appearance="neutral"
      icon={Info}
      className="demo-banner"
      title={
        <>
          <b>{DEMO_WORDS.bannerTitle}</b> <span className="demo-banner-text">{DEMO_WORDS.bannerText}</span>
        </>
      }
      actions={
        <>
          <ButtonLink variant="link" href={repoUrl} target="_blank" rel="noopener noreferrer">
            {DEMO_WORDS.seeOnGitHub}
          </ButtonLink>
          <Button variant="primary" onClick={onUseOwn}>
            {DEMO_WORDS.useOwn}
          </Button>
        </>
      }
    />
  );
}
