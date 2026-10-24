// The suggestion review: a DS lead decides on one suggestion (a change filed as a GitHub issue, applied later by a
// developer). Built on the "Decide in seconds" direction: one change at a time on a card, who suggests it, Before and
// After, three proof chips (design system checks, contrast in light and dark, where it is used), a big Approve with
// Suggest changes next to it, and the next items stacked behind the card. A suggestion approved for an older version,
// or one main moved under, says so first. Approve and Suggest changes show only to owners; everyone else reads why.
// Details (who approved, every token, previews, the GitHub link) stay folded. Opened from Branches (?suggestion=N) and
// in the review queue. Data, GitHub writes and words: scripts/suggestions.ts, lib/suggestions-view.ts.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Check, CircleAlert, Ellipsis, Minus, TriangleAlert, X } from 'lucide-react';
import {
  Accordion,
  AccordionItem,
  Alert,
  Badge,
  Breadcrumb,
  Button,
  ButtonGroup,
  Card,
  Checklist,
  ChecklistRow,
  CodeBlock,
  IconButton,
  Kbd,
  Link,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Textarea,
  TokenValue,
  Tooltip,
  type ChecklistStatus,
} from '@bridge-ds/react';
import { Face, TokenRows, type PersonRef } from './BranchReview';
import { Who, type Face as FaceData } from './faces';
import { suggestionHref, SUGGESTION_WORDS, type ProofChip, type StaleView, type SuggestionGate, type SuggestionTokenRow } from '../../../lib/suggestions-view';
import { valueName } from '../../../lib/review-page';

/** A queue item waiting after this one, drawn as a card stacked behind. */
export interface NextCard {
  key: string;
  title: string;
  person?: FaceData | null;
}

export interface SuggestionReviewProps {
  n: number;
  /** The issue on GitHub, for "Open on GitHub". */
  url: string;
  title: string;
  /** "Token change", "Docs change". */
  kind: string;
  summary: string;
  author: PersonRef;
  source: string;
  createdAt: string;
  status: { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' };
  tokens: SuggestionTokenRow[];
  docs: { component: string; after: unknown }[];
  spec: { component: string; brief: string } | null;
  /** Other files it writes (brand, settings, undo), changelog entries left out. */
  files: string[];
  proofs: ProofChip[];
  /** Whose checks the chips show: today's main, still being run, or the ones recorded when it was suggested. */
  proofsWhen: 'today' | 'checking' | 'suggested';
  stale: StaleView[];
  /** The machine-readable part was edited on GitHub after Bridge wrote it. */
  edited: boolean;
  approvals: { label: string; state: 'approved' | 'changes' | 'waiting'; text: string }[];
  gate: SuggestionGate;
  approveLabel: string;
  /** Approved: how a developer applies it. */
  apply: { label: string; value: string }[] | null;
  /** The viewer is a developer (a tech owner): the commands show, folded under For developers. Designers never see them. */
  developer?: boolean;
  previews: { label: string; url: string }[];
  next: NextCard[];
  crumbs?: { label: string; href?: string }[] | undefined;
  inQueue: boolean;
  /** The result of the last decision, said once. */
  said?: string | undefined;
  onApprove: (text: string) => Promise<string | void>;
  onRequestChanges: (text: string) => Promise<string | void>;
  onDecline: () => void;
}

const PANE_ROWS = 4;
const PEEKS = 3;

const WHEN: Record<SuggestionReviewProps['proofsWhen'], string> = {
  today: "Checked on today's main.",
  checking: "Checking on today's main.",
  suggested: 'Checked when it was suggested.',
};

const PROOF_ICON = { success: Check, danger: X, warning: TriangleAlert, neutral: Minus } as const;
const APPROVAL_STATUS: Record<'approved' | 'changes' | 'waiting', ChecklistStatus> = { approved: 'done', changes: 'failed', waiting: 'waiting' };

// ---------------------------------------------------------------------------------------------------------------
// Before and After

function Swatch({ hex }: { hex: string | null }) {
  return hex ? <span className="sg-swatch" aria-hidden="true" style={{ backgroundColor: hex }} /> : <span className="sg-swatch is-none" aria-hidden="true" />;
}

function TokenPane({ rows, side }: { rows: SuggestionTokenRow[]; side: 'before' | 'after' }) {
  return (
    <ul className="sg-pane-list">
      {rows.slice(0, PANE_ROWS).map((r) => {
        const v = side === 'before' ? r.before : r.after;
        return (
          <li key={r.path} className="sg-pane-row">
            <Swatch hex={v?.hex ?? null} />
            <span className="sg-pane-text">
              <span className="sg-pane-name">
                {r.path}
                {r.contexts.length > 0 && ` · ${r.contexts.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')}`}
              </span>
              {v ? <TokenValue value={v.alias ? `{${v.alias}}` : (v.css ?? '')} resolved={v.alias ? (v.css ?? undefined) : undefined} swatch={false} size="sm" title={valueName(v)} /> : <span className="sg-muted">{side === 'before' ? 'Not in the library yet' : 'Removed'}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function docsLine(after: unknown): string | null {
  if (after && typeof after === 'object' && typeof (after as { summary?: unknown }).summary === 'string') return (after as { summary: string }).summary;
  return null;
}

function BeforeAfter({ p }: { p: SuggestionReviewProps }) {
  if (p.tokens.length) {
    const more = p.tokens.length - PANE_ROWS;
    return (
      <div className="sg-ba">
        <section className="sg-side" aria-label="Before">
          <p className="sg-side-label">Before</p>
          <div className="sg-pane">
            <TokenPane rows={p.tokens} side="before" />
          </div>
        </section>
        <section className="sg-side" aria-label="After">
          <p className="sg-side-label">After</p>
          <div className="sg-pane is-after">
            <TokenPane rows={p.tokens} side="after" />
          </div>
        </section>
        {more > 0 && <p className="sg-muted sg-ba-more">And {more} more {more === 1 ? 'token' : 'tokens'}, in the details.</p>}
      </div>
    );
  }
  const body: ReactNode = p.docs.length ? (
    <ul className="sg-pane-list">
      {p.docs.map((d) => (
        <li key={d.component} className="sg-pane-row is-text">
          <span className="sg-pane-text">
            <span className="sg-pane-name">{d.component} docs</span>
            <span>{docsLine(d.after) ?? 'New usage guidance for this component.'}</span>
          </span>
        </li>
      ))}
    </ul>
  ) : p.spec ? (
    <p className="sg-brief">{p.spec.brief}</p>
  ) : (
    <ul className="sg-pane-list">
      {p.files.map((f) => (
        <li key={f} className="sg-pane-row is-text">
          <span className="sg-pane-name">{f}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="sg-ba is-one">
      <section className="sg-side" aria-label="Suggested">
        <p className="sg-side-label">{p.spec ? `${p.spec.component}, as suggested` : 'Suggested'}</p>
        <div className="sg-pane is-after">{body}</div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Proof, and the folded details

function Proof({ p }: { p: SuggestionReviewProps }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="sg-proof" aria-label="Checks">
      <div className="sg-proof-row">
        <ul className="sg-chips">
          {p.proofs.map((c) => (
            <li key={c.key}>
              <Tooltip content={c.detail}>
                <Badge tone={c.tone} icon={PROOF_ICON[c.tone]} className="sg-chip" tabIndex={0}>
                  {c.label}
                </Badge>
              </Tooltip>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`sg-details-${p.n}`} onClick={() => setOpen(!open)}>
          {open ? 'Hide details' : 'Details'}
        </Button>
      </div>
      <p className="sg-muted sg-when">{WHEN[p.proofsWhen]}</p>
      <div id={`sg-details-${p.n}`} className="sg-details" hidden={!open}>
        <Checklist label="Who approves it">
          {p.approvals.map((a) => (
            <ChecklistRow key={a.label} status={APPROVAL_STATUS[a.state]} title={a.label} detail={a.text} />
          ))}
        </Checklist>
        <ul className="sg-detail-lines">
          {p.proofs.map((c) => (
            <li key={c.key}>{c.detail}</li>
          ))}
        </ul>
        {p.tokens.length > PANE_ROWS && <TokenRows rows={p.tokens} />}
        {p.previews.length > 0 && (
          <p className="sg-links">
            {p.previews.map((x) => (
              <Link key={x.url} href={x.url} external>
                {x.label}
              </Link>
            ))}
          </p>
        )}
        <p className="sg-links">
          <Link href={p.url} external>
            Open on GitHub
          </Link>
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The decision

function Decide({ p }: { p: SuggestionReviewProps }) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'approve' | 'changes' | null>(null);
  const [said, setSaid] = useState(p.said ?? '');
  const [invalid, setInvalid] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const g = p.gate;
  useEffect(() => {
    setSaid(p.said ?? '');
  }, [p.said]);
  useEffect(() => {
    if (asking) field.current?.focus();
  }, [asking]);

  const run = async (kind: 'approve' | 'changes') => {
    if (kind === 'changes' && !text.trim()) {
      setInvalid('Say what should change, in a sentence or two: the author reads it.');
      field.current?.focus();
      return;
    }
    setBusy(kind);
    setSaid('');
    try {
      const r = kind === 'approve' ? await p.onApprove('') : await p.onRequestChanges(text.trim());
      setText('');
      setAsking(false);
      setSaid(r ?? '');
    } catch (err) {
      setSaid((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${suggestionHref(p.n)}`);
      setSaid('Link to this suggestion copied.');
    } catch {
      setSaid('Copy is not available in this browser. Copy the address from the address bar.');
    }
  };

  const acts = g.canApprove || g.canRequestChanges;
  // Decline stays reachable when nothing else is (an outdated suggestion): in More actions, next to the reason.
  const more = acts || g.canDecline;
  return (
    <footer className="sg-foot" role="region" aria-label="Your decision">
      {asking ? (
        <div className="sg-ask">
          <Textarea
            ref={field}
            label="What should change?"
            rows={3}
            hint={`${p.author.name} reads it on GitHub and can send a new version.`}
            error={invalid ?? undefined}
            value={text}
            onValueChange={(v) => {
              setText(v);
              setInvalid(null);
            }}
          />
          <ButtonGroup align="end">
            <Button variant="secondary" size="lg" disabled={busy !== null} onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy === 'changes'} onClick={() => void run('changes')}>
              Send to {p.author.name}
            </Button>
          </ButtonGroup>
        </div>
      ) : (
        <div className="sg-foot-row">
          {more ? (
            g.why && <p className="sg-why">{g.why}</p>
          ) : (
            <p className="sg-why">
              <span>{g.why}</span>{' '}
              <Link href={p.url} external>
                Open on GitHub
              </Link>
            </p>
          )}
          {more && (
            <>
              {g.canRequestChanges && (
                <Button variant="secondary" size="lg" data-sg-suggest="" data-demo-write="review suggestions" disabled={busy !== null} onClick={() => setAsking(true)}>
                  {SUGGESTION_WORDS.requestChanges}
                </Button>
              )}
              {g.canApprove && (
                <Button variant="primary" size="lg" className="sg-approve" data-sg-approve="" data-demo-write="review suggestions" iconEnd={Check} loading={busy === 'approve'} disabled={busy !== null} onClick={() => void run('approve')}>
                  {p.approveLabel}
                </Button>
              )}
              <Menu>
                <Tooltip content="More actions">
                  <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" size="lg" />} />
                </Tooltip>
                <MenuContent side="top" align="end">
                  <MenuItem onClick={() => void copy()}>Copy link</MenuItem>
                  <MenuItem onClick={() => window.open(p.url, '_blank', 'noopener')}>Open on GitHub</MenuItem>
                  {g.canDecline && <MenuSeparator />}
                  {g.canDecline && (
                    <MenuItem tone="danger" onClick={p.onDecline}>
                      {SUGGESTION_WORDS.decline}
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            </>
          )}
        </div>
      )}
      <p className="sg-said" role="status" aria-live="polite">
        {said}
      </p>
    </footer>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function Peeks({ next }: { next: NextCard[] }) {
  const shown = next.slice(0, PEEKS).reverse();
  if (!shown.length) return null;
  return (
    <div className="sg-peeks" aria-hidden="true">
      {shown.map((c, i) => (
        <div key={c.key} className="sg-peek" style={{ marginInline: `calc(var(--space-6) * ${shown.length - i})` }}>
          {c.person && <Who p={c.person} size="xs" />}
          <span className="sg-peek-text">{c.title}</span>
        </div>
      ))}
    </div>
  );
}

/** The why the person wrote: the summary before any section Bridge appends ("## Docs to check"). */
export const whyOf = (summary: string | null | undefined): string => (summary ?? '').split(/\n\s*#{1,6}\s/)[0]!.trim();

export function SuggestionReview(p: SuggestionReviewProps) {
  const keys = p.inQueue && p.gate.canApprove;
  return (
    <div className="sg">
      {p.crumbs && <Breadcrumb items={p.crumbs} className="sg-crumbs" />}
      <div className="sg-stage">
        <Peeks next={p.next} />
        <Card className="sg-card" padding="none">
          <header className="sg-head">
            <Face person={p.author} size="md" />
            <div className="sg-head-text">
              <p className="sg-who">
                <strong>{p.author.name}</strong> <span className="sg-muted">suggests a change</span>
              </p>
              <h2 className="sg-title br-title" tabIndex={-1}>
                {p.title}
              </h2>
              <p className="sg-meta">
                <Badge tone={p.status.tone} size="sm">
                  {p.status.label}
                </Badge>
                <span className="sg-muted">{p.kind}</span>
              </p>
            </div>
            {keys && (
              <p className="sg-keys sg-muted" aria-label="Keyboard: A approve, S suggest changes, J next">
                <span className="sg-key">
                  <Kbd keys="A" size="sm" /> approve
                </span>
                <span className="sg-key">
                  <Kbd keys="S" size="sm" /> suggest
                </span>
                <span className="sg-key">
                  <Kbd keys="J" size="sm" /> next
                </span>
              </p>
            )}
          </header>
          <div className="sg-body">
            {p.stale.map((s) => (
              <Alert key={s.title} tone={s.tone} title={s.title} announce="off" icon={s.tone === 'success' ? undefined : CircleAlert}>
                {s.text}
              </Alert>
            ))}
            {p.edited && (
              <Alert tone="warning" title="Edited by hand on GitHub" announce="off">
                Someone changed the suggestion on GitHub after Bridge wrote it. Check the details before you approve.
              </Alert>
            )}
            {whyOf(p.summary) && <p className="sg-summary">{whyOf(p.summary)}</p>}
            <BeforeAfter p={p} />
            <Proof p={p} />
            {p.apply && (
              <section className="sg-apply" aria-label={SUGGESTION_WORDS.ready}>
                <p className="sg-apply-title">{SUGGESTION_WORDS.ready}</p>
                <p className="sg-muted">{SUGGESTION_WORDS.applyHint}</p>
                {p.developer && (
                  <Accordion appearance="flush" headingLevel={3} className="sg-dev">
                    <AccordionItem value="developers" title="For developers">
                      {p.apply.map((l) => (
                        <CodeBlock key={l.label} label={l.label} code={l.value} />
                      ))}
                    </AccordionItem>
                  </Accordion>
                )}
              </section>
            )}
          </div>
          <Decide p={p} />
        </Card>
      </div>
    </div>
  );
}

function Loading({ crumbs }: { crumbs?: SuggestionReviewProps['crumbs'] }) {
  return (
    <div className="sg">
      {crumbs && <Breadcrumb items={crumbs} className="sg-crumbs" />}
      <Card className="sg-card is-loading" padding="none" aria-busy="true">
        <Skeleton variant="rect" className="sg-skel" />
        <p className="sr-only" role="status">
          Loading the suggestion
        </p>
      </Card>
    </div>
  );
}

function Failed({ error, url, crumbs }: { error: string; url: string; crumbs?: SuggestionReviewProps['crumbs'] }) {
  return (
    <div className="sg">
      {crumbs && <Breadcrumb items={crumbs} className="sg-crumbs" />}
      <Alert tone="danger" title="This suggestion cannot be shown" actions={<Link href={url} external>Open on GitHub</Link>}>
        {error}
      </Alert>
    </div>
  );
}

const roots = new Map<HTMLElement, Root>();

type PaintProps = SuggestionReviewProps | { loading: true; crumbs?: SuggestionReviewProps['crumbs'] } | { error: string; url: string; crumbs?: SuggestionReviewProps['crumbs'] };

/** Renders into `el` (synchronously the first time, so focus can move to the title right after). */
export function paintSuggestionReview(el: HTMLElement, props: PaintProps) {
  const node = 'loading' in props ? <Loading crumbs={props.crumbs} /> : 'error' in props ? <Failed {...props} /> : <SuggestionReview {...props} />;
  let r = roots.get(el);
  if (!r) {
    el.replaceChildren();
    r = createRoot(el);
    roots.set(el, r);
    flushSync(() => r!.render(node));
    return;
  }
  r.render(node);
}

export function unmountSuggestionReview(el: HTMLElement) {
  roots.get(el)?.unmount();
  roots.delete(el);
}
