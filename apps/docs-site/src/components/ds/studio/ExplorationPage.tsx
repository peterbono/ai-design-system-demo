// The exploration page while it runs, the validated boards X1 and X2 (Changes > <product> > <exploration>):
// - X1, not started (nothing on the branch beyond the Bridge note): "Not started", who started it, the "Nothing built
//   yet" panel with the line to paste in the viewer's own AI tools only (AiToolPanel.tsx: Claude app, Terminal, VS
//   Code with Copilot; one tool: no tabs; never answered: the inferred ones and "Use another AI tool?"), the tool's
//   button ("Continue in Claude" opens a new Claude conversation with the line in it, after the connect steps while
//   the viewer's own Claude has no Bridge yet: ConnectClaudeDialog; copies it for the Terminal; "Copy for Copilot"),
//   "See the product today", and an empty "Your preview" frame.
// - X2, exploring: "Exploring", who changed what and when, the preview (a captured image when Bridge has one, else a
//   neutral frame) with one group of actions: "Open the preview" (with the Bridge toolbar, Before and After, when the
//   product supports it) and the tool's button, the Harbor card "Happy with it?" (Done exploring), and the last 3
//   events.
// - After Done exploring (Waiting for code, Being built, Shipped), the same family: the status tag, who said done and
//   when, the preview with one action, and the one Harbor zone on what happens next: the hand-off in three steps (the
//   DS Checklist), then what the library gets from it (the pieces Bridge found, each with its request status; Bridge
//   runs that check itself, the page shows it while it runs). The activity under it. A write's line is a DS toast.
// The "..." menu holds Archive. "For developers" folds the branch and the commands. Data: scripts/exploration-page.ts
// over lib/exploration-page.ts. Styles: styles/exploration-page.css.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChevronLeft, Ellipsis, ExternalLink } from 'lucide-react';
import {
  Accordion,
  AccordionItem,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CardBody,
  Checklist,
  ChecklistRow,
  Icon,
  IconButton,
  Link,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  Spinner,
  ToastProvider,
  TokenValue,
  Tooltip,
  useToast,
} from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { Drawing } from './Drawing';
import { Who } from './faces';
import { explorationTag, type ActivityRow, type DoneAction, type HandoffStatus, type HandoffStep, type LibraryPieces, type PageFace, type SentPiece } from '../../../lib/exploration-page';
import { studioHref } from '../../../lib/team-path';
import { plateDrawing } from '../../../lib/branch-thumb';
import { capturedLine } from '../../../lib/preview-shots';
import { TERMINAL_SETUP_LINE } from '../../../lib/claude-connector';
import type { AiTool } from '../../../lib/ai-tools';
import { claudeNewUrl, ToolAction, ToolPanel, useAiTools, type ToolLines, type ToolSetup } from './AiToolPanel';

export { claudeNewUrl };

export type ExplorationStage = 'loading' | 'not-started' | 'exploring' | 'handed-off';

/** After Done exploring: where it stands, the three steps, and what the library gets from it. */
export interface HandoffView {
  status: HandoffStatus;
  /** Who said Done exploring, and when in words ("Oct 30"). */
  doneBy: PageFace | null;
  doneWhen: string;
  steps: HandoffStep[];
  pieces: LibraryPieces;
  /** The one action of a piece still without a library side (send it), when this viewer can. */
  onPiece?: ((piece: SentPiece) => Promise<string | void>) | null;
}

export interface ExplorationPageProps {
  number: number;
  crumbs: { label: string; href?: string }[];
  title: string;
  stage: ExplorationStage;
  /** Who started it, and " · Admin demo · today" after the name. */
  author: PageFace;
  startedTail: string;
  /** The line to paste, per tool: the Claude app's line also goes to Copilot Chat. */
  lines: { app: string; terminal: string };
  /** The product as it is today (X1's quiet link); null when not set up. */
  todayUrl: string | null;
  /** X2: who changed what, when. Null while unread or when nothing reads. */
  headline: ActivityRow | null;
  /** X2: the branch's own build; null while it has none (the note says why in words). */
  previewUrl: string | null;
  /**
   * X2: the same build opened with the Bridge toolbar (`?bridge=<n>`): Live product and This change on the same screen.
   * "Open the preview" opens it instead of the plain build when set. Null for the library's apps and for a product
   * without a production URL (no Before to flip to).
   */
  tryUrl?: string | null;
  previewNote: string | null;
  /** X2: the preview is building: the button reads "Preview is building" with a spinner, at full contrast. */
  previewBuilding?: boolean;
  /**
   * X2: a captured image of the change: the preview capture (lib/preview-shots), else the visual impact's after shot;
   * none: the plate. An image that does not load gives the plate back in the same frame.
   */
  thumb: string | null;
  /** When the preview capture was taken (ISO): "Captured 2 h ago" on the frame. Null for a visual impact shot. */
  thumbCapturedAt?: string | null;
  /** X2: the last 3 events; null while read. */
  activity: ActivityRow[] | null;
  done: DoneAction;
  onDone: (focus: HTMLElement | null) => void;
  /** Archive in the "..." menu; null when not offered. */
  onArchive: (() => Promise<string | void>) | null;
  /** Copies a line (clipboard, else a selection fallback). */
  onCopy: (text: string) => Promise<void>;
  developer: { label: string; value: string }[];
  take: { commands: [string, string]; note: string } | null;
  githubUrl: string;
  /** The line a write produced (Done exploring, Archive): shown once as a DS toast. */
  said?: string;
  /** After Done exploring (stage 'handed-off'). */
  handoff?: HandoffView | null;
  /**
   * The product's name and the screen the exploration changed, for the preview plate while no capture exists. `seed`
   * (the exploration's key) picks the same drawing as its card on the Studio home.
   */
  plate?: { product: string; screen: string | null; seed?: string | null } | null;
  /**
   * Has the viewer connected Bridge in their own Claude (scripts/claude-link.ts)? 'no': "Continue in Claude" and
   * "Check in Claude" show the connect steps first (ConnectClaudeDialog). 'yes', 'unknown' or unset (signed out, the
   * sample team, still reading, a failed read): they open Claude directly.
   */
  claudeLink?: 'yes' | 'no' | 'unknown';
  /** The connector address the steps show (<origin>/mcp). */
  connectorAddress?: string;
  /** "I've connected it, continue": the page forgets the answer and reads it again next time. */
  onClaudeConnected?: () => void;
  /** A product exploration: the command the Terminal needs once in the product's folder (bridge connect). */
  terminalSetup?: string | null;
  /** The command VS Code needs once for Copilot: bridge connect --tool copilot in a product, code --add-mcp for the library. */
  copilotSetup?: { label: string; command: string } | null;
}

/** The tool the panel has open, for the buttons further down the page (Check in Claude, the X2 action). */
const ToolContext = createContext<AiTool>('claude-app');

const linesOf = (p: ExplorationPageProps): ToolLines => ({ 'claude-app': p.lines.app, 'claude-code': p.lines.terminal, copilot: p.lines.app });
const setupOf = (p: ExplorationPageProps): ToolSetup => ({
  'claude-code': p.terminalSetup ? { label: TERMINAL_SETUP_LINE, command: p.terminalSetup } : null,
  copilot: p.copilotSetup ?? null,
});

/** The open tool's button with this page's line and connector gate. */
function ContinueButton({ p, tool, line, say, variant, children, size = 'lg' }: { p: ExplorationPageProps; tool: AiTool; line: string; say: (s: string) => void; variant: 'primary' | 'secondary'; children?: string; size?: 'md' | 'lg' }) {
  return (
    <ToolAction
      tool={tool}
      line={line}
      onCopy={p.onCopy}
      say={say}
      variant={variant}
      size={size}
      {...(p.claudeLink ? { claudeLink: p.claudeLink } : {})}
      {...(p.connectorAddress ? { connectorAddress: p.connectorAddress } : {})}
      {...(p.onClaudeConnected ? { onClaudeConnected: p.onClaudeConnected } : {})}
      {...(children ? { children } : {})}
    />
  );
}

function DoneCard({ p }: { p: ExplorationPageProps }) {
  const d = p.done;
  if (!d) return null;
  return (
    <section className="xp-done zone" aria-labelledby="xp-done-h">
      <h2 className="xp-h2" id="xp-done-h">
        Happy with it?
      </h2>
      <p>Pick what the library should keep. The preview stays for everyone.</p>
      {d.kind === 'note' ? (
        <p className="xp-muted">{d.text}</p>
      ) : d.kind === 'demo' ? (
        <Button variant="inverse" size="md" className="xp-done-btn" data-demo-write="keep an exploration">
          Done exploring
        </Button>
      ) : (
        <Button variant="inverse" size="md" className="xp-done-btn" onClick={(e) => p.onDone(e.currentTarget)}>
          Done exploring
        </Button>
      )}
    </section>
  );
}

function ActivityList({ rows }: { rows: ActivityRow[] | null }) {
  return (
    <section className="xp-activity" aria-labelledby="xp-act-h">
      <h2 className="xp-h2" id="xp-act-h">
        Activity
      </h2>
      {rows === null ? (
        <Skeleton variant="rect" className="xp-skel-rows" />
      ) : (
        <ul className="xp-rows">
          {rows.map((r, i) => (
            <li key={i} className="xp-row">
              <Who p={{ login: r.who.login, name: r.who.name, agent: r.who.agent, avatar: r.who.avatar }} size="sm" />
              <span className="xp-row-text">
                <strong>{r.who.name}</strong> {r.text}
              </span>
              <span className="xp-muted xp-when">{r.when}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The preview while Bridge has no capture of the screen: an honest plate, not a fake wireframe. The changed screen's
 * name in the display face, the product, and a Field Guide drawing (the one of its card, lib/branch-thumb plateDrawing).
 * The frame has the ratio of a capture, so a capture arriving later, or failing to load, moves nothing.
 */
export function ScreenPlate({ product, screen, seed }: { product: string; screen: string | null; seed?: string | null }) {
  return (
    <div className="xp-frame xp-plate" aria-hidden="true">
      <Drawing name={plateDrawing({ seed, screen, product })} width={88} className="xp-plate-art" />
      <span className="xp-plate-text">
        <span className="xp-plate-screen">{screen ?? product}</span>
        <span className="xp-muted">{screen ? `${product} · no screenshot yet` : 'No screenshot yet'}</span>
      </span>
    </div>
  );
}

/** The captured screen, "Captured 2 h ago" in its corner; the plate (or the neutral frame) if the image fails. */
function ShotFrame({ p }: { p: ExplorationPageProps }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!p.thumb || failed === p.thumb) return p.plate ? <ScreenPlate product={p.plate.product} screen={p.plate.screen} seed={p.plate.seed ?? null} /> : <EmptyFrame label={null} />;
  return (
    <div className="xp-frame is-shot">
      <img src={p.thumb} alt="The latest captured screen of this exploration" loading="lazy" onError={() => setFailed(p.thumb)} />
      {p.thumbCapturedAt && <span className="xp-captured">{capturedLine(p.thumbCapturedAt, Date.now())}</span>}
    </div>
  );
}

function EmptyFrame({ label }: { label: string | null }) {
  return (
    <div className={label ? 'xp-frame is-empty' : 'xp-frame is-neutral'} aria-hidden="true">
      <span className="xp-frame-lines">
        <span />
        <span />
        <span />
        <span />
      </span>
      {label && <span className="xp-muted">{label}</span>}
    </div>
  );
}

/** The line a write produced, once, as a DS toast (success, or danger when it says something did not happen). */
function SaidToast({ said }: { said: string | undefined }) {
  const toast = useToast();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!said || shown.current === said) return;
    shown.current = said;
    toast.add({ title: said, tone: 'success', timeout: 8000 });
  }, [said, toast]);
  return null;
}

/** "Waiting for code", "Being built", "Shipped": the tag of the title row, with the same words as the lists. */
function StatusTag({ status, notStarted }: { status: string; notStarted?: boolean }) {
  const t = explorationTag(status, notStarted ? { notStarted } : {});
  return (
    <Badge tone={t.tone} size="md" dot={t.dot} className={status === 'active' && !notStarted ? 'xp-exploring' : undefined}>
      {t.label}
    </Badge>
  );
}

function PieceItem({ piece, onPiece, say }: { piece: SentPiece; onPiece: HandoffView['onPiece']; say: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const act = piece.action && onPiece;
  return (
    <li className="xp-piece-item">
      <Card interactive={Boolean(piece.href)} padding="compact" className="xp-piece">
        <CardBody className="xp-piece-body">
          {/* The value beside the name, unless the name already says it ("New color #C2410C"). */}
          {piece.value && !piece.title.toLowerCase().includes(piece.value.toLowerCase()) && <TokenValue value={piece.value} className="xp-piece-value" aria-hidden="true" />}
          <span className="xp-piece-text">
            {piece.href ? (
              <Link href={piece.href} variant="subtle" data-card-primary {...(piece.opens ? { [`data-open-${piece.opens}`]: piece.number ?? '' } : {})}>
                <strong>{piece.title}</strong>
              </Link>
            ) : (
              <strong>{piece.title}</strong>
            )}
            {piece.line ? (
              <Badge tone={piece.tone} size="md" className="xp-piece-tag">
                {piece.line}
              </Badge>
            ) : (
              !act && <span className="xp-muted">Not sent to the library yet</span>
            )}
          </span>
          {act && (
            <Button
              variant="secondary"
              size="md"
              className="xp-piece-act"
              loading={busy}
              onClick={() => {
                setBusy(true);
                onPiece!(piece)
                  .then((r) => r && say(r))
                  .catch((err: Error) => say(err.message))
                  .finally(() => setBusy(false));
              }}
            >
              {piece.action!.label}
            </Button>
          )}
        </CardBody>
      </Card>
    </li>
  );
}

/** "Check in Claude" (or "Copy for Copilot"): the same check in the open tool. */
function CheckButton({ p, line, say }: { p: ExplorationPageProps; line: string; say: (s: string) => void }) {
  const tool = useContext(ToolContext);
  return (
    <ContinueButton p={p} tool={tool} line={line} say={say} variant="secondary" size="md">
      {tool === 'copilot' ? 'Copy for Copilot' : 'Check in Claude'}
    </ContinueButton>
  );
}

/** What the library gets from it: the pieces with their request status, the check while it runs, or not checked. */
function LibraryPart({ h, p, say }: { h: HandoffView; p: ExplorationPageProps; say: (s: string) => void }) {
  const x = h.pieces;
  if (x.state === 'hidden') return null;
  return (
    <div className="xp-lib">
      <h3 className="xp-h3">For the library</h3>
      {x.state === 'loading' ? (
        <Skeleton variant="rect" className="xp-skel-piece" />
      ) : x.state === 'checking' ? (
        <p className="xp-checking" role="status">
          <Spinner size="sm" />
          Bridge is checking what the library is missing.
        </p>
      ) : x.state === 'none' ? (
        <p>Nothing missing: everything comes from the library.</p>
      ) : x.state === 'unchecked' ? (
        <div className="xp-unchecked">
          <p className="xp-muted">Not checked against the library.</p>
          {x.claude && <CheckButton p={p} line={x.claude} say={say} />}
        </div>
      ) : (
        <ul className="xp-pieces">
          {x.rows.map((r) => (
            <PieceItem key={r.id} piece={r} onPiece={h.onPiece} say={say} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The one Harbor zone after Done exploring: the hand-off in three steps, then the library part. */
function HandoffCard({ h, p, say }: { h: HandoffView; p: ExplorationPageProps; say: (s: string) => void }) {
  return (
    <section className="xp-next zone" aria-labelledby="xp-next-h">
      <h2 className="xp-h2" id="xp-next-h">
        {h.status === 'shipped' ? 'How it went' : 'What happens next'}
      </h2>
      <Checklist label="From exploration to product" className="xp-steps">
        {h.steps.map((s) => (
          <ChecklistRow key={s.title} status={s.status} title={s.title} detail={s.detail} statusLabel={s.status === 'done' ? 'Done' : s.current ? 'Now' : 'Next'} aria-current={s.current ? 'step' : undefined} />
        ))}
      </Checklist>
      <LibraryPart h={h} p={p} say={say} />
    </section>
  );
}

export function ExplorationPage(p: ExplorationPageProps) {
  return (
    <ToastProvider limit={2}>
      <ExplorationBody {...p} />
      <SaidToast said={p.said} />
    </ToastProvider>
  );
}

function ExplorationBody(p: ExplorationPageProps) {
  const { view, tab, setTab } = useAiTools(p.claudeLink);
  const [said, setSaid] = useState('');
  const lines = linesOf(p);
  const line = lines[tab];
  const only = view.tools.length === 1 ? view.tools[0] : null;
  const withWhat = only === 'copilot' ? 'GitHub Copilot' : only ? 'Claude AI' : 'your AI tool';
  const archive = () => {
    setSaid('');
    p.onArchive?.()
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message));
  };
  const notStarted = p.stage === 'not-started';
  const handoff = p.stage === 'handed-off' ? (p.handoff ?? null) : null;
  return (
    <ToolContext.Provider value={tab}>
    <div className="xp-page">
      <div className="xp-top">
        <Breadcrumb items={p.crumbs} className="xp-crumbs" />
        <Link variant="subtle" href={p.crumbs[0]!.href ?? studioHref('changes/')} className="xp-crumbs-phone" data-back="">
          <Icon icon={ChevronLeft} size="sm" /> {p.crumbs[0]!.label}
        </Link>
        <header className="xp-pagehead">
          <h1 className="xp-pagetitle" tabIndex={-1}>
            {p.title}
          </h1>
          {p.stage !== 'loading' && <StatusTag status={handoff ? handoff.status : 'active'} notStarted={notStarted} />}
          <span className="xp-spacer" />
          {p.onArchive && (
            <Menu>
              <Tooltip content="More actions">
                <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" size="lg" />} />
              </Tooltip>
              <MenuContent align="end">
                <MenuItem onClick={archive}>Archive</MenuItem>
              </MenuContent>
            </Menu>
          )}
        </header>
        {handoff ? (
          <p className="xp-meta">
            {handoff.doneBy && <Who p={{ login: handoff.doneBy.login, name: handoff.doneBy.name, agent: handoff.doneBy.agent, avatar: handoff.doneBy.avatar }} size="xs" />}
            <span>
              {handoff.doneBy ? (
                <>
                  <strong>{handoff.doneBy.name}</strong> said done exploring
                </>
              ) : (
                'Done exploring'
              )}
              {handoff.doneWhen && <span className="xp-muted">, {handoff.doneWhen}</span>}
              {handoff.doneBy?.login !== p.author.login && <span className="xp-muted"> · started by {p.author.name}</span>}
            </span>
          </p>
        ) : p.stage === 'exploring' && p.headline ? (
          <p className="xp-meta">
            <Who p={{ login: p.headline.who.login, name: p.headline.who.name, agent: p.headline.who.agent, avatar: p.headline.who.avatar }} size="xs" />
            <span>
              <strong>{p.headline.who.name}</strong> {p.headline.text}, <span className="xp-muted">{p.headline.when}</span>
            </span>
          </p>
        ) : (
          <p className="xp-meta">
            <Who p={{ login: p.author.login, name: p.author.name, agent: p.author.agent, avatar: p.author.avatar }} size="xs" />
            <span>
              Started by <strong>{p.author.name}</strong>
              {p.startedTail && <span className="xp-muted"> · {p.startedTail}</span>}
            </span>
          </p>
        )}
      </div>
      {p.stage === 'loading' && <Skeleton variant="rect" className="xp-skel" />}
      {notStarted && (
        <section className="xp-start" aria-labelledby="xp-start-h">
          <div className="xp-start-text">
            <div className="xp-start-intro">
              <h2 className="xp-h-lg" id="xp-start-h">
                Nothing built yet
              </h2>
              <p className="xp-body">You explore with {withWhat} and the library. Your preview appears here after the first change.</p>
            </div>
            <ToolPanel tools={view.tools} tab={tab} setTab={setTab} chosen={view.chosen} lines={lines} setup={setupOf(p)} onCopy={p.onCopy} say={setSaid} />
            <div className="xp-acts">
              <ContinueButton p={p} tool={tab} line={line} say={setSaid} variant="primary" />
              {p.todayUrl && (
                <Link href={p.todayUrl} target="_blank" rel="noopener" className="xp-today">
                  See the product today
                </Link>
              )}
            </div>
          </div>
          <EmptyFrame label="Your preview" />
        </section>
      )}
      {(p.stage === 'exploring' || handoff) && (
        // The preview and the Harbor zone end on one line: the preview's frame takes the height the zone beside it needs
        // (within a screen-like ratio). While exploring, the activity sits under the Harbor card; after Done exploring,
        // under the preview, so the hand-off and the preview stay side by side (styles/exploration-page.css).
        <div className={handoff ? 'xp-board is-handoff' : 'xp-board'}>
          <section className="xp-preview" aria-label="Preview">
            <ShotFrame p={p} />
            <div className={handoff ? 'xp-acts' : 'xp-acts xp-preview-acts'}>
              {p.previewUrl ? (
                // The preview with the Bridge toolbar when the product has one (Before and After live in its toolbar).
                <ButtonLink variant="primary" size="lg" href={p.tryUrl ?? p.previewUrl} target="_blank" rel="noopener" iconEnd={ExternalLink} aria-describedby={p.previewNote ? 'xp-preview-note' : undefined}>
                  {handoff?.status === 'shipped' ? 'See it in the product' : 'Open the preview'}
                </ButtonLink>
              ) : p.previewBuilding ? (
                // A status, not a dead control: Button's loading state keeps the primary colors (no disabled grey).
                <Button variant="primary" size="lg" loading>
                  Preview is building
                </Button>
              ) : (
                <Button variant="primary" size="lg" disabled aria-describedby={p.previewNote ? 'xp-preview-note' : undefined}>
                  Open the preview
                </Button>
              )}
              {!handoff && <ContinueButton p={p} tool={tab} line={line} say={setSaid} variant="secondary" />}
            </div>
            {p.previewNote && !(p.previewBuilding && !p.previewUrl) && (
              <p className="xp-muted xp-note" id="xp-preview-note">
                {p.previewNote}
              </p>
            )}
          </section>
          <div className="xp-side">
            {handoff ? <HandoffCard h={handoff} p={p} say={setSaid} /> : <DoneCard p={p} />}
            {!handoff && <ActivityList rows={p.activity} />}
          </div>
          {handoff && <ActivityList rows={p.activity} />}
        </div>
      )}
      <p className="xp-said" role="status" aria-live="polite">
        {said}
      </p>
      <Accordion className="xp-dev" headingLevel={2}>
        <AccordionItem value="dev" title="For developers">
          {p.take && (
            <div className="xp-dev-take">
              <p>{p.take.note}</p>
              <pre className="xp-mono xp-dev-commands">
                <code>{p.take.commands.join('\n')}</code>
              </pre>
            </div>
          )}
          <dl className="xp-dev-list">
            {p.developer.map((d) => (
              <div key={d.label} className="xp-dev-row">
                <dt>{d.label}</dt>
                <dd className="xp-mono">{d.value}</dd>
              </div>
            ))}
          </dl>
          <Link href={p.githubUrl} target="_blank" rel="noopener">
            Open on GitHub
          </Link>
        </AccordionItem>
      </Accordion>
    </div>
    </ToolContext.Provider>
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Renders the page into `el` (synchronously the first time). */
export function paintExplorationPage(el: HTMLElement, props: ExplorationPageProps) {
  if (host === el && !el.querySelector(':scope > .xp-page')) {
    root = null;
    host = null;
  }
  if (host !== el || !root) {
    root?.unmount();
    el.replaceChildren();
    root = createRoot(el);
    host = el;
    flushSync(() => root!.render(<ExplorationPage {...props} />));
    return;
  }
  root.render(<ExplorationPage {...props} />);
}

export function unmountExplorationPage() {
  root?.unmount();
  root = null;
  host = null;
}
