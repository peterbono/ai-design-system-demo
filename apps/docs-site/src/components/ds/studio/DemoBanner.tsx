// The banner over every page of a demo team for a visitor who cannot change it, Studio and Library alike. One banner,
// one action (lib/demo.ts):
//   - The sample team (Acme Design): "Acme Design. This is a sample team: your edits stay in this browser and nothing
//     is sent." with "Get started", the email sign-in (lib/account.ts SIGNIN_PAGE), never GitHub. A visitor signed in to
//     a Bridge account gets "Back to your workspace" instead: they have already started.
//   - Bridge's own team, for a guest: "Bridge DS, read only." with "Back to your workspace" (or "Connect your design
//     system" with no workspace yet, lib/start.ts demoBack).
// The action is secondary weight: the page keeps its own primary (Review all on the demo home). A DS Banner, neutral,
// with the board's warm tint (styles/demo-home.css). Mounted by scripts/demo-gate.ts into the layout's [data-demo-strip].
import { Info } from 'lucide-react';
import { Banner } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { DEMO_WORDS, demoBanner } from '../../../lib/demo';
import { SIGNIN_PAGE } from '../../../lib/account';
import '../../../styles/demo-home.css';

export interface DemoBannerProps {
  /** owner/repo: the sample team (Acme Design) or Bridge's own design system pick the words (lib/demo.ts demoBanner). */
  repo: string;
  /**
   * Where "Back to your workspace" leads, for a visitor who has one (signed in to a Bridge account, or Bridge's own team);
   * `connect` when there is none yet. Null on the sample team for a visitor who has not started: "Get started".
   */
  back?: { href: string; connect: boolean } | null;
  /** "Connect your design system" clicked (scripts/start-connect.ts). */
  onConnect?: (e: Event, href: string) => void;
}

export function DemoBanner({ repo, back, onConnect }: DemoBannerProps) {
  const words = demoBanner(repo);
  const action = !back ? (
    <ButtonLink variant="secondary" href={SIGNIN_PAGE} data-demo-start="">
      {DEMO_WORDS.getStarted}
    </ButtonLink>
  ) : back.connect ? (
    <ButtonLink variant="secondary" href={back.href} onClick={(e) => onConnect?.(e.nativeEvent, back.href)}>
      {DEMO_WORDS.connectOwn}
    </ButtonLink>
  ) : (
    <ButtonLink variant="secondary" href={back.href}>
      {DEMO_WORDS.backToWorkspace}
    </ButtonLink>
  );
  return (
    <Banner
      appearance="neutral"
      icon={Info}
      className="demo-banner demo-banner-sample"
      title={
        <>
          <b>{words.title}</b> <span className="demo-banner-text">{words.text}</span>
        </>
      }
      actions={action}
    />
  );
}
