// The Studio home, direction D (lib/home-model.ts holds the rules and the words). Mounted by pages/studio/index.astro.
//   - The Harbor zone: the greeting, who waits on the viewer and for how long, the Needs you rows (one row component,
//     the whole row is the link), the grouped row with the one primary action "Review all", and a tertiary hint.
//   - One muted health line under the zone.
//   - Your branches: open branches as cards, a status filter, "Create branch" as the first card.
//   - Nothing at all: three ways to start, each with its drawing.
//   - Someone without a review right (`contributor`): only what waits on them (their branches sent back with changes),
//     never the review queue, and on the first visit a two-step tour of their branches and how to start (HomeTour.tsx).
// NeedList is shared with the review queue (pages/studio/review.astro), so a row reads the same in both places.
// Admins also get join requests (board E7b, scripts/team-home.ts): one row per person, Decline and Approve inline while
// 3 things or fewer wait; more than that, it folds into "N more" like any row and Review all leads there.
import { createRoot, type Root } from 'react-dom/client';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Check, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { Who } from './faces';
import { Alert, AvatarGroup, Badge, Button, Card, CardBody, Icon, Link, SegmentedControl, Skeleton, ToastProvider, useToast } from '@bridge-ds/react';
import { BranchThumb } from './BranchThumb';
import { BranchRow } from './BranchRow';
import { Drawing } from './Drawing';
import StartChange from './StartChange';
import ButtonLink from '../ButtonLink';
import {
  AVATARS_SHOWN,
  CONTRIBUTOR_TOUR_STEPS,
  contributorTour,
  type ContributorTourAt,
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
import { demoWaiting, type TourAt } from '../../../lib/demo';
import { ENTRY_WORDS } from '../../../lib/entry';
import { useTour } from './HomeTour';

/** What deciding on a join request gave: the line for the toast (`undo`: it can be taken back), or why it did not happen. */
export type JoinOutcome = { ok: true; text: string; undo?: boolean } | { ok: false; github: boolean; text: string };

export interface JoinHandlers {
  /** Approve or decline; on success the row leaves the list at once and the home recounts. */
  decide: (row: NeedRow, approve: boolean) => Promise<JoinOutcome>;
  /** Takes the decision back for a short while: the request waits again. */
  undo?: (row: NeedRow) => Promise<JoinOutcome>;
  /** No GitHub admin account linked: "Connect GitHub to manage requests". */
  connectGitHub: () => void;
}

/** How long the toast offers Undo (the server keeps the decision undoable for 30 seconds). */
const UNDO_MS = 8000;

/** Decline and Approve on a join request. After a decision the row goes and a short toast says what happened, with Undo. */
function JoinActions({ row, join }: { row: NeedRow; join: JoinHandlers }) {
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [out, setOut] = useState<JoinOutcome | null>(null);
  const toast = useToast();
  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'decline');
    const o = await join.decide(row, approve);
    if (o.ok) {
      const undo = join.undo;
      toast.add({
        title: o.text,
        tone: o.undo ? 'success' : 'neutral',
        timeout: o.undo && undo ? UNDO_MS : undefined,
        action:
          o.undo && undo
            ? {
                label: ENTRY_WORDS.undo,
                onClick: () => {
                  void undo(row).then((u) => (u.ok ? toast.add({ title: u.text, tone: 'neutral' }) : toast.add({ title: u.text || ENTRY_WORDS.githubToManage, tone: 'danger' })));
                },
              }
            : undefined,
      });
      return;
    }
    setOut(o);
    setBusy(null);
  };
  if (out && !out.ok && out.github)
    return (
      <span className="sh-join">
        <Button variant="link" onClick={join.connectGitHub}>
          {ENTRY_WORDS.githubToManage}
        </Button>
      </span>
    );
  const who = row.request?.name ?? row.title;
  return (
    <span className="sh-join">
      {out && !out.ok && (
        <span className="t-ui t-muted" role="status">
          {out.text}
        </span>
      )}
      <Button variant="secondary" loading={busy === 'decline'} disabled={Boolean(busy)} aria-label={`${ENTRY_WORDS.decline} ${who}`} onClick={() => void decide(false)}>
        {ENTRY_WORDS.decline}
      </Button>
      <Button variant="primary" loading={busy === 'approve'} disabled={Boolean(busy)} aria-label={`${ENTRY_WORDS.approve} ${who}`} onClick={() => void decide(true)}>
        {ENTRY_WORDS.approve}
      </Button>
    </span>
  );
}

/** One Needs you row: before/after, who, what and why, the status on the right (the shared BranchRow). */
export function NeedRowItem({ row, selected, onSelect, action, compact, join }: { row: NeedRow; selected?: boolean; onSelect?: (row: NeedRow) => void; action?: 'primary' | 'secondary'; compact?: boolean; join?: JoinHandlers }) {
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
      detail={row.detail}
      end={
        action && row.kind === 'join' && join ? (
          <JoinActions row={row} join={join} />
        ) : (
          action && (
          <ButtonLink variant={action} href={row.href} className="sh-row-action" tabIndex={-1} aria-hidden="true">
            {rowAction(row.kind, row.action)}
          </ButtonLink>
          )
        )
      }
    />
  );
}

export function NeedList({ rows, selectedKey, onSelect, label = 'Needs you', action, compact, join }: { rows: NeedRow[]; selectedKey?: string | null; onSelect?: (row: NeedRow) => void; label?: string; action?: 'primary' | 'secondary'; compact?: boolean; join?: JoinHandlers }) {
  return (
    <ul className="sh-rows" aria-label={label}>
      {rows.map((r) => (
        <NeedRowItem key={r.key} row={r} selected={selectedKey === r.key} onSelect={onSelect} action={action} compact={compact} join={join} />
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

function Needs({ needs, now, snoozed, demo, tour, join }: { needs: NeedRow[]; now: number; snoozed: boolean; demo?: boolean; tour?: StudioHomeProps['tour']; join?: JoinHandlers }) {
  const { shown, more } = splitNeeds(needs);
  return (
    <>
      {/* One item: its button is the page's primary. Two or three: secondary buttons. More: no row buttons, each row is
          its own link and "Review all" acts, the demo included. */}
      <NeedList rows={shown} compact action={more ? undefined : shown.length === 1 ? 'primary' : 'secondary'} join={join} />
      {tour?.('rows')}
      {more && (
        <div className="sh-more">
          <p className="t-body sh-more-text">
            <b className="sh-strong">{more.label}</b>
            {more.parts && <span className="t-muted"> · {more.parts}</span>}
          </p>
          {/* The demo opens Branches on Waiting on me: every change that waits on the lead, by kind and designer. */}
          <ButtonLink variant="primary" href={studioHref(demo ? 'changes/?who=waiting' : 'review/')} className="sh-more-btn">
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
        {/* Create first, like "+ New" in Figma's file browser: the slot never moves as branches come and go. On the demo
            too: its button carries data-demo-write, so a visitor gets the demo's sign-in dialog (scripts/demo-gate.ts). */}
        {create && (
          <li className="sh-card-item sh-create">
            <StartChange components={components} appearance="card" />
          </li>
        )}
        {shown.map((b) => (
          <BranchCardItem key={b.number} b={b} now={now} />
        ))}
      </ul>
      {create && tour?.('start')}
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
  { drawing: 'components', title: 'Ask for a component change', line: 'Describe what is missing or wrong. A developer builds it with Claude, the owner decides.', key: 'component' },
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
  /** Once, right after Entry opened a team the person just joined: "You joined Acme Design." */
  note?: string | null;
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
  tour?: (at: HomeTourAt) => ReactNode;
  /**
   * The viewer holds no review right (an email contributor, or a member no owner list names): the needs are only
   * their branches sent back with changes, and the contributor tour runs on the first visit.
   */
  contributor?: boolean;
  /** Admins: Approve and Decline on join requests (board E7b). */
  join?: JoinHandlers;
}

/** Where a tour step can point: the demo's (lib/demo TourAt) and the contributor's ("start", the ways to start). */
export type HomeTourAt = TourAt | ContributorTourAt;

const CONTRIBUTOR_TOUR_KEY = 'bridge.home.contributor-tour';

/** The review drawing without its empty sky: the scene only, so it never makes the greeting taller than its text. */
const REVIEW_CROP = '0 98 232 86';

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
  const own = useTour<ContributorTourAt>(CONTRIBUTOR_TOUR_KEY, [...CONTRIBUTOR_TOUR_STEPS], contributorTour, Boolean(p.contributor) && !p.demo && (p.state === 'busy' || p.state === 'empty'));
  const tour: StudioHomeProps['tour'] = p.tour ?? (p.contributor ? (at) => (at === 'branches' || at === 'start' ? own(at) : null) : undefined);
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
            {p.setup && <div className="sh-setup">{p.setup}</div>}
            <p className="t-body">
              {p.greeting} Nothing needs you{p.failed ? '' : ', and you have no branch in progress'}.
            </p>
            <h1 id="sh-hello" className="sh-hello">
              What do you want to change?
            </h1>
          </div>
          {tour?.('branches')}
          <Start hrefs={p.startHrefs} />
          {tour?.('start')}
        </section>
        {p.failed && <p className="t-ui t-muted sh-health">{p.failed}</p>}
        {p.health && <Health h={p.health} />}
      </div>
    );
  }
  const loading = p.state === 'loading';
  return (
    <div className="sh">
      {note}
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
          p.needs.length > 0 && <Needs needs={p.needs} now={p.now} snoozed={snoozed} demo={Boolean(p.demo)} tour={tour} join={p.join} />
        )}
      </section>
      {p.failed && <p className="t-ui t-muted sh-health">{p.failed}</p>}
      {p.health && <Health h={p.health} />}
      {(p.branches.length > 0 || !loading) && <Branches branches={p.branches} now={p.now} components={p.components} title={p.demo?.branchesTitle} sub={p.demo ? null : undefined} max={p.demo?.branchesMax} tour={tour} />}
    </div>
  );
}

/** Mounts the home into `el` once; later calls repaint it. */
export function paintStudioHome(el: HTMLElement, props: StudioHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<StudioHome {...props} />);
  return r;
}
