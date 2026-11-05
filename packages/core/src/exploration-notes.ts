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
// headings) and of hand-written text (numbered lists, heading words singular or plural, "Component, state: covered"
// lines: it never drops a word), a writer that merges an update section by section, keeping everything a person
// wrote that the update does not name, in place, with its own words, and a normalizer that rewrites a note file an
// AI tool wrote itself in this format, so Studio and the next person read a clean file.
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
  'decisions made': 'decisions',
  'edge cases': 'edgeCases',
  'edge case': 'edgeCases',
  'edge-cases': 'edgeCases',
  'edge-case': 'edgeCases',
  states: 'edgeCases',
  'open questions': 'openQuestions',
  'open question': 'openQuestions',
  questions: 'openQuestions',
  question: 'openQuestions',
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
/** A list item: "-", "*" or "+" bullets and numbered items ("1." or "1)"). */
const BULLET = /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const CHECK = /^\[( |x|X)\]\s*(.*)$/;

const keyOf = (heading: string): NoteSection | null =>
  ALIASES[
    heading
      .replace(/[*_`]/g, '')
      .trim()
      .replace(/[\s:.?]+$/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
  ] ?? null;

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
    if (/^\s*(```|~~~)/.test(line)) continue;
    const h = H3.exec(line);
    if (h) {
      // A subheading a person used to group the list: kept as a line of its own, never lost.
      flush();
      out.push(h[1]!.trim());
      inItem = false;
      continue;
    }
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

/** Words that say whether a case is covered, as people (and AI tools) write them after the state. */
const STATUS = '(not yet covered|not covered|uncovered|covered|not done|done|to do|todo|missing|yes|no|ok)';
const coveredWord = (w: string) => /^(covered|done|yes|ok)$/i.test(w.trim());
/** "State: covered. note", "State: no - note": the status word ends the state, then punctuation or the end. */
const COLON_STATUS = new RegExp(`^(.+?)\\s*:\\s*${STATUS}(?:\\s*$|\\s*[.,;:!]\\s*|\\s+[-–]\\s+)(.*)$`, 'i');
/** "State (covered) note". */
const PAREN_STATUS = new RegExp(`^(.+?)\\s*\\(${STATUS}\\)\\s*[.,;:]?\\s*(?:[-–]\\s+)?(.*)$`, 'i');
/** A covered or open mark some tools write instead of a checkbox. */
const MARK = /^(✅|✔️?|☑️?|❌|✖️?|⬜|☐)\s*/u;

const unbold = (s: string) => s.replace(/\*\*|__/g, '').trim();

/**
 * One edge case line, in any of the forms people and AI tools write:
 *   under "### Button":  "- [x] Loading: spinner"      "- Loading: covered. spinner"     "- Loading (covered) spinner"
 *   under no component:  "- [x] Button / Loading: spinner"  "- [x] Button: loading, spinner"
 *                        "- Button, loading: covered|not covered|yes|no. note"   "- Button / loading (covered) note"
 * A line Bridge cannot split keeps all its words as the state, so nothing is lost.
 */
function edgeCaseOf(raw: string, heading: string | null): EdgeCase | null {
  let text = raw.trim();
  let checked: boolean | null = null;
  const c = CHECK.exec(text);
  if (c) {
    checked = c[1]!.toLowerCase() === 'x';
    text = c[2]!.trim();
  }
  const mark = MARK.exec(text);
  if (mark) {
    checked ??= /✅|✔|☑/u.test(mark[1]!);
    text = text.slice(mark[0].length).trim();
  }
  if (!text) return null;
  let head: string;
  let note: string | undefined;
  let status: boolean | null = null;
  // A checkbox already says it: the words after it are the state and its note, as Bridge writes them ("- [x] Empty: done").
  const st = checked === null ? (PAREN_STATUS.exec(text) ?? COLON_STATUS.exec(text)) : null;
  if (st) {
    head = st[1]!.trim();
    status = coveredWord(st[2]!);
    note = st[3]!.trim() || undefined;
  } else {
    const sn = stateAndNote(text);
    head = sn.state;
    note = sn.note;
  }
  let component = heading ?? GENERAL;
  let state = head;
  const comma = /^(.+?)\s*,\s*(.+)$/.exec(head);
  const slash = /^(.+?)\s*\/\s*(.+)$/.exec(head);
  if (heading) {
    // "- Button, loading: covered" under "### Button": the component said twice.
    const named = comma ?? slash;
    if (named && sameWords(unbold(named[1]!), heading)) state = named[2]!;
  } else if (slash) [component, state] = [slash[1]!, slash[2]!];
  else if (st && comma) [component, state] = [comma[1]!, comma[2]!];
  else if (!st && checked !== null && note) {
    // "- [x] Button: loading, spinner kept": the component, then the state and its note after a comma.
    const sc = /^(.+?)\s*,\s*(.+)$/.exec(note);
    [component, state, note] = sc ? [head, sc[1]!, sc[2]!] : [component, state, note];
  }
  component = unbold(component).replace(/:$/, '') || GENERAL;
  state = unbold(state);
  if (!state) return null;
  return { component, state, covered: status ?? checked ?? false, ...(note?.trim() ? { note: note.trim() } : {}) };
}

/** The edge cases of the Edge cases section: "### Component" groups lines "- [x] State: note" ([ ] or none: not covered). */
function edgeCasesOf(body: string): EdgeCase[] {
  const out: EdgeCase[] = [];
  let heading: string | null = null;
  let last: EdgeCase | null = null;
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    const h = fence ? null : H3.exec(line);
    if (h) {
      heading = unbold(h[1]!.trim().replace(/:$/, '')) || null;
      last = null;
      continue;
    }
    if (!line.trim()) continue;
    const b = fence ? null : BULLET.exec(line);
    if (b) {
      last = edgeCaseOf(b[1]!, heading);
      if (last) out.push(last);
    } else if (last) {
      // A line under a case (indented or not): more of its note, never dropped.
      last.note = `${last.note ? `${last.note} ` : ''}${line.trim()}`;
    } else {
      // Text before any case: read as a case of its own, so it stays visible.
      last = edgeCaseOf(line, heading);
      if (last) out.push(last);
    }
  }
  return out;
}

/** A text section (context, next step) without the list marks an AI tool may put in front of its lines. */
const textOf = (body: string): string => {
  let fence = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      return fence ? line : line.replace(/^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+(?:\[( |x|X)\]\s*)?/, '');
    })
    .join('\n')
    .trim();
};


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
    let heading: string | null = null;
    let found = -1;
    let foundUnder: string | null = null;
    let prev: EdgeCase | null = null;
    let groupEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      const h = H3.exec(lines[i]!);
      if (h) {
        heading = unbold(h[1]!.trim().replace(/:$/, '')) || null;
        continue;
      }
      const b = BULLET.exec(lines[i]!);
      if (!b) continue;
      const ec = edgeCaseOf(b[1]!, heading);
      if (!ec || !sameWords(ec.component, e.component)) continue;
      // New lines only join a "### Component" group: under no heading they would read as General.
      if (heading) groupEnd = i;
      if (sameWords(ec.state, e.state)) {
        found = i;
        foundUnder = heading;
        prev = ec;
        break;
      }
    }
    if (found >= 0) {
      // A note left out keeps the one written before.
      let end = found + 1;
      while (end < lines.length && /^\s+\S/.test(lines[end]!) && !BULLET.test(lines[end]!)) end++;
      const block = edgeCasesOf([...(foundUnder ? [`### ${foundUnder}`] : []), ...lines.slice(found, end)].join('\n'))[0] ?? prev;
      const line = edgeCaseLine({ ...e, note: e.note ?? block?.note });
      lines.splice(found, end - found, foundUnder ? line : line.replace(/^(- \[.\] )/, `$1${e.component} / `));
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

/**
 * The note file rewritten in Bridge's own format, for a note file an AI tool or a person wrote by hand (numbered
 * lists, "Component, state: covered" lines, "Open question" headings...): the five sections get their own headings
 * and one line per item, edge cases grouped under "### Component" as "- [x] State: note". Everything else stays as
 * written: the title, the purpose and Bridge's marker text above the sections, sections Bridge does not know. Every
 * word of the five sections is kept (parseExplorationNotes never drops text). Writing it twice changes nothing more.
 * `previous`: the note file before; when the new one starts straight with the sections, its title, purpose and
 * Bridge's marker text are kept on top.
 */
export function normalizeExplorationNotes(md: string | null | undefined, opts: { previous?: string | null | undefined } = {}): string {
  const f = split(md ?? '');
  if (!f.sections.some((s) => s.key)) return md ?? '';
  if (!f.preamble.trim() && opts.previous) f.preamble = split(opts.previous).preamble;
  const n = parseExplorationNotes(md);
  const bodies: Record<NoteSection, string> = {
    context: trimBlank(clean(n.context).trim()),
    decisions: listBody(n.decisions),
    edgeCases: edgeCasesBody(n.edgeCases),
    openQuestions: listBody(n.openQuestions),
    nextStep: trimBlank(clean(n.nextStep).trim()),
  };
  const canonical = NOTE_SECTIONS.filter((k) => bodies[k]).map((k): RawSection => ({ heading: `## ${NOTE_HEADINGS[k]}`, key: k, body: bodies[k] }));
  // The five fill the places they held, in the stable order; sections Bridge does not know stay where they were.
  const out: RawSection[] = [];
  let next = 0;
  for (const s of f.sections) {
    if (!s.key) out.push(s);
    else if (next < canonical.length) out.push(canonical[next++]!);
  }
  return join({ preamble: f.preamble, sections: out });
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
