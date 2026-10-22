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

/** One Needs you row: before/after, who, what and why, the status on the right (the shared BranchRow). */
export function NeedRowItem({ row, selected, onSelect, action }: { row: NeedRow; selected?: boolean; onSelect?: (row: NeedRow) => void; action?: 'primary' | 'secondary' }) {
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

export function NeedList({ rows, selectedKey, onSelect, label = 'Needs you', action }: { rows: NeedRow[]; selectedKey?: string | null; onSelect?: (row: NeedRow) => void; label?: string; action?: 'primary' | 'secondary' }) {
  return (
    <ul className="sh-rows" aria-label={label}>
      {rows.map((r) => (
        <NeedRowItem key={r.key} row={r} selected={selectedKey === r.key} onSelect={onSelect} action={action} />
      ))}
    </ul>
  );
}

/** "Ann, Dana, Claude AI and 6 others are waiting on you." with their avatars and the oldest wait. */
function Waiting({ needs, now }: { needs: NeedRow[]; now: number }) {
  const people = uniquePeople(needs.filter((r) => r.waitsOnYou).map((r) => r.person));
  const s = waitingSentence(people);
  const oldest = oldestLabel(needs, now);
  if (!s) return null;
  return (
    <p className="t-body sh-waiting">
      <AvatarGroup aria-label="Waiting on you" max={AVATARS_SHOWN} size="md" className="sh-stack">
        {people.map((p) => (
          <Who key={p.agent ? '#agent' : p.login} p={p} name={p.name} decorative={false} />
        ))}
      </AvatarGroup>
      <span>
        <b className="sh-strong">{s.names}</b>
        {s.rest}
      </span>
      {oldest && (
        <Badge tone="warning" size="md">
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

function Needs({ needs, now, snoozed }: { needs: NeedRow[]; now: number; snoozed: boolean }) {
  const { shown, more } = splitNeeds(needs);
  return (
    <>
      {/* One item: its button is the page's primary. Two or three: secondary buttons. More: no row buttons, "Review all" acts. */}
      <NeedList rows={shown} action={more ? undefined : shown.length === 1 ? 'primary' : 'secondary'} />
      {more && (
        <div className="sh-more">
          <p className="t-body sh-more-text">
            <b className="sh-strong">{more.label}</b>
            {more.parts && <span className="t-muted"> · {more.parts}</span>}
          </p>
          <ButtonLink variant="primary" href={studioHref('review/')} className="sh-more-btn">
            Review all
          </ButtonLink>
        </div>
      )}
      <OnlyReviewerHint needs={needs} snoozed={snoozed} />
    </>
  );
}

function BranchCardItem({ b, now }: { b: BranchCard; now: number }) {
  const s = branchStatus(b, now);
  return (
    <li className="sh-card-item">
      <Card interactive padding="none" className="sh-card">
        <BranchThumb spec={b.thumb} size="card" />
        <div className="sh-card-body">
          <Link href={b.href} variant="subtle" className="t-body sh-card-title" data-card-primary>
            <span className="sh-strong">{b.title}</span>
          </Link>
          <span className="t-ui t-muted sh-card-status">
            <span className="sh-card-stage">{s.stage}</span> ·{' '}
            {b.stage === 'ready' && b.reviewer && !b.status ? (
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

function Branches({ branches, now, components }: { branches: BranchCard[]; now: number; components: HomeComponent[] }) {
  const [filter, setFilter] = useState<BranchFilter>('all');
  const shown = sortBranches(branches).filter((b) => showsBranch(filter, b.stage));
  return (
    <section className="sh-section" aria-labelledby="sh-branches">
      <header className="sh-section-head">
        <div className="sh-section-title">
          <h2 id="sh-branches" className="sh-h2">
            Your {VOCAB.branches}
          </h2>
          <p className="t-body t-muted sh-section-sub">Your changes, kept apart from the library until they're merged.</p>
        </div>
        {branches.length >= 4 && <SegmentedControl label={`Show ${VOCAB.branches}`} size="md" value={filter} onValueChange={(v) => setFilter(v as BranchFilter)} items={BRANCH_FILTERS} />}
      </header>
      <ul className="sh-cards">
        {/* Create first, like "+ New" in Figma's file browser: the slot never moves as branches come and go. */}
        <li className="sh-card-item sh-create">
          <StartChange components={components} appearance="card" />
        </li>
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
}

/** The review drawing without its empty sky: the scene only, so it never makes the greeting taller than its text. */
const REVIEW_CROP = '0 98 232 86';

export function StudioHome(p: StudioHomeProps) {
  const snoozed = hintSnoozed(readSnooze(), p.now);
  if (p.state === 'signed-out') {
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
  if (p.state === 'empty') {
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
            {loading ? <p className="t-body">Checking what needs you.</p> : p.needs.some((r) => r.waitsOnYou) ? <Waiting needs={p.needs} now={p.now} /> : <p className="t-body">{p.needs.length ? 'Your branches need you.' : 'Nothing needs you.'}</p>}
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
          p.needs.length > 0 && <Needs needs={p.needs} now={p.now} snoozed={snoozed} />
        )}
      </section>
      {p.failed && <p className="t-ui t-muted sh-health">{p.failed}</p>}
      {p.health && <Health h={p.health} />}
      {(p.branches.length > 0 || !loading) && <Branches branches={p.branches} now={p.now} components={p.components} />}
    </div>
  );
}

/** Mounts the home into `el` once; later calls repaint it. */
export function paintStudioHome(el: HTMLElement, props: StudioHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<StudioHome {...props} />);
  return r;
}
