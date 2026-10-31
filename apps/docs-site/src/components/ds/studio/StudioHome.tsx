// The Studio home, direction D (lib/home-model.ts holds the rules and the words). Mounted by pages/studio/index.astro.
//   - The Harbor zone: the greeting, who waits on the viewer and for how long, the Needs you rows (one row component,
//     the whole row is the link), the grouped row with the one primary action "Review all", and a tertiary hint.
//   - One muted health line under the zone.
//   - Your explorations (lib/home-explorations.ts): the product screens tried with Claude AI, each card the explored
//     screen, "Start an exploration" as the first card. Library changes are not cards here: they wait in the review
//     queue for reviewers, live on Changes, and their author gets one line under the section ("Your changes").
//   - Nothing at all: three ways to start, each with its drawing, and the explorations' own empty state.
//   - Someone without a review right (`contributor`): only what waits on them (their branches sent back with changes),
//     never the review queue, and on the first visit a two-step tour of their explorations and how to start (HomeTour.tsx).
// NeedList is shared with the review queue (pages/studio/review.astro), so a row reads the same in both places.
// Admins also get join requests (board E7b, scripts/team-home.ts): one row per person, Decline and Approve inline while
// 3 things or fewer wait; more than that, it folds into "N more" like any row and Review all leads there.
import { createRoot, type Root } from 'react-dom/client';
import { useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Who } from './faces';
import { Alert, AvatarGroup, Badge, Button, Card, CardBody, Icon, Link, Skeleton, ToastProvider } from '@bridge-ds/react';
import { ExplorationCardItem, ProductFolders } from './ExplorationCards';
import { Drawing } from './Drawing';
import { QuietScene } from './QuietScene';
import StartExploration from './StartExploration';
import { BuildLine } from './BuildLine';
import ButtonLink from '../ButtonLink';
import {
  AVATARS_SHOWN,
  contributorTourSteps,
  moreNeedsAction,
  contributorTour,
  type ContributorTourAt,
  SEP,
  hintSnoozed,
  oldestLabel,
  onlyReviewerLine,
  splitNeeds,
  uniquePeople,
  waitingSentence,
  type BranchCard,
  type HomeState,
  type NeedRow,
  type Person,
} from '../../../lib/home-model';
import { explorationsFor, libraryChangesLine, YOUR_CHANGES_HREF, type ExplorationCard } from '../../../lib/home-explorations';
import { studioHref } from '../../../lib/team-path';
import { productFolders } from '../../../lib/product-page';
import { siteConfig } from '../../../scripts/repo-context';
import { productsOf, type ProductConfig } from '@bridge-ds/core';
import { demoTour, demoWaiting, tourSteps, type TourAt } from '../../../lib/demo';
import { useNarrow, useTour } from './HomeTour';

// The rows of the queue (NeedList) and Approve and Decline on a join request live in NeedRows.tsx, shared with
// Settings > Members and the home of a team with no design system yet (JoinRequests.tsx).
export { NeedList, NeedRowItem, type JoinHandlers, type JoinOutcome } from './NeedRows';
import { NeedList, type JoinHandlers } from './NeedRows';


/**
 * "Ann, Dana, Claude AI and 6 others are waiting on you." with their avatars and the oldest wait. On the demo (`lead`),
 * the visitor sits in the lead's seat: "8 changes need your review. Ann and Claude AI are waiting on Dana, who leads
 * this design system." (lib/demo.ts demoWaiting), the lead left out of the people.
 */
function Waiting({ needs, now, lead }: { needs: NeedRow[]; now: number; lead?: Person | null }) {
  const people = uniquePeople(needs.filter((r) => r.waitsOnYou).map((r) => r.person)).filter((p) => !lead || p.agent || p.login.toLowerCase() !== lead.login.toLowerCase());
  const s = waitingSentence(people);
  const oldest = oldestLabel(needs, now);
  const demo = lead !== undefined ? demoWaiting(needs.filter((r) => r.kind === 'review').length, s, lead?.name ?? null, needs.filter((r) => r.kind === 'guidance').length) : null;
  if (!s && !demo) return null;
  // A div, not a p: the avatar group is a block (a div inside a p is invalid HTML).
  return (
    <div className="t-body sh-waiting">
      {people.length > 0 && (
        <AvatarGroup aria-label={lead === null ? 'Waiting for review' : 'Waiting on you'} max={AVATARS_SHOWN} size="md" className="sh-stack">
          {people.map((p) => (
            <Who key={p.agent ? '#agent' : p.login} p={p} name={p.name} decorative={false} />
          ))}
        </AvatarGroup>
      )}
      {demo ? (
        <span>
          <b className="sh-strong">{demo.count}</b>
          {demo.rest}
        </span>
      ) : (
        <span>
          <b className="sh-strong">{s!.names}</b>
          {s!.rest}
        </span>
      )}
      {oldest && (
        <Badge tone="warning" size="md" className="sh-oldest">
          {oldest}
        </Badge>
      )}
    </div>
  );
}

const HINT_KEY = 'bridge.home.only-reviewer.snoozed';

function readSnooze(): number | null {
  try {
    const v = Number(localStorage.getItem(HINT_KEY));
    return v ? v : null;
  } catch {
    return null;
  }
}

function OnlyReviewerHint({ needs, snoozed }: { needs: NeedRow[]; snoozed: boolean }) {
  const [hidden, setHidden] = useState(snoozed);
  const line = onlyReviewerLine(needs);
  if (!line || hidden) return null;
  const notNow = () => {
    try {
      localStorage.setItem(HINT_KEY, String(Date.now()));
    } catch {
      /* private mode: the hint comes back on the next visit */
    }
    setHidden(true);
  };
  return (
    <p className="t-ui t-muted sh-hint">
      <span>{line.text}</span>
      <Link href={studioHref('settings/#roles')}>Add a reviewer</Link>
      <Button variant="ghost" size="sm" onClick={notNow}>
        Not now
      </Button>
    </p>
  );
}

function Needs({ needs, now, snoozed, demo, tour, join, contributor }: { needs: NeedRow[]; now: number; snoozed: boolean; demo?: boolean; tour?: StudioHomeProps['tour']; join?: JoinHandlers; contributor?: boolean }) {
  const { shown, more } = splitNeeds(needs);
  const moreAction = moreNeedsAction(Boolean(contributor) && !demo);
  // On a phone the rows can fill the first screen: the first step sits above them, in view where the page opens (a
  // card in the flow, HomeTour.tsx). On a wide screen it floats under the rows it talks about.
  const narrow = useNarrow();
  return (
    <>
      {narrow && tour?.('rows')}
      {/* One item: its button is the page's primary. Two or three: secondary buttons. More: no row buttons, each row is
          its own link and "Review all" acts, the demo included. */}
      <NeedList rows={shown} compact action={more ? undefined : shown.length === 1 ? 'primary' : 'secondary'} join={join} />
      {!narrow && tour?.('rows')}
      {more && (
        <div className="sh-more">
          <p className="t-body sh-more-text">
            <b className="sh-strong">{more.label}</b>
            {more.parts && (
              <span className="t-muted">
                {SEP}
                {more.parts}
              </span>
            )}
          </p>
          {/* A reviewer: the Review page, the one queue, the same rows as this list (the demo lead's included). Someone
              without a review right: their own work on Changes (only reviewers get the review queue). */}
          <ButtonLink variant="primary" href={studioHref(moreAction.path)} className="sh-more-btn">
            {moreAction.label}
          </ButtonLink>
        </div>
      )}
      {more && tour?.('more')}
      {!demo && <OnlyReviewerHint needs={needs} snoozed={snoozed} />}
    </>
  );
}

export interface HomeComponent {
  name: string;
  slug: string;
  family?: string;
}

/** Exploration cards in one row on a wide screen (board D1): "Start an exploration" and three cards. */
export const EXPLORATION_CARDS = 3;

/** The one sentence of the section when there is no exploration yet. */
export const EXPLORE_LINE = 'Try a product screen with Claude AI. Bridge spots what the library does not have, and what works goes to review.';

/**
 * "Your explorations": the product screens tried with Claude AI, the promise of the product. "Start an exploration"
 * first, like "+ New" in Figma's file browser (the slot never moves), then the first cards and "See all N". None yet:
 * the drawing, one sentence and the one button. Library changes are not here: they wait in the review queue for
 * reviewers, and live on Changes (the "Your changes" line under this section, for their author).
 */
function Explorations({
  explorations,
  components,
  title,
  seeAll,
  tour,
}: {
  explorations: ExplorationCard[];
  components: HomeComponent[];
  title: string;
  seeAll: string;
  tour?: StudioHomeProps['tour'];
}) {
  const narrow = useNarrow();
  const shown = explorations.slice(0, EXPLORATION_CARDS);
  return (
    <section className="sh-section" aria-labelledby="sh-explorations">
      <header className="sh-section-head">
        <h2 id="sh-explorations" className="sh-h2">
          {title}
        </h2>
        {explorations.length > EXPLORATION_CARDS && <Link href={seeAll}>See all {explorations.length}</Link>}
      </header>
      {/* On a phone the step is a card in the flow, before the cards; on a wide screen it floats under them, so it never
          covers the first card ("Start an exploration"). */}
      {narrow && tour?.('branches')}
      {explorations.length ? (
        <ul className="sh-cards">
          {/* On the demo too: its button carries data-demo-write, so a visitor gets the demo's sign-in dialog
              (scripts/demo-gate.ts). */}
          <li className="sh-card-item sh-create">
            <StartExploration components={components} appearance="card" />
          </li>
          {shown.map((c) => (
            <ExplorationCardItem key={c.key ?? c.number} c={c} />
          ))}
        </ul>
      ) : (
        <div className="sh-explore-empty">
          <Drawing name="paint" width={88} />
          <p className="t-body sh-explore-empty-text">{EXPLORE_LINE}</p>
          <StartExploration components={components} appearance="button" />
        </div>
      )}
      {!narrow && tour?.('branches')}
      {tour?.('start')}
    </section>
  );
}

/** "You have 2 library changes in progress. See your changes": the author's library changes, on Changes. */
function YourChanges({ n }: { n: number }) {
  const line = libraryChangesLine(n);
  if (!line) return null;
  return (
    <p className="t-ui t-muted sh-health">
      <span>{line}</span>
      <Link href={YOUR_CHANGES_HREF()}>See your changes</Link>
    </p>
  );
}

export interface HealthLine {
  /** Danger rows live in Needs you; this line only says it is healthy, or names an adoption drop. */
  text: string;
  tone: 'ok' | 'drop';
  href: string;
  link: string;
}

function Health({ h }: { h: HealthLine }) {
  return (
    <p className="t-ui t-muted sh-health">
      <Icon icon={h.tone === 'ok' ? CircleCheck : CircleAlert} size="sm" />
      <span>{h.text}</span>
      <Link href={h.href}>{h.link}</Link>
    </p>
  );
}

/**
 * The status line under the Harbor zone: the library's health ("Library healthy. Open Quality") and, while setup steps
 * are left, "7 of 8 connected" with its checklist, in the same quiet voice. Neither competes with the greeting.
 */
function Status({ health, setup }: { health: HealthLine | null; setup?: ReactNode }) {
  if (!health && !setup) return null;
  return (
    <div className="sh-status" data-home-status="">
      {health && <Health h={health} />}
      {setup && <div className="sh-setup">{setup}</div>}
    </div>
  );
}

/** The team's products (bridge.config.json), as this page knows them. */
function pageProducts(): ProductConfig[] {
  try {
    return productsOf(siteConfig() as { products?: ProductConfig[] });
  } catch {
    return productsOf(null);
  }
}

const CHOICES = [
  { drawing: 'tokens', title: 'Edit tokens', line: 'A color, a spacing, a radius. See every place it shows before you send it.', key: 'tokens' },
  { drawing: 'components', title: 'Ask for a component change', line: 'Describe what is missing or wrong. A developer builds it with Claude, the owner decides.', key: 'component' },
  { drawing: 'guide', title: 'Write usage guidance', line: 'When to use a component, and when not to.', key: 'guidance' },
] as const;

/** The first way to start, before the library ones: an exploration, through the start flow (StartExploration). */
const EXPLORE_CHOICE = 'Try a product screen with Claude AI. Bridge shows what the library does not have yet.';

function Start({ hrefs, components }: { hrefs: Record<(typeof CHOICES)[number]['key'], string>; components: HomeComponent[] }) {
  return (
    <ul className="sh-choices" aria-label="Ways to start">
      <li>
        <Card interactive className="sh-choice">
          <CardBody className="sh-choice-body">
            <Drawing name="paint" width={104} />
            <StartExploration components={components} appearance="choice" />
            <span className="t-ui t-muted">{EXPLORE_CHOICE}</span>
          </CardBody>
        </Card>
      </li>
      {CHOICES.map((c) => (
        <li key={c.key}>
          <Card interactive className="sh-choice">
            <CardBody className="sh-choice-body">
              <Drawing name={c.drawing} width={104} />
              <Link href={hrefs[c.key]} variant="subtle" data-card-primary>
                <span className="sh-choice-title">{c.title}</span>
              </Link>
              <span className="t-ui t-muted">{c.line}</span>
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export interface StudioHomeProps {
  state: HomeState;
  /** Once, right after Entry opened a team the person just joined: "You joined Acme Design." */
  note?: string | null;
  greeting: string;
  needs: NeedRow[];
  /** The viewer's own library changes and suggestions: counted in one line under the explorations, listed on Changes. */
  branches: BranchCard[];
  /**
   * The team's explorations (lib/home-explorations), each marked `own`: a lead or reviewer sees them all under
   * "Explorations", a contributor only their own under "Your explorations" (home by role). The demo: the team's.
   */
  explorations: ExplorationCard[];
  health: HealthLine | null;
  /** Show the calm Being built line under the zone (BuildLine): what developers build from Figma, never a Needs you row. */
  building?: boolean;
  now: number;
  components: HomeComponent[];
  /** Signed out: the line and the button label (Sign in with GitHub, or Connect GitHub). */
  signedOut: { line: string; button: string; signIn: boolean };
  /** GitHub could not be read. */
  failed: string | null;
  startHrefs: Record<'tokens' | 'component' | 'guidance', string>;
  /**
   * Signed in with setup steps left: "4 of 8 connected" and its checklist (Onboarding.tsx), on the status line under
   * the Harbor zone, next to the library's health: out of the greeting, which keeps the zone for what needs you.
   */
  setup?: ReactNode;
  /** bridge.config.json products, for the product folders under the explorations. Absent: the page's (repo-context). */
  products?: ProductConfig[];
  /**
   * The demo for a visitor (DemoHome.tsx, boards D1 and D1b): the same home from the DS lead's seat. `lead` names
   * them in the waiting line; each row keeps its Review button; "Review all" opens the Review page; the team's
   * explorations under their own title. Always the busy layout.
   */
  demo?: { lead: Person | null; explorationsTitle: string };
  /** The demo tour's popovers, anchored where each step points: under the rows, the grouped row, the explorations. */
  tour?: (at: HomeTourAt) => ReactNode;
  /**
   * The viewer holds no review right (an email contributor, or a member no owner list names): the needs are only
   * their branches sent back with changes, and the contributor tour runs on the first visit.
   */
  contributor?: boolean;
  /**
   * A lead of the team: a reviewer, or an admin (an email admin included, who manages without GitHub). They get the
   * lead tour on the first visit (the rows that wait on the lead, the whole queue, the branches), never the
   * contributor's.
   */
  lead?: boolean;
  /** Admins: Approve and Decline on join requests (board E7b). */
  join?: JoinHandlers;
}

/** Where a tour step can point: the demo's (lib/demo TourAt) and the contributor's ("start", the ways to start). */
export type HomeTourAt = TourAt | ContributorTourAt;

const CONTRIBUTOR_TOUR_KEY = 'bridge.home.contributor-tour';
const LEAD_TOUR_KEY = 'bridge.home.lead-tour';

/** The review drawing without its empty sky: the scene only, so it never makes the greeting taller than its text. */
const REVIEW_CROP = '0 98 232 86';

/** The Harbor zone's line when nothing waits on the viewer: honest first, then the calm. */
export const QUIET_LINE = 'Nothing needs you. The harbor is calm.';

/** "You joined Acme Design.": said once, dismissible. */
function JoinedNote({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <Alert tone="success" className="sh-note" onDismiss={() => setOpen(false)}>
      {text}
    </Alert>
  );
}

export function StudioHome(p: StudioHomeProps) {
  // The toasts of the home: a join request approved or declined, with Undo.
  return (
    <ToastProvider limit={2}>
      <HomeBody {...p} />
    </ToastProvider>
  );
}

function HomeBody(p: StudioHomeProps) {
  const snoozed = hintSnoozed(readSnooze(), p.now);
  const own = useTour<ContributorTourAt>(CONTRIBUTOR_TOUR_KEY, contributorTourSteps(p.state === 'empty'), (at) => contributorTour(at, p.state === 'empty'), Boolean(p.contributor) && !p.demo && (p.state === 'busy' || p.state === 'empty'));
  // The lead's tour speaks of changes: rows that are only join requests (or a health note) are not what it shows. Its
  // first step points at the rows on screen, so it runs only when they hold a change; changes folded under "N more"
  // get the Review all step alone.
  const isChange = (r: NeedRow) => r.kind === 'review' || r.kind === 'guidance';
  const changeRows = p.needs.some(isChange);
  const split = splitNeeds(p.needs);
  const byRole = explorationsFor(p.explorations, Boolean(p.contributor) && !p.demo);
  const leadSteps = tourSteps({ rows: split.shown.some(isChange), more: changeRows && Boolean(split.more), branches: byRole.cards.length > 0 });
  const lead = useTour<TourAt>(LEAD_TOUR_KEY, leadSteps, (at) => demoTour(at), Boolean(p.lead) && !p.contributor && !p.demo && p.state === 'busy' && leadSteps.length > 0);
  const tour: StudioHomeProps['tour'] =
    p.tour ??
    (p.contributor
      ? (at) => (at === 'branches' || at === 'start' ? own(at) : null)
      : p.lead && !p.demo
        ? (at) => (at === 'rows' || at === 'more' || at === 'branches' ? lead(at) : null)
        : undefined);
  const explorations = (
    <Explorations
      explorations={byRole.cards}
      components={p.components}
      title={p.demo?.explorationsTitle ?? byRole.title}
      // The demo shows the team's: all of them on Changes.
      seeAll={p.demo ? studioHref('changes/') : byRole.seeAll}
      tour={tour}
    />
  );
  if (p.state === 'signed-out' && !p.demo) {
    return (
      <div className="sh">
        <section className="zone sh-zone" aria-labelledby="sh-hello">
          <div className="sh-head">
            <div className="sh-head-text">
              <h1 id="sh-hello" className="sh-hello">
                {p.greeting}
              </h1>
              <p className="t-body">{p.signedOut.line}</p>
              <span className="sh-connect">
                <Button variant="primary" className="sh-connect-btn" data-gh-open data-gh-signin={p.signedOut.signIn ? '' : undefined}>
                  {p.signedOut.button}
                </Button>
              </span>
            </div>
            <Drawing name="review" width={220} crop={REVIEW_CROP} className="sh-art" />
          </div>
        </section>
      </div>
    );
  }
  const note = p.note ? <JoinedNote text={p.note} /> : null;
  if (p.state === 'empty' && !p.demo) {
    return (
      <div className="sh">
        {note}
        <section className="zone sh-zone sh-zone-empty" aria-labelledby="sh-hello">
          <div className="sh-head-text">
            <p className="t-body">
              {p.greeting} Nothing needs you{p.failed ? '' : ', and you have nothing in progress'}.
            </p>
            <h1 id="sh-hello" className="sh-hello">
              What do you want to change?
            </h1>
          </div>
          {tour?.('branches')}
          <Start hrefs={p.startHrefs} components={p.components} />
          {tour?.('start')}
        </section>
        {p.failed && <p className="t-ui t-muted sh-health">{p.failed}</p>}
        <Status health={p.health} setup={p.setup} />
        {p.building && <BuildLine />}
      </div>
    );
  }
  const loading = p.state === 'loading';
  const quiet = !loading && p.needs.length === 0;
  return (
    <div className="sh">
      {note}
      <section className={`zone sh-zone${quiet ? ' sh-zone-quiet' : ''}`} aria-labelledby="sh-hello" aria-busy={loading || undefined}>
        {/* Nothing waits: the zone becomes a window onto a calm harbor, not an empty box (on a phone, only the water). */}
        {quiet && <QuietScene scene="harbor" layout="window" />}
        <div className="sh-head">
          <div className="sh-head-text">
            <h1 id="sh-hello" className="sh-hello">
              {p.greeting}
            </h1>
            {loading ? <p className="t-body">Checking what needs you.</p> : p.needs.some((r) => r.waitsOnYou) ? <Waiting needs={p.needs} now={p.now} lead={p.demo ? p.demo.lead : undefined} /> : <p className="t-body">{p.needs.length ? 'Your changes need you.' : QUIET_LINE}</p>}
          </div>
        </div>
        {loading ? (
          <>
            {/* Join requests come from Bridge, not GitHub: they show while the rest still loads. */}
            {p.needs.some((r) => r.kind === 'join') && <Needs needs={p.needs.filter((r) => r.kind === 'join')} now={p.now} snoozed={snoozed} join={p.join} />}
            <ul className="sh-rows" aria-hidden="true">
              <li className="sh-row-item">
                <Skeleton variant="rect" className="sh-skel" />
              </li>
            </ul>
          </>
        ) : (
          p.needs.length > 0 && <Needs needs={p.needs} now={p.now} snoozed={snoozed} demo={Boolean(p.demo)} tour={tour} join={p.join} contributor={Boolean(p.contributor)} />
        )}
      </section>
      {p.failed && <p className="t-ui t-muted sh-health">{p.failed}</p>}
      <Status health={p.health} setup={p.setup} />
      {p.building && <BuildLine />}
      {(byRole.cards.length > 0 || !loading) && explorations}
      {!p.demo && !loading && <YourChanges n={p.branches.length} />}
      {/* The products, like project folders in Figma: each opens its page, with the explorations made in it. */}
      {!loading && <ProductFolders folders={productFolders(p.products ?? pageProducts(), byRole.cards)} />}
    </div>
  );
}

/** Mounts the home into `el` once; later calls repaint it. */
export function paintStudioHome(el: HTMLElement, props: StudioHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<StudioHome {...props} />);
  return r;
}
