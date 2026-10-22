// The Studio home, direction D (lib/home-model.ts holds the rules and the words). Mounted by pages/studio/index.astro.
//   - The Harbor zone: the greeting, who waits on the viewer and for how long, the Needs you rows (one row component,
//     the whole row is the link), the grouped row with the one primary action "Review all", and a tertiary hint.
//   - One muted health line under the zone.
//   - Your branches: open branches as cards, a status filter, "Create branch" as the first card.
//   - Nothing at all: three ways to start, each with its drawing.
// NeedList is shared with the review queue (pages/studio/review.astro), so a row reads the same in both places.
import { createRoot, type Root } from 'react-dom/client';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Check, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { Who } from './faces';
import { AvatarGroup, Badge, Button, Card, CardBody, Icon, Link, SegmentedControl, Skeleton } from '@bridge-ds/react';
import { BranchThumb } from './BranchThumb';
import { BranchRow } from './BranchRow';
import { Drawing } from './Drawing';
import StartChange from './StartChange';
import ButtonLink from '../ButtonLink';
import {
  AVATARS_SHOWN,
  BRANCH_FILTERS,
  branchStatus,
  hintSnoozed,
  oldestLabel,
  onlyReviewerLine,
  showsBranch,
  sortBranches,
  rowAction,
  splitNeeds,
  uniquePeople,
  waitingSentence,
  type BranchCard,
  type BranchFilter,
  type HomeState,
  type NeedRow,
  type Person,
} from '../../../lib/home-model';
import { VOCAB } from '../../../lib/vocabulary';
import { studioHref } from '../../../lib/team-path';
import { demoWaiting } from '../../../lib/demo';

/** One Needs you row: before/after, who, what and why, the status on the right (the shared BranchRow). */
export function NeedRowItem({ row, selected, onSelect, action, compact }: { row: NeedRow; selected?: boolean; onSelect?: (row: NeedRow) => void; action?: 'primary' | 'secondary'; compact?: boolean }) {
  const click = onSelect
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onSelect(row);
      }
    : undefined;
  return (
    <BranchRow
      thumb={row.thumb}
      who={row.person ? <Who p={row.person} /> : <span className="sh-row-icon"><Icon icon={row.pill?.tone === 'danger' ? TriangleAlert : Check} size="md" /></span>}
      title={row.title}
      href={row.href}
      onClick={click}
      selected={selected}
      line={row.line}
      pill={row.pill}
      compact={compact}
      tags={row.sample ? <SampleTag /> : undefined}
      end={
        action && (
          <ButtonLink variant={action} href={row.href} className="sh-row-action" tabIndex={-1} aria-hidden="true">
            {rowAction(row.kind)}
          </ButtonLink>
        )
      }
    />
  );
}

/** "Sample": demo data, said on every row and card of the demo so a visitor never takes it for real work. */
export function SampleTag() {
  return (
    <Badge tone="neutral" size="sm" className="sh-sample">
      Sample
    </Badge>
  );
}

export function NeedList({ rows, selectedKey, onSelect, label = 'Needs you', action, compact }: { rows: NeedRow[]; selectedKey?: string | null; onSelect?: (row: NeedRow) => void; label?: string; action?: 'primary' | 'secondary'; compact?: boolean }) {
  return (
    <ul className="sh-rows" aria-label={label}>
      {rows.map((r) => (
        <NeedRowItem key={r.key} row={r} selected={selectedKey === r.key} onSelect={onSelect} action={action} compact={compact} />
      ))}
    </ul>
  );
}

/**
 * "Ann, Dana, Claude AI and 6 others are waiting on you." with their avatars and the oldest wait. On the demo (`lead`),
 * the visitor sits in the lead's seat: "8 changes need your review. Ann and Claude AI are waiting on Dana, who leads
 * this design system." (lib/demo.ts demoWaiting), the lead left out of the people.
 */
function Waiting({ needs, now, lead }: { needs: NeedRow[]; now: number; lead?: Person | null }) {
  const people = uniquePeople(needs.filter((r) => r.waitsOnYou).map((r) => r.person)).filter((p) => !lead || p.agent || p.login.toLowerCase() !== lead.login.toLowerCase());
  const s = waitingSentence(people);
  const oldest = oldestLabel(needs, now);
  const demo = lead !== undefined ? demoWaiting(needs.filter((r) => r.waitsOnYou).length, s, lead?.name ?? null) : null;
  if (!s && !demo) return null;
  return (
    <p className="t-body sh-waiting">
      {people.length > 0 && (
        <AvatarGroup aria-label="Waiting on you" max={AVATARS_SHOWN} size="md" className="sh-stack">
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
    </p>
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

function Needs({ needs, now, snoozed, demo, tour }: { needs: NeedRow[]; now: number; snoozed: boolean; demo?: boolean; tour?: StudioHomeProps['tour'] }) {
  const { shown, more } = splitNeeds(needs);
  return (
    <>
      {/* One item: its button is the page's primary. Two or three: secondary buttons. More: no row buttons, "Review all"
          acts. The demo (board D1b) keeps a Review button on each row, beside "Review all (N)". */}
      <NeedList rows={shown} compact action={demo ? 'secondary' : more ? undefined : shown.length === 1 ? 'primary' : 'secondary'} />
      {tour?.('rows')}
      {more && (
        <div className="sh-more">
          <p className="t-body sh-more-text">
            <b className="sh-strong">{more.label}</b>
            {more.parts && <span className="t-muted"> · {more.parts}</span>}
          </p>
          <ButtonLink variant="primary" href={studioHref('review/')} className="sh-more-btn">
            {demo ? `Review all (${needs.length})` : 'Review all'}
          </ButtonLink>
        </div>
      )}
      {more && tour?.('more')}
      {!demo && <OnlyReviewerHint needs={needs} snoozed={snoozed} />}
    </>
  );
}

function BranchCardItem({ b, now }: { b: BranchCard; now: number }) {
  const s = b.statusLine ?? branchStatus(b, now);
  return (
    <li className="sh-card-item">
      <Card interactive padding="none" className="sh-card">
        <BranchThumb spec={b.thumb} size="card" />
        <div className="sh-card-body">
          <span className="sh-card-head">
            <Link href={b.href} variant="subtle" className="t-body sh-card-title" data-card-primary>
              <span className="sh-strong">{b.title}</span>
            </Link>
            {b.sample && <SampleTag />}
          </span>
          <span className="t-ui t-muted sh-card-status">
            <span className="sh-card-stage">{s.stage}</span> ·{' '}
            {b.stage === 'ready' && b.reviewer && !b.status && !b.statusLine ? (
              <>
                <Who p={b.reviewer} size="xs" /> {s.detail}
              </>
            ) : (
              s.detail
            )}
          </span>
        </div>
      </Card>
    </li>
  );
}

export interface HomeComponent {
  name: string;
  slug: string;
  family?: string;
}

function Branches({
  branches,
  now,
  components,
  title = `Your ${VOCAB.branches}`,
  sub = "Your changes, kept apart from the library until they're merged.",
  create = true,
  max,
  tour,
}: {
  branches: BranchCard[];
  now: number;
  components: HomeComponent[];
  title?: string;
  sub?: string | null;
  create?: boolean;
  /** Show the first `max` only, with "See all N" by the title (the demo, board D1: one row of cards). */
  max?: number;
  tour?: StudioHomeProps['tour'];
}) {
  const [filter, setFilter] = useState<BranchFilter>('all');
  const sorted = sortBranches(branches).filter((b) => showsBranch(filter, b.stage));
  const shown = max ? sorted.slice(0, max) : sorted;
  return (
    <section className="sh-section" aria-labelledby="sh-branches">
      <header className="sh-section-head">
        <div className="sh-section-title">
          <h2 id="sh-branches" className="sh-h2">
            {title}
          </h2>
          {sub && <p className="t-body t-muted sh-section-sub">{sub}</p>}
        </div>
        {max ? (
          branches.length > max && <Link href={studioHref('changes/')}>See all {branches.length}</Link>
        ) : branches.length >= 4 && <SegmentedControl label={`Show ${VOCAB.branches}`} size="md" value={filter} onValueChange={(v) => setFilter(v as BranchFilter)} items={BRANCH_FILTERS} />}
      </header>
      {tour?.('branches')}
      <ul className="sh-cards">
        {/* Create first, like "+ New" in Figma's file browser: the slot never moves as branches come and go. */}
        {create && (
          <li className="sh-card-item sh-create">
            <StartChange components={components} appearance="card" />
          </li>
        )}
        {shown.map((b) => (
          <BranchCardItem key={b.number} b={b} now={now} />
        ))}
      </ul>
    </section>
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

const CHOICES = [
  { drawing: 'tokens', title: 'Edit tokens', line: 'A colour, a spacing, a radius. See every place it shows before you send it.', key: 'tokens' },
  { drawing: 'components', title: 'Ask for a component change', line: 'Describe what is missing or wrong. Claude builds it, the owner decides.', key: 'component' },
  { drawing: 'guide', title: 'Write usage guidance', line: 'When to use a component, and when not to.', key: 'guidance' },
] as const;

function Start({ hrefs }: { hrefs: Record<(typeof CHOICES)[number]['key'], string> }) {
  return (
    <ul className="sh-choices" aria-label="Ways to start">
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
  greeting: string;
  needs: NeedRow[];
  branches: BranchCard[];
  health: HealthLine | null;
  now: number;
  components: HomeComponent[];
  /** Signed out: the line and the button label (Sign in with GitHub, or Connect GitHub). */
  signedOut: { line: string; button: string; signIn: boolean };
  /** GitHub could not be read. */
  failed: string | null;
  startHrefs: Record<'tokens' | 'component' | 'guidance', string>;
  /** Signed in with setup steps left: "4 of 6 connected" and its checklist (Onboarding.tsx), by the greeting. */
  setup?: ReactNode;
  /**
   * The demo for a visitor (DemoHome.tsx, boards D1 and D1b): the same home from the DS lead's seat. `lead` names
   * them in the waiting line; each row keeps its Review button; "Review all (N)"; the team's branches under their own
   * title, without Create branch. Always the busy layout.
   */
  demo?: { lead: Person | null; branchesTitle: string; branchesMax: number };
  /** The demo tour's popovers, anchored where each step points: under the rows, the grouped row, the branches. */
  tour?: (at: 'rows' | 'more' | 'branches') => ReactNode;
}

/** The review drawing without its empty sky: the scene only, so it never makes the greeting taller than its text. */
const REVIEW_CROP = '0 98 232 86';

export function StudioHome(p: StudioHomeProps) {
  const snoozed = hintSnoozed(readSnooze(), p.now);
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
  if (p.state === 'empty' && !p.demo) {
    return (
      <div className="sh">
        <section className="zone sh-zone sh-zone-empty" aria-labelledby="sh-hello">
          <div className="sh-head-text">
            {p.setup && <div className="sh-setup">{p.setup}</div>}
            <p className="t-body">
              {p.greeting} Nothing needs you{p.failed ? '' : ', and you have no branch in progress'}.
            </p>
            <h1 id="sh-hello" className="sh-hello">
              What do you want to change?
            </h1>
          </div>
          <Start hrefs={p.startHrefs} />
        </section>
        {p.failed && <p className="t-ui t-muted sh-health">{p.failed}</p>}
        {p.health && <Health h={p.health} />}
      </div>
    );
  }
  const loading = p.state === 'loading';
  return (
    <div className="sh">
      <section className="zone sh-zone" aria-labelledby="sh-hello" aria-busy={loading || undefined}>
        <div className="sh-head">
          <div className="sh-head-text">
            <div className="sh-hello-row">
              <h1 id="sh-hello" className="sh-hello">
                {p.greeting}
              </h1>
              {p.setup && <div className="sh-setup">{p.setup}</div>}
            </div>
            {loading ? <p className="t-body">Checking what needs you.</p> : p.needs.some((r) => r.waitsOnYou) ? <Waiting needs={p.needs} now={p.now} lead={p.demo ? p.demo.lead : undefined} /> : <p className="t-body">{p.needs.length ? 'Your branches need you.' : 'Nothing needs you.'}</p>}
          </div>
          <Drawing name="review" width={220} crop={REVIEW_CROP} className="sh-art" />
        </div>
        {loading ? (
          <ul className="sh-rows" aria-hidden="true">
            <li className="sh-row-item">
              <Skeleton variant="rect" className="sh-skel" />
            </li>
          </ul>
        ) : (
          p.needs.length > 0 && <Needs needs={p.needs} now={p.now} snoozed={snoozed} demo={Boolean(p.demo)} tour={p.tour} />
        )}
      </section>
      {p.failed && <p className="t-ui t-muted sh-health">{p.failed}</p>}
      {p.health && <Health h={p.health} />}
      {(p.branches.length > 0 || !loading) && <Branches branches={p.branches} now={p.now} components={p.components} title={p.demo?.branchesTitle} sub={p.demo ? null : undefined} create={!p.demo} max={p.demo?.branchesMax} tour={p.tour} />}
    </div>
  );
}

/** Mounts the home into `el` once; later calls repaint it. */
export function paintStudioHome(el: HTMLElement, props: StudioHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<StudioHome {...props} />);
  return r;
}
