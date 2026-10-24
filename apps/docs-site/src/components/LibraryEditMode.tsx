// Edit mode of a Library component page, in place: same URL (?edit=1), same layout, same live preview. Only the top
// bar, the prose sections and the right rail switch to editing. A client-only island that renders into slots of
// pages/components/[slug].astro through portals. Pure rules live in lib/library-edit-model.ts; sending reuses the
// docs save path (lib/docs-draft-model.ts, scripts/docs-commit.ts); drafting goes through scripts/docs-ai.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Alert, AlertDialog, AlertDialogContent, Badge, Button, Dialog, DialogContent, IconButton, Input, Link, Menu, MenuContent, MenuGroup, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Spinner, Textarea } from '@bridge-ds/react';
import { Check, ChevronDown, Circle, CircleX, Copy, Ellipsis, PenLine, Plus, Sparkles, X } from 'lucide-react';
import { docsAuthorLine, DRAFT_PHRASE, type ComponentDocsJson, type DocsGuidance, type ProseKey } from '@bridge-ds/core';
import { REGISTRY, resolveProps } from './registry';
import type { ExampleNode } from '../lib/components';
import { cleanDocs, docsEdits, docsFileText, setDocsEdit, validateDocs, type DocsEdit } from '../lib/docs-draft-model';
import type { Draft } from '../lib/editor-model';
import { parseJiraKey, VOCAB } from '../lib/vocabulary';
import { SEE_SUGGESTION, sendButton as sendWords, SUGGESTION_SENT, suggestionSentLine } from '../lib/gh-wording';
import { changesModeOnPage } from '../scripts/changes-mode';
import {
  SECTIONS,
  applyDraft,
  authorship,
  continueLine,
  cancelNeedsConfirm,
  changeTitle,
  changedLabel,
  discardDrafts,
  docsToSend,
  editBarLabel,
  editBarState,
  editMeta,
  escapeIntent,
  fieldId,
  getField,
  initEdit,
  isDirty,
  keepAllLabel,
  keepDrafts,
  pendingSections,
  replaceSelection,
  restoreMeta,
  sectionById,
  sectionOf,
  sectionState,
  sendBlockedReason,
  sendTitle,
  setField,
  setValue,
  toReview,
  guestEditLine,
  type EditState,
  type FieldRef,
  type SectionId,
} from '../lib/library-edit-model';
import type { DraftScope, DraftWay } from '../scripts/docs-ai';
import { studioHref } from '../lib/team-path';
import { COPY_SETUP, developerSetupMessage } from '../lib/docs-ai-model';

export interface LibraryEditModeProps {
  name: string;
  slug: string;
  /** Repo path of the docs.json. */
  path: string;
  /** The docs.json on main, as text, or null when the component has none. */
  original: string | null;
  /** Where editing starts: the docs on main, or the deterministic pre-fill when there are none. */
  initial: ComponentDocsJson;
  repo: { owner: string; repo: string };
  /**
   * A team's Library page (components/ds/library/LibraryTeamComponents.tsx): its Studio address for a path, and how a
   * branch's docs.json is read (through the member's session: private repositories and email members). Absent on this
   * site's own pages: this site's Studio, and the raw host.
   */
  team?: { studio: (path: string) => string; readFile: (path: string, ref: string) => Promise<string | undefined> };
}

type DocsAi = typeof import('../scripts/docs-ai');
type Selection = { field: FieldRef; start: number; end: number; text: string };
type Proposal = Selection & { replacement: string };

const DRAFT_KEY = 'bridge.draft.v1';
const metaKey = (path: string) => `bridge.library-edit.v1:${path}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: the draft lives for this page */
  }
}
const readDraft = () => readJson<Draft>(DRAFT_KEY, { edits: [] });
function writeDraft(d: Draft) {
  writeJson(DRAFT_KEY, d);
  document.dispatchEvent(new CustomEvent('bridge:draft'));
}
const announce = (msg: string) => {
  const live = document.getElementById('live');
  if (live) live.textContent = msg;
};
const isEditUrl = () => new URLSearchParams(location.search).get('edit') === '1';
function setEditUrl(on: boolean) {
  const q = new URLSearchParams(location.search);
  if (on) q.set('edit', '1');
  else ['edit', 'pr', 'ref'].forEach((k) => q.delete(k));
  const qs = q.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

/** Opens the shared Connect GitHub dialog (scripts/github-session.ts listens for clicks on [data-gh-open]). */
function openConnect() {
  const b = document.createElement('button');
  b.type = 'button';
  b.hidden = true;
  b.setAttribute('data-gh-open', '');
  // On the demo, a visitor who cannot write sees "Make it yours" instead (scripts/demo-gate.ts).
  b.setAttribute('data-demo-write', 'save usage guidance');
  document.body.appendChild(b);
  b.click();
  b.remove();
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Examples: the static HTML of the read page when the example did not change, else rendered with the registry.       */

const ExampleHtml = createContext<Map<string, string>>(new Map());

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

function VerdictExample({ node, inert }: { node: ExampleNode; inert?: boolean }) {
  // The read page's own example markup (React-rendered at build time, props sanitised by registry resolveProps).
  const html = useContext(ExampleHtml).get(JSON.stringify(node));
  const extra = inert ? ({ inert: '' } as object) : {};
  return html !== undefined ? (
    <div className="verdict-stage" data-theme="light" {...extra} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className="verdict-stage" data-theme="light" {...extra}>
      {renderNode(node)}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Editing context: what fields need from the island.                                                                 */

interface Ctx {
  state: EditState;
  writing: Set<SectionId>;
  proposal: Proposal | null;
  canDraft: boolean;
  drafting: boolean;
  setText: (f: FieldRef, text: string) => void;
  setList: (key: ProseKey, value: ComponentDocsJson[ProseKey]) => void;
  onFocusField: (f: FieldRef) => void;
  onSelectField: (sel: Selection | null) => void;
  write: (id: SectionId) => void;
  draftSection: (id: SectionId) => void;
  keep: (id: SectionId) => void;
  discard: (id: SectionId) => void;
  keepProposal: () => void;
  discardProposal: () => void;
  focusRequest: string | null;
}
const EditCtx = createContext<Ctx | null>(null);
const useEdit = () => useContext(EditCtx)!;

/** The DS inline Textarea: reads like the text it edits (same font, measure and line height) and fits its content. */
function InlineText({ field, label, className, placeholder, onKeyDown }: { field: FieldRef; label: string; className?: string; placeholder?: string; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const e = useEdit();
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = getField(e.state.docs, field);
  const id = fieldId(field);
  useEffect(() => {
    if (e.focusRequest === id) ref.current?.focus();
  }, [e.focusRequest, id]);
  const track = () => {
    const t = ref.current;
    if (!t) return;
    e.onSelectField(t.selectionStart < t.selectionEnd ? { field, start: t.selectionStart, end: t.selectionEnd, text: t.value.slice(t.selectionStart, t.selectionEnd) } : null);
  };
  return (
    <Textarea
      ref={ref}
      appearance="inline"
      className={`le-text${className ? ` ${className}` : ''}`}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      data-field={id}
      onChange={(ev) => e.setText(field, ev.target.value)}
      onFocus={() => e.onFocusField(field)}
      onSelect={track}
      onKeyUp={track}
      onMouseUp={track}
      onKeyDown={onKeyDown}
    />
  );
}

/** Under a section heading: Keep and Discard for a Claude draft, Write and Draft for an empty or outdated section. */
function SectionControls({ id }: { id: SectionId }) {
  const e = useEdit();
  const st = sectionState(e.state, id);
  const label = sectionById(id).label;
  if (st === 'drafted')
    return (
      <div className="le-actions" role="group" aria-label={`${label}: Claude draft`}>
        <Button size="sm" variant="secondary" iconStart={Check} onClick={() => e.keep(id)}>
          Keep
        </Button>
        <Button size="sm" variant="ghost" onClick={() => e.discard(id)}>
          Discard
        </Button>
      </div>
    );
  if ((st === 'empty' && !e.writing.has(id)) || st === 'outdated')
    return (
      <div className="le-actions" role="group" aria-label={`${label}: ${st === 'empty' ? 'empty' : 'outdated'}`}>
        {st === 'empty' && <span className="le-empty">Empty.</span>}
        <Button size="sm" variant="secondary" iconStart={PenLine} onClick={() => e.write(id)}>
          Write
        </Button>
        <Button size="sm" variant="ghost" iconStart={Sparkles} disabled={e.drafting} onClick={() => e.draftSection(id)}>
          Draft with Claude
        </Button>
      </div>
    );
  return null;
}

/** Next to a heading: what the section waits for. */
function SectionFlag({ id }: { id: SectionId }) {
  const e = useEdit();
  const st = sectionState(e.state, id);
  if (st === 'drafted')
    return (
      <span className="le-flag">
        <Avatar kind="agent" brand="claude" size="xs" decorative />
        <Badge tone="info">{e.state.updated.includes(id) ? 'Updated' : 'Drafted'} by Claude · review it</Badge>
      </span>
    );
  if (st === 'outdated') return <Badge tone="warning">Outdated: the code changed since</Badge>;
  if (e.state.accurate.includes(id))
    return (
      <span className="le-quiet">
        <Check size={16} aria-hidden="true" /> Still accurate
      </span>
    );
  return null;
}

/** On the edge of an editable region, on hover: says the region is editable. Decorative, the fields carry the names. */
const EditHint = () => (
  <span className="le-hint" aria-hidden="true">
    <PenLine size={14} />
    Edit
  </span>
);

const showEditor = (e: Ctx, id: SectionId) => sectionState(e.state, id) !== 'empty' || e.writing.has(id);

/** A list of sentences: one field per item, Enter adds the next item, a remove button per item. */
function ListEditor({ k, label, listClass, icon }: { k: 'whenToUse' | 'whenNotToUse' | 'accessibility' | 'contentGuidelines'; label: string; listClass?: string; icon?: boolean }) {
  const e = useEdit();
  const items = (e.state.docs[k] ?? []) as string[];
  const add = (at = items.length) => {
    const next = [...items.slice(0, at), '', ...items.slice(at)];
    e.setList(k, next);
    e.onFocusField({ key: k, index: at });
  };
  const drop = (i: number) => {
    e.setList(k, items.filter((_, j) => j !== i));
    if (i > 0) e.onFocusField({ key: k, index: i - 1 });
  };
  const keys = (i: number) => (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      add(i + 1);
    } else if (ev.key === 'Backspace' && !ev.currentTarget.value && items.length > 1) {
      ev.preventDefault();
      drop(i);
    }
  };
  return (
    <>
      <ul className={`le-list ${listClass ?? ''}`}>
        {items.map((_, i) => (
          <li key={i}>
            {icon && <Check className="le-li-icon" size={16} aria-hidden="true" />}
            <InlineText field={{ key: k, index: i }} label={`${label}, item ${i + 1}`} placeholder="Write one sentence" onKeyDown={keys(i)} />
            <IconButton className="le-remove" icon={X} size="sm" label={`Remove ${label.toLowerCase()} item ${i + 1}`} onClick={() => drop(i)} />
          </li>
        ))}
      </ul>
      <Button className="le-add" variant="ghost" size="sm" iconStart={Plus} onClick={() => add()}>
        Add item
      </Button>
    </>
  );
}

function ProposalBox({ keys }: { keys: readonly ProseKey[] }) {
  const e = useEdit();
  const p = e.proposal;
  if (!p || !keys.includes(p.field.key)) return null;
  return (
    <div className="le-proposal" role="group" aria-label="Claude's proposal for the selected text">
      <p className="le-proposal-text">
        <span className="le-flag">
          <Avatar kind="agent" brand="claude" size="xs" decorative />
          <Badge tone="info">Claude proposes</Badge>
        </span>{' '}
        {p.replacement}
      </p>
      <div className="le-actions">
        <Button size="sm" variant="secondary" iconStart={Check} onClick={e.keepProposal}>
          Keep
        </Button>
        <Button size="sm" variant="ghost" onClick={e.discardProposal}>
          Discard
        </Button>
      </div>
    </div>
  );
}

function GuideCards({ k }: { k: 'dos' | 'donts' }) {
  const e = useEdit();
  const items = e.state.docs[k];
  const word = k === 'dos' ? 'Do' : "Don't";
  return (
    <>
      {items.map((g, i) => (
        <figure className={`verdict ${k === 'dos' ? 'do' : 'dont'} le-verdict`} key={`${k}-${i}`}>
          {g.example && <VerdictExample node={g.example as ExampleNode} inert={k === 'donts'} />}
          <figcaption className="verdict-body">
            <div className="le-verdict-head">
              <Badge tone={k === 'dos' ? 'success' : 'danger'} icon={k === 'dos' ? Check : X}>
                {word}
              </Badge>
              <IconButton className="le-remove" icon={X} size="sm" label={`Remove ${word} ${i + 1}`} onClick={() => e.setList(k, items.filter((_, j) => j !== i) as DocsGuidance[])} />
            </div>
            {/* h3 under the section's h2, as on the read page (components/UsagePanel.tsx): no skipped level. */}
            <h3 className="verdict-title">
              <InlineText field={{ key: k, index: i, part: 'title' }} label={`${word} ${i + 1}, title`} placeholder="Title" />
            </h3>
            {/* A div, not a p: the field is a block (Textarea), and a p cannot hold one. */}
            <div className="verdict-text">
              <InlineText field={{ key: k, index: i, part: 'text' }} label={`${word} ${i + 1}, why`} placeholder="Why, in one sentence" />
            </div>
          </figcaption>
        </figure>
      ))}
    </>
  );
}

function UsageEditor() {
  const e = useEdit();
  const addGuide = (k: 'dos' | 'donts') => {
    const items = e.state.docs[k];
    e.setList(k, [...items, { title: '', text: '' }]);
    e.onFocusField({ key: k, index: items.length, part: 'title' });
  };
  const col = (id: 'whenToUse' | 'whenNotToUse') => (
    <div className={`usage-col le-region ${id === 'whenToUse' ? 'is-use' : 'is-avoid'}`} role="group" aria-labelledby={`le-h-${id}`} data-section={id} id={`le-sec-${id}`}>
      <EditHint />
      <div className="le-head">
        <h3 id={`le-h-${id}`}>
          {id === 'whenToUse' ? <Check size={18} aria-hidden="true" className="le-col-icon" /> : <CircleX size={18} aria-hidden="true" className="le-col-icon" />}
          {id === 'whenToUse' ? 'Use it for' : 'Not for'}
        </h3>
        <SectionFlag id={id} />
      </div>
      <SectionControls id={id} />
      {showEditor(e, id) && <ListEditor k={id} label={id === 'whenToUse' ? 'When to use' : 'When not to use'} />}
      <ProposalBox keys={[id]} />
    </div>
  );
  return (
    <div className="le-usage">
      <section aria-labelledby="le-usage">
        <h2 id="le-usage">When to use</h2>
        <div className="usage-grid">
          {col('whenToUse')}
          {col('whenNotToUse')}
        </div>
      </section>

      <section className="le-region" aria-labelledby="le-h-doDont" data-section="doDont" id="le-sec-doDont">
        <EditHint />
        <div className="le-head">
          <h2 id="le-h-doDont">Do and don't</h2>
          <SectionFlag id="doDont" />
        </div>
        <SectionControls id="doDont" />
        {showEditor(e, 'doDont') && (
          <>
            <div className="guidance">
              <GuideCards k="dos" />
              <GuideCards k="donts" />
            </div>
            <div className="le-actions le-add-row">
              <Button variant="ghost" size="sm" iconStart={Plus} onClick={() => addGuide('dos')}>
                Add do
              </Button>
              <Button variant="ghost" size="sm" iconStart={Plus} onClick={() => addGuide('donts')}>
                Add don't
              </Button>
            </div>
          </>
        )}
        <ProposalBox keys={['dos', 'donts']} />
      </section>

      <section className="le-region" aria-labelledby="le-h-accessibility" data-section="accessibility" id="le-sec-accessibility">
        <EditHint />
        <div className="le-head">
          <h2 id="le-h-accessibility">Accessibility</h2>
          <SectionFlag id="accessibility" />
        </div>
        <SectionControls id="accessibility" />
        {showEditor(e, 'accessibility') && <ListEditor k="accessibility" label="Accessibility" listClass="a11y-list" icon />}
        <ProposalBox keys={['accessibility']} />
      </section>

      <section className="le-region" aria-labelledby="le-h-contentGuidelines" data-section="contentGuidelines" id="le-sec-contentGuidelines">
        <EditHint />
        <div className="le-head">
          <h2 id="le-h-contentGuidelines">Content guidelines</h2>
          <SectionFlag id="contentGuidelines" />
        </div>
        <SectionControls id="contentGuidelines" />
        {showEditor(e, 'contentGuidelines') && <ListEditor k="contentGuidelines" label="Content guidelines" listClass="cp-content-list" />}
        <ProposalBox keys={['contentGuidelines']} />
      </section>
    </div>
  );
}

function SummaryEditor() {
  const e = useEdit();
  return (
    <div className="le-summary le-region" role="group" aria-label="Summary" data-section="summary" id="le-sec-summary">
      <EditHint />
      {showEditor(e, 'summary') && <InlineText field={{ key: 'summary' }} label="Summary" placeholder="One or two sentences: what it is for, and what to use instead." />}
      <div className="le-summary-foot">
        <SectionFlag id="summary" />
        <SectionControls id="summary" />
      </div>
      <ProposalBox keys={['summary']} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Rail                                                                                                               */

const STATUS_OPTIONS = [
  { value: 'stable', label: 'Stable', tone: 'success' },
  { value: 'beta', label: 'Beta', tone: 'info' },
  { value: 'deprecated', label: 'Deprecated', tone: 'warning' },
] as const;

function RailContent() {
  const e = useEdit();
  const review = toReview(e.state);
  const go = (id: SectionId) => {
    const el = document.getElementById(`le-sec-${id}`);
    el?.scrollIntoView({ block: 'center' });
    const target = el?.querySelector<HTMLElement>('.le-actions button, textarea');
    target?.focus({ preventScroll: true });
  };
  return (
    <>
      <div className="le-rail-group">
        <p className="cp-toc-title">To review</p>
        {review.length ? (
          <ul className="le-review">
            {review.map((r) => (
              <li key={r.id}>
                <Link
                  variant="subtle"
                  href={`#le-sec-${r.id}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    go(r.id);
                  }}
                >
                  <Circle size={16} aria-hidden="true" />
                  <span className="le-review-text">
                    {r.label}
                    <span className="le-review-words">{r.words}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="le-rail-note">Nothing waits for a decision.</p>
        )}
      </div>
      <div className="le-rail-group">
        <p className="cp-toc-title">Changed</p>
        <p className="le-rail-note">{changedLabel(e.state)}</p>
      </div>
    </>
  );
}

/** In edit mode the status pill under the title is the control: same place, same pill, a menu of the three states. */
function StatusPill({ value, onChange }: { value: NonNullable<ComponentDocsJson['status']>; onChange: (v: NonNullable<ComponentDocsJson['status']>) => void }) {
  const opt = STATUS_OPTIONS.find((o) => o.value === value) ?? STATUS_OPTIONS[0]!;
  return (
    <Menu>
      <MenuTrigger className="le-status" aria-label={`Status: ${opt.label}. Change status`}>
        <Badge tone={opt.tone}>
          {opt.label}
          <ChevronDown size={14} aria-hidden="true" />
        </Badge>
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup label="Status" value={value} onValueChange={(v) => onChange(v as NonNullable<ComponentDocsJson['status']>)}>
          {STATUS_OPTIONS.map((o) => (
            <MenuRadioItem key={o.value} value={o.value} closeOnClick>
              {o.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Claude setup panel (no way to draft yet), like the Figma plugin's Claude card.                                     */

function ClaudeSetup({ repo, component, onSaved, ai }: { repo: string; component: string; onSaved: () => void; ai: DocsAi | null }) {
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const save = () => {
    try {
      ai?.saveApiKey(key.trim() || null);
      setKey('');
      onSaved();
    } catch {
      setMsg({ tone: 'danger', text: 'Drafting with Claude is not available on this site yet.' });
    }
  };
  // The my-Claude way belongs to a developer: the designer copies the setup for them, she never sees the terminal steps.
  const copySetup = () => {
    const page = `${location.origin}${location.pathname}?edit=1`;
    const text = developerSetupMessage({ repo, component, page, phrase: DRAFT_PHRASE });
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      announce(COPY_SETUP.done);
    });
  };
  return (
    <div className="le-setup">
      <p>Claude drafts the sections from the code. You review each one before anything is sent.</p>
      <Input label="Anthropic API key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." value={key} onChange={(ev) => setKey(ev.target.value)} hint="Saved in this browser only. Each draft sends this page's text to Anthropic." />
      <Button variant="secondary" size="sm" disabled={!key.trim()} onClick={save}>
        Save key
      </Button>
      <p className="le-setup-note">No API key? A developer can draft it with their own Claude.</p>
      <Button variant="ghost" size="sm" iconStart={copied ? Check : Copy} onClick={copySetup}>
        {copied ? COPY_SETUP.done : COPY_SETUP.label}
      </Button>
      {msg && (
        <p className={`le-setup-msg is-${msg.tone}`} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* The island                                                                                                         */

function useSlot(selector: string, on: boolean) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(on ? document.querySelector<HTMLElement>(selector) : null), [selector, on]);
  return el;
}

function useMedia(q: string) {
  const [match, setMatch] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return match;
}
/** From 1320px the rail has its own column. */
const useWide = () => useMedia('(min-width: 1320px)');
/** Below 768px (breakpoint.md) the edit bar keeps the label and Request review; the rest goes into a More menu. */
const useCompact = () => useMedia('(max-width: 767px)');

/** A menu, popover or dialog is open: it owns Escape. */
const overlayOpen = () => Boolean(document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], dialog[open]'));

export default function LibraryEditMode(p: LibraryEditModeProps) {
  // Where "See the review" goes: the team's Studio on a team's Library page, else this site's.
  const studio = p.team?.studio ?? studioHref;
  const [editing, setEditing] = useState(false);
  /** Editing without a GitHub session: the line that says it is a draft in this browser only; null when signed in. */
  const [guest, setGuest] = useState<string | null>(null);
  const [state, setState] = useState<EditState>(() => initEdit(p.initial));
  const [base, setBase] = useState<string | null>(p.original);
  /** Where Send goes instead of a new proposal: a change opened from Studio (?pr&ref), or the component's open proposal. */
  const [branch, setBranch] = useState<{ pr: number | null; ref: string; author?: string; continues?: boolean } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [writing, setWriting] = useState<Set<SectionId>>(new Set());
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const [lastSection, setLastSection] = useState<SectionId | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [ai, setAi] = useState<DocsAi | null>(null);
  const [ways, setWays] = useState<{ ways: DraftWay[]; preferred: DraftWay | null }>({ ways: [], preferred: null });
  const [drafting, setDrafting] = useState<{ ctrl: AbortController; status: string; way: DraftWay } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'rewrite' | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sent, setSent] = useState<{ pr: number | null; title: string; continued?: boolean; suggestion?: string } | null>(null);
  // How changes reach the code (bridge.config.json "changes"): a suggestion, or a branch in review.
  const mode = useMemo(() => changesModeOnPage(), []);
  const suggest = mode === 'suggest';
  const [title, setTitle] = useState(sendTitle(p.name));
  const [message, setMessage] = useState('');
  const [jira, setJira] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [copied, setCopied] = useState(false);
  const [setupDialog, setSetupDialog] = useState(false);
  /** After a draft: the first drafted section, brought into view with focus on its Keep. */
  const [jump, setJump] = useState<SectionId | null>(null);
  const exampleHtml = useRef(new Map<string, string>());
  const loaded = useRef(false);
  const viewerWired = useRef(false);
  const guestWired = useRef(false);
  const wide = useWide();
  const compact = useCompact();

  const dirty = isDirty(state);
  const pending = pendingSections(state);
  const canDraft = ways.ways.length > 0;

  // Read the static examples once: Do and don't cards keep the exact markup of the read page.
  useEffect(() => {
    const read = document.querySelector('#tab-usage [data-le-read]');
    if (!read) return;
    const grab = (cls: string, list: ComponentDocsJson['dos']) => {
      const stages = [...read.querySelectorAll(`.verdict.${cls}`)].map((f) => f.querySelector('.verdict-stage')?.innerHTML);
      list.forEach((g, i) => g.example && stages[i] !== undefined && exampleHtml.current.set(JSON.stringify(g.example), stages[i]!));
    };
    grab('do', p.initial.dos);
    grab('dont', p.initial.donts);
  }, []);

  // "This section" and "Selected text" exist only while focus (or the selection) is in an editable section. Moving to
  // the Draft with Claude button or its menu keeps them; anything else clears them.
  useEffect(() => {
    if (!editing) return;
    let toDraft = false;
    const down = (ev: PointerEvent) => {
      toDraft = Boolean((ev.target as HTMLElement).closest('[data-le-draft], [role="menu"]'));
    };
    const out = (ev: FocusEvent) => {
      if (!(ev.target as HTMLElement).closest('[data-section]')) return;
      const next = ev.relatedTarget as HTMLElement | null;
      if (next?.closest('[data-section]')) return;
      if (toDraft || next?.closest('[data-le-draft], [role="menu"]')) return;
      setLastSection(null);
      setSelection(null);
    };
    const into = (ev: FocusEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('[data-section], [data-le-draft], [role="menu"]')) return;
      setLastSection(null);
      setSelection(null);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('focusout', out);
    document.addEventListener('focusin', into);
    return () => {
      document.removeEventListener('focusin', into);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('focusout', out);
    };
  }, [editing]);

  // Escape never discards: in a field it leaves the field, elsewhere it asks to leave editing (Cancel confirms when
  // something would be lost). Open menus, popovers and dialogs keep their own Escape.
  const cancelRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!editing) return;
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing) return;
      const t = ev.target as HTMLElement | null;
      const inField = Boolean(t?.closest('[data-section] textarea, [data-section] input'));
      const intent = escapeIntent({ overlayOpen: overlayOpen(), inField });
      if (intent === 'leave-field') {
        t?.blur();
        announce('Left the field. Press Escape again to leave editing.');
      } else if (intent === 'cancel') cancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  // Saving an API key (here or anywhere on the page) changes how Claude can be reached.
  useEffect(() => {
    const on = () => ai && setWays(ai.draftAvailability());
    document.addEventListener('bridge:docs-ai', on);
    window.addEventListener('bridge:docs-ai', on);
    document.addEventListener('bridge:auth', on);
    return () => {
      document.removeEventListener('bridge:docs-ai', on);
      window.removeEventListener('bridge:docs-ai', on);
      document.removeEventListener('bridge:auth', on);
    };
  }, [ai]);

  const loadAi = useCallback(async () => {
    try {
      const m = await import('../scripts/docs-ai');
      setAi(m);
      setWays(m.draftAvailability());
      return m;
    } catch {
      return null;
    }
  }, []);

  // Start editing: from the change's branch (?pr&ref), else this browser's draft, else main.
  const start = useCallback(async () => {
    if (!loaded.current) {
      loaded.current = true;
      const q = new URLSearchParams(location.search);
      const ref = q.get('ref');
      let next = initEdit(p.initial);
      setBranch(null);
      setBase(p.original);
      const session = await import('../scripts/github-session').catch(() => null);
      setViewer(session?.currentViewer()?.login ?? null);
      // The viewer is known after the session's first token check: "by you" on their own proposal.
      if (session && !viewerWired.current) {
        viewerWired.current = true;
        session.initGitHubConnect((v) => setViewer(v?.login ?? null));
      }
      // One open proposal per component: without a change to edit (?ref), the editor opens on the open one, if any.
      const open = ref ? null : await import('../scripts/docs-commit').then((m) => m.findOpenDocs(p.name, p.slug)).catch(() => null);
      const readBranch = async (branchRef: string) => {
        if (p.team) {
          const text = await p.team.readFile(p.path, branchRef);
          if (text === undefined) throw new Error('404');
          return text;
        }
        const r = await fetch(`https://raw.githubusercontent.com/${p.repo.owner}/${p.repo.repo}/${encodeURIComponent(branchRef)}/${p.path}`);
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      };
      const mine = docsEdits(readDraft()).find((e) => e.path === p.path);
      let onOpen = false;
      if (open) {
        try {
          const text = await readBranch(open.branch);
          const docs = JSON.parse(text) as ComponentDocsJson;
          let edited = docs;
          try {
            // Edits kept in this browser go on top of the open proposal's text.
            if (mine) edited = JSON.parse(mine.after) as ComponentDocsJson;
          } catch {
            /* a broken draft entry: start from the proposal */
          }
          next = initEdit(docs, edited);
          setBase(text);
          setBranch({ pr: open.number, ref: open.branch, author: open.author, continues: true });
          onOpen = true;
        } catch {
          /* the proposal could not be read: start from main; Send still joins it (core looks again) */
        }
      }
      if (onOpen) {
        /* started on the open proposal */
      } else if (ref) {
        try {
          const text = await readBranch(ref);
          next = initEdit(JSON.parse(text) as ComponentDocsJson);
          setBase(text);
          setBranch({ pr: Number(q.get('pr')) || null, ref });
        } catch {
          setNotice({ tone: 'info', text: `Could not read the ${p.name} docs of that branch. You are editing the published page.` });
        }
      } else {
        if (mine) {
          try {
            next = initEdit(p.initial, JSON.parse(mine.after) as ComponentDocsJson);
          } catch {
            /* a broken draft entry: start from main */
          }
        }
        next = restoreMeta(next, readJson(metaKey(p.path), null));
      }
      setState(next);
      const m = await loadAi();
      m?.outdatedSections(p.slug, next.docs)
        .then((keys) => setState((s) => ({ ...s, outdated: keys })))
        .catch(() => undefined);
    }
    setEditing(true);
    setEditUrl(true);
    announce(`Editing ${p.name}. Each section of the usage guidance is editable.`);
  }, []);

  // Edit never asks for GitHub first: without a session (a guest, or signed out) it is a draft in this browser, Keep
  // and Discard work, and only the send asks to sign in (openSend).
  const requestEdit = useCallback(async () => {
    const session = await import('../scripts/github-session');
    const paintGuest = () => setGuest(session.hasWorkingToken() ? null : guestEditLine(session.prefersSignIn()));
    if (guestWired.current) session.initGitHubConnect();
    else session.initGitHubConnect(paintGuest);
    guestWired.current = true;
    paintGuest();
    void start();
  }, [start]);

  useEffect(() => {
    if (isEditUrl()) void requestEdit();
    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest('[data-le-edit]');
      if (!a || ev.metaKey || ev.ctrlKey) return;
      ev.preventDefault();
      void requestEdit();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [requestEdit]);

  // Page chrome: hide the read parts, open the Usage tab.
  useEffect(() => {
    const page = document.querySelector<HTMLElement>('.cp-page');
    page?.toggleAttribute('data-editing', editing);
    // The live preview stays on screen, but its sample buttons are not part of editing: out of the tab order.
    document.querySelectorAll('.hero-pane-inner').forEach((el) => el.toggleAttribute('inert', editing));
    const aside = document.querySelector('.cp-toc');
    aside?.setAttribute('aria-label', editing ? 'Review' : 'On this page');
    if (editing) {
      const usage = document.querySelector<HTMLElement>('[data-cp-tabs] [data-tab="usage"]');
      if (usage?.getAttribute('aria-selected') !== 'true') usage?.click();
    }
  }, [editing]);

  // Every change goes to the local draft (not on a change's branch: that is saved there on Send).
  useEffect(() => {
    if (!editing || branch) return;
    const t = window.setTimeout(() => {
      const draft = readDraft();
      const has = docsEdits(draft).some((e) => e.path === p.path);
      if (!dirty && !has && !pending.length) return;
      const fileText = docsFileText(docsToSend(state), base);
      const next = dirty ? setDocsEdit(draft, { path: p.path, component: p.name, slug: p.slug, before: base, after: fileText }) : { ...draft, edits: draft.edits.filter((e) => !(e.kind === 'docs' && e.path === p.path)) };
      writeDraft(next);
      writeJson(metaKey(p.path), pending.length || state.reviewed.length ? editMeta(state) : null);
    }, 250);
    return () => window.clearTimeout(t);
  }, [state, editing, branch]);

  const exit = (clear: boolean) => {
    if (clear) {
      writeDraft({ ...readDraft(), edits: readDraft().edits.filter((e) => !(e.kind === 'docs' && e.path === p.path)) });
      writeJson(metaKey(p.path), null);
      setState(initEdit(p.initial));
      loaded.current = false;
    }
    drafting?.ctrl.abort();
    setEditing(false);
    setEditUrl(false);
    setProposal(null);
    setWriting(new Set());
    announce(`Done editing ${p.name}.`);
    document.querySelector<HTMLElement>('[data-le-edit] a, a[data-le-edit], [data-le-edit]')?.focus();
  };

  const onCancel = () => (cancelNeedsConfirm({ dirty, pending: pending.length }) ? setConfirm('cancel') : exit(true));
  cancelRef.current = onCancel;

  /* Drafting with Claude */
  const runDraft = async (scope: DraftScope, sel?: Selection) => {
    const m = ai ?? (await loadAi());
    const av = m?.draftAvailability() ?? { ways: [], preferred: null };
    setWays(av);
    const way = av.preferred ?? av.ways[0];
    if (!m || !way) {
      if (compact) setSetupDialog(true);
      else setSetupOpen(true);
      return;
    }
    const ctrl = new AbortController();
    setNotice(null);
    setDrafting({ ctrl, status: 'Asking Claude', way });
    try {
      const res = await m.draftDocs({
        slug: p.slug,
        name: p.name,
        docs: cleanDocs(state.docs),
        scope,
        way,
        signal: ctrl.signal,
        onStatus: (s) => setDrafting((d) => (d ? { ...d, status: s } : d)),
      });
      if (scope.kind === 'selection' && sel) {
        if (res.replacement) setProposal({ ...sel, replacement: res.replacement });
        announce(res.replacement ? 'Claude proposes a new wording. Keep or discard it.' : 'Claude kept the wording.');
      } else {
        const n = Object.keys(res.sections).length;
        const checked = (res as { checked?: ProseKey[] }).checked ?? [];
        setState((s) => applyDraft(s, res.sections, checked));
        const first = SECTIONS.find((x) => x.keys.some((k) => k in res.sections));
        if (first) setJump(first.id);
        announce(n ? `Claude drafted ${n} ${n === 1 ? 'section' : 'sections'}. Review each one, then keep or discard it.` : 'Claude had nothing to add.');
        if (!n) setNotice({ tone: 'info', text: checked.length ? 'Claude checked the sections against the code: they are still accurate.' : 'Nothing to draft: every section is written and up to date.' });
      }
    } catch (err) {
      if (ctrl.signal.aborted) setNotice({ tone: 'info', text: 'Stopped. Nothing changed on the page.' });
      else setNotice({ tone: 'danger', text: `Claude could not draft: ${(err as Error).message}. Try again, or write the section yourself.` });
    } finally {
      setDrafting(null);
    }
  };

  const draftSection = async (id: SectionId) => {
    for (const key of sectionById(id).keys as readonly ProseKey[]) await runDraft({ kind: 'section', key });
  };

  const ctx: Ctx = {
    state,
    writing,
    proposal,
    canDraft,
    drafting: Boolean(drafting),
    focusRequest,
    setText: (f, text) => setState((s) => setValue(s, f.key, setField(s.docs, f, text) as never)),
    setList: (key, value) => setState((s) => setValue(s, key, value as never)),
    onFocusField: (f) => {
      setLastSection(sectionOf(f.key).id);
      setFocusRequest(fieldId(f));
    },
    onSelectField: (sel) => {
      setSelection(sel);
      if (sel) setLastSection(sectionOf(sel.field.key).id);
    },
    write: (id) => {
      setWriting((w) => new Set(w).add(id));
      const first = sectionById(id).keys[0] as ProseKey;
      if (first === 'summary') setFocusRequest(fieldId({ key: 'summary' }));
      else if (first === 'dos') {
        if (!state.docs.dos.length) setState((s) => setValue(s, 'dos', [{ title: '', text: '' }]));
        setFocusRequest(fieldId({ key: 'dos', index: 0, part: 'title' }));
      } else {
        const list = (state.docs[first] ?? []) as string[];
        if (!list.length) setState((s) => setValue(s, first, [''] as never));
        setFocusRequest(fieldId({ key: first, index: 0 }));
      }
    },
    draftSection: (id) => void draftSection(id),
    keep: (id) => {
      setState((s) => keepDrafts(s, [id]));
      announce(`${sectionById(id).label}: Claude's draft kept.`);
    },
    discard: (id) => {
      setState((s) => discardDrafts(s, [id]));
      announce(`${sectionById(id).label}: Claude's draft discarded.`);
    },
    keepProposal: () => {
      if (!proposal) return;
      const cur = getField(state.docs, proposal.field);
      ctx.setText(proposal.field, replaceSelection(cur, proposal, proposal.replacement));
      setProposal(null);
      setFocusRequest(fieldId(proposal.field));
    },
    discardProposal: () => {
      if (!proposal) return;
      setFocusRequest(fieldId(proposal.field));
      setProposal(null);
    },
  };
  useEffect(() => {
    if (!jump) return;
    const el = document.querySelector<HTMLElement>(`#le-sec-${jump} .le-actions button`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
    setJump(null);
  }, [jump, state]);
  // A focus request is consumed once the field focused.
  useEffect(() => {
    if (focusRequest) {
      const t = window.setTimeout(() => setFocusRequest(null), 50);
      return () => window.clearTimeout(t);
    }
  }, [focusRequest]);

  /* Request review (a new branch) or save to the branch being edited */
  const toSend = useMemo(() => docsToSend(state), [state]);
  const issues = useMemo(() => validateDocs(cleanDocs(toSend)), [toSend]);
  const sendBlock = useMemo(() => sendBlockedReason({ fileText: docsFileText(toSend, base), base, continuing: Boolean(branch) }), [toSend, base, branch]);
  const forgetLocal = () => {
    writeDraft({ ...readDraft(), edits: readDraft().edits.filter((e) => !(e.kind === 'docs' && e.path === p.path)) });
    writeJson(metaKey(p.path), null);
  };
  const openSend = async () => {
    const session = await import('../scripts/github-session');
    session.initGitHubConnect();
    if (!session.hasWorkingToken()) return openConnect();
    setSendError('');
    setSent(null);
    setSendOpen(true);
  };
  const send = async () => {
    setBusy(true);
    setSendError('');
    try {
      const fileText = docsFileText(toSend, base);
      const docsCommit = await import('../scripts/docs-commit');
      // Who wrote the text: Claude's drafts kept as is, edited by the person, or written by the person.
      const authorLine = docsAuthorLine(authorship(state), viewer);
      let continued = Boolean(branch?.continues);
      if (branch?.continues && branch.pr) {
        await docsCommit.continueDocs({ number: branch.pr, branch: branch.ref }, p.path, p.name, fileText, authorLine);
        setBase(fileText);
        forgetLocal();
        setSent({ pr: branch.pr, title: title.trim() || sendTitle(p.name), continued: true });
      } else if (branch) {
        await docsCommit.commitDocsToBranch(p.path, branch.ref, p.name, fileText);
        setBase(fileText);
        setSent({ pr: branch.pr, title: title.trim() || sendTitle(p.name) });
      } else {
        const edit: DocsEdit = { kind: 'docs', id: Math.random().toString(36).slice(2, 10), path: p.path, component: p.name, slug: p.slug, before: p.original, after: fileText };
        const r = await docsCommit.proposeDocs([edit], changeTitle(p.slug, title || sendTitle(p.name)), message, parseJiraKey(jira), authorLine);
        continued = r.continued;
        forgetLocal();
        // A suggestion links to its page; a branch opens in Studio.
        setSent({ pr: r.number, title: title.trim() || sendTitle(p.name), continued: r.continued, ...(r.kind === 'suggestion' ? { suggestion: r.url } : {}) });
        if (r.kind === 'suggestion') {
          announce(`${SUGGESTION_SENT}.`);
          return;
        }
      }
      announce(branch || continued ? 'Update sent.' : 'Sent for review.');
    } catch (err) {
      // The session's words: sign-in or token, and the site's way in.
      const { ghAuthFailure } = await import('../scripts/github-session');
      setSendError(ghAuthFailure(err, branch ? 'send this update' : suggest ? 'send suggestions' : 'request review')?.text ?? `Not sent: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const doneSent = () => {
    setSendOpen(false);
    setSent(null);
    setBranch(null);
    setBase(p.original);
    setState(initEdit(p.initial));
    loaded.current = false;
    setEditing(false);
    setEditUrl(false);
  };

  /* Slots */
  const barSlot = useSlot('[data-le-bar]', editing);
  const summarySlot = useSlot('[data-le-summary]', editing);
  const usageSlot = useSlot('[data-le-usage]', editing);
  const railSlot = useSlot('[data-le-rail]', editing);
  const narrowSlot = useSlot('[data-le-rail-narrow]', editing);
  const statusSlot = useSlot('[data-le-status]', editing);
  if (!editing) return null;

  const sectionName = lastSection ? sectionById(lastSection).label : null;
  const selKey = selection?.field.key;
  const reviewCount = toReview(state).filter((r) => !r.done).length;
  const changedNote = changedLabel(state);
  const repoName = `${p.repo.owner}/${p.repo.repo}`;
  const draftButton = (
    <Button variant="secondary" iconStart={Sparkles} iconEnd={ChevronDown} data-le-draft="">
      Draft with Claude
    </Button>
  );
  const keepAll = keepAllLabel(pending.length);
  const barState = editBarState({ dirty, sent: Boolean(sent), savesLocally: !branch });
  const sendLabel = branch ? 'Send update' : sendWords('docs', mode);
  const stateText = barState !== 'sent' && sendBlock ? sendBlock : editBarLabel(barState, Boolean(branch?.continues));
  const sendButton = (
    <Button variant="primary" disabled={Boolean(sendBlock)} aria-describedby="le-bar-state" onClick={() => void openSend()}>
      {sendLabel}
    </Button>
  );
  /** What Claude can draft from here: the whole page, the section in focus, the selected text. */
  const draftItems = (
    <>
      <MenuGroup label={compact ? 'Draft with Claude: whole page' : 'Whole page'}>
        <MenuItem disabled={Boolean(drafting)} onClick={() => void runDraft({ kind: 'page-fill' })}>
          Fill empty and outdated sections
        </MenuItem>
        <MenuItem disabled={Boolean(drafting)} onClick={() => setConfirm('rewrite')}>
          Rewrite every section
        </MenuItem>
      </MenuGroup>
      {sectionName && lastSection && (
        <>
          <MenuSeparator />
          <MenuGroup label={`This section (${sectionName})`}>
            <MenuItem disabled={Boolean(drafting)} onClick={() => void draftSection(lastSection)}>
              Draft this section
            </MenuItem>
          </MenuGroup>
        </>
      )}
      {selection && selKey && (
        <>
          <MenuSeparator />
          <MenuGroup label="Selected text">
            {(['clearer', 'shorter', 'voice'] as const).map((mode) => (
              <MenuItem key={mode} disabled={Boolean(drafting)} onClick={() => void runDraft({ kind: 'selection', key: selKey, text: selection.text, mode }, selection)}>
                {mode === 'clearer' ? 'Clearer' : mode === 'shorter' ? 'Shorter' : 'Bridge voice'}
              </MenuItem>
            ))}
          </MenuGroup>
        </>
      )}
    </>
  );
  const claudeSetup = (onDone: () => void) => (
    <ClaudeSetup
      repo={repoName}
      component={p.name}
      ai={ai}
      onSaved={() => {
        if (ai) setWays(ai.draftAvailability());
        onDone();
        announce('Key saved in this browser. Draft with Claude is ready.');
      }}
    />
  );

  const bar = (
    <div className="le-bar" role="region" aria-label={`Editing ${p.name}`} data-state={barState}>
      <div className="le-bar-row">
        <span className="le-bar-mark" aria-hidden="true">
          <PenLine size={20} />
        </span>
        <div className="le-bar-label">
          <p className="le-bar-title">
            Editing <strong>{p.name}</strong>
          </p>
          <p className="le-bar-state" id="le-bar-state" role="status">
            {stateText}
          </p>
        </div>
        {compact ? (
          <div className="le-bar-actions">
            {sendButton}
            <Menu>
              <MenuTrigger render={<IconButton icon={Ellipsis} label="More editing actions" variant="secondary" data-le-draft="" />} />
              <MenuContent align="end" className="le-menu">
                {canDraft ? (
                  draftItems
                ) : (
                  <MenuGroup label="Claude">
                    <MenuItem icon={Sparkles} onClick={() => setSetupDialog(true)}>
                      Draft with Claude
                    </MenuItem>
                  </MenuGroup>
                )}
                {keepAll && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={Check} onClick={() => setState((s) => keepDrafts(s))}>
                      {keepAll}
                    </MenuItem>
                  </>
                )}
                <MenuSeparator />
                <MenuItem icon={X} onClick={onCancel}>
                  Cancel editing
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ) : (
          <div className="le-bar-actions">
            {keepAll && (
              <Button variant="ghost" iconStart={Check} onClick={() => setState((s) => keepDrafts(s))}>
                {keepAll}
              </Button>
            )}
            {canDraft ? (
              <Menu>
                <MenuTrigger render={draftButton} />
                <MenuContent align="end" className="le-menu">
                  {draftItems}
                </MenuContent>
              </Menu>
            ) : (
              <Popover open={setupOpen} onOpenChange={setSetupOpen}>
                <PopoverTrigger render={draftButton} />
                <PopoverContent title="Draft with Claude" align="end" showClose className="le-setup-pop">
                  {claudeSetup(() => setSetupOpen(false))}
                </PopoverContent>
              </Popover>
            )}
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            {sendButton}
          </div>
        )}
      </div>
      {guest && !sent && (
        <p className="le-bar-note" data-le-guest="">
          {guest}
        </p>
      )}
      {branch?.continues && branch.author && branch.pr && (
        <p className="le-bar-note">
          {continueLine(branch.author, viewer)}{' '}
          <Link href={studio(`changes/?pr=${branch.pr}`)}>See the review</Link>
        </p>
      )}
      {drafting && (
        <div className="le-status" role="status">
          <Spinner size="sm" label="Drafting" />
          <span>{drafting.status}</span>
          {drafting.way === 'my-claude' && (
            <span className="le-status-hint">
              A developer says: <q className="le-phrase">{DRAFT_PHRASE}</q>
              <Button
                variant="ghost"
                size="sm"
                iconStart={copied ? Check : Copy}
                onClick={() => {
                  void navigator.clipboard?.writeText(DRAFT_PHRASE).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </span>
          )}
          <span className="le-bar-spacer" />
          <Button variant="secondary" size="sm" onClick={() => drafting.ctrl.abort()}>
            Stop
          </Button>
        </div>
      )}
      {notice && (
        <Alert tone={notice.tone} className="le-notice" onDismiss={() => setNotice(null)} dismissLabel="Dismiss">
          {notice.text}
        </Alert>
      )}
    </div>
  );

  const narrowRail = (
        <details className="le-rail-narrow">
          <summary>
            <span>{reviewCount ? `${reviewCount} to review` : 'Nothing to review'}</span>
            <span className="le-rail-sep" aria-hidden="true">·</span>
            <span>Changed: {changedNote.toLowerCase()}</span>
          </summary>
          <div className="le-rail le-rail-in">
            <RailContent />
          </div>
        </details>
  );

  return (
    <ExampleHtml.Provider value={exampleHtml.current}>
      <EditCtx.Provider value={ctx}>
        {barSlot && createPortal(bar, barSlot)}
        {narrowSlot && !wide && createPortal(narrowRail, narrowSlot)}
        {statusSlot && createPortal(<StatusPill value={state.docs.status ?? 'stable'} onChange={(v) => setState((s) => ({ ...s, docs: { ...s.docs, status: v } }))} />, statusSlot)}
        {summarySlot && createPortal(<SummaryEditor />, summarySlot)}
        {usageSlot && createPortal(<UsageEditor />, usageSlot)}
        {railSlot &&
          wide &&
          createPortal(
            <div className="le-rail">
              <RailContent />
            </div>,
            railSlot,
          )}

        <AlertDialog open={confirm === 'cancel'} onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent
            title={`Discard your changes to ${p.name}?`}
            description="Your edits and Claude's drafts on this page go away. The published page does not change."
            confirmLabel="Discard changes"
            cancelLabel="Keep editing"
            tone="danger"
            onConfirm={() => {
              setConfirm(null);
              exit(true);
            }}
          />
        </AlertDialog>
        <AlertDialog open={confirm === 'rewrite'} onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent
            title="Rewrite every section?"
            description={`Claude drafts a new version of all ${SECTIONS.length} sections. Each one waits for your Keep or Discard, and nothing leaves this page until you request review.`}
            confirmLabel="Rewrite every section"
            cancelLabel="Cancel"
            tone="primary"
            onConfirm={() => {
              setConfirm(null);
              void runDraft({ kind: 'page-rewrite' });
            }}
          />
        </AlertDialog>

        <Dialog open={setupDialog} onOpenChange={setSetupDialog}>
          <DialogContent size="sm" title="Draft with Claude">
            {claudeSetup(() => setSetupDialog(false))}
          </DialogContent>
        </Dialog>

        <Dialog open={sendOpen} onOpenChange={(o) => (o ? setSendOpen(true) : sent ? doneSent() : setSendOpen(false))}>
          <DialogContent
            size="md"
            title={sent ? (sent.suggestion ? SUGGESTION_SENT : sent.continued || branch ? 'Update sent' : 'Sent for review') : branch ? 'Send your update' : suggest ? sendWords('docs', mode) : 'Send for review'}
            description={
              sent
                ? undefined
                : branch?.continues && branch.author
                  ? `Your update joins ${branch.author === viewer ? 'your open proposal' : `the open proposal by @${branch.author}`}. Your team reviews it in Studio before it reaches the Library.`
                  : suggest
                    ? 'Your DS lead reviews the new guidance. Once approved, a developer applies it to the Library.'
                    : 'Your team reviews the new guidance in Studio before it reaches the Library.'
            }
            footer={
              sent ? (
                <div className="le-dialog-foot">
                  <Button variant="primary" onClick={doneSent}>
                    Back to {p.name}
                  </Button>
                </div>
              ) : (
                <div className="le-dialog-foot">
                  <Button variant="ghost" onClick={() => setSendOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" loading={busy} disabled={busy || issues.length > 0} onClick={() => void send()}>
                    {sendLabel}
                  </Button>
                </div>
              )
            }
          >
            {sent?.suggestion ? (
              <p className="le-sent">
                {suggestionSentLine(sent.pr ?? 0)}{' '}
                <Link href={sent.pr ? studio(`changes/?suggestion=${sent.pr}`) : sent.suggestion}>{SEE_SUGGESTION}</Link>
              </p>
            ) : sent ? (
              <p className="le-sent">
                {sent.continued ? 'Added to the open proposal. ' : ''}Your team can review it in Studio: <Link href={sent.pr ? studio(`changes/?pr=${sent.pr}`) : studio('changes/')}>{sent.title}</Link>.
              </p>
            ) : (
              <div className="le-send">
                {issues.length > 0 && (
                  <Alert tone="warning" announce="off">
                    {issues[0]!.message}
                  </Alert>
                )}
                {pending.length > 0 && (
                  <Alert tone="info" announce="off">
                    {pending.length === 1 ? '1 Claude draft is' : `${pending.length} Claude drafts are`} not reviewed yet. They go out marked for review.
                  </Alert>
                )}
                {!branch && <Input label="Title" value={title} onChange={(ev) => setTitle(ev.target.value)} />}
                {!branch && <Textarea label="Message to the team" hint="Optional. What changed and why, in a sentence or two." rows={3} value={message} onChange={(ev) => setMessage(ev.target.value)} />}
                {!branch && <Input label="Jira ticket" placeholder="DS-42" hint="Optional. Links this change to the ticket in Jira." spellCheck={false} autoComplete="off" value={jira} onChange={(ev) => setJira(ev.target.value)} />}
                {sendError && (
                  <Alert tone="danger" announce="auto">
                    {sendError}
                  </Alert>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </EditCtx.Provider>
    </ExampleHtml.Provider>
  );
}
