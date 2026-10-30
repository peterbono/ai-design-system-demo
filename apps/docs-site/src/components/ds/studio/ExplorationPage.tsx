// The exploration page while it runs, the validated boards X1 and X2 (Changes > <product> > <exploration>):
// - X1, not started (nothing on the branch beyond the Bridge note): "Not started", who started it, the "Nothing built
//   yet" panel with the line to paste in Claude (Claude app or Terminal), "Continue in Claude" (copies the line),
//   "See the product today", and an empty "Your preview" frame.
// - X2, exploring: "Exploring", who changed what and when, the preview (a captured image when Bridge has one, else a
//   neutral frame) with "Open the preview" and "Continue in Claude", the Harbor card "Happy with it?" (Done
//   exploring), and the last 3 events.
// The "..." menu holds Archive. "For developers" folds the branch and the commands. Data: scripts/exploration-page.ts
// over lib/exploration-page.ts. Styles: styles/exploration-page.css.
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChevronLeft, Copy as CopyIcon, Ellipsis, ExternalLink } from 'lucide-react';
import { Accordion, AccordionItem, Avatar, Badge, Breadcrumb, Button, Icon, IconButton, Link, Menu, MenuContent, MenuItem, MenuTrigger, SegmentedControl, Skeleton, Tooltip } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { Who } from './faces';
import type { ActivityRow, DoneAction, PageFace } from '../../../lib/exploration-page';
import { studioHref } from '../../../lib/team-path';

export type ExplorationStage = 'loading' | 'not-started' | 'exploring';
export type ClaudeWhere = 'app' | 'terminal';

export interface ExplorationPageProps {
  number: number;
  crumbs: { label: string; href?: string }[];
  title: string;
  stage: ExplorationStage;
  /** Who started it, and " · Admin demo · today" after the name. */
  author: PageFace;
  startedTail: string;
  /** The line to paste in Claude, per tab. */
  lines: { app: string; terminal: string };
  /** The product as it is today (X1's quiet link); null when not set up. */
  todayUrl: string | null;
  /** X2: who changed what, when. Null while unread or when nothing reads. */
  headline: ActivityRow | null;
  /** X2: the branch's own build; null while it has none (the note says why in words). */
  previewUrl: string | null;
  previewNote: string | null;
  /** X2: a captured image of the change (the visual impact's after shot), else a neutral frame. */
  thumb: string | null;
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
  said?: string;
}

const COPIED = 'Copied. Paste it in Claude.';

function ClaudeGlyph({ size = 'xs' }: { size?: 'xs' | 'sm' }) {
  return <Avatar kind="agent" brand="claude" name="Claude" size={size} decorative className="xp-claude" />;
}

function ContinuePanel({ p, where, setWhere, say }: { p: ExplorationPageProps; where: ClaudeWhere; setWhere: (w: ClaudeWhere) => void; say: (s: string) => void }) {
  const line = where === 'app' ? p.lines.app : p.lines.terminal;
  const copy = () => p.onCopy(line).then(() => say(COPIED), () => say('Select the line and copy it.'));
  return (
    <div className="xp-paste">
      <div className="xp-paste-head">
        <span className="xp-muted" id="xp-paste-label">
          Paste this in Claude
        </span>
        <SegmentedControl
          size="sm"
          label="Where you use Claude"
          value={where}
          onValueChange={(v) => setWhere(v as ClaudeWhere)}
          items={[
            { value: 'app', label: 'Claude app' },
            { value: 'terminal', label: 'Terminal' },
          ]}
        />
      </div>
      <div className="xp-paste-body">
        <code className="xp-line" id="xp-line">
          {line}
        </code>
        <Tooltip content="Copy">
          <IconButton icon={CopyIcon} label="Copy the line" variant="secondary" size="sm" onClick={() => void copy()} />
        </Tooltip>
      </div>
    </div>
  );
}

function ContinueButton({ p, line, say, variant }: { p: ExplorationPageProps; line: string; say: (s: string) => void; variant: 'primary' | 'secondary' }) {
  return (
    <Button variant={variant} size="lg" className="xp-continue" onClick={() => void p.onCopy(line).then(() => say(COPIED), () => say('Select the line and copy it.'))}>
      <ClaudeGlyph />
      Continue in Claude
    </Button>
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
      ) : d.kind === 'connect' ? (
        <Button variant="inverse" size="md" className="xp-done-btn" data-gh-open="" data-demo-write="keep an exploration">
          {d.label}
        </Button>
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

export function ExplorationPage(p: ExplorationPageProps) {
  const [where, setWhere] = useState<ClaudeWhere>('app');
  const [said, setSaid] = useState(p.said ?? '');
  const line = where === 'app' ? p.lines.app : p.lines.terminal;
  const archive = () => {
    setSaid('');
    p.onArchive?.()
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message));
  };
  const notStarted = p.stage === 'not-started';
  return (
    <div className="xp">
      <div className="xp-top">
        <Breadcrumb items={p.crumbs} className="xp-crumbs" />
        <Link variant="subtle" href={p.crumbs[0]!.href ?? studioHref('changes/')} className="xp-crumbs-phone" data-back="">
          <Icon icon={ChevronLeft} size="sm" /> {p.crumbs[0]!.label}
        </Link>
        <header className="xp-head">
          <h1 className="xp-title" tabIndex={-1}>
            {p.title}
          </h1>
          {p.stage !== 'loading' &&
            (notStarted ? (
              <Badge tone="neutral" size="md">
                Not started
              </Badge>
            ) : (
              <Badge tone="info" size="md" dot>
                Exploring
              </Badge>
            ))}
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
        {p.stage === 'exploring' && p.headline ? (
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
              <p className="xp-body">You explore with Claude AI and the library. Your preview appears here after the first change.</p>
            </div>
            <ContinuePanel p={p} where={where} setWhere={setWhere} say={setSaid} />
            <div className="xp-acts">
              <ContinueButton p={p} line={line} say={setSaid} variant="primary" />
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
      {p.stage === 'exploring' && (
        <div className="xp-grid">
          <section className="xp-preview" aria-label="Preview">
            {p.thumb ? (
              <div className="xp-frame is-shot">
                <img src={p.thumb} alt="The latest captured screen of this exploration" loading="lazy" />
              </div>
            ) : (
              <EmptyFrame label={null} />
            )}
            <div className="xp-acts">
              {p.previewUrl ? (
                <ButtonLink variant="primary" size="lg" href={p.previewUrl} target="_blank" rel="noopener" iconEnd={ExternalLink} aria-describedby={p.previewNote ? 'xp-preview-note' : undefined}>
                  Open the preview
                </ButtonLink>
              ) : (
                <Button variant="primary" size="lg" disabled aria-describedby={p.previewNote ? 'xp-preview-note' : undefined}>
                  Open the preview
                </Button>
              )}
              <ContinueButton p={p} line={p.lines.app} say={setSaid} variant="secondary" />
            </div>
            {p.previewNote && (
              <p className="xp-muted xp-note" id="xp-preview-note">
                {p.previewNote}
              </p>
            )}
          </section>
          <div className="xp-side">
            <DoneCard p={p} />
            <ActivityList rows={p.activity} />
          </div>
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
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Renders the page into `el` (synchronously the first time). */
export function paintExplorationPage(el: HTMLElement, props: ExplorationPageProps) {
  if (host === el && !el.querySelector(':scope > .xp')) {
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
