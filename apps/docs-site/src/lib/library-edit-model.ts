// Edit mode of a Library component page, as pure functions: which sections exist, what changed since the page on
// main (or on a change's branch), the Claude drafts waiting for Keep or Discard, the To review list of the rail and
// text replacements for a selection. The island (components/LibraryEditMode.tsx) keeps an EditState and calls these.
import { markClaudeDraft, missingProse, PROSE_KEYS, sectionsNeedingReview, type ComponentDocsJson, type DocsAuthorship, type DocsGuidance, type ProseKey } from '@bridge-ds/core';
import { cleanDocs } from './docs-draft-model';

/** Editable sections, in page order. Do and don't is one section that holds two keys. */
export const SECTIONS = [
  { id: 'summary', label: 'Summary', keys: ['summary'] },
  { id: 'whenToUse', label: 'When to use', keys: ['whenToUse'] },
  { id: 'whenNotToUse', label: 'When not to use', keys: ['whenNotToUse'] },
  { id: 'doDont', label: "Do and don't", keys: ['dos', 'donts'] },
  { id: 'accessibility', label: 'Accessibility', keys: ['accessibility'] },
  { id: 'contentGuidelines', label: 'Content guidelines', keys: ['contentGuidelines'] },
] as const satisfies readonly { id: string; label: string; keys: readonly ProseKey[] }[];

export type SectionId = (typeof SECTIONS)[number]['id'];
export type Section = (typeof SECTIONS)[number];

export const sectionOf = (key: ProseKey): Section => SECTIONS.find((s) => (s.keys as readonly ProseKey[]).includes(key))!;
export const sectionById = (id: SectionId): Section => SECTIONS.find((s) => s.id === id)!;

type ProseValue = ComponentDocsJson[ProseKey];

export interface EditState {
  /** The docs on main (or on the change's branch), the reference for "changed". */
  base: ComponentDocsJson;
  /** What the page shows now, Claude drafts included. */
  docs: ComponentDocsJson;
  /** Pending Claude drafts: the value each key had before the draft, for Discard. */
  drafts: Partial<Record<ProseKey, ProseValue>>;
  /** Sections the code says are out of date (from the drafting engine). */
  outdated: ProseKey[];
  /** Sections that were drafted or outdated and that someone then kept or rewrote: ticked in To review. */
  reviewed: SectionId[];
  /** Sections whose Claude draft was kept (credited as drafted by Claude when sent). */
  kept: SectionId[];
  /** Written sections Claude rewrote (they had text): "Updated by Claude" instead of "Drafted by Claude". */
  updated: SectionId[];
  /** Written sections Claude checked against newer code and left as they are: "Still accurate". */
  accurate: SectionId[];
  /**
   * The text Claude wrote, per key: drafts made here and drafts the file came with (draftedBy "claude"). Compared with
   * what is sent, it says who wrote each section (authorship). Absent: no Claude text on the page.
   */
  claude?: Partial<Record<ProseKey, ProseValue>>;
}

const emptyOf = (k: ProseKey) => (k === 'summary' ? '' : []) as ProseValue;

/**
 * Starts editing. Sections the file itself marks as waiting for review (needsReview with draftedSections, a draft from
 * CI or from an earlier send) come back as pending drafts; discarding one empties it.
 */
export function initEdit(base: ComponentDocsJson, docs: ComponentDocsJson = base): EditState {
  const drafts: EditState['drafts'] = {};
  for (const k of sectionsNeedingReview(docs)) if (!isEmptyValue(docs[k])) drafts[k] = emptyOf(k);
  return { base, docs, drafts, outdated: [], reviewed: [], kept: [], updated: [], accurate: [], claude: claudeTextOf(base, docs) };
}

/**
 * The Claude text a file carries: the sections waiting for review, or, once accepted, every written section of a
 * file that says "draftedBy": "claude" (the record of who wrote it). Read from the docs being edited, else the base.
 */
export function claudeTextOf(base: ComponentDocsJson, docs: ComponentDocsJson = base): Partial<Record<ProseKey, ProseValue>> {
  const out: Partial<Record<ProseKey, ProseValue>> = {};
  for (const d of [base, docs]) {
    if (d.draftedBy !== 'claude') continue;
    const keys = d.needsReview === true ? sectionsNeedingReview(d) : d.draftedSections?.length ? d.draftedSections : [...PROSE_KEYS];
    for (const k of keys) if (!isEmptyValue(d[k])) out[k] = d[k] as ProseValue;
  }
  return out;
}

const norm = (v: unknown) => JSON.stringify(v ?? null);
const cleaned = (d: ComponentDocsJson) => cleanDocs(d);

/** True when a prose value has no content: blank summary, empty list, list of blank items. */
export function isEmptyValue(v: ProseValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return !v.trim();
  return !(v as (string | DocsGuidance)[]).some((x) => (typeof x === 'string' ? x.trim() : x.title.trim() || x.text.trim()));
}

/** Prose keys whose cleaned value differs from the base. */
export function changedKeys(s: Pick<EditState, 'base' | 'docs'>): ProseKey[] {
  const a = cleaned(s.base);
  const b = cleaned(s.docs);
  return (['summary', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines'] as ProseKey[]).filter((k) => norm(a[k] ?? (k === 'summary' ? '' : [])) !== norm(b[k] ?? (k === 'summary' ? '' : [])));
}

/** Sections with at least one changed key, in page order. */
export const changedSections = (s: Pick<EditState, 'base' | 'docs'>): SectionId[] => {
  const keys = changedKeys(s);
  return SECTIONS.filter((x) => x.keys.some((k) => keys.includes(k))).map((x) => x.id);
};

/** The page reads a missing status as stable, so does this. */
/** What docs.json says about review: pending drafts go out as needsReview with draftedSections. */
const reviewMeta = (d: Partial<ComponentDocsJson>) => JSON.stringify([d.needsReview === true, d.needsReview === true ? (d.draftedSections ?? null) : null]);

export const statusChanged = (s: Pick<EditState, 'base' | 'docs'>) => (s.base.status ?? 'stable') !== (s.docs.status ?? 'stable');

/** Anything to send: a changed section or a changed status. */
export const isDirty = (s: Pick<EditState, 'base' | 'docs'> & Partial<EditState>) =>
  changedKeys(s).length > 0 || statusChanged(s) || (s.drafts !== undefined && reviewMeta(docsToSend(s as EditState)) !== reviewMeta(s.base));

export type SectionState = 'drafted' | 'outdated' | 'empty' | 'filled';

/** What a section shows under its heading: Keep and Discard, a Write and Draft line, or nothing. */
export function sectionState(s: EditState, id: SectionId): SectionState {
  const sec = sectionById(id);
  const keys = sec.keys as readonly ProseKey[];
  if (keys.some((k) => k in s.drafts)) return 'drafted';
  if (keys.every((k) => isEmptyValue(s.docs[k]))) return 'empty';
  if (keys.some((k) => s.outdated.includes(k)) && !s.reviewed.includes(id) && !changedKeys(s).some((k) => keys.includes(k))) return 'outdated';
  return 'filled';
}

/** Sections that are empty or outdated: what "Fill empty and outdated sections" works on. */
export const sectionsToFill = (s: EditState): SectionId[] => SECTIONS.filter((x) => ['empty', 'outdated'].includes(sectionState(s, x.id))).map((x) => x.id);

/**
 * Puts Claude's sections on the page as pending drafts. A key drafted twice keeps its first "before". `checked` lists
 * written sections Claude verified against the code: left unchanged they are "Still accurate" (reviewed, nothing to
 * keep); returned in `sections` they are "Updated by Claude".
 */
export function applyDraft(s: EditState, sections: Partial<Record<ProseKey, ProseValue>>, checked: readonly ProseKey[] = []): EditState {
  const drafts = { ...s.drafts };
  const updated = SECTIONS.filter((x) => x.keys.some((k) => k in sections && !isEmptyValue(s.docs[k]))).map((x) => x.id);
  const accurate = SECTIONS.filter((x) => x.keys.some((k) => checked.includes(k) && !(k in sections))).map((x) => x.id);
  const docs = { ...s.docs } as ComponentDocsJson & Record<string, unknown>;
  const claude = { ...(s.claude ?? {}) };
  for (const [k, v] of Object.entries(sections) as [ProseKey, ProseValue][]) {
    if (v === undefined) continue;
    if (!(k in drafts)) drafts[k] = s.docs[k] as ProseValue;
    docs[k] = v as never;
    claude[k] = v;
  }
  const touched = SECTIONS.filter((x) => x.keys.some((k) => k in sections)).map((x) => x.id);
  return {
    ...s,
    docs,
    drafts,
    claude,
    reviewed: [...new Set([...s.reviewed.filter((id) => !touched.includes(id)), ...accurate])],
    kept: s.kept.filter((id) => !touched.includes(id)),
    updated: [...new Set([...s.updated.filter((id) => !touched.includes(id)), ...updated])],
    accurate: [...new Set([...s.accurate.filter((id) => !touched.includes(id)), ...accurate])],
  };
}

/** Keeps the drafts of these sections (all when omitted): the text stays, the section is ticked as reviewed. */
export function keepDrafts(s: EditState, ids?: SectionId[]): EditState {
  const which = ids ?? pendingSections(s);
  const drop = which.flatMap((id) => sectionById(id).keys as readonly ProseKey[]);
  const drafts = Object.fromEntries(Object.entries(s.drafts).filter(([k]) => !drop.includes(k as ProseKey))) as EditState['drafts'];
  return { ...s, drafts, reviewed: [...new Set([...s.reviewed, ...which])], kept: [...new Set([...s.kept, ...which])] };
}

/** Discards the drafts of these sections: each key goes back to the text it had before Claude. */
export function discardDrafts(s: EditState, ids: SectionId[]): EditState {
  const drop = ids.flatMap((id) => sectionById(id).keys as readonly ProseKey[]);
  const docs = { ...s.docs } as ComponentDocsJson & Record<string, unknown>;
  const drafts = { ...s.drafts };
  const claude = { ...(s.claude ?? {}) };
  for (const k of drop) {
    if (!(k in drafts)) continue;
    delete claude[k];
    // A draft that came with the file has no text before it: discarding empties the section.
    const before = drafts[k];
    if (before === undefined) delete docs[k];
    else docs[k] = before as never;
    delete drafts[k];
  }
  return { ...s, docs, drafts, claude, updated: s.updated.filter((id) => !ids.includes(id)) };
}

/** Sections with a pending draft, in page order. */
export const pendingSections = (s: EditState): SectionId[] => SECTIONS.filter((x) => x.keys.some((k) => k in s.drafts)).map((x) => x.id);

/** Writes one prose value (an edit by the person). Editing an outdated section counts as reviewing it. */
export function setValue<K extends ProseKey>(s: EditState, key: K, value: ComponentDocsJson[K]): EditState {
  const id = sectionOf(key).id;
  const reviewed = s.outdated.includes(key) && !s.reviewed.includes(id) ? [...s.reviewed, id] : s.reviewed;
  return { ...s, docs: { ...s.docs, [key]: value }, reviewed };
}

export interface ReviewItem {
  id: SectionId;
  label: string;
  done: boolean;
  /** "Drafted by Claude", "Outdated", "Kept", "Updated". */
  words: string;
  /** True for a section Claude rewrote (it had text). */
  updated?: boolean;
}

/**
 * The rail's To review list: only what still needs a decision, pending Claude drafts and outdated sections. Kept
 * drafts and sections Claude checked as still accurate leave it (the section heading says "Still accurate").
 */
export function toReview(s: EditState): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const x of SECTIONS) {
    const st = sectionState(s, x.id);
    if (st === 'drafted') out.push({ id: x.id, label: x.label, done: false, words: s.updated.includes(x.id) ? 'Updated by Claude' : 'Drafted by Claude', ...(s.updated.includes(x.id) ? { updated: true } : {}) });
    else if (st === 'outdated') out.push({ id: x.id, label: x.label, done: false, words: 'Outdated' });
  }
  return out;
}

/** Where an editable text lives in docs.json: a prose key, an item, and for Do and don't the title or the text. */
export interface FieldRef {
  key: ProseKey;
  index?: number;
  part?: 'title' | 'text';
}

export const fieldId = (f: FieldRef) => [f.key, f.index ?? '', f.part ?? ''].join(':');

export function getField(d: ComponentDocsJson, f: FieldRef): string {
  const v = d[f.key];
  if (typeof v === 'string') return v;
  const item = (v ?? [])[f.index ?? 0];
  if (item === undefined) return '';
  return typeof item === 'string' ? item : item[f.part ?? 'text'];
}

export function setField(d: ComponentDocsJson, f: FieldRef, text: string): ProseValue {
  const v = d[f.key];
  if (typeof v === 'string' || f.key === 'summary') return text;
  const list = [...((v ?? []) as (string | DocsGuidance)[])];
  const i = f.index ?? 0;
  const cur = list[i];
  list[i] = typeof cur === 'object' && cur !== null ? { ...cur, [f.part ?? 'text']: text } : text;
  return list as ProseValue;
}

/** Replaces the selected range of a field. Falls back to the first match of the selected text when the range moved. */
export function replaceSelection(value: string, sel: { start: number; end: number; text: string }, replacement: string): string {
  if (value.slice(sel.start, sel.end) === sel.text) return value.slice(0, sel.start) + replacement + value.slice(sel.end);
  const i = value.indexOf(sel.text);
  return i < 0 ? value : value.slice(0, i) + replacement + value.slice(i + sel.text.length);
}

/** Title of the change, as the send panel prefills it. */
export const sendTitle = (name: string) => `Update ${name} usage guidance`;

/** The pull request title: the conventional docs prefix the repo uses, then the person's words. */
export function changeTitle(slug: string, title: string): string {
  const t = title.trim();
  if (/^[a-z]+(\([^)]*\))?!?:\s/.test(t)) return t;
  return `docs(${slug}): ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

/**
 * The docs.json to send. Kept Claude drafts are credited (draftedBy "claude"); drafts still pending go out marked
 * "needsReview" so the review in Changes asks for them.
 */
export function docsToSend(s: EditState): ComponentDocsJson {
  const { needsReview: _n, draftedSections: _d, ...rest } = s.docs;
  const pending = (Object.keys(s.drafts) as ProseKey[]).filter((k) => !isEmptyValue(s.docs[k]));
  if (pending.length) return markClaudeDraft(rest as ComponentDocsJson, pending);
  const d = rest as ComponentDocsJson;
  if (s.kept?.length) d.draftedBy = 'claude';
  // Every draft reviewed here: a file that waited for review is accepted (needsReview false, as acceptDocsDraft does).
  if (s.base.needsReview === true || s.docs.needsReview === true) d.needsReview = false;
  return d;
}

/** "2 sections", "1 section and the status", for the rail's Changed line. */
export function changedLabel(s: Pick<EditState, 'base' | 'docs'>): string {
  const n = changedSections(s).length;
  const parts = [n ? `${n} ${n === 1 ? 'section' : 'sections'}` : '', statusChanged(s) ? 'the status' : ''].filter(Boolean);
  return parts.join(' and ') || 'Nothing yet';
}

/** What the edit state keeps across reloads, besides the docs text (that lives in the local draft). */
export interface EditMeta {
  drafts: EditState['drafts'];
  claude?: EditState['claude'];
  reviewed: SectionId[];
  kept: SectionId[];
  updated?: SectionId[];
  accurate?: SectionId[];
}

export const editMeta = (s: EditState): EditMeta => ({ drafts: s.drafts, claude: s.claude, reviewed: s.reviewed, kept: s.kept, updated: s.updated, accurate: s.accurate });

export function restoreMeta(s: EditState, m: Partial<EditMeta> | null | undefined): EditState {
  if (!m) return s;
  const valid = SECTIONS.map((x) => x.id) as SectionId[];
  const ids = (xs: SectionId[] | undefined) => (xs ?? []).filter((id) => valid.includes(id));
  return { ...s, drafts: m.drafts ?? s.drafts, claude: { ...(s.claude ?? {}), ...(m.claude ?? {}) }, reviewed: ids(m.reviewed), kept: ids(m.kept), updated: ids(m.updated), accurate: ids(m.accurate) };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* The edit bar: the mode signal at the top of the page while editing.                                                */

export type EditBarState = 'clean' | 'saved' | 'unsaved' | 'sent';

/**
 * The small state under "Editing <name>": nothing changed yet; a draft kept in this browser (editing the published
 * page saves a local draft as you type); changes not saved anywhere yet (editing a change under review, saved there
 * only on Save to change); or sent for review (the send dialog shows its result). Drafts that came with the file
 * (waiting for review) are not a change made here: they do not count until someone keeps or edits them.
 */
export function editBarState(o: { dirty: boolean; sent: boolean; savesLocally: boolean }): EditBarState {
  if (o.sent) return 'sent';
  if (!o.dirty) return 'clean';
  return o.savesLocally ? 'saved' : 'unsaved';
}

export const EDIT_BAR_LABEL: Record<EditBarState, string> = {
  clean: 'No changes yet',
  saved: 'Draft saved in this browser',
  unsaved: 'Unsaved changes',
  sent: 'Sent for review',
};

/**
 * "Keep all" accepts every pending Claude draft at once. It shows only from two drafts (a single draft has its own Keep
 * next to it) and names what it keeps.
 */
export function keepAllLabel(pending: number): string | null {
  return pending >= 2 ? `Keep all ${pending} Claude drafts` : null;
}

export type EscapeIntent = 'none' | 'leave-field' | 'cancel';

/**
 * What Escape does while editing. An open menu, popover or dialog handles its own Escape. In a field, Escape leaves
 * the field and the text stays. Outside a field it asks to leave editing through Cancel, which confirms first when
 * something would be lost: Escape never discards silently.
 */
export function escapeIntent(o: { overlayOpen: boolean; inField: boolean }): EscapeIntent {
  if (o.overlayOpen) return 'none';
  return o.inField ? 'leave-field' : 'cancel';
}

/** Cancel leaves at once when nothing would be lost, else it asks first. */
export const cancelNeedsConfirm = (o: { dirty: boolean; pending: number }) => o.dirty || o.pending > 0;

/* ------------------------------------------------------------------------------------------------------------------ */
/* Who wrote the text, and the open proposal a send continues.                                                         */

/**
 * Who wrote each section of what is sent, by section label (core's docsAuthorLine turns it into the author line).
 * A section with Claude text is "claude" when it goes out as Claude wrote it and was reviewed, "pending" when nobody
 * reviewed it yet, "edited" when the person changed it; a section without Claude text that changed is "written".
 */
export function authorship(s: EditState): DocsAuthorship {
  const out: DocsAuthorship = { claude: [], edited: [], written: [], pending: [] };
  const claudeText = s.claude ?? {};
  const now = cleaned(s.docs);
  const was = cleaned({ ...s.base, ...claudeText } as ComponentDocsJson);
  const changed = changedKeys(s);
  const value = (d: ComponentDocsJson, k: ProseKey) => norm(d[k] ?? (k === 'summary' ? '' : []));
  for (const x of SECTIONS) {
    const keys = x.keys as readonly ProseKey[];
    if (keys.some((k) => k in claudeText)) {
      if (keys.some((k) => value(now, k) !== value(was, k))) out.edited.push(x.label);
      else if (keys.some((k) => k in s.drafts)) out.pending.push(x.label);
      else out.claude.push(x.label);
    } else if (keys.some((k) => changed.includes(k))) out.written.push(x.label);
  }
  return out;
}

/** Why Send is off, or null when it is on: what would be sent is already there. */
export function sendBlockedReason(o: { fileText: string; base: string | null; continuing: boolean }): string | null {
  if (o.base === null || o.fileText !== o.base) return null;
  return o.continuing ? CONTINUE_CLEAN : EDIT_BAR_LABEL.clean;
}

const CONTINUE_CLEAN = 'Nothing changed since the open proposal';

/** The quiet line of an editor opened on the open proposal: who started it ("you" for the viewer), and that it waits. */
export function continueLine(author: string, viewer: string | null | undefined): string {
  const who = viewer && viewer.toLowerCase() === author.toLowerCase() ? 'you' : `@${author}`;
  return `Continues the open proposal by ${who}, waiting for review.`;
}

/** The edit bar's state line: on an open proposal, "nothing changed" says since when. */
export const editBarLabel = (state: EditBarState, continuing: boolean): string => (state === 'clean' && continuing ? CONTINUE_CLEAN : EDIT_BAR_LABEL[state]);
