// The Studio home on the demo for a visitor who cannot change it (lib/demo.ts exploresDemo): the same layout as a
// signed-in owner's home (StudioHome.tsx), with the demo's real data read-only and nothing personal.
//   1. The Harbor zone: "You're exploring the Bridge demo", one line on what they can do, the one primary action
//      (Connect your design system, which opens "Make it yours"), Create branch beside it (it opens the same dialog),
//      and "Already on Bridge?" which reveals the team launcher on demand. Under them, what waits for a review: the
//      Needs you rows (NeedList, the whole row is the link), at most three, the rest behind "See all branches".
//   2. The library at a glance: components, tokens, contrast and adoption, each a card that opens where it comes from.
//   3. Recent changes: the latest merged branches, one BranchRow each.
// Rows come from scripts/demo-home.ts (GitHub, read anonymously); figures from the build or the team's repo model.
import { createRoot, type Root } from 'react-dom/client';
import { useId, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { Button, Card, CardBody, Link, Skeleton } from '@bridge-ds/react';
import { Who } from './faces';
import { BranchRow } from './BranchRow';
import { Drawing } from './Drawing';
import { NeedList } from './StudioHome';
import TeamLauncher from './TeamLauncher';
import ButtonLink from '../ButtonLink';
import { DEMO_WORDS, demoWaitingLine } from '../../../lib/demo';
import { NEEDS_SHOWN, type NeedRow } from '../../../lib/home-model';
import type { GlanceFigure, RecentChange } from '../../../lib/demo-home';
import { VOCAB } from '../../../lib/vocabulary';
import { studioHref } from '../../../lib/team-path';

export interface DemoHomeProps {
  loading: boolean;
  waiting: NeedRow[];
  /** Null when GitHub could not be read: nothing is said about them. */
  recent: RecentChange[] | null;
  figures: GlanceFigure[];
  /** GitHub could not be read. */
  failed: string | null;
  /** Offer the team launcher (the hosted site, where other teams open). */
  launcher: boolean;
  /** Opens "Make it yours" (no action: from Connect your design system). */
  onConnect: () => void;
}

/** The review drawing without its empty sky, as on the signed-in home. */
const REVIEW_CROP = '0 98 232 86';

function Glance({ figures }: { figures: GlanceFigure[] }) {
  return (
    <section className="sh-section" aria-labelledby="dh-glance">
      <header className="sh-section-head">
        <div className="sh-section-title">
          <h2 id="dh-glance" className="sh-h2">
            {DEMO_WORDS.glance}
          </h2>
        </div>
      </header>
      <ul className="dh-figs">
        {figures.map((f) => (
          <li key={f.id}>
            <Card interactive padding="compact" className="dh-fig-card">
              <CardBody className={f.tone === 'fail' ? 'dh-fig is-fail' : 'dh-fig'}>
                <span className="dh-fig-value">{f.value}</span>
                <Link href={f.href} variant="subtle" className="t-ui dh-fig-label" data-card-primary>
                  {f.label}
                </Link>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recent({ recent, loading }: { recent: RecentChange[]; loading: boolean }) {
  if (!loading && !recent.length) return null;
  return (
    <section className="sh-section" aria-labelledby="dh-recent" aria-busy={loading || undefined}>
      <header className="sh-section-head">
        <div className="sh-section-title">
          <h2 id="dh-recent" className="sh-h2">
            {DEMO_WORDS.recent}
          </h2>
          <p className="t-body t-muted sh-section-sub">{DEMO_WORDS.recentSub}</p>
        </div>
      </header>
      {loading ? (
        <Skeleton variant="rect" className="sh-skel" />
      ) : (
        <ul className="sh-rows" aria-label={DEMO_WORDS.recent}>
          {recent.map((r) => (
            <BranchRow key={r.number} thumb={{ kind: 'icon', icon: 'branch' }} who={<Who p={r.person} />} title={r.title} href={r.href} line={r.line} pill={{ label: 'Merged', tone: 'success' }} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function DemoHome(p: DemoHomeProps) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherId = `${useId()}-launcher`;
  const shown = p.waiting.slice(0, NEEDS_SHOWN);
  const more = p.waiting.length - shown.length;
  return (
    <div className="sh dh">
      <section className="zone sh-zone" aria-labelledby="sh-hello" aria-busy={p.loading || undefined}>
        <div className="sh-head">
          <div className="sh-head-text">
            <h1 id="sh-hello" className="sh-hello">
              {DEMO_WORDS.hello}
            </h1>
            <p className="t-body">{DEMO_WORDS.line}</p>
            <div className="dh-actions">
              <Button variant="primary" iconEnd={ArrowRight} onClick={p.onConnect}>
                {DEMO_WORDS.connect}
              </Button>
              <Button variant="secondary" iconStart={Plus} data-demo-write="create branches">
                {VOCAB.createBranch}
              </Button>
              {p.launcher && (
                <Button variant="link" iconEnd={launcherOpen ? ChevronUp : ChevronDown} aria-expanded={launcherOpen} aria-controls={launcherId} onClick={() => setLauncherOpen(!launcherOpen)}>
                  {DEMO_WORDS.launcherToggle}
                </Button>
              )}
            </div>
          </div>
          <Drawing name="review" width={220} crop={REVIEW_CROP} className="sh-art" />
        </div>
        {p.launcher && (
          <div id={launcherId} className="dh-launcher" hidden={!launcherOpen}>
            {launcherOpen && <TeamLauncher />}
          </div>
        )}
        <p className="t-body">
          <b className="sh-strong">{p.loading ? 'Checking what waits for a review.' : p.failed ? p.failed : demoWaitingLine(p.waiting.filter((r) => r.kind !== 'guidance').length, p.waiting.filter((r) => r.kind === 'guidance').length)}</b>
        </p>
        {p.loading ? (
          <ul className="sh-rows" aria-hidden="true">
            <li className="sh-row-item">
              <Skeleton variant="rect" className="sh-skel" />
            </li>
          </ul>
        ) : (
          shown.length > 0 && <NeedList rows={shown} label="Waiting for a review" />
        )}
        {more > 0 && (
          <div className="sh-more">
            <p className="t-body sh-more-text">
              <b className="sh-strong">{more} more</b>
            </p>
            <ButtonLink variant="secondary" href={studioHref('changes/')} className="sh-more-btn">
              {DEMO_WORDS.seeAll}
            </ButtonLink>
          </div>
        )}
      </section>
      {p.figures.length > 0 && <Glance figures={p.figures} />}
      {p.recent && <Recent recent={p.recent} loading={p.loading} />}
    </div>
  );
}

/** Mounts the demo home into `el` once; later calls repaint it. */
export function paintDemoHome(el: HTMLElement, props: DemoHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<DemoHome {...props} />);
  return r;
}
