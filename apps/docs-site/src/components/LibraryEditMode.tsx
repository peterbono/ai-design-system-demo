// Edit mode of a Library component page, in place: same URL (?edit=1), same layout, same live preview. Only the top
// bar, the prose sections and the right rail switch to editing. A client-only island that renders into slots of
// pages/components/[slug].astro through portals. Pure rules live in lib/library-edit-model.ts; sending reuses the
// docs save path (lib/docs-draft-model.ts, scripts/docs-commit.ts); drafting goes through scripts/docs-ai.ts.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  Spinner,
  Textarea,
} from '@bridge-ds/react';
import { Check, ChevronDown, Circle, CircleCheck, CircleX, Copy, PenLine, Plus, Sparkles, X } from 'lucide-react';
import { DRAFT_PHRASE, type ComponentDocsJson, type DocsGuidance, type ProseKey } from '@bridge-ds/core';
import { REGISTRY, resolveProps } from './registry';
import type { ExampleNode } from '../lib/components';
import { cleanDocs, docsEdits, docsFileText, setDocsEdit, validateDocs, type DocsEdit } from '../lib/docs-draft-model';
import type { Draft } from '../lib/editor-model';
import {
  SECTIONS,
  applyDraft,
  changeTitle,
  changedLabel,
  discardDrafts,
  docsToSend,
  editMeta,
  fieldId,
  getField,
  initEdit,
  isDirty,
  keepDrafts,
  pendingSections,
  replaceSelection,
  restoreMeta,
  sectionById,
  sectionOf,
  sectionState,
  sendTitle,
  setField,
  setValue,
  toReview,
  type EditState,
  type FieldRef,
  type SectionId,
} from '../lib/library-edit-model';
import type { DraftScope, DraftWay } from '../scripts/docs-ai';

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

/** Grows a field to its content without moving the page (a collapsed height would scroll the caret into view). */
function fit(t: HTMLTextAreaElement | null) {
  if (!t) return;
  const y = window.scrollY;
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + (t.offsetHeight - t.clientHeight)}px`;
  if (window.scrollY !== y) window.scrollTo({ top: y });
}

/** A textarea that reads like the text it edits: same font, grows with its content. */
function Field({ field, label, className, placeholder, onKeyDown }: { field: FieldRef; label: string; className?: string; placeholder?: string; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const e = useEdit();
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = getField(e.state.docs, field);
  const id = fieldId(field);
  useLayoutEffect(() => fit(ref.current), [value]);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    const ro = new ResizeObserver(() => fit(t));
    ro.observe(t.parentElement ?? t);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (e.focusRequest === id) ref.current?.focus();
  }, [e.focusRequest, id]);
  const track = () => {
    const t = ref.current;
    if (!t) return;
    e.onSelectField(t.selectionStart < t.selectionEnd ? { field, start: t.selectionStart, end: t.selectionEnd, text: t.value.slice(t.selectionStart, t.selectionEnd) } : null);
  };
  return (
    <textarea
      ref={ref}
      className={`le-text${className ? ` ${className}` : ''}`}
      rows={1}
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
  if (st === 'drafted') return <Badge tone="info" icon={Sparkles}>{e.state.updated.includes(id) ? 'Updated' : 'Drafted'} by Claude · review it</Badge>;
  if (st === 'outdated') return <Badge tone="warning">Outdated: the code changed since</Badge>;
  if (e.state.accurate.includes(id))
    return (
      <span className="le-quiet">
        <Check size={16} aria-hidden="true" /> Still accurate
      </span>
    );
  return null;
}

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
            <Field field={{ key: k, index: i }} label={`${label}, item ${i + 1}`} placeholder="Write one sentence" onKeyDown={keys(i)} />
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
        <Badge tone="info" icon={Sparkles}>Claude proposes</Badge> {p.replacement}
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
            <h4>
              <Field field={{ key: k, index: i, part: 'title' }} label={`${word} ${i + 1}, title`} placeholder="Title" />
            </h4>
            <p>
              <Field field={{ key: k, index: i, part: 'text' }} label={`${word} ${i + 1}, why`} placeholder="Why, in one sentence" />
            </p>
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
    <div className={`usage-col ${id === 'whenToUse' ? 'is-use' : 'is-avoid'}`} role="group" aria-labelledby={`le-h-${id}`} data-section={id} id={`le-sec-${id}`}>
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

      <section aria-labelledby="le-h-doDont" data-section="doDont" id="le-sec-doDont">
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

      <section aria-labelledby="le-h-accessibility" data-section="accessibility" id="le-sec-accessibility">
        <div className="le-head">
          <h2 id="le-h-accessibility">Accessibility</h2>
          <SectionFlag id="accessibility" />
        </div>
        <SectionControls id="accessibility" />
        {showEditor(e, 'accessibility') && <ListEditor k="accessibility" label="Accessibility" listClass="a11y-list" icon />}
        <ProposalBox keys={['accessibility']} />
      </section>

      <section aria-labelledby="le-h-contentGuidelines" data-section="contentGuidelines" id="le-sec-contentGuidelines">
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
    <div className="le-summary" role="group" aria-label="Summary" data-section="summary" id="le-sec-summary">
      {showEditor(e, 'summary') && <Field field={{ key: 'summary' }} label="Summary" placeholder="One or two sentences: what it is for, and what to use instead." />}
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
  { value: 'stable', label: 'Stable' },
  { value: 'beta', label: 'Beta' },
  { value: 'deprecated', label: 'Deprecated' },
];

function RailContent({ onStatus, idPrefix }: { onStatus: (v: ComponentDocsJson['status']) => void; idPrefix: string }) {
  const e = useEdit();
  const review = toReview(e.state);
  const go = (id: SectionId) => {
    const el = document.getElementById(`le-sec-${id}`);
    el?.scrollIntoView({ block: 'center' });
    const target = el?.querySelector<HTMLElement>('textarea, button');
    target?.focus({ preventScroll: true });
  };
  return (
    <>
      <div className="le-rail-group">
        <p className="cp-toc-title" id={`${idPrefix}status`}>
          Status
        </p>
        <Select size="sm" label="Status" hideLabel options={STATUS_OPTIONS} value={e.state.docs.status ?? 'stable'} onValueChange={(v) => v && onStatus(v as ComponentDocsJson['status'])} />
      </div>
      <div className="le-rail-group">
        <p className="cp-toc-title">To review</p>
        {review.length ? (
          <ul className="le-review">
            {review.map((r) => (
              <li key={r.id} className={r.done ? 'is-done' : ''}>
                <a
                  href={`#le-sec-${r.id}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    go(r.id);
                  }}
                >
                  {r.done ? <CircleCheck size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
                  <span className="le-review-text">
                    {r.label}
                    <span className="le-review-words">
                      {r.words}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="le-rail-note">Nothing waits for review.</p>
        )}
      </div>
      <div className="le-rail-group">
        <p className="cp-toc-title">Changed</p>
        <p className="le-rail-note">{changedLabel(e.state)}</p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Claude setup panel (no way to draft yet), like the Figma plugin's Claude card.                                     */

function ClaudeSetup({ repo, onSaved, ai }: { repo: string; onSaved: () => void; ai: DocsAi | null }) {
  const [way, setWay] = useState<'plan' | 'key'>('plan');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const command = `claude mcp add bridge -s user -e GITHUB_TOKEN=your-github-token -- npx -y @bridge-ds/mcp --repo ${repo}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setMsg({ tone: 'success', text: 'Command copied.' });
    } catch {
      setMsg({ tone: 'danger', text: 'Copy did not work. Select the command and copy it.' });
    }
  };
  const save = () => {
    try {
      ai?.saveApiKey(key.trim() || null);
      setKey('');
      onSaved();
    } catch {
      setMsg({ tone: 'danger', text: 'Drafting with Claude is not available on this site yet.' });
    }
  };
  return (
    <div className="le-setup">
      <p>Claude drafts the sections from the code. You review each one before anything is sent.</p>
      <SegmentedControl
        label="How Bridge reaches Claude"
        size="sm"
        fullWidth
        value={way}
        onValueChange={(v) => {
          setWay(v as 'plan' | 'key');
          setMsg(null);
        }}
        items={[
          { value: 'plan', label: 'Your Claude plan' },
          { value: 'key', label: 'An API key' },
        ]}
      />
      {way === 'plan' ? (
        <>
          <p className="le-setup-note">Add Bridge to your Claude once, in a terminal. Put your GitHub token in place of your-github-token.</p>
          <pre className="le-code">{command}</pre>
          <Button variant="secondary" size="sm" iconStart={Copy} onClick={copy}>
            Copy command
          </Button>
        </>
      ) : (
        <>
          <Input label="Anthropic API key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." value={key} onChange={(ev) => setKey(ev.target.value)} hint="Saved in this browser only. Each draft sends this page's text to Anthropic." />
          <Button variant="secondary" size="sm" disabled={!key.trim()} onClick={save}>
            Save key
          </Button>
        </>
      )}
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

function useWide() {
  const q = '(min-width: 1320px)';
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

export default function LibraryEditMode(p: LibraryEditModeProps) {
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<EditState>(() => initEdit(p.initial));
  const [base, setBase] = useState<string | null>(p.original);
  const [branch, setBranch] = useState<{ pr: number | null; ref: string } | null>(null);
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
  const [sent, setSent] = useState<{ pr: number | null; title: string } | null>(null);
  const [title, setTitle] = useState(sendTitle(p.name));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [copied, setCopied] = useState(false);
  /** After a draft: the first drafted section, brought into view with focus on its Keep. */
  const [jump, setJump] = useState<SectionId | null>(null);
  const exampleHtml = useRef(new Map<string, string>());
  const loaded = useRef(false);
  const wide = useWide();

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
      if (ref) {
        try {
          const r = await fetch(`https://raw.githubusercontent.com/${p.repo.owner}/${p.repo.repo}/${encodeURIComponent(ref)}/${p.path}`);
          if (!r.ok) throw new Error(String(r.status));
          const text = await r.text();
          next = initEdit(JSON.parse(text) as ComponentDocsJson);
          setBase(text);
          setBranch({ pr: Number(q.get('pr')) || null, ref });
        } catch {
          setNotice({ tone: 'info', text: `Could not read the ${p.name} docs of that change. You are editing the published page.` });
        }
      } else {
        const mine = docsEdits(readDraft()).find((e) => e.path === p.path);
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

  // Edit asks for GitHub first when nobody is connected.
  const requestEdit = useCallback(async () => {
    const session = await import('../scripts/github-session');
    session.initGitHubConnect();
    if (session.hasWorkingToken()) return void start();
    openConnect();
    const dialog = document.getElementById('gh-dialog');
    const onAuth = () => {
      if (!session.hasWorkingToken()) return;
      cleanup();
      void start();
    };
    const onClose = () => window.setTimeout(() => {
      if (session.hasWorkingToken()) return;
      cleanup();
      setEditUrl(false);
    }, 0);
    const cleanup = () => {
      document.removeEventListener('bridge:auth', onAuth);
      dialog?.removeEventListener('close', onClose);
    };
    document.addEventListener('bridge:auth', onAuth);
    dialog?.addEventListener('close', onClose);
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

  const onCancel = () => (dirty || pending.length ? setConfirm('cancel') : exit(true));

  /* Drafting with Claude */
  const runDraft = async (scope: DraftScope, sel?: Selection) => {
    const m = ai ?? (await loadAi());
    const av = m?.draftAvailability() ?? { ways: [], preferred: null };
    setWays(av);
    const way = av.preferred ?? av.ways[0];
    if (!m || !way) {
      setSetupOpen(true);
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

  /* Send for review */
  const toSend = useMemo(() => docsToSend(state), [state]);
  const issues = useMemo(() => validateDocs(cleanDocs(toSend)), [toSend]);
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
      if (branch) {
        await docsCommit.commitDocsToBranch(p.path, branch.ref, p.name, fileText);
        setBase(fileText);
        setSent({ pr: branch.pr, title: title.trim() || sendTitle(p.name) });
      } else {
        const edit: DocsEdit = { kind: 'docs', id: Math.random().toString(36).slice(2, 10), path: p.path, component: p.name, slug: p.slug, before: p.original, after: fileText };
        const n = await docsCommit.proposeDocs([edit], changeTitle(p.slug, title || sendTitle(p.name)), message);
        writeDraft({ ...readDraft(), edits: readDraft().edits.filter((e) => !(e.kind === 'docs' && e.path === p.path)) });
        writeJson(metaKey(p.path), null);
        setSent({ pr: n, title: title.trim() || sendTitle(p.name) });
      }
      announce('Sent for review.');
    } catch (err) {
      const { errorText } = await import('../lib/token-session');
      setSendError(errorText(err, `Not sent: ${(err as Error).message}`, branch ? 'save to this change' : 'send changes for review'));
    } finally {
      setBusy(false);
    }
  };
  const doneSent = () => {
    setSendOpen(false);
    setSent(null);
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
  if (!editing) return null;

  const sectionName = lastSection ? sectionById(lastSection).label : null;
  const selKey = selection?.field.key;
  const reviewCount = toReview(state).filter((r) => !r.done).length;
  const changedNote = changedLabel(state);
  const repoName = `${p.repo.owner}/${p.repo.repo}`;
  const draftButton = (
    <Button variant="secondary" iconStart={Sparkles} iconEnd={ChevronDown} aria-label="Draft with Claude">
      Draft<span className="le-long"> with Claude</span>
    </Button>
  );

  const bar = (
    <div className="le-bar" role="region" aria-label={`Editing ${p.name}`}>
      <div className="le-bar-row">
        <p className="le-bar-title">
          Editing <strong>{p.name}</strong>
        </p>
        {dirty && <Badge>Unsaved changes</Badge>}
        <div className="le-bar-actions">
        {pending.length > 1 && (
          <Button className="le-keep-all" variant="ghost" iconStart={Check} onClick={() => setState((s) => keepDrafts(s))}>
            Keep all
          </Button>
        )}
        {canDraft ? (
          <Menu>
            <MenuTrigger render={draftButton} />
            <MenuContent align="end" className="le-menu">
              <MenuGroup label="Whole page">
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
            </MenuContent>
          </Menu>
        ) : (
          <Popover open={setupOpen} onOpenChange={setSetupOpen}>
            <PopoverTrigger render={draftButton} />
            <PopoverContent title="Draft with Claude" align="end" showClose className="le-setup-pop">
              <ClaudeSetup
                repo={repoName}
                ai={ai}
                onSaved={() => {
                  if (ai) setWays(ai.draftAvailability());
                  setSetupOpen(false);
                  announce('Key saved in this browser. Draft with Claude is ready.');
                }}
              />
            </PopoverContent>
          </Popover>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!dirty && !pending.length} onClick={() => void openSend()}>
          {branch ? `Save to change${branch.pr ? ` #${branch.pr}` : ''}` : 'Send for review'}
        </Button>
        </div>
      </div>
      {drafting && (
        <div className="le-status" role="status">
          <Spinner size="sm" label="Drafting" />
          <span>{drafting.status}</span>
          {drafting.way === 'my-claude' && (
            <span className="le-status-hint">
              Ask your Claude: <q className="le-phrase">{DRAFT_PHRASE}</q>
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
            {pending.length > 1 && (
              <Button variant="secondary" size="sm" iconStart={Check} onClick={() => setState((s) => keepDrafts(s))}>
                Keep all drafts
              </Button>
            )}
            <RailContent idPrefix="le-n-" onStatus={(v) => setState((s) => ({ ...s, docs: { ...s.docs, status: v } }))} />
          </div>
        </details>
  );

  return (
    <ExampleHtml.Provider value={exampleHtml.current}>
      <EditCtx.Provider value={ctx}>
        {barSlot && createPortal(bar, barSlot)}
        {narrowSlot && !wide && createPortal(narrowRail, narrowSlot)}
        {summarySlot && createPortal(<SummaryEditor />, summarySlot)}
        {usageSlot && createPortal(<UsageEditor />, usageSlot)}
        {railSlot &&
          wide &&
          createPortal(
            <div className="le-rail">
              <RailContent idPrefix="le-w-" onStatus={(v) => setState((s) => ({ ...s, docs: { ...s.docs, status: v } }))} />
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
            description={`Claude drafts a new version of all ${SECTIONS.length} sections. Each one waits for your Keep or Discard, and nothing is sent until you send it.`}
            confirmLabel="Rewrite every section"
            cancelLabel="Cancel"
            tone="primary"
            onConfirm={() => {
              setConfirm(null);
              void runDraft({ kind: 'page-rewrite' });
            }}
          />
        </AlertDialog>

        <Dialog open={sendOpen} onOpenChange={(o) => (o ? setSendOpen(true) : sent ? doneSent() : setSendOpen(false))}>
          <DialogContent
            size="md"
            title={sent ? 'Sent for review' : branch ? 'Save to this change' : 'Send for review'}
            description={sent ? undefined : 'Your team reviews the new guidance in Studio before it reaches the Library.'}
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
                    {branch ? 'Save to this change' : 'Send for review'}
                  </Button>
                </div>
              )
            }
          >
            {sent ? (
              <p className="le-sent">
                Your team can review it in Studio: <a href={sent.pr ? `/studio/changes/?pr=${sent.pr}` : '/studio/changes/'}>{sent.title}</a>.
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
