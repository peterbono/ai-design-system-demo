// "Where it stands": the handover notes of an exploration, so another designer (or another AI tool) carries on
// without the first one. They live in the exploration's note file (.bridge/explorations/<slug>.md, the file Bridge
// writes when it starts one and removes on Done exploring), as plain readable text under five stable headings:
//
//   ## Context          what this is about, in a few sentences
//   ## Decisions        one line per decision taken
//   ## Edge cases       per component (### Button), one line per state: "- [x] Loading: spinner, width kept"
//   ## Open questions   one line per question nobody answered yet
//   ## Next step        where the next person starts
//
// Claude adds to them with each save (bridge_save_exploration `notes`), Studio's exploration page shows and edits
// them, Claude reads them first when it continues one, and Done exploring hands the decisions and edge cases to the
// developers as the spec. The rules below are pure: a parser tolerant of old notes (only Bridge's marker text, no
// headings) and of hand-written text, and a writer that merges an update section by section, keeping everything a
// person wrote that the update does not name, in place, with its own words.
import { EXPLORATION_PREFIX, explorationNotePath, explorationSlugFromBranch } from './explorations';

/** The five sections, in the order a note shows them. */
export const NOTE_SECTIONS = ['context', 'decisions', 'edgeCases', 'openQuestions', 'nextStep'] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

/** The heading each section is written under (and read back from, ignoring case and a trailing colon). */
export const NOTE_HEADINGS: Record<NoteSection, string> = {
  context: 'Context',
  decisions: 'Decisions',
  edgeCases: 'Edge cases',
  openQuestions: 'Open questions',
  nextStep: 'Next step',
};

/** Other words a person may use for a heading: read as the same section, kept as they wrote it. */
const ALIASES: Record<string, NoteSection> = {
  context: 'context',
  background: 'context',
  decisions: 'decisions',
  decision: 'decisions',
  'decisions taken': 'decisions',
  'edge cases': 'edgeCases',
  'edge case': 'edgeCases',
  states: 'edgeCases',
  'open questions': 'openQuestions',
  'open question': 'openQuestions',
  questions: 'openQuestions',
  'next step': 'nextStep',
  'next steps': 'nextStep',
  next: 'nextStep',
};

/** One state of one component, and whether the exploration covers it yet. */
export interface EdgeCase {
  /** The component ("Button"); "General" when a line sits under no component. */
  component: string;
  /** The state or situation ("Loading", "Empty list", "Long label in German"). */
  state: string;
  /** True once the prototype handles it. */
  covered: boolean;
  /** A short note: how it is handled, or what is missing. */
  note?: string | undefined;
}

export interface ExplorationNotes {
  context: string;
  decisions: string[];
  edgeCases: EdgeCase[];
  openQuestions: string[];
  nextStep: string;
}

/**
 * What a save or an edit changes. Every field is optional: a section left out stays as it is. Text sections
 * (context, nextStep) are replaced. Lists are added to: a line already there (same words, any case) is not repeated,
 * an edge case with the same component and state is updated in place. `answeredQuestions` takes questions out of
 * Open questions once answered. `replace` (Studio's in-place edit, where the person sees the whole section) writes
 * the named list sections exactly as given instead of adding to them.
 */
export interface NotesUpdate {
  context?: string | undefined;
  decisions?: readonly string[] | undefined;
  edgeCases?: readonly EdgeCase[] | undefined;
  openQuestions?: readonly string[] | undefined;
  answeredQuestions?: readonly string[] | undefined;
  nextStep?: string | undefined;
}

/** A section of the note file as written: its heading line, its section when it is one of the five, its body. */
interface RawSection {
  heading: string;
  key: NoteSection | null;
  body: string;
}

interface NoteFile {
  /** Everything before the first "## " heading: the title, the purpose and Bridge's marker text. Never touched. */
  preamble: string;
  sections: RawSection[];
}

const H2 = /^##\s+(.+?)\s*#*\s*$/;
const H3 = /^###\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const CHECK = /^\[( |x|X)\]\s*(.*)$/;

const keyOf = (heading: string): NoteSection | null => ALIASES[heading.trim().replace(/:$/, '').trim().toLowerCase()] ?? null;

/** Words compared without case, spacing or end punctuation: "Keep the width." matches "keep the width". */
export const sameWords = (a: string, b: string): boolean => norm(a) === norm(b);
const norm = (s: string) => s.toLowerCase().replace(/[`*_]/g, '').replace(/[\s.!?;:,]+$/g, '').replace(/\s+/g, ' ').trim();

/** Sections that are fenced code are never read as headings (a person may paste a snippet). */
function split(md: string): NoteFile {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const pre: string[] = [];
  const sections: { heading: string; key: NoteSection | null; lines: string[] }[] = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : H2.exec(line);
    if (m) {
      sections.push({ heading: line, key: keyOf(m[1]!), lines: [] });
      continue;
    }
    if (sections.length) sections[sections.length - 1]!.lines.push(line);
    else pre.push(line);
  }
  return { preamble: pre.join('\n'), sections: sections.map((s) => ({ heading: s.heading, key: s.key, body: trimBlank(s.lines.join('\n')) })) };
}

/** Leading and trailing blank lines go; the text keeps its own indentation. */
const trimBlank = (s: string) => s.replace(/^(\s*\n)+/, '').replace(/(\n\s*)+$/, '');

function join(f: NoteFile): string {
  const parts = [trimBlank(f.preamble), ...f.sections.map((s) => (s.body ? `${s.heading}\n\n${s.body}` : s.heading))].filter((x) => x !== '');
  return `${parts.join('\n\n')}\n`;
}

/** The items of a list section: its bullets (with their indented continuation lines), and any paragraph a person wrote. */
function itemsOf(body: string): string[] {
  const out: string[] = [];
  let para: string[] = [];
  let inItem = false;
  const flush = () => {
    if (para.length) out.push(para.join(' ').trim());
    para = [];
  };
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line) || H3.test(line)) continue;
    const b = BULLET.exec(line);
    if (b) {
      flush();
      out.push(b[1]!.replace(CHECK, '$2').trim());
      inItem = true;
    } else if (!line.trim()) {
      flush();
      inItem = false;
    } else if (inItem && /^\s+\S/.test(line)) out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`.trim();
    else {
      inItem = false;
      para.push(line.trim());
    }
  }
  flush();
  return out.filter(Boolean);
}

/** "State: note", "State - note", "State (note)", or only the state. */
function stateAndNote(text: string): { state: string; note?: string } {
  const m = /^(.+?)\s*(?::|\s[-–]\s)\s*(.+)$/.exec(text);
  if (m) return { state: m[1]!.replace(/\*\*/g, '').trim(), note: m[2]!.trim() };
  return { state: text.replace(/\*\*/g, '').trim() };
}

const GENERAL = 'General';

/** The edge cases of the Edge cases section: "### Component" groups lines "- [x] State: note" ([ ] or none: not covered). */
function edgeCasesOf(body: string): EdgeCase[] {
  const out: EdgeCase[] = [];
  let component = GENERAL;
  let last: EdgeCase | null = null;
  for (const line of body.split('\n')) {
    const h = H3.exec(line);
    if (h) {
      component = h[1]!.trim().replace(/:$/, '');
      last = null;
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      const c = CHECK.exec(b[1]!.trim());
      const text = (c ? c[2]! : b[1]!).trim();
      if (!text) continue;
      // "- Button / Loading: note" or "- Button, loading: note" under no component heading.
      const sn = stateAndNote(text);
      let comp = component;
      let state = sn.state;
      if (component === GENERAL) {
        const slash = /^(.+?)\s*\/\s*(.+)$/.exec(sn.state);
        if (slash) [comp, state] = [slash[1]!.trim(), slash[2]!.trim()];
      }
      last = { component: comp, state, covered: c ? c[1]!.toLowerCase() === 'x' : false, ...(sn.note ? { note: sn.note } : {}) };
      out.push(last);
    } else if (last && /^\s+\S/.test(line)) last.note = `${last.note ? `${last.note} ` : ''}${line.trim()}`;
    else if (line.trim()) last = null;
  }
  return out;
}

const textOf = (body: string) => body.trim();

/** The notes of a note file, tolerant of old notes (only the marker text: every section empty) and of hand-written text. */
export function parseExplorationNotes(md: string | null | undefined): ExplorationNotes {
  const notes: ExplorationNotes = { context: '', decisions: [], edgeCases: [], openQuestions: [], nextStep: '' };
  for (const s of split(md ?? '').sections) {
    if (!s.key) continue;
    if (s.key === 'context') notes.context = [notes.context, textOf(s.body)].filter(Boolean).join('\n\n');
    else if (s.key === 'nextStep') notes.nextStep = [notes.nextStep, textOf(s.body)].filter(Boolean).join('\n\n');
    else if (s.key === 'edgeCases') notes.edgeCases.push(...edgeCasesOf(s.body));
    else notes[s.key].push(...itemsOf(s.body));
  }
  return notes;
}

/** True when nobody wrote anything in the five sections yet. */
export const notesEmpty = (n: ExplorationNotes): boolean => !n.context && !n.nextStep && !n.decisions.length && !n.edgeCases.length && !n.openQuestions.length;

/** The counts Studio shows next to the next step. */
export function notesCounts(n: ExplorationNotes): { decisions: number; edgeCases: number; covered: number; open: number; questions: number } {
  const covered = n.edgeCases.filter((e) => e.covered).length;
  return { decisions: n.decisions.length, edgeCases: n.edgeCases.length, covered, open: n.edgeCases.length - covered, questions: n.openQuestions.length };
}

/** One edge case line: "- [x] Loading: spinner replaces the label". */
export const edgeCaseLine = (e: Pick<EdgeCase, 'state' | 'covered' | 'note'>): string => `- [${e.covered ? 'x' : ' '}] ${oneLine(e.state)}${e.note?.trim() ? `: ${oneLine(e.note)}` : ''}`;

/** Text that goes on one line of the file: no line breaks, no em dash (an AI tell Bridge never writes). */
const oneLine = (s: string) => clean(s).replace(/\s*\n\s*/g, ' ').trim();
const clean = (s: string) => s.replace(/\s*—\s*/g, ', ').replace(/\r\n?/g, '\n');

/** The Edge cases body for these cases, grouped by component in first-seen order. */
function edgeCasesBody(cases: readonly EdgeCase[]): string {
  const groups = new Map<string, EdgeCase[]>();
  for (const e of cases) {
    const c = oneLine(e.component) || GENERAL;
    const k = [...groups.keys()].find((x) => sameWords(x, c)) ?? c;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()].map(([c, list]) => [`### ${c}`, '', ...list.map(edgeCaseLine)].join('\n')).join('\n\n');
}

const listBody = (items: readonly string[]) => items.map((x) => `- ${oneLine(x)}`).join('\n');

/** Adds the lines not already there at the end of the section's list, keeping every line a person wrote. */
function addItems(body: string, items: readonly string[]): string {
  const have = itemsOf(body);
  const fresh: string[] = [];
  for (const i of items.map(oneLine).filter(Boolean)) if (!have.some((h) => sameWords(h, i)) && !fresh.some((h) => sameWords(h, i))) fresh.push(i);
  if (!fresh.length) return body;
  return trimBlank(`${body}\n${listBody(fresh)}`);
}

/** Takes the answered questions out of the list, leaving every other line as written. */
function removeItems(body: string, answered: readonly string[]): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const b = BULLET.exec(line);
    if (b) {
      skipping = answered.some((a) => sameWords(a, b[1]!.replace(CHECK, '$2')));
      if (!skipping) out.push(line);
    } else if (skipping && /^\s+\S/.test(line)) continue;
    else {
      skipping = false;
      out.push(line);
    }
  }
  return trimBlank(out.join('\n'));
}

/**
 * Updates or adds edge cases in the section as written: a line with the same component and state is rewritten in
 * place (the person's other lines and headings stay), a new one goes at the end of its component's group, a new
 * component gets its own "### Component" group at the end.
 */
function upsertEdgeCases(body: string, cases: readonly EdgeCase[]): string {
  const lines = body ? body.split('\n') : [];
  for (const raw of cases) {
    const e: EdgeCase = { component: oneLine(raw.component) || GENERAL, state: oneLine(raw.state), covered: Boolean(raw.covered), ...(raw.note?.trim() ? { note: oneLine(raw.note) } : {}) };
    if (!e.state) continue;
    let component = GENERAL;
    let found = -1;
    let groupEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      const h = H3.exec(lines[i]!);
      if (h) {
        component = h[1]!.trim().replace(/:$/, '');
        continue;
      }
      if (!sameWords(component, e.component)) continue;
      const b = BULLET.exec(lines[i]!);
      if (!b) continue;
      groupEnd = i;
      const c = CHECK.exec(b[1]!.trim());
      const sn = stateAndNote((c ? c[2]! : b[1]!).trim());
      if (sameWords(sn.state, e.state)) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      // A note left out keeps the one written before.
      const prev = edgeCasesOf(`### ${e.component}\n${lines[found]}`)[0];
      let end = found + 1;
      while (end < lines.length && /^\s+\S/.test(lines[end]!) && !BULLET.test(lines[end]!)) end++;
      lines.splice(found, end - found, edgeCaseLine({ ...e, note: e.note ?? prev?.note }));
    } else if (groupEnd >= 0) {
      let at = groupEnd + 1;
      while (at < lines.length && /^\s+\S/.test(lines[at]!) && !BULLET.test(lines[at]!)) at++;
      lines.splice(at, 0, edgeCaseLine(e));
    } else {
      const block = [`### ${e.component}`, '', edgeCaseLine(e)];
      if (lines.length && lines[lines.length - 1]!.trim()) lines.push('');
      lines.push(...block);
    }
  }
  return trimBlank(lines.join('\n'));
}

/** Where a missing section goes: after the last of the five that comes before it, else before the first after it, else at the end. */
function insertAt(f: NoteFile, key: NoteSection): number {
  const order = NOTE_SECTIONS.indexOf(key);
  let at = -1;
  f.sections.forEach((s, i) => {
    if (s.key && NOTE_SECTIONS.indexOf(s.key) < order) at = i;
  });
  if (at >= 0) return at + 1;
  const after = f.sections.findIndex((s) => s.key && NOTE_SECTIONS.indexOf(s.key) > order);
  return after >= 0 ? after : f.sections.length;
}

/**
 * The note file with the update merged in, section by section. What the update does not name stays exactly as
 * written: the title, the purpose and Bridge's marker text above the sections, sections Bridge does not know,
 * hand-written lines inside the five. An old note (only the marker text) gets the sections it needs below it.
 * `replace`: the named list sections are written exactly as given (Studio's in-place edit).
 */
export function mergeExplorationNotes(md: string | null | undefined, update: NotesUpdate, opts: { replace?: boolean } = {}): string {
  const f = split(md ?? '');
  const section = (key: NoteSection): RawSection => {
    const found = f.sections.find((s) => s.key === key);
    if (found) return found;
    const s: RawSection = { heading: `## ${NOTE_HEADINGS[key]}`, key, body: '' };
    f.sections.splice(insertAt(f, key), 0, s);
    return s;
  };
  const named = (v: unknown) => v !== undefined && v !== null;
  if (named(update.context)) section('context').body = trimBlank(clean(update.context!).trim());
  if (named(update.decisions)) {
    const s = section('decisions');
    s.body = opts.replace ? listBody(update.decisions!.filter((x) => x.trim())) : addItems(s.body, update.decisions!);
  }
  if (named(update.edgeCases)) {
    const s = section('edgeCases');
    s.body = opts.replace ? edgeCasesBody(update.edgeCases!.filter((e) => e.state?.trim())) : upsertEdgeCases(s.body, update.edgeCases!);
  }
  if (named(update.openQuestions) || (update.answeredQuestions?.length && f.sections.some((s) => s.key === 'openQuestions'))) {
    const s = section('openQuestions');
    if (named(update.openQuestions)) s.body = opts.replace ? listBody(update.openQuestions!.filter((x) => x.trim())) : addItems(s.body, update.openQuestions!);
    if (update.answeredQuestions?.length) s.body = removeItems(s.body, update.answeredQuestions);
  }
  if (named(update.nextStep)) section('nextStep').body = trimBlank(clean(update.nextStep!).trim());
  // A section emptied by the update keeps its heading only while a person's own text is elsewhere in it: an empty one goes.
  f.sections = f.sections.filter((s) => !s.key || s.body.trim() || !named(updateOf(update, s.key)));
  return join(f);
}

const updateOf = (u: NotesUpdate, key: NoteSection): unknown => (key === 'openQuestions' ? (u.openQuestions ?? (u.answeredQuestions?.length ? [] : undefined)) : u[key]);

/** True when the update names nothing. */
export const updateEmpty = (u: NotesUpdate | null | undefined): boolean =>
  !u || (u.context === undefined && u.nextStep === undefined && u.decisions === undefined && u.edgeCases === undefined && u.openQuestions === undefined && !u.answeredQuestions?.length);

/**
 * The spec developers get on Done exploring, from the notes: the decisions, the edge cases (covered or still open)
 * and the open questions, as plain lines under bold labels (no headings, so it sits inside any section of a pull
 * request or a task). Null when the notes hold none of them.
 */
export function notesSpec(n: ExplorationNotes): string | null {
  if (!n.decisions.length && !n.edgeCases.length && !n.openQuestions.length) return null;
  const out: string[] = [];
  if (n.context) out.push(`**Context.** ${oneLine(n.context)}`, '');
  if (n.decisions.length) out.push('**Decisions.**', '', ...n.decisions.map((d) => `- ${oneLine(d)}`), '');
  if (n.edgeCases.length) {
    out.push('**Edge cases.** Checked: the prototype covers it.', '');
    for (const e of n.edgeCases) out.push(`- [${e.covered ? 'x' : ' '}] ${oneLine(e.component)}, ${oneLine(e.state)}${e.note ? `: ${oneLine(e.note)}` : ''}`);
    out.push('');
  }
  if (n.openQuestions.length) out.push('**Open questions.**', '', ...n.openQuestions.map((q) => `- ${oneLine(q)}`), '');
  return out.join('\n').trim();
}

/** The note file of an exploration among the files its branch changed (.bridge/explorations/*.md), else null. */
export const noteFileOf = (files: readonly string[] | null | undefined): string | null => files?.find((f) => /^\.bridge\/explorations\/[^/]+\.md$/.test(f)) ?? null;

/** The note file of an exploration: the one its branch carries, else the one Bridge names after the branch. */
export function explorationNotePathOf(files: readonly string[] | null | undefined, branch: string): string {
  return noteFileOf(files) ?? explorationNotePath(explorationSlugFromBranch(branch) ?? branch.replace(EXPLORATION_PREFIX, ''));
}
