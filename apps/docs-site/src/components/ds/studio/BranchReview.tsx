// The branch review (Branches > a branch, ?pr=N, and the review queue): the breadcrumb, the title with its status,
// who asks and why, then the change itself by type (guidance as it will read in the Library with new text
// highlighted and click-to-edit; tokens as before and after; components as before and after screens), the
// conversation, one line about checks, and one sticky decision bar. A branch with several changes gets an outline
// and a "looked at" reading aid. Rules: lib/review-page.ts. Data and GitHub writes: scripts/reviews.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Who } from './faces';
import { ArrowRight, Check, ChevronLeft, Circle, Ellipsis, Pencil } from 'lucide-react';
import {
  Accordion,
  AccordionItem,
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Breadcrumb,
  Button,
  Checklist,
  ChecklistRow,
  Icon,
  IconButton,
  Input,
  Link,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  MenuTrigger,
  Progress,
  SidebarNav,
  SidebarNavItem,
  SidebarNavSection,
  Textarea,
  TokenValue,
  Tooltip,
  type ChecklistStatus,
} from '@bridge-ds/react';
import type { ExampleNode } from '../../../lib/components';
import { REGISTRY, resolveProps } from '../../registry';
import ButtonLink from '../ButtonLink';
import { AddedNotice, EditInChange } from './ContinueChange';
import { ShareChange, type ShareChangeProps } from './ShareChange';
import MotionChanges, { type MotionChangesProps } from './MotionChanges';
import { ProductContext, type ProductContextProps } from './ProductContext';

/** The id of the Motion change in the outline of a busy branch. */
export const MOTION_CHANGE = 'tokens:motion';
import {
  changeGroups,
  currentChange,
  guidanceMeta,
  lookedProgress,
  ROLE_LABEL,
  shotComponent,
  withGuidanceEdit,
  type ChecksLine,
  type ConvEntry,
  type GuidanceDocs,
  type GuidanceItem,
  type GuidanceKey,
  type GuidanceSection,
  valueName,
  type PrimaryKind,
  type ReviewActions,
  type ReviewChange,
  type Seg,
  productWorkEmpty,
  productWorkLine,
  type ProductWorkView,
} from '../../../lib/review-page';
import type { VisualShot } from '../../../lib/visual-impact';
import { VISUAL_CHECKS_DOCS } from '@bridge-ds/core';
import type { ShownValue } from '../../../lib/token-review';
import type { Lifecycle, LifecycleTone } from '../../../lib/change-status';
import { demoApproved } from '../../../lib/demo';
import { demoApprovals, rememberDemoApproval } from '../../../scripts/demo-approvals';

export interface PersonRef {
  login: string;
  /** Display name, never "@login". */
  name: string;
  avatarUrl?: string | null;
  /** Claude made it. */
  agent?: boolean;
}

export interface TokenRowView {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: ShownValue | null;
  after: ShownValue | null;
  /** Modes it changes in ("light", "dark", "ocean"), empty for single-mode tiers. */
  contexts: string[];
}

export interface VisualView {
  state: 'loading' | 'not-run' | 'no-change' | 'changes' | 'error';
  shots: VisualShot[];
  base?: string;
  error?: string;
  /** Not run, and the team asks for it on demand: the ask is painted in #rv-visual-ask. */
  ask?: boolean;
}

export interface GuidanceView {
  path: string;
  name: string;
  /** The docs on the branch, as read. */
  docs: GuidanceDocs | null;
  sections: GuidanceSection[];
  error?: string;
}

export type ActKind = PrimaryKind | 'suggest' | 'comment';

export interface BranchReviewProps {
  pr: number;
  crumbs: { label: string; href?: string }[];
  title: string;
  jira: string | null;
  /** Warning only in the demo seat: the list's "Waiting 1 day" pill for the same branch. */
  status: { label: string; tone: LifecycleTone | 'warning'; lifecycle: Lifecycle };
  who: { person: PersonRef | null; lead: string | null; rest: string };
  /** Back from the token editor: what was just added. */
  added?: string | null;
  changes: ReviewChange[];
  /** Changes this viewer marked "Looks good" (a reading aid, never an approval). */
  looked: string[];
  onLooked: (ids: string[]) => void;
  tokens: { rows: TokenRowView[]; error?: string | null; editHref?: string | null } | null;
  guidance: Record<string, GuidanceView>;
  canEditGuidance: boolean;
  onSaveGuidance: (path: string, docs: GuidanceDocs) => Promise<void>;
  visual: VisualView | null;
  /**
   * The branch touches what visual checks capture but the repo has no visual impact workflow (core visualOffer
   * "set-up"): a quiet link to set them up, never an ask or a "No visual change" it cannot know.
   */
  visualSetUp?: boolean;
  /** "Admin demo": where the screens are. */
  product: string;
  tryUrl: string | null;
  people: Record<string, PersonRef>;
  conversation: { count: number; latest: ConvEntry | null; earlier: ConvEntry[] };
  /** Line comments by file path, for the change they belong to. */
  fileComments: ConvEntry[];
  checks: ChecksLine;
  /**
   * The viewer is a developer (a tech owner): the technical side of the branch, folded under "For developers". Null
   * for designers, who read who acts instead ("A developer is on it").
   */
  developer?: { tests: string | null; failing: string[]; url: string; number: number; held?: string | null } | null;
  approvals: { label: string; state: 'approved' | 'changes' | 'waiting'; text: string }[];
  /** The branch is behind or conflicts with main: the line above the bar (filled by scripts/reviews.ts). */
  update: 'behind' | 'conflict' | 'done' | null;
  actions: ReviewActions;
  onAct: (kind: ActKind, text: string) => Promise<string | void>;
  onOverride: () => void;
  onDraft: () => Promise<string | void>;
  onClose: () => Promise<string | void>;
  links: { review: string; developer: string };
  share: Omit<ShareChangeProps, 'open' | 'onOpenChange' | 'hideTrigger'> | null;
  /** A line to say on mount (the result of the action that repainted the review). */
  said?: string;
  /** Why the viewer cannot act (read-only account). */
  note?: string | null;
  /** Motion changes (#153), read after the first paint; on a busy branch it is its own change, MOTION_CHANGE. */
  motion?: MotionChangesProps | null;
  /** Inside the review queue: its bar replaces this one. */
  inQueue?: boolean;
  /** A library branch a product branch needs: "Why it exists" (ProductContext). */
  productContext?: ProductContextProps['context'] | null;
  /** An exploration or a product branch: "See it" for a designer (where, why, previews, Try it, Share). */
  productWork?: ProductWorkView | null;
  /** Product work's technical side, folded under "For developers" for everyone. */
  code?: { files: string[]; branch: string; url: string; number: number; install: string | null } | null;
  /**
   * The sample team (lib/demo.ts): Approve can be tried. It shows the approved state and what happens next, and
   * writes nothing. `author` is who asked for the review; `codeBy` who checks the code next ("Malik"), when the change
   * still needs that check.
   */
  /** `valuesOnly`: a token value change, the design approval is all it needs (core withTokenValueApprovals). */
  sample?: { author: string | null; codeBy?: string | null; valuesOnly?: boolean | undefined } | null;
}

// ---------------------------------------------------------------------------------------------------------------

/** Who asks, who wrote: their photo, else their drawn face (seeded by login), and Claude as Claude (faces.tsx). */
export function Face({ person, size = 'sm' }: { person: PersonRef | null; size?: 'xs' | 'sm' | 'md' }) {
  if (!person) return null;
  const avatarUrl = person.avatarUrl ? `${person.avatarUrl}${person.avatarUrl.includes('?') ? '&' : '?'}s=64` : null;
  return <Who p={person.agent ? { login: 'claude', name: 'Claude AI', agent: true } : { ...person, avatarUrl }} size={size} className="br-face" />;
}

function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.added ? (
          <mark className="br-add" key={i}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function renderNode(node: ExampleNode, key?: number): ReactNode {
  if (typeof node === 'string') return node;
  const Comp = REGISTRY[node.c];
  if (!Comp) return null;
  return (
    <Comp key={key} {...resolveProps(node.p)}>
      {node.children?.map((c, i) => renderNode(c, i))}
    </Comp>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Guidance, as it will read

type Draft = Record<number, string | { title: string; text: string }>;

function GuidanceSectionBlock({
  section,
  canEdit,
  onSave,
}: {
  section: GuidanceSection;
  canEdit: boolean;
  onSave: (key: GuidanceKey, draft: Draft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [failed, setFailed] = useState(false);
  const verdict = section.key === 'dos' ? 'is-do' : section.key === 'donts' ? 'is-dont' : '';
  const plain = (segs: Seg[] | undefined) => (segs ?? []).map((s) => s.text).join('');
  const start = (index: number) => {
    if (!canEdit || draft) return;
    setFocus(index);
    setSaid('');
    setDraft(Object.fromEntries(section.items.map((it) => [it.index, it.title ? { title: plain(it.title), text: plain(it.text) } : plain(it.text)])));
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setSaid('');
    setFailed(false);
    try {
      await onSave(section.key, draft);
      setDraft(null);
      setSaid('Saved to this change.');
    } catch (err) {
      setSaid((err as Error).message);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const headingId = `br-g-${section.key}`;
  return (
    <section className={`br-g-sec ${verdict}`} aria-labelledby={headingId}>
      <div className="br-g-head">
        <h3 className="br-g-title" id={headingId}>
          {section.label}
        </h3>
        {canEdit && !draft && <IconButton icon={Pencil} label={`Edit ${section.label}`} variant="ghost" size="sm" onClick={() => start(0)} />}
      </div>
      {section.items.map((it: GuidanceItem, k) =>
        draft ? (
          <div className="br-g-edit" key={it.index}>
            {typeof draft[it.index] === 'object' && (
              <Textarea
                appearance="inline"
                className="br-g-input is-title"
                aria-label={`${section.label} ${k + 1}, title`}
                value={(draft[it.index] as { title: string }).title}
                autoFocus={k === focus}
                onValueChange={(v) => setDraft({ ...draft, [it.index]: { ...(draft[it.index] as { title: string; text: string }), title: v } })}
              />
            )}
            <Textarea
              appearance="inline"
              className="br-g-input"
              aria-label={`${section.label} ${k + 1}`}
              value={typeof draft[it.index] === 'object' ? (draft[it.index] as { text: string }).text : (draft[it.index] as string)}
              autoFocus={k === focus && typeof draft[it.index] !== 'object'}
              onValueChange={(v) => setDraft({ ...draft, [it.index]: typeof draft[it.index] === 'object' ? { ...(draft[it.index] as { title: string; text: string }), text: v } : v })}
            />
          </div>
        ) : (
          // Click any part to edit it (the pencil next to the heading is the keyboard way in).
          <div className="br-g-item" key={it.index} data-editable={canEdit ? '' : undefined} onClick={() => start(k)}>
            {it.example ? <div className="br-g-example" data-theme="light" {...(section.key === 'donts' ? ({ inert: '' } as object) : {})}>{renderNode(it.example as ExampleNode)}</div> : null}
            {it.title && (
              <p className="br-g-entry">
                <Segs segs={it.title} />
              </p>
            )}
            <p className="br-g-text">
              <Segs segs={it.text} />
            </p>
          </div>
        ),
      )}
      {!draft && section.removed.length > 0 && (
        <p className="br-g-removed">
          Removed: {section.removed.map((r, i) => (
            <del key={i}>{r}</del>
          ))}
        </p>
      )}
      {draft && (
        <div className="br-g-actions">
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setSaid('');
              setFailed(false);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      <p className={failed ? 'br-said br-error' : 'br-said'} role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
        {said}
      </p>
    </section>
  );
}

function GuidanceBody({ view, canEdit, onSave }: { view: GuidanceView; canEdit: boolean; onSave: BranchReviewProps['onSaveGuidance'] }) {
  if (view.error) return <p className="br-error">{view.error}</p>;
  if (!view.docs) return <p className="br-muted">Reading the guidance</p>;
  const editable = canEdit && Boolean(view.docs);
  const save = async (key: GuidanceKey, draft: Draft) => {
    let next = view.docs!;
    for (const [i, v] of Object.entries(draft)) next = withGuidanceEdit(next, key, Number(i), v);
    await onSave(view.path, next);
  };
  const sections = view.sections;
  const verdicts = sections.filter((s) => s.key === 'dos' || s.key === 'donts');
  const rest = (pred: (s: GuidanceSection) => boolean) => sections.filter(pred).map((s) => <GuidanceSectionBlock key={s.key} section={s} canEdit={editable} onSave={save} />);
  return (
    <article className="br-card br-guidance" aria-label={`${view.name} guidance as it will read in the Library`}>
      {rest((s) => ['summary', 'whenToUse', 'whenNotToUse'].includes(s.key))}
      {verdicts.length > 0 && <div className="br-g-verdicts">{rest((s) => s.key === 'dos' || s.key === 'donts')}</div>}
      {rest((s) => ['accessibility', 'contentGuidelines'].includes(s.key))}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tokens: what changes

const TOKEN_LIMIT = 6;

export function Sample({ v }: { v: ShownValue | null }) {
  if (!v?.css) return <span className="br-sample is-none" aria-hidden="true" />;
  if (v.hex) return <span className="br-sample" aria-hidden="true" style={{ backgroundColor: v.hex }} />;
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(v.css);
  if (px) return <span className="br-sample is-size" aria-hidden="true"><span style={{ width: `${Math.min(Number(px[1]), 64)}px` }} /></span>;
  return null;
}

/** The full value, for the tooltip: the alias and what it resolves to. */
const rawValue = (v: ShownValue) => [v.alias ? `{${v.alias}}` : null, v.css].filter(Boolean).join(' ');

function themesLine(contexts: string[]): string {
  if (!contexts.length) return '';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (contexts.length > 1) return contexts.map(cap).join(', ');
  return /^(light|dark)$/i.test(contexts[0]!) ? `${cap(contexts[0]!)} theme only` : `${cap(contexts[0]!)} only`;
}

/** The token rows of a review: name, before, arrow, after, modes (also the suggestion review, SuggestionReview). */
export function TokenRows({ rows }: { rows: TokenRowView[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, TOKEN_LIMIT);
  return (
    <>
      <ul className="br-tokens" aria-label="Token changes">
        {shown.map((r) => (
          <li className="br-token" key={r.path}>
            <span className="br-token-name">{r.path}</span>
            <span className="br-token-side br-muted" title={r.before ? rawValue(r.before) : undefined}>
              <Sample v={r.before} />
              {r.before ? valueName(r.before) : 'New'}
            </span>
            <Icon icon={ArrowRight} size="sm" className="br-arrow" label="becomes" />
            <span className="br-token-side" title={r.after ? rawValue(r.after) : undefined}>
              <Sample v={r.after} />
              {r.after ? valueName(r.after) : 'Removed'}
            </span>
            {r.contexts.length > 0 && <span className="br-muted br-token-where">{themesLine(r.contexts)}</span>}
          </li>
        ))}
      </ul>
      {rows.length > TOKEN_LIMIT && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show ${rows.length - TOKEN_LIMIT} more`}
        </Button>
      )}
    </>
  );
}

function TokensBody({ tokens, only }: { tokens: NonNullable<BranchReviewProps['tokens']>; only?: string[] }) {
  if (tokens.error) return <p className="br-error">{tokens.error}</p>;
  const rows = only?.length ? tokens.rows.filter((r) => only.includes(r.path)) : tokens.rows;
  return (
    <section className="br-card" aria-labelledby="br-what">
      <div className="br-line">
        <h2 className="br-h2" id="br-what">
          What changes
        </h2>
        {tokens.editHref && <EditInChange href={tokens.editHref} />}
      </div>
      {rows.length ? <TokenRows rows={rows} /> : <p className="br-muted">The token files changed, but no token value did (formatting or descriptions only).</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Where it shows: before and after screens

const PAIRS = 3;

function ShotPair({ shot, base }: { shot: VisualShot; base: string }) {
  const url = (p?: string) => (p ? `${base}/${p}` : undefined);
  return (
    <figure className="br-shot">
      <div className="br-shot-pair">
        {shot.images.before ? <img src={url(shot.images.before)} alt={`Before: ${shot.label}, ${shot.theme}`} loading="lazy" /> : <span className="br-shot-none">New</span>}
        {shot.images.after ? <img src={url(shot.images.after)} alt={`After: ${shot.label}, ${shot.theme}`} loading="lazy" /> : <span className="br-shot-none">Gone</span>}
      </div>
      <figcaption>
        {shot.label}
        <span className="br-muted">, {shot.theme}</span>
      </figcaption>
    </figure>
  );
}

function whereLine(shots: VisualShot[], product: string): string {
  const routes = new Set(shots.filter((s) => s.kind === 'route').map((s) => s.label)).size;
  const stories = new Set(shots.filter((s) => s.kind === 'story').map((s) => s.label)).size;
  return [routes && `${routes} ${routes === 1 ? 'screen' : 'screens'} in ${product}`, stories && `${stories} component ${stories === 1 ? 'example' : 'examples'}`].filter(Boolean).join(', ');
}

function WhereItShows({ visual, product, tryUrl, component, components, compact }: { visual: VisualView; product: string; tryUrl: string | null; component?: string; components: string[]; compact?: boolean }) {
  const [all, setAll] = useState(false);
  const shots = component ? visual.shots.filter((s) => shotComponent(s.key, components) === component) : visual.shots;
  const changed = visual.state === 'changes' && shots.length > 0;
  const head = (
    <div className="br-line">
      <h2 className="br-h2" id={component ? `br-where-${component}` : 'br-where'}>
        Where it shows {changed && <span className="br-muted br-h2-meta">{whereLine(shots, product)}</span>}
      </h2>
      {changed && tryUrl && !compact && (
        <ButtonLink variant="secondary" href={tryUrl} target="_blank" rel="noopener">
          Try it in the product
        </ButtonLink>
      )}
    </div>
  );
  return (
    <section className="br-where" aria-labelledby={component ? `br-where-${component}` : 'br-where'}>
      {head}
      {visual.state === 'loading' && <p className="br-muted">Reading the before and after</p>}
      {visual.state === 'not-run' && !visual.ask && <p className="br-muted">The before and after is being prepared. It runs on its own whenever tokens or components change.</p>}
      {!component && <div id="rv-visual-ask" hidden={!(visual.state === 'not-run' && visual.ask)} />}
      {visual.state === 'error' && <p className="br-error">Could not read the before and after: {visual.error}</p>}
      {visual.state === 'no-change' && <p className="br-muted">No visual change: every captured screen renders the same.</p>}
      {visual.state === 'changes' && !shots.length && <p className="br-muted">No captured screen changes for this part.</p>}
      {changed && (
        <div className="br-shots">
          {shots.slice(0, PAIRS).map((s) => (
            <ShotPair key={s.key} shot={s} base={visual.base!} />
          ))}
        </div>
      )}
      {/* The full list with its slider and filters (scripts/reviews/visual-impact.ts paints it), on demand. The
          not-run state (ask or follow the run) is painted in the same slot and shows at once. */}
      {!component && visual.state === 'changes' && visual.shots.length > PAIRS && (
        <Button variant="ghost" size="sm" aria-expanded={all} aria-controls="rv-visual" onClick={() => setAll(!all)}>
          {all ? 'Hide the slider view' : `Compare all ${visual.shots.length} with a slider`}
        </Button>
      )}
      {!component && <div id="rv-visual" className="br-visual-slot" hidden={!(visual.state === 'changes' && all)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// One change

function ChangeBody(p: BranchReviewProps & { change: ReviewChange; multi: boolean }) {
  const { change } = p;
  const components = p.changes.filter((c) => c.kind === 'component').map((c) => c.component!);
  if (change.kind === 'guidance') {
    const view = p.guidance[change.paths[0]!];
    return view ? <GuidanceBody view={view} canEdit={p.canEditGuidance} onSave={p.onSaveGuidance} /> : <p className="br-muted">Reading the guidance</p>;
  }
  if (change.id === MOTION_CHANGE) return p.motion ? <MotionChanges {...p.motion} /> : null;
  if (change.kind === 'tokens') return p.tokens ? <TokensBody tokens={p.tokens} only={change.tokens} /> : <p className="br-muted">Reading the token changes</p>;
  return (
    <>
      {p.visual ? (
        <WhereItShows visual={p.visual} product={p.product} tryUrl={p.tryUrl} component={change.component} components={components} compact />
      ) : p.visualSetUp ? (
        <SetUpVisualChecks />
      ) : (
        <p className="br-muted">No visual change.</p>
      )}
      <p className="br-muted">The code is a developer's to review.</p>
    </>
  );
}

/** On a repo without visual checks: what it would take, calmly, in place of the before and after. */
function SetUpVisualChecks() {
  return (
    <p className="br-muted">
      This repo has no visual checks yet.{' '}
      <Link href={VISUAL_CHECKS_DOCS} target="_blank" rel="noopener">
        Set up visual checks
      </Link>
    </p>
  );
}

function CommentLine({ c, people, onReply, here }: { c: ConvEntry; people: Record<string, PersonRef>; onReply?: () => void; here?: boolean }) {
  const who = (c.login && people[c.login.toLowerCase()]) || { login: c.login ?? '', name: c.login ?? 'Someone' };
  return (
    <div className="br-comment">
      <Face person={who} size="sm" />
      <p className="br-comment-body">
        <strong>{who.name}</strong>
        <span className="br-muted">
          {c.role ? ` · ${ROLE_LABEL[c.role]}` : ''}
          {here ? ' · on this change' : ''}
          {c.at ? ` · ${relative(c.at)}` : ''}
        </span>
        <br />
        {c.text}
      </p>
      {onReply && (
        <Button variant="ghost" size="sm" onClick={onReply}>
          Reply
        </Button>
      )}
    </div>
  );
}

function relative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} ${d === 1 ? 'day' : 'days'} ago` : new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------------------------------------------
// The busy branch: outline and changes

function Outline(p: BranchReviewProps & { current: string | null; seen: Set<string>; pick: (id: string) => void }) {
  const progress = lookedProgress(p.changes, p.seen);
  const changed = p.visual?.state === 'changes' && p.visual.shots.length > 0;
  return (
    <aside className="br-outline" aria-label="What this change changes">
      <p className="br-outline-count">
        <strong>
          {p.changes.length} changes
        </strong>
        <span className="br-muted"> · {progress.line}</span>
      </p>
      <Progress value={progress.looked} max={progress.total} size="sm" aria-label={progress.line} className="br-outline-bar" getAriaValueText={() => progress.line} />
      <SidebarNav aria-label="Jump to a change" className="br-toc">
        {changeGroups(p.changes).map((g) => (
          <SidebarNavSection title={g.label} key={g.kind}>
            {g.changes.map((c) => (
              <SidebarNavItem
                key={c.id}
                href={`#${anchor(c.id)}`}
                active={c.id === p.current}
                onClick={(e) => {
                  e.preventDefault();
                  p.pick(c.id);
                }}
              >
                <Icon icon={p.seen.has(c.id) ? Check : Circle} size='sm' className={p.seen.has(c.id) ? 'br-toc-mark is-done' : 'br-toc-mark'} label={p.seen.has(c.id) ? 'Looked at' : 'Not looked at yet'} />
                <span className="br-toc-text">{c.title}</span>
              </SidebarNavItem>
            ))}
          </SidebarNavSection>
        ))}
      </SidebarNav>
      {changed && (
        <div className="br-outline-where">
          <strong>Where it shows</strong>
          <span className="br-muted">{whereLine(p.visual!.shots, p.product)}</span>
          {p.tryUrl && (
            <ButtonLink variant="secondary" href={p.tryUrl} target="_blank" rel="noopener">
              Try it in the product
            </ButtonLink>
          )}
        </div>
      )}
    </aside>
  );
}

const anchor = (id: string) => `br-c-${id.replace(/[^\w-]/g, '-')}`;

function MultiBody(p: BranchReviewProps & { current: string | null; seen: Set<string>; pick: (id: string) => void; mark: (id: string) => void }) {
  const idx = p.changes.findIndex((c) => c.id === p.current);
  const meta = (c: ReviewChange) => (c.kind === 'guidance' && p.guidance[c.paths[0]!]?.sections.length ? guidanceMeta(p.guidance[c.paths[0]!]!.sections) : c.meta);
  const later = p.changes.filter((c, i) => i > idx && !p.seen.has(c.id));
  return (
    <div className="br-changes">
      {p.changes.map((c, i) => {
        if (c.id === p.current) {
          const comments = p.fileComments.filter((x) => x.path && c.paths.includes(x.path));
          return (
            <section className="br-change is-open" key={c.id} id={anchor(c.id)} aria-labelledby={`${anchor(c.id)}-h`} tabIndex={-1}>
              <div className="br-line">
                <h2 className="br-h2" id={`${anchor(c.id)}-h`}>
                  {c.kind === 'tokens' && c.id !== MOTION_CHANGE ? <span className="br-mono">{c.title}</span> : c.title} <span className="br-muted br-h2-meta">· {meta(c)}</span>
                </h2>
                <Button variant="secondary" iconStart={Check} onClick={() => p.mark(c.id)} disabled={p.seen.has(c.id)}>
                  {p.seen.has(c.id) ? 'Looked at' : 'Looks good'}
                </Button>
              </div>
              <ChangeBody {...p} change={c} multi />
              {comments.map((x, k) => (
                <CommentLine c={x} people={p.people} key={k} here />
              ))}
            </section>
          );
        }
        if (p.seen.has(c.id))
          return (
            <section className="br-change is-done" key={c.id} id={anchor(c.id)} aria-label={`${c.title}, looked at`}>
              <Icon icon={Check} size="sm" className="br-toc-mark is-done" />
              <span className="br-change-line">
                <strong className={c.kind === 'tokens' && c.id !== MOTION_CHANGE ? 'br-mono' : undefined}>{c.title}</strong>
                <span className="br-muted"> · {meta(c)}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => p.pick(c.id)}>
                Show again
              </Button>
            </section>
          );
        // Not looked at and after the open one: one line each, under "Next" (before it: the same line).
        return i > idx && later[0]?.id !== c.id ? null : (
          <NextRows key={c.id} rows={i > idx ? later : [c]} meta={meta} pick={p.pick} />
        );
      })}
    </div>
  );
}

function NextRows({ rows, meta, pick }: { rows: ReviewChange[]; meta: (c: ReviewChange) => string; pick: (id: string) => void }) {
  return (
    <section className="br-next" aria-label="Next changes">
      {rows.map((c) => (
        <div className="br-next-row" key={c.id} id={anchor(c.id)}>
          <span className="br-change-line">
            <strong className={c.kind === 'tokens' && c.id !== MOTION_CHANGE ? 'br-mono' : undefined}>{c.title}</strong>
            <span className="br-muted"> · {meta(c)}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => pick(c.id)}>
            Open
          </Button>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Conversation and checks

function Conversation({ p, onReply }: { p: BranchReviewProps; onReply: () => void }) {
  const [all, setAll] = useState(false);
  const { count, latest, earlier } = p.conversation;
  return (
    <section className="br-conv" aria-labelledby="br-conv-h">
      <h2 className="br-h2" id="br-conv-h">
        Conversation <span className="br-muted br-h2-meta">{count}</span>
      </h2>
      {!latest && <p className="br-muted">No comments yet.</p>}
      {all && earlier.map((c, i) => <CommentLine c={c} people={p.people} key={i} />)}
      {latest && <CommentLine c={latest} people={p.people} onReply={p.actions.comment ? onReply : undefined} />}
      {earlier.length > 0 && (
        <Button variant="ghost" size="sm" className="br-left" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Hide earlier comments' : `Show ${earlier.length} earlier ${earlier.length === 1 ? 'comment' : 'comments'}`}
        </Button>
      )}
    </section>
  );
}

const CHECK_STATUS: Record<'pass' | 'fail' | 'pending', ChecklistStatus> = { pass: 'done', fail: 'failed', pending: 'waiting' };
const APPROVAL_STATUS: Record<'approved' | 'changes' | 'waiting', ChecklistStatus> = { approved: 'done', changes: 'failed', waiting: 'waiting' };

function ChecksRow({ checks, approvals }: { checks: ChecksLine; approvals: BranchReviewProps['approvals'] }) {
  const [open, setOpen] = useState(false);
  const tone = checks.state === 'pass' ? 'is-pass' : checks.state === 'fail' ? 'is-fail' : '';
  return (
    <section className="br-checks" aria-label="Checks and approvals">
      {/* The approvals it needs, always in view: who approves the design and who approves the code. */}
      {approvals.length > 0 && (
        <Checklist label="Approvals it needs">
          {approvals.map((a) => (
            <ChecklistRow key={a.label} status={APPROVAL_STATUS[a.state]} title={a.label} detail={a.text} />
          ))}
        </Checklist>
      )}
      <div className="br-line is-tight">
        <p className={`br-checks-line ${tone}`}>{checks.text}</p>
        {checks.rows.length > 0 && (
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="br-checks-detail" onClick={() => setOpen(!open)}>
            {open ? 'Hide details' : 'Details'}
          </Button>
        )}
      </div>
      <div id="br-checks-detail" hidden={!open}>
        <Checklist label="Checks">
          {checks.rows.map((r) => (
            <ChecklistRow key={r.label} status={CHECK_STATUS[r.state]} title={r.label} detail={r.text} />
          ))}
        </Checklist>
      </div>
    </section>
  );
}

/**
 * The technical side of the branch, folded: what fails and the branch on GitHub for developers (tech owners); on
 * product work, for everyone, the branch, its files and the install command of its test build.
 */
function ForDevelopers({ dev, code }: { dev?: BranchReviewProps['developer']; code?: BranchReviewProps['code'] }) {
  const url = dev?.url ?? code?.url;
  const number = dev?.number ?? code?.number;
  return (
    <Accordion appearance="flush" headingLevel={2} className="br-dev">
      <AccordionItem value="developers" title="For developers">
        {dev?.held && <p>{dev.held}</p>}
        {dev?.tests && <p>{dev.tests}</p>}
        {dev && dev.failing.length > 0 && (
          <ul className="br-dev-list">
            {dev.failing.map((name) => (
              <li key={name} className="br-mono">
                {name}
              </li>
            ))}
          </ul>
        )}
        {dev && !dev.held && !dev.tests && !dev.failing.length && <p className="br-muted">Nothing fails on the code side.</p>}
        {code && (
          <>
            <p>
              Branch <span className="br-mono">{code.branch}</span>, {code.files.length} {code.files.length === 1 ? 'file' : 'files'} changed:
            </p>
            <ul className="br-dev-list">
              {code.files.slice(0, 20).map((f) => (
                <li key={f} className="br-mono">
                  {f}
                </li>
              ))}
              {code.files.length > 20 && <li className="br-muted">and {code.files.length - 20} more</li>}
            </ul>
            {code.install && (
              <p>
                Install its test build in a product branch: <span className="br-mono">{code.install}</span>
              </p>
            )}
          </>
        )}
        {url && (
          <Link href={url} target="_blank" rel="noopener">
            Open #{number} on GitHub
          </Link>
        )}
      </AccordionItem>
    </Accordion>
  );
}

/**
 * An exploration or a product branch, for a designer: where it is and why, then how to see it (Try it in the
 * product with the Bridge toolbar, the previews), and Share, which copies the link to this page. The before and
 * after, when the visual checks captured it, shows right below (WhereItShows).
 */
function ProductWork({ work, link, hasVisual }: { work: ProductWorkView; link: string; hasVisual: boolean }) {
  const [said, setSaid] = useState('');
  const share = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setSaid('Link copied. Anyone on the team can open this page with it.');
    } catch {
      setSaid('Copy is not available in this browser. Copy the address from the address bar.');
    }
  };
  const seeable = Boolean(work.tryUrl) || work.previews.length > 0;
  return (
    <section className="br-work" aria-labelledby="br-work-h">
      <div className="br-line">
        <h2 className="br-h2" id="br-work-h">
          See it {work.useCase && <span className="br-muted br-h2-meta">{work.useCase}</span>}
        </h2>
      </div>
      <p>{productWorkLine(work)}</p>
      {work.experimental.length > 0 && (
        <ul className="br-work-list" aria-label="What is experimental">
          {work.experimental.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {!seeable && !hasVisual && <p className="br-muted">{productWorkEmpty(work)}</p>}
      <div className="br-work-actions">
        {work.tryUrl && (
          <ButtonLink variant="secondary" href={work.tryUrl} target="_blank" rel="noopener">
            Try it in the product
          </ButtonLink>
        )}
        {work.previews.map((v) => (
          <ButtonLink key={v.url} variant="secondary" href={v.url} target="_blank" rel="noopener">
            Open in {v.label}
          </ButtonLink>
        ))}
        <Button variant="secondary" onClick={() => void share()}>
          Share
        </Button>
      </div>
      <p className="br-said" role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The decision bar

/** Approve, tried on the sample team: approved, what happens next, and that nothing was sent. */
function TriedApprove({ author, codeBy, valuesOnly }: { author: string | null; codeBy: string | null; valuesOnly?: boolean | undefined }) {
  const w = demoApproved(author, codeBy, valuesOnly);
  return (
    <Alert tone="success" title={w.title} className="br-tried">
      {w.next} {w.note}
    </Alert>
  );
}

function DecisionBar({ p, leftLine, inputRef, tried, onTry }: { p: BranchReviewProps; leftLine: string | null; inputRef: React.RefObject<HTMLInputElement>; tried: boolean; onTry: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<ActKind | null>(null);
  const [said, setSaid] = useState(p.said ?? '');
  const [confirm, setConfirm] = useState<'merge' | 'close' | null>(null);
  const [share, setShare] = useState(false);
  const a = p.actions;
  const run = async (kind: ActKind) => {
    if (kind === 'suggest' && !text.trim()) {
      setSaid('Say what to change in the comment first.');
      inputRef.current?.focus();
      return;
    }
    setBusy(kind);
    setSaid('');
    try {
      const r = await p.onAct(kind, text.trim());
      setText('');
      setSaid(r ?? '');
    } catch (err) {
      setSaid((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const go = (kind: ActKind) => (kind === 'merge' || kind === 'approve-merge' ? setConfirm('merge') : void run(kind));
  const copy = async (url: string, what: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setSaid(`${what} copied.`);
    } catch {
      setSaid('Copy is not available in this browser. Copy the address from the address bar.');
    }
  };
  const later = async (f: () => Promise<string | void>) => {
    setSaid('');
    try {
      setSaid((await f()) ?? '');
    } catch (err) {
      setSaid((err as Error).message);
    }
  };
  const primary = a.primary;
  return (
    <div className="br-bar" role="region" aria-label="Your review">
      <div className="br-bar-row">
        {leftLine && <span className="br-bar-left">{leftLine}</span>}
        {a.comment && (
          <div className="br-bar-field">
            <Input
              ref={inputRef}
            label="Comment"
            hideLabel
            size="lg"
            placeholder={leftLine ? 'Add a comment on the whole change (optional)' : 'Add a comment (optional)'}
            value={text}
            onValueChange={setText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim() && !a.primary) void run('comment');
            }}
            />
          </div>
        )}
        {a.comment && !a.suggest && !primary && (
          <Button variant="secondary" size="lg" loading={busy === 'comment'} disabled={!text.trim()} onClick={() => void run('comment')} data-demo-write="comment on changes">
            Comment
          </Button>
        )}
        {a.suggest && (
          <Button variant="secondary" size="lg" loading={busy === 'suggest'} onClick={() => void run('suggest')} data-demo-write="review changes">
            Ask for changes
          </Button>
        )}
        {primary && p.sample && (primary.kind === 'approve' || primary.kind === 'approve-merge') ? (
          // The sample team: Approve is tried here, nothing is written (no data-demo-write: the demo gate lets it through).
          !tried && (
            <Button variant="primary" size="lg" onClick={onTry} data-demo-try="approve">
              Approve
            </Button>
          )
        ) : primary && (
          <Button
            variant="primary"
            size="lg"
            loading={busy === primary.kind}
            onClick={() => go(primary.kind)}
            {...(primary.kind === 'approve' || primary.kind === 'approve-merge' ? { 'data-act': 'APPROVE' } : {})}
            {...(primary.kind === 'connect' ? { 'data-gh-open': '' } : {})}
            data-demo-write="review changes"
          >
            {primary.label}
          </Button>
        )}
        <Menu>
          <Tooltip content="More actions">
            <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" size="lg" />} />
          </Tooltip>
          <MenuContent side="top" align="end">
            {a.menu.override && (
              <MenuGroup label={a.menu.override}>
                <MenuItem onClick={p.onOverride}>Add to the library with owner override</MenuItem>
              </MenuGroup>
            )}
            {a.menu.override && <MenuSeparator />}
            {a.menu.share && <MenuItem onClick={() => setShare(true)}>Share with a product team</MenuItem>}
            <MenuSubmenu label="Copy link">
              <MenuItem onClick={() => void copy(p.links.review, 'Link to this review')}>Link to this review</MenuItem>
              <MenuItem onClick={() => void copy(p.links.developer, 'Link for a developer')}>Link for a developer</MenuItem>
            </MenuSubmenu>
            {a.menu.draft && <MenuItem onClick={() => void later(p.onDraft)}>Back to draft</MenuItem>}
            {a.menu.close && <MenuSeparator />}
            {a.menu.close && (
              <MenuItem tone="danger" onClick={() => setConfirm('close')}>
                Close change
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>
      {tried && p.sample && <TriedApprove author={p.sample.author} codeBy={p.sample.codeBy ?? null} valuesOnly={p.sample.valuesOnly} />}
      {(said || p.note) && (
        <p className="br-said" role="status" aria-live="polite">
          {said || p.note}
        </p>
      )}
      {!said && !p.note && <p className="br-said" role="status" aria-live="polite" />}
      <AlertDialog open={confirm === 'merge'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent
          title={primary?.kind === 'approve-merge' ? 'Approve and add it to the library?' : 'Add it to the library?'}
          description="It goes out with the next release of the library."
          confirmLabel={primary?.kind === 'approve-merge' ? 'Approve and add to the library' : 'Add to the library'}
          tone="primary"
          onConfirm={() => {
            setConfirm(null);
            if (primary) void run(primary.kind);
          }}
        />
      </AlertDialog>
      <AlertDialog open={confirm === 'close'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent
          title="Close this change without adding it to the library?"
          description="Nothing reaches the library. Its author can reopen it."
          confirmLabel="Close change"
          tone="danger"
          onConfirm={() => {
            setConfirm(null);
            void later(p.onClose);
          }}
        />
      </AlertDialog>
      {p.share && <ShareChange {...p.share} open={share} onOpenChange={setShare} hideTrigger />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export function BranchReview(p: BranchReviewProps) {
  const looked = useMemo(() => new Set(p.looked), [p.looked]);
  const [picked, setPicked] = useState<string | null>(null);
  const [added, setAdded] = useState(p.added ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Approve tried on the sample team: the page shows the approved state, again on any page of the visit (the branch
  // is remembered in this browser, scripts/demo-approvals.ts); nothing is sent.
  const [tried, setTried] = useState(() => Boolean(p.sample) && demoApprovals().has(p.pr));
  useEffect(() => setTried(Boolean(p.sample) && demoApprovals().has(p.pr)), [p.sample, p.pr]);
  const tryApprove = () => {
    rememberDemoApproval(p.pr);
    setTried(true);
  };
  const status = tried && p.sample ? { label: 'Approved', tone: 'success' as const } : p.status;
  // The line under the title follows: never "Ann asks for your review" once the visitor approved.
  const who = tried && p.sample ? { person: null, lead: null, rest: 'You approved it.' } : p.who;
  // Only the visitor's own row turns approved: the code check stays with whoever the Review rules name ("Waiting for Malik").
  const approvals = tried && p.sample ? p.approvals.map((a) => (a.state === 'waiting' && a.text === 'Waiting for you' ? { ...a, state: 'approved' as const, text: 'You approved' } : a)) : p.approvals;
  const multi = p.changes.length > 1;
  const current = multi ? currentChange(p.changes, looked, picked) : (p.changes[0]?.id ?? null);
  const progress = lookedProgress(p.changes, looked);
  const pick = (id: string) => {
    setPicked(id);
    requestAnimationFrame(() => document.getElementById(anchor(id))?.focus({ preventScroll: false }));
  };
  const mark = (id: string) => {
    const next = new Set(looked);
    next.add(id);
    p.onLooked([...next]);
    const after = p.changes.find((c) => !next.has(c.id));
    setPicked(after?.id ?? id);
    if (after) requestAnimationFrame(() => document.getElementById(anchor(after.id))?.focus());
  };
  const reply = () => inputRef.current?.focus();
  const parent = p.crumbs[p.crumbs.length - 2];
  const single = p.changes[0];
  const visualOnTop = !multi && p.visual && (!single || single.kind !== 'guidance');
  // In the review queue the page heading is the queue's: the branch title is one level down.
  const Heading = p.inQueue ? 'h2' : 'h1';
  const work = p.productWork ?? null;

  return (
    <div className={`br ${multi ? 'is-multi' : 'is-single'}${p.inQueue ? ' is-queue' : ''}`}>
      <header className="br-head">
        {!p.inQueue && (
          <>
            <Breadcrumb items={p.crumbs} className="br-crumbs" />
            {parent?.href && (
              <Link variant="subtle" href={parent.href} className="br-crumbs-phone">
                <Icon icon={ChevronLeft} size="sm" /> {parent.label}
              </Link>
            )}
          </>
        )}
        {/* The status follows the last word of the title, wherever the title wraps. */}
        <Heading className="br-title">
          {p.title}{' '}
          <Badge tone={status.tone} className="br-status">
            {status.label}
          </Badge>
        </Heading>
        <p className="br-who">
          <Face person={who.lead === 'Claude AI' ? { login: 'claude', name: 'Claude AI', agent: true } : who.person} size="sm" />
          <span>
            {who.lead && <strong>{who.lead}</strong>} {who.rest}
            {p.jira && (
              <>
                {' · '}
                <span className="br-mono">{p.jira}</span>
              </>
            )}
          </span>
        </p>
      </header>
      {p.productContext && <ProductContext context={p.productContext} canSuggest={p.actions.suggest} onSuggest={(comment) => p.onAct('suggest', comment)} />}
      {added && <AddedNotice text={added} onDismiss={() => setAdded(null)} />}

      {multi ? (
        <div className="br-multi">
          <Outline {...p} current={current} seen={looked} pick={pick} />
          <div className="br-main">
            {work && <ProductWork work={work} link={p.links.review} hasVisual={p.visual?.state === 'changes'} />}
            <MultiBody {...p} current={current} seen={looked} pick={pick} mark={mark} />
            <Conversation p={p} onReply={reply} />
            <ChecksRow checks={p.checks} approvals={approvals} />
            {(p.developer || p.code) && <ForDevelopers dev={p.developer} code={p.code} />}
            {/* The visual impact reads into these (scripts/reviews.ts); on a busy branch the before and after shows per change. */}
            {p.visual && <div id="rv-visual" hidden />}
            {p.visual && <div id="rv-visual-ask" hidden={!(p.visual.state === 'not-run' && p.visual.ask)} />}
          </div>
        </div>
      ) : (
        <div className="br-main">
          {work && <ProductWork work={work} link={p.links.review} hasVisual={p.visual?.state === 'changes'} />}
          {single && single.kind !== 'component' && <ChangeBody {...p} change={single} multi={false} />}
          {p.motion && <MotionChanges {...p.motion} />}
          {visualOnTop && <WhereItShows visual={p.visual!} product={p.product} tryUrl={work ? null : p.tryUrl} components={[]} />}
          {!single && !work && <p className="br-muted">Nothing here for design review: the changes are code, a developer reviews them.</p>}
          {single?.kind === 'component' && <p className="br-muted">The code is a developer's to review.</p>}
          <Conversation p={p} onReply={reply} />
          <ChecksRow checks={p.checks} approvals={approvals} />
          {(p.developer || p.code) && <ForDevelopers dev={p.developer} code={p.code} />}
        </div>
      )}

      {p.update && (
        <div className="br-update" id="rv-lib" data-state={p.update}>
          <p className="br-update-text">
            <span id="rv-lib-text" />
            <span className="br-muted" id="rv-lib-hint" aria-live="polite" />
          </p>
          <span id="rv-lib-act" />
        </div>
      )}
      {!p.inQueue && <DecisionBar p={p} leftLine={multi ? progress.leftLine : null} inputRef={inputRef} tried={tried} onTry={tryApprove} />}
    </div>
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Renders the review into `el` (synchronously the first time, so the script can fill its slots). */
export function paintBranchReview(el: HTMLElement, props: BranchReviewProps) {
  if (host !== el || !root) {
    root?.unmount();
    el.replaceChildren();
    root = createRoot(el);
    host = el;
    flushSync(() => root!.render(<BranchReview {...props} />));
    return;
  }
  root.render(<BranchReview {...props} />);
}

export function unmountBranchReview() {
  root?.unmount();
  root = null;
  host = null;
}
