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
//   events, with "Where it stands" (WhereItStands.tsx, the handover notes) above them.
// - After Done exploring (Waiting for code, Being built, Shipped), the same family: the status tag, who said done and
//   when, the preview with one action, and the one Harbor zone on what happens next: the hand-off in four steps (the
//   DS Checklist), then what the library gets from it (the pieces Bridge found, each with its request status; Bridge
//   runs that check itself, the page shows it while it runs). The activity under it. A write's line is a DS toast.
// - "Send to Figma", one of the actions under the preview for who can edit when the team has a Figma file: it hands the
//   request to the viewer's own Claude, which rebuilds the exploration in Figma. Once Claude recorded the page, the link.
// The "..." menu holds Rename (a DS Dialog), Back to exploring (a confirmation, waiting for code only) and Archive. "For developers" folds the branch and the commands. Data: scripts/exploration-page.ts
// over lib/exploration-page.ts. Styles: styles/exploration-page.css.
import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChevronLeft, Ellipsis, ExternalLink } from 'lucide-react';
import {
  Accordion,
  AccordionItem,
  AlertDialog,
  AlertDialogContent,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  Checklist,
  ChecklistRow,
  Dialog,
  DialogClose,
  DialogContent,
  Icon,
  IconButton,
  Input,
  Link,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  Spinner,
  Textarea,
  ToastProvider,
  TokenValue,
  Tooltip,
  useToast,
  VisuallyHidden,
} from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { Drawing } from './Drawing';
import { Who } from './faces';
import type { DesignAnswer, LifecycleStage } from '../../../lib/review-state';
import { clipQuote, explorationTag, questionWords, type ActivityRow, type DoneAction, type HandoffStatus, type HandoffStep, type LibraryPieces, type PageFace, type SentPiece } from '../../../lib/exploration-page';
import { studioHref } from '../../../lib/team-path';
import { ARCHIVED_LINE } from '../../../lib/explorations-view';
import { EXPLORATION_STAGE_LABEL, startedWhen } from '@bridge-ds/core';
import { plateDrawing } from '../../../lib/branch-thumb';
import { capturedLine } from '../../../lib/preview-shots';
import { CONNECT_FIRST, connectFirst, TERMINAL_SETUP_LINE } from '../../../lib/claude-connector';
import type { AiTool } from '../../../lib/ai-tools';
import { DEV_MESSAGE_WORDS } from '../../../lib/developers-message';
import { useCopy } from './TeamLink';
import { ClaudeGlyph, claudeNewUrl, ConnectClaudeButton, ConnectFirst, ToolAction, ToolPanel, useAiTools, useClaudeRecheck, type ToolLines, type ToolSetup } from './AiToolPanel';
import { WhereItStands, type WhereItStandsView } from './WhereItStands';
import { Decisions, DesignerZone, HandOverDialog, LeadBar, NotDoingZone, TellDevelopers, WhyDialog, type DesignerZoneView, type HandOverPerson, type LeadBarView, type NotDoingView } from './LeadDecisions';
import type { DecisionRowView } from '../../../lib/lead-decisions';

export { claudeNewUrl };

export type ExplorationStage = 'loading' | 'not-started' | 'exploring' | 'handed-off';

/** Waiting for the design lead: one line, their answer when the viewer is a lead, Keep exploring for who asked. */
export interface LeadView {
  line: string;
  /** The review bar, for a lead (LeadDecisions.tsx). */
  bar?: LeadBarView | null;
  onCancel?: (() => Promise<string | void>) | null;
}

/** After Done exploring: where it stands, the four steps, and what the library gets from it. */
export interface HandoffView {
  status: HandoffStatus;
  /** The lifecycle's stage (lib/review-state): In review and In the next release have their own tag. */
  stage?: LifecycleStage | null;
  /** Who said Done exploring, and when in words ("Oct 30"). */
  doneBy: PageFace | null;
  doneWhen: string;
  steps: HandoffStep[];
  pieces: LibraryPieces;
  /** The one action of a piece still without a library side (send it), when this viewer can. */
  onPiece?: ((piece: SentPiece) => Promise<string | void>) | null;
  /**
   * The designer's answer on the developers' version (a design copy exploration whose developers opened their pull
   * request): Looks right, or Needs changes with a short text. Null when there is nothing to answer or the viewer cannot.
   */
  onAnswer?: ((a: DesignAnswer) => Promise<string | void>) | null;
  /**
   * Someone asked the designer something on the task: their words (plain text; null when only a label asks),
   * who and when, whether the designer answered since, and the reply when this viewer can write it.
   */
  question?: {
    text: string | null;
    by: PageFace | null;
    when: string;
    answered: boolean;
    onReply?: ((text: string) => Promise<string | void>) | null;
  } | null;
  /** The developers closed it without building it: their last word, when they left one. */
  declined?: { note: { text: string; by: PageFace; when: string } | null } | null;
  /**
   * A product added from its address, for a team member: its developers work elsewhere, so "Copy for your developers"
   * sits on the "Developers build it" step with the plain message to paste where they work (lib/developers-message).
   */
  forDevelopers?: { message: string } | null;
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
  /** "See the library today" for a library exploration, else "See the product today". */
  todayLabel?: string;
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
  /**
   * The preview's toolbar is older than the read pass (lib/read-pass-link.ts toolbarTakesPass): the link never carries
   * the member's pass, which that toolbar would leave in the address (an empty page).
   */
  tryWithoutPass?: boolean;
  previewNote: string | null;
  /**
   * A running exploration of the design team's copy that misses changes the product made since it started: the quiet
   * line and "Bring it in" (merges the copy's main into it). Null when it is up to date or Bridge cannot say.
   */
  latest?: { line: string; onBring: () => Promise<string> } | null;
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
  /** Done exploring asked the design lead and they have not answered yet. */
  lead?: LeadView | null;
  /** The lead's last open word, for the designer to answer (boards L3, L4). */
  designerZone?: DesignerZoneView | null;
  /** Ended by a lead, with the reason (board L5). */
  notDoing?: NotDoingView | null;
  /** The tag while the talk decides what it is ("Needs changes"), over the lifecycle's own. */
  tag?: { label: string; tone: 'danger' | 'neutral' | 'info' } | null;
  /** Everything the designer and their lead said, newest first. */
  decisions?: readonly DecisionRowView[];
  /** "Take it back", for a lead on someone else's exploration no developer started (board L2). */
  onTakeBack?: ((reason: string) => Promise<string | void>) | null;
  /** Developers started: a word on their task, for a lead. */
  onTellDevelopers?: ((text: string) => Promise<string | void>) | null;
  /** "Take it over" and "Hand over" in the "..." menu, for a lead. */
  onTakeOver?: ((reason: string) => Promise<string | void>) | null;
  handOver?: { people: readonly HandOverPerson[]; onConfirm: (to: string, reason: string) => Promise<string | void> } | null;
  /** A lead archiving someone else's work says why: Archive asks first. */
  archiveAsksWhy?: boolean;
  /** Rename in the "..." menu: saves the new name on GitHub; null when not offered. */
  onRename?: ((name: string) => Promise<string | void>) | null;
  /** Back to exploring in the "..." menu (waiting for code, no developer push yet); null when not offered. */
  onReopen?: (() => Promise<string | void>) | null;
  /** Archive in the "..." menu; null when not offered. */
  onArchive: ((reason?: string) => Promise<string | void>) | null;
  /**
   * Archived: hidden from the lists, its preview still works. The page keeps its layout (the preview, the activity),
   * the tag reads Archived, one line says so with Unarchive, and nothing offers Done exploring or to keep working
   * (no Open in Claude Code, Continue in your AI tool or Bring it in): the preview is the bar's one action.
   */
  archived?: boolean;
  /** Unarchive, beside the archived line; null when this viewer cannot. */
  onUnarchive?: (() => Promise<string | void>) | null;
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
  /** A designer (joined with their email, or with GitHub but working in the copy through Bridge): the Claude app with Bridge is their one tool. */
  emailMember?: boolean;
  /** The connector address the steps show (<origin>/mcp). */
  connectorAddress?: string;
  /** "I've connected it, continue": the page forgets the answer and reads it again next time. */
  onClaudeConnected?: () => void;
  /** The connection read again (useClaudeRecheck, back from Claude): the page repaints with it. */
  onClaudeLink?: (v: 'yes' | 'no' | 'unknown') => void;
  /** A product exploration: the command the Terminal needs once in the product's folder (bridge connect). */
  terminalSetup?: string | null;
  /** The command VS Code needs once for Copilot: bridge connect --tool copilot in a product, code --add-mcp for the library. */
  copilotSetup?: { label: string; command: string } | null;
  /**
   * In the design team's copy of a product (lib/design-copy.ts claudeCodeUrl): "Open in Claude Code" opens the copy on
   * this exploration's branch, and stands for the AI tool panel and its Continue button.
   */
  claudeCodeUrl?: string | null;
  /**
   * "Where it stands": the handover notes (decisions, edge cases, open questions, next step), above the activity while
   * it runs. Editable in place by whoever can edit the exploration (onSave), read only otherwise. Unset: not shown
   * (after Done exploring they stay readable when the branch keeps them).
   */
  notes?: WhereItStandsView | null;
  /** "Send to Figma": the line for the viewer's Claude (lib/exploration-page canPutInFigma). Unset or null: no button. */
  figma?: { app: string; terminal: string } | null;
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
  if (p.claudeCodeUrl)
    return (
      <ButtonLink variant={variant} size={size} className="xp-continue" href={p.claudeCodeUrl} target="_blank" rel="noopener">
        <ClaudeGlyph />
        Open in Claude Code
      </ButtonLink>
    );
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

/** While the design lead has not answered: where it stands, their answer in the bar at the bottom of the page. */
function LeadCard({ lead, say }: { lead: LeadView; say: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="xp-done zone" aria-labelledby="xp-lead-h">
      <h2 className="xp-h2" id="xp-lead-h">
        {lead.bar ? 'Ready for the developers?' : 'With your lead'}
      </h2>
      <p>{lead.line}</p>
      {lead.onCancel && (
        <Button
          variant="inverse"
          size="md"
          className="xp-done-btn"
          loading={busy}
          onClick={() => {
            setBusy(true);
            lead.onCancel!()
              .then((r) => r && say(r))
              .catch((err: Error) => say(err.message))
              .finally(() => setBusy(false));
          }}
        >
          Keep exploring
        </Button>
      )}
    </section>
  );
}

function DoneCard({ p, tool, line, say }: { p: ExplorationPageProps; tool: AiTool; line: string; say: (s: string) => void }) {
  if (p.notDoing) return <NotDoingZone v={p.notDoing} say={say} />;
  if (p.designerZone) return <DesignerZone z={p.designerZone} say={say} extra={<ContinueButton p={p} tool={tool} line={line} say={say} variant="secondary" size="md" />} />;
  if (p.lead) return p.archived ? null : <LeadCard lead={p.lead} say={say} />;
  const d = p.done;
  if (!d || p.archived) return null;
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
function StatusTag({ status, notStarted, stage }: { status: string; notStarted?: boolean; stage?: LifecycleStage | null }) {
  const t = explorationTag(status, { ...(notStarted ? { notStarted } : {}), stage: stage ?? null });
  return (
    <Badge tone={t.tone} size="md" dot={t.dot} className={status === 'active' && !notStarted && !stage ? 'xp-exploring' : undefined}>
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

/**
 * The designer's answer on the developers' version, under the steps: Looks right in one click, Needs changes opens a
 * short text first (progressive disclosure). Bridge posts it on the developers' pull request.
 */
const DEV_ANSWER_WORDS = { hint: 'The developers read it on their work.', send: 'Send to the developers' };

function DevAnswer({ onAnswer, say }: { onAnswer: NonNullable<HandoffView['onAnswer']>; say: (s: string) => void }) {
  const words = DEV_ANSWER_WORDS;
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'looks-right' | 'changes' | null>(null);
  const send = (a: DesignAnswer) => {
    setBusy(a.kind);
    onAnswer(a)
      .then((r) => r && say(r))
      .catch((err: Error) => say(err.message))
      .finally(() => setBusy(null));
  };
  if (asking) {
    return (
      <form
        className="xp-answer"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (text.trim()) send({ kind: 'changes', text });
        }}
      >
        <Textarea label="What should change" hint={words.hint} rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <ButtonGroup>
          <Button type="submit" variant="primary" size="md" loading={busy === 'changes'} disabled={!text.trim()}>
            {words.send}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={() => setAsking(false)} disabled={busy !== null}>
            Cancel
          </Button>
        </ButtonGroup>
      </form>
    );
  }
  return (
    <ButtonGroup>
      <Button variant="secondary" size="md" loading={busy === 'looks-right'} onClick={() => send({ kind: 'looks-right' })}>
        Looks right
      </Button>
      <Button variant="ghost" size="md" disabled={busy !== null} onClick={() => setAsking(true)}>
        Needs changes
      </Button>
    </ButtonGroup>
  );
}

/**
 * A developer's words, quoted as plain text (React escapes it: never HTML), cut after a few lines with "Show more",
 * after who said it and when (the name introduces the words it belongs to).
 */
function DevQuote({ text, by, when }: { text: string; by: PageFace | null; when: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { short, clipped } = clipQuote(text);
  return (
    <figure className="xp-quote">
      {by && (
        <figcaption className="xp-muted xp-quote-by">
          <Who p={{ login: by.login, name: by.name, agent: by.agent, avatar: by.avatar }} size="xs" />
          <span>
            {by.name}
            {when ? `, ${when}` : ''}
          </span>
        </figcaption>
      )}
      <blockquote id={id} className="xp-quote-text">
        {open ? text : short}
      </blockquote>
      {clipped && (
        <Button variant="link" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </figure>
  );
}

/**
 * The question on the task, under the steps: the asker's words (named, never "the developers" by default), and the
 * reply box when this viewer can answer. Once the designer answered, one quiet line says so and the words stay.
 */
function DevQuestion({ q, say }: { q: NonNullable<HandoffView['question']>; say: (s: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!q.onReply || !text.trim()) return;
    setBusy(true);
    q.onReply(text)
      .then((r) => r && say(r))
      .catch((err: Error) => say(err.message))
      .finally(() => setBusy(false));
  };
  const w = questionWords(q.by);
  return (
    <section className="xp-question" aria-label={q.by ? `${q.by.name}'s question` : 'A question for you'}>
      {q.text ? <DevQuote text={q.text} by={q.by} when={q.when} /> : !q.answered && <p>{w.needsInput}</p>}
      {q.answered ? (
        <p className="xp-muted">{w.answered}</p>
      ) : (
        q.onReply && (
          <form className="xp-answer xp-reply" onSubmit={send}>
            <Textarea label="Your answer" hint={w.hint} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            {/* What waits on the viewer: the view's one primary action (the preview's button steps back meanwhile). */}
            <Button type="submit" variant="primary" size="md" className="xp-reply-send" loading={busy} disabled={!text.trim()}>
              {w.send}
            </Button>
          </form>
        )
      )}
    </section>
  );
}

/** "Art print shop changed since this exploration started. Bring it in": quiet, one link-sized action. */
function LatestLine({ latest, say }: { latest: NonNullable<ExplorationPageProps['latest']>; say: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <p className="xp-muted xp-note xp-latest">
      {latest.line}{' '}
      <Button
        variant="link"
        size="sm"
        loading={busy}
        onClick={() => {
          setBusy(true);
          latest
            .onBring()
            .then(say)
            .finally(() => setBusy(false));
        }}
      >
        Bring it in
      </Button>
    </p>
  );
}

/**
 * The way to Figma, in the block of actions under the preview: the page Claude built, once recorded, then the action.
 * It always hands the line to the viewer's AI tool: Claude Code's copy of the product has no Figma connector of its own
 * to count on.
 */
function FigmaAction({ p, tool, say }: { p: ExplorationPageProps; tool: AiTool; say: (s: string) => void }) {
  const page = p.notes?.notes?.figmaPage ?? null;
  if (!page && !p.figma) return null;
  const to = p.claudeCodeUrl ? 'claude-app' : tool;
  return (
    <>
      {page && (
        <ButtonLink variant="secondary" size="lg" href={page} target="_blank" rel="noopener" iconEnd={ExternalLink}>
          See it in Figma
        </ButtonLink>
      )}
      {p.figma && (
        <ToolAction
          tool={to}
          line={to === 'claude-code' ? p.figma.terminal : p.figma.app}
          onCopy={p.onCopy}
          say={say}
          variant="secondary"
          size="lg"
          {...(p.claudeLink ? { claudeLink: p.claudeLink } : {})}
          {...(p.connectorAddress ? { connectorAddress: p.connectorAddress } : {})}
          {...(p.onClaudeConnected ? { onClaudeConnected: p.onClaudeConnected } : {})}
        >
          {page ? 'Send to Figma again' : 'Send to Figma'}
        </ToolAction>
      )}
    </>
  );
}

/** A question on the task the viewer has not answered yet and can answer here: what waits on them. */
const waitsOnAnswer = (h: HandoffView | null): boolean => Boolean(h && !h.declined && h.status !== 'shipped' && h.question && !h.question.answered && h.question.onReply);

/** The developers' version waits for the viewer's eyes (Review is now, and they can answer): opening it is the next step. */
const reviewsVersion = (h: HandoffView | null): boolean =>
  Boolean(h && !h.declined && h.onAnswer && h.steps.some((s) => s.title === 'Review' && s.current) && h.steps.some((s) => s.link));

/** The one Harbor zone after Done exploring: the hand-off in four steps, then the library part. */
function HandoffCard({ h, p, say, onBack, onTakeBack }: { h: HandoffView; p: ExplorationPageProps; say: (s: string) => void; onBack?: (() => void) | null; onTakeBack?: (() => void) | null }) {
  const version = h.steps.find((s) => s.link)?.link ?? null;
  const asks = waitsOnAnswer(h);
  // The message for developers who work elsewhere: copied from the step it acts on, which then says so.
  const { copied, said, copy } = useCopy(3000);
  const send = h.forDevelopers && !h.declined && h.status !== 'shipped' ? h.forDevelopers : null;
  return (
    <section className="xp-next zone" aria-labelledby="xp-next-h">
      <h2 className="xp-h2" id="xp-next-h">
        {h.status === 'shipped' ? 'How it went' : 'What happens next'}
      </h2>
      {/* The question waiting on the viewer leads the zone (on a phone too): what needs them first, the steps after. */}
      {asks && <DevQuestion q={h.question!} say={say} />}
      <Checklist label="From exploration to product" className="xp-steps">
        {h.steps.map((s) => {
          // The step it acts on says why (their developers work elsewhere) and holds the quiet copy on the same line; a
          // row action would squeeze the details of this narrow zone to one word a line.
          const sends = send && s.title === 'Developers build it' && s.current;
          const line = sends && (copied || (said && said !== DEV_MESSAGE_WORDS.said)) ? said : s.detail;
          return (
            <ChecklistRow
              key={s.title}
              status={s.status}
              title={s.title}
              detail={
                sends ? (
                  <span className="xp-send">
                    <span>{line}</span>
                    <Button variant="link" size="sm" onClick={() => void copy(send.message, DEV_MESSAGE_WORDS.said)}>
                      {DEV_MESSAGE_WORDS.copy}
                    </Button>
                  </span>
                ) : (
                  s.detail
                )
              }
              statusLabel={s.status === 'done' ? 'Done' : s.current ? 'Now' : 'Next'}
              aria-current={s.current ? 'step' : undefined}
            />
          );
        })}
      </Checklist>
      {send && <VisuallyHidden role="status">{said}</VisuallyHidden>}
      {/* The developers' version opens under the steps, not inside a row: a row action squeezed every detail to a word. */}
      {version && reviewsVersion(h) ? (
        // Their version is what the viewer has to look at before answering: the view's one primary action.
        <ButtonLink variant="primary" size="lg" className="xp-fill" href={version.href} target="_blank" rel="noopener" iconEnd={ExternalLink}>
          {version.label}
        </ButtonLink>
      ) : version && (
        <p className="xp-version">
          <Link href={version.href} target="_blank" rel="noopener">
            {version.label}
            <ExternalLink aria-hidden="true" size={14} />
          </Link>
        </p>
      )}
      {h.declined ? (
        // Declined: their last word, if any, then the one way forward.
        <div className="xp-declined">
          {h.declined.note && <DevQuote text={h.declined.note.text} by={h.declined.note.by} when={h.declined.note.when} />}
          {onBack && (
            <Button variant="primary" size="lg" className="xp-fill" onClick={onBack}>
              Back to exploring
            </Button>
          )}
        </div>
      ) : (
        h.question && !asks && h.status !== 'shipped' && <DevQuestion q={h.question} say={say} />
      )}
      {!h.declined && h.onAnswer && h.steps.some((s) => s.title === 'Review' && s.current) && <DevAnswer onAnswer={h.onAnswer} say={say} />}
      {onTakeBack && (
        <Button variant="secondary" size="lg" className="xp-self-start" onClick={onTakeBack}>
          Take it back
        </Button>
      )}
      {p.onTellDevelopers && <TellDevelopers onSend={p.onTellDevelopers} say={say} />}
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
  const { view, tab, setTab } = useAiTools(p.claudeLink, p.emailMember);
  const [said, setSaid] = useState('');
  // Nothing built yet and the viewer's own Claude has no Bridge: the connect steps first, read again on coming back.
  const first = !p.claudeCodeUrl && connectFirst(tab, p.claudeLink) && p.stage === 'not-started' && !p.archived;
  useClaudeRecheck(first, (v) => {
    p.onClaudeLink?.(v);
    if (v === 'yes') setSaid(CONNECT_FIRST.connected);
  });
  const lines = linesOf(p);
  const line = lines[tab];
  const only = view.tools.length === 1 ? view.tools[0] : null;
  const withWhat = only === 'copilot' ? 'GitHub Copilot' : only ? 'Claude AI' : 'your AI tool';
  const [ask, setAsk] = useState<'rename' | 'reopen' | 'take-back' | 'take-over' | 'hand-over' | 'archive' | null>(null);
  const [reopening, setReopening] = useState(false);
  const archive = () => {
    setSaid('');
    p.onArchive?.()
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message));
  };
  const [unarchiving, setUnarchiving] = useState(false);
  const unarchive = () => {
    setSaid('');
    setUnarchiving(true);
    p.onUnarchive?.()
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message))
      .finally(() => setUnarchiving(false));
  };
  const reopenIt = () => {
    setSaid('');
    setReopening(true);
    p.onReopen?.()
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message))
      .finally(() => {
        setReopening(false);
        setAsk(null);
      });
  };
  const notStarted = p.stage === 'not-started';
  const handoff = p.stage === 'handed-off' ? (p.handoff ?? null) : null;
  // Declined by the developers: Back to exploring is the one primary action, the preview steps back.
  const declined = Boolean(handoff?.declined);
  // The Harbor zone holds what waits on the viewer (Back to exploring, or the answer to a question): the preview's
  // button steps back to secondary, one primary action per view.
  // The lead's words wait on the viewer: the zone answers them and holds the way back to their AI tool.
  const answers = Boolean(p.designerZone?.onSend) || Boolean(p.notDoing);
  const zoneLeads = declined || waitsOnAnswer(handoff) || reviewsVersion(handoff) || answers;
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
          {p.stage !== 'loading' &&
            (p.tag ? (
              <Badge tone={p.tag.tone} size="md">
                {p.tag.label}
              </Badge>
            ) : p.archived ? (
              <Badge tone="neutral" size="md">
                {EXPLORATION_STAGE_LABEL.archived}
              </Badge>
            ) : (
              <StatusTag status={handoff ? handoff.status : 'active'} notStarted={notStarted} stage={handoff?.stage ?? (p.lead ? 'waiting-for-lead' : null)} />
            ))}
          <span className="xp-spacer" />
          {(p.onRename || p.onReopen || p.onArchive || p.onTakeOver || p.handOver) && (
            // Last on the title's line, on a phone too (the title wraps beside it).
            <span className="xp-more">
              <Menu>
                <Tooltip content="More actions">
                  <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" size="lg" />} />
                </Tooltip>
                <MenuContent align="end">
                  {p.onRename && <MenuItem onClick={() => setAsk('rename')}>Rename</MenuItem>}
                  {p.onReopen && <MenuItem onClick={() => setAsk('reopen')}>Back to exploring</MenuItem>}
                  {p.onTakeOver && <MenuItem onClick={() => setAsk('take-over')}>Take it over</MenuItem>}
                  {p.handOver && <MenuItem onClick={() => setAsk('hand-over')}>Hand over</MenuItem>}
                  {p.onArchive && <MenuItem onClick={() => (p.archiveAsksWhy ? setAsk('archive') : archive())}>Archive</MenuItem>}
                </MenuContent>
              </Menu>
            </span>
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
      {p.archived && !p.notDoing && p.stage !== 'loading' && (
        <div className="xp-archived">
          <p className="xp-muted">{ARCHIVED_LINE}</p>
          {p.onUnarchive && (
            <Button variant="secondary" size="md" disabled={unarchiving} onClick={unarchive}>
              {unarchiving ? 'Unarchiving' : 'Unarchive'}
            </Button>
          )}
        </div>
      )}
      {p.stage === 'loading' && <Skeleton variant="rect" className="xp-skel" />}
      {notStarted && (
        <section className="xp-start" aria-labelledby="xp-start-h">
          <div className="xp-start-text">
            <div className="xp-start-intro">
              <h2 className="xp-h-lg" id="xp-start-h">
                Nothing built yet
              </h2>
              {!p.archived && (
              <p className="xp-body">
                {p.claudeCodeUrl
                  ? "You explore with Claude Code in your team's copy of the product, with the library. Your preview appears here after the first change."
                  : `You explore with ${withWhat} and the library. Your preview appears here after the first change.`}
              </p>
              )}
            </div>
            {/* Archived: nothing to keep working on here, only Unarchive (above) and the product as it is today. */}
            {p.archived ? null : first ? (
              <ConnectFirst address={p.connectorAddress ?? '/mcp'} onCopy={p.onCopy}>
                <ToolPanel tools={view.tools} tab={tab} setTab={setTab} chosen={view.chosen} lines={lines} setup={setupOf(p)} onCopy={p.onCopy} say={setSaid} />
              </ConnectFirst>
            ) : (
              !p.claudeCodeUrl && <ToolPanel tools={view.tools} tab={tab} setTab={setTab} chosen={view.chosen} lines={lines} setup={setupOf(p)} onCopy={p.onCopy} say={setSaid} />
            )}
            <div className="xp-acts">
              {p.archived ? null : first ? <ConnectClaudeButton /> : <ContinueButton p={p} tool={tab} line={line} say={setSaid} variant="primary" />}
              {p.todayUrl && (
                <Link href={p.todayUrl} target="_blank" rel="noopener" className="xp-today">
                  {p.todayLabel ?? 'See the product today'}
                </Link>
              )}
            </div>
          </div>
          <EmptyFrame label="Your preview" />
        </section>
      )}
      {notStarted && p.notes && <WhereItStands view={p.notes} say={setSaid} />}
      {(p.stage === 'exploring' || handoff) && (
        // The preview and the Harbor zone end on one line: the preview's frame takes the height the zone beside it needs
        // (within a screen-like ratio). While exploring, the activity sits under the Harbor card; after Done exploring,
        // under the preview, so the hand-off and the preview stay side by side (styles/exploration-page.css).
        <div className={handoff ? 'xp-board is-handoff' : 'xp-board'}>
          <section className="xp-preview" aria-label="Preview">
            <ShotFrame p={p} />
            <div className="xp-acts xp-preview-acts">
              {p.previewUrl ? (
                // The preview with the Bridge toolbar when the product has one (Before and After live in its toolbar).
                <ButtonLink variant={zoneLeads ? 'secondary' : 'primary'} size="lg" href={p.tryUrl ?? p.previewUrl} target="_blank" rel="noopener" iconEnd={ExternalLink} data-bridge-pass={p.tryWithoutPass ? 'off' : undefined} aria-describedby={p.previewNote ? 'xp-preview-note' : undefined}>
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
              {/* Archived: the preview still opens, nothing offers to keep working on it (Unarchive first). */}
              {!handoff && !p.archived && !answers && <ContinueButton p={p} tool={tab} line={line} say={setSaid} variant="secondary" />}
              {!p.archived && !answers && <FigmaAction p={p} tool={tab} say={setSaid} />}
            </div>
            {p.previewNote && !(p.previewBuilding && !p.previewUrl) && (
              <p className="xp-muted xp-note" id="xp-preview-note">
                {p.previewNote}
              </p>
            )}
            {!handoff && !p.archived && p.latest && <LatestLine latest={p.latest} say={setSaid} />}
          </section>
          <div className="xp-side">
            {handoff ? <HandoffCard h={handoff} p={p} say={setSaid} onBack={p.onReopen ? () => setAsk('reopen') : null} onTakeBack={p.onTakeBack ? () => setAsk('take-back') : null} /> : <DoneCard p={p} tool={tab} line={line} say={setSaid} />}
            {p.decisions && <Decisions rows={p.decisions} when={startedWhen} />}
            {p.notes && (!handoff || p.notes.notes) && <WhereItStands view={p.notes} say={setSaid} />}
            {!handoff && <ActivityList rows={p.activity} />}
          </div>
          {handoff && <ActivityList rows={p.activity} />}
        </div>
      )}
      {p.lead?.bar && !p.archived && <LeadBar bar={p.lead.bar} say={setSaid} />}
      <p className="xp-said" role="status" aria-live="polite">
        {said}
      </p>
      {p.onTakeBack && (
        <WhyDialog
          open={ask === 'take-back'}
          onOpenChange={(o) => setAsk(o ? 'take-back' : null)}
          title="Take it back from the developers?"
          description="It leaves their list and goes back to its designer, with your reason. They read it on this page and by email."
          confirm="Take it back"
          onConfirm={(why) => p.onTakeBack!(why).then((r) => setSaid(r ?? ''))}
        />
      )}
      {p.onTakeOver && (
        <WhyDialog
          open={ask === 'take-over'}
          onOpenChange={(o) => setAsk(o ? 'take-over' : null)}
          title="Take it over?"
          description="You carry it on from here. Whoever kept it reads your reason on this page."
          confirm="Take it over"
          onConfirm={(why) => p.onTakeOver!(why).then((r) => setSaid(r ?? ''))}
        />
      )}
      {p.handOver && <HandOverDialog open={ask === 'hand-over'} onOpenChange={(o) => setAsk(o ? 'hand-over' : null)} people={p.handOver.people} onConfirm={(to, why) => p.handOver!.onConfirm(to, why).then((r) => setSaid(r ?? ''))} />}
      {p.archiveAsksWhy && p.onArchive && (
        <WhyDialog
          open={ask === 'archive'}
          onOpenChange={(o) => setAsk(o ? 'archive' : null)}
          title="Archive this exploration?"
          description="It leaves the lists. Its preview stays, and whoever kept it reads your reason on this page."
          confirm="Archive"
          onConfirm={(why) => p.onArchive!(why).then((r) => setSaid(r ?? ''))}
        />
      )}
      {p.onRename && (
        <RenameDialog
          open={ask === 'rename'}
          name={p.title}
          onOpenChange={(o) => setAsk(o ? 'rename' : null)}
          onSave={async (name) => {
            setSaid('');
            const r = await p.onRename!(name);
            setAsk(null);
            setSaid(r ?? '');
          }}
        />
      )}
      {p.onReopen && (
        <AlertDialog open={ask === 'reopen'} onOpenChange={(o) => !reopening && setAsk(o ? 'reopen' : null)}>
          <AlertDialogContent
            title="Back to exploring?"
            description={declined ? 'Your developers closed it without building it. The exploration runs again and Done exploring comes back.' : 'Your developers have not started yet. The exploration runs again and Done exploring comes back.'}
            confirmLabel="Back to exploring"
            cancelLabel="Cancel"
            tone="primary"
            closeOnConfirm={false}
            loading={reopening}
            onConfirm={reopenIt}
          />
        </AlertDialog>
      )}
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

/** "Rename this exploration": the name prefilled, Save writes it on GitHub; a refusal shows under the field. */
function RenameDialog({ open, name, onOpenChange, onSave }: { open: boolean; name: string; onOpenChange: (open: boolean) => void; onSave: (name: string) => Promise<void> }) {
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValue(name);
    setError(null);
  }, [open, name]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (!next) return setError('Name the exploration, for example "Denser data tables".');
    if (next === name.trim()) return onOpenChange(false);
    setBusy(true);
    onSave(next)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        title="Rename this exploration"
        size="sm"
        initialFocus={input}
        hideClose
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
            <Button type="submit" form={formId} variant="primary" loading={busy} disabled={busy}>
              Save
            </Button>
          </ButtonGroup>
        }
      >
        <form id={formId} onSubmit={submit} noValidate>
          <Input
            ref={input}
            label="Name"
            autoComplete="off"
            value={value}
            onValueChange={(v) => {
              setValue(v);
              if (error) setError(null);
            }}
            error={error ?? undefined}
          />
        </form>
      </DialogContent>
    </Dialog>
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
  // The detail may have been written over already (a loading line): React then throws removing nodes that are gone,
  // which left the detail blank after Archive. The effects still clean up; the next paint starts a new root.
  try {
    root?.unmount();
  } catch {
    // Its nodes were already replaced.
  }
  root = null;
  host = null;
}
