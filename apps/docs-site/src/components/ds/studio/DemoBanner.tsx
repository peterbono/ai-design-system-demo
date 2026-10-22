// The banner over every Studio page of the demo, for a visitor who cannot change it. Two kinds (lib/start.ts
// demoBannerKind):
//   - "Demo workspace." (board D1), for a visitor who came straight to the demo: what the demo is, "See it on GitHub"
//     (the demo repository) and "Use your own repo", which opens "Create a new team" (NewTeamDialog.tsx).
//   - "Sample data." (board EmptyA2), for a visitor with a workspace or who came through the start screen: the demo is
//     read only, and "Back to your workspace" leads to their team or browser workspace; with none yet, "Connect your
//     design system" starts the setup (lib/start.ts demoBack).
// A DS Banner, neutral; the sample kind takes the board's warm tint (styles/demo-home.css). Mounted by
// scripts/demo-gate.ts into the layout's [data-demo-strip].
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
  /** Shows the "Sample data" banner: back to the visitor's workspace, or connect one when there is none. */
  back?: { href: string; connect: boolean } | null;
  /** "Connect your design system" clicked (scripts/start-connect.ts). */
  onConnect?: (e: Event, href: string) => void;
}

export function DemoBanner({ repoUrl, onUseOwn, back, onConnect }: DemoBannerProps) {
  if (back)
    return (
      <Banner
        appearance="neutral"
        icon={Info}
        className="demo-banner demo-banner-sample"
        title={
          <>
            <b>{DEMO_WORDS.sampleTitle}</b> <span className="demo-banner-text">{DEMO_WORDS.sampleText}</span>
          </>
        }
        actions={
          back.connect ? (
            <ButtonLink variant="primary" href={back.href} onClick={(e) => onConnect?.(e.nativeEvent, back.href)}>
              {DEMO_WORDS.connectOwn}
            </ButtonLink>
          ) : (
            <ButtonLink variant="secondary" href={back.href}>
              {DEMO_WORDS.backToWorkspace}
            </ButtonLink>
          )
        }
      />
    );
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
