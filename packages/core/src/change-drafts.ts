// Change drafts: the words a designer would otherwise type by hand when sending a change for review. Deterministic and
// offline: computed only from what the diff detected, so they never invent a reason or a number. Shared by the Figma
// plugin (request form, Push description) and any tool that sends requests or pull requests from detected changes.
//
// Voice (docs/DESIGN-LANGUAGE.md section 10): sentence case, starts with a verb, no em dash, digits for numbers.
// A request title never repeats the component: the issue title already starts with it ("Badge: add a danger tone").

import type { DiffEntry } from './diff-engine';
import type { RequestChange, RequestKind } from './requests';
import { modeDisplayName } from './types';
import { formatValue } from './values';

export interface DraftText {
  /** One line, sentence case, no trailing period. Empty when nothing was detected. */
  title: string;
  /** 1 or 2 sentences. Empty when nothing was detected. */
  summary: string;
}

/** Removes em dashes (U+2014), the punctuation the Bridge voice never uses: " a [em dash] b " becomes "a, b". */
export function cleanDraftText(text: string): string {
  return text
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*/, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const values = (s: string | undefined) => (s ?? '').split(', ').map((x) => x.trim()).filter(Boolean);
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "boolean, default false" -> { type: "boolean", def: "false" }. */
function propShape(s: string | undefined): { type: string; def: string } | undefined {
  if (!s) return undefined;
  const m = /^(.*?), default (.*)$/.exec(s);
  return m ? { type: m[1]!, def: m[2]! } : { type: s, def: '' };
}

// ---------------------------------------------------------------------------------------------
// Structure changes: a layer added, removed or moved in a variant. The scan writes them as rows
// `New layer "Icon" (Size=sm, Variant=primary)` with the kind and the place as values:
// added `instance Icon/Pencil, after "Label"`, removed the same as `before`, moved `after "A"` -> `before "B"`.

const VARIANT_FIRST = ['variant', 'tone', 'intent', 'appearance', 'kind', 'type', 'style'];

/** "Size=sm, State=Default, Variant=primary" -> "primary sm": the values a designer says, default states left out. */
export function shortVariant(key: string): string {
  const pairs = key.split(', ').map((p) => {
    const at = p.indexOf('=');
    return at < 0 ? { k: '', v: p.trim() } : { k: p.slice(0, at).trim(), v: p.slice(at + 1).trim() };
  });
  const kept = pairs.filter((p) => p.v && !/^default$/i.test(p.v));
  if (!kept.length) return key;
  const rank = (k: string) => {
    const i = VARIANT_FIRST.indexOf(k.toLowerCase());
    return i < 0 ? VARIANT_FIRST.length : i;
  };
  return kept
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i)
    .map((p) => p.v)
    .join(' ');
}

/** "Size=sm, Variant=primary; Size=md, Variant=primary" -> "primary sm and primary md"; empty -> "every variant". */
export const shortVariants = (list: string | undefined) => (list ? andList(list.split('; ').map(shortVariant)) : 'every variant');

export interface StructureRow {
  op: 'added' | 'removed' | 'moved';
  name: string;
  /** "in primary sm" or "in every variant". */
  where: string;
  /** Layer type in words ("instance", "text", "frame"), when known. */
  type?: string | undefined;
  /** Main component of an instance ("Icon/Pencil"). */
  main?: string | undefined;
  /** Where it sits now (added, moved) or sat (removed): `after "Label"`, `before "Label"`, `alone`. */
  at?: string | undefined;
  /** Moved: where it sat before. */
  from?: string | undefined;
}

/** A structure row read back, or undefined when the field is not one. */
export function parseStructureChange(c: RequestChange): StructureRow | undefined {
  const m = /^(New|Removed|Moved) layer "(.*)"(?: \((.*)\))?$/.exec(c.field);
  if (!m) return undefined;
  const op = m[1] === 'New' ? 'added' : m[1] === 'Removed' ? 'removed' : 'moved';
  const where = `in ${shortVariants(m[3])}`;
  if (op === 'moved') return { op, name: m[2]!, where, at: c.after, from: c.before };
  const shape = (op === 'added' ? c.after : c.before) ?? '';
  const sm = /^(\S+)(?: (.*?))?, ((?:after|before) ".*"|alone)$/.exec(shape);
  return { op, name: m[2]!, where, ...(sm ? { type: sm[1], ...(sm[2] ? { main: sm[2] } : {}), at: sm[3] } : {}) };
}

function structurePhrase(r: StructureRow): string {
  const type = r.type ? `${r.type} ` : '';
  const main = r.main ? ` (${r.main})` : '';
  const at = r.at && r.at !== 'alone' ? ` ${r.at}` : '';
  if (r.op === 'added') return `New ${type}layer "${r.name}"${main}${at} ${r.where}`;
  if (r.op === 'removed') return `Removed ${type}layer "${r.name}"${main}${at} ${r.where}`;
  return `Moved layer "${r.name}" ${r.at ?? ''}${r.from ? ` (was ${r.from})` : ''} ${r.where}`.replace(/\s+/g, ' ');
}

const bare = (at: string | undefined) => (at ?? '').replace(/"/g, '');

/** Title and summary for the first change of a detected component change. */
function firstChange(component: string, kind: RequestKind, c: RequestChange | undefined, all: RequestChange[]): DraftText {
  switch (kind) {
    case 'new-component': {
      const axes = all.filter((x) => x.field.startsWith('Variant '));
      const props = all.filter((x) => x.field.startsWith('Prop '));
      const parts = [axes.length ? plural(axes.length, 'variant axis', 'variant axes') : '', props.length ? plural(props.length, 'prop') : ''].filter(Boolean);
      return {
        title: `Add the ${component} component`,
        summary: `${component} is not in code yet.${parts.length ? ` The Figma component has ${andList(parts)}.` : ''}`,
      };
    }
    case 'new-variant': {
      if (!c) return { title: `Update the ${component} variants`, summary: `The variants of ${component} changed in Figma.` };
      const axis = c.field.replace(/^Variant /, '');
      const before = values(c.before);
      const after = values(c.after);
      const added = after.filter((x) => !before.includes(x));
      const removed = before.filter((x) => !after.includes(x));
      const word = axis.toLowerCase();
      if (!before.length) return { title: `Add a ${axis} variant axis`, summary: `${component} gets a new variant axis, ${axis}, with ${after.length === 1 ? 'the value' : 'the values'} ${andList(after)}.` };
      if (!after.length) return { title: `Remove the ${axis} variant axis`, summary: `${component} no longer has the ${axis} variant axis (${andList(before)}).` };
      if (added.length === 1 && !removed.length) return { title: `Add ${article(added[0]!)} ${added[0]} ${word}`, summary: `${component} gets a new ${axis} value, ${added[0]}.` };
      if (added.length && !removed.length) return { title: `Add ${andList(added)} to ${axis}`, summary: `${component} gets ${plural(added.length, `new ${axis} value`)}: ${andList(added)}.` };
      if (removed.length === 1 && !added.length) return { title: `Remove the ${removed[0]} ${word}`, summary: `${component} no longer has the ${axis} value ${removed[0]}.` };
      if (removed.length && !added.length) return { title: `Remove ${andList(removed)} from ${axis}`, summary: `${component} no longer has the ${axis} values ${andList(removed)}.` };
      return { title: `Change the ${axis} values`, summary: `${axis} on ${component} goes from ${andList(before)} to ${andList(after)}.` };
    }
    case 'prop-change': {
      if (!c) return { title: `Change a ${component} prop`, summary: `A prop of ${component} changed in Figma.` };
      const name = c.field.replace(/^Prop /, '');
      const b = propShape(c.before);
      const a = propShape(c.after);
      if (!b && a) return { title: `Add the ${name} prop`, summary: `${component} gets a new ${a.type} prop, ${name}${a.def ? `, default ${a.def}` : ''}.` };
      if (b && !a) return { title: `Remove the ${name} prop`, summary: `${component} no longer has the ${name} prop.` };
      if (b && a && b.type === a.type && b.def !== a.def) return { title: `Change the ${name} default to ${a.def || 'empty'}`, summary: `The default of ${name} on ${component} goes from ${b.def || 'empty'} to ${a.def || 'empty'}.` };
      return { title: `Change the ${name} prop`, summary: `${name} on ${component} goes from ${c.before ?? 'none'} to ${c.after ?? 'none'}.` };
    }
    case 'token-binding': {
      if (!c) return { title: 'Use another token', summary: `A part of ${component} uses another token in Figma.` };
      const m = /^(.*?)(?: \((.*)\))?$/.exec(c.field)!;
      const part = lower(m[1]!);
      const where = m[2] ? ` in ${m[2]}` : '';
      const after = c.after && c.after !== 'none' ? c.after : '';
      const before = c.before && c.before !== 'none' ? c.before : '';
      if (!after) return { title: `Unbind the ${part}`, summary: `The ${part} of ${component}${where} no longer uses ${before || 'a token'}.` };
      return {
        title: `Use ${after} for the ${part}`,
        summary: `The ${part} of ${component}${where} ${before ? `moves from ${before} to ${after}` : `now uses ${after}`}.`,
      };
    }
    case 'structure': {
      const r = c ? parseStructureChange(c) : undefined;
      if (!r) return { title: 'Change the layers to match Figma', summary: `The layers of ${component} changed in Figma.` };
      if (r.op === 'added') {
        const at = r.at && r.at !== 'alone' ? ` ${bare(r.at)}` : '';
        return { title: `Add a layer${at}`, summary: `${component} gets ${article(r.type ?? 'layer')} ${r.type ?? 'layer'}${r.type ? ' layer' : ''}, ${r.name}${r.main ? ` (${r.main})` : ''}${at} ${r.where}.` };
      }
      if (r.op === 'removed') return { title: `Remove the ${r.name} layer`, summary: `${component} no longer has the ${r.name} layer ${r.where}.` };
      return { title: `Move the ${r.name} layer`, summary: `The ${r.name} layer of ${component} moves ${bare(r.at) || 'elsewhere'}${r.from ? ` (it was ${bare(r.from)})` : ''} ${r.where}.` };
    }
    case 'visual':
      return {
        title: 'Update the look to match Figma',
        summary: `${component} looks different in Figma${c?.field.startsWith('Look of ') && c.field !== 'Look of every variant' ? ` in ${c.field.slice(8)}` : ''}, and no variable edit explains it.`,
      };
    default:
      return { title: '', summary: '' };
  }
}

/**
 * The deterministic title and summary of a component change request, from the changes a scan detected. Manual
 * requests with no detected change (a bug, an idea) get empty text: there is nothing factual to say yet.
 */
export function draftRequestText(component: string, kind: RequestKind, changes: RequestChange[]): DraftText {
  const name = component.trim() || 'the component';
  if (!changes.length && kind !== 'new-component') return { title: '', summary: '' };
  const d = firstChange(name, kind, changes[0], changes);
  const rest = kind === 'new-component' ? 0 : changes.length - 1;
  const summary = rest > 0 ? `${d.summary} ${capital(plural(rest, 'other change'))} ${rest === 1 ? 'is' : 'are'} listed below.` : d.summary;
  return { title: cleanDraftText(d.title), summary: cleanDraftText(summary) };
}

// ---------------------------------------------------------------------------------------------
// Change lines: one sentence per detected component change, the main line of its row in the plugin and the first line
// of its request. Claude rewrites it from the before and after images; this is the deterministic default.

/** A change line is one sentence of at most this many characters, with no trailing period. */
export const DRAFT_LINE_MAX = 120;

/** Shortens to `max` characters at a word boundary, without a trailing period. */
function clipText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:(]+$/, '');
}

/** A change line kept to the contract: one line, no em dash, at most 120 characters, no trailing period. */
export function sanitizeDraftLine(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return capital(clipText(cleanDraftText(raw.replace(/[\r\n]+/g, ' ')), DRAFT_LINE_MAX));
}

/** One change row as a short phrase a developer reads ("Fill uses color.x instead of color.y in Size=sm"). */
function changePhrase(c: RequestChange): string {
  let m: RegExpExecArray | null;
  if ((m = /^Variant (.+)$/.exec(c.field))) {
    const axis = m[1]!;
    const before = values(c.before);
    const after = values(c.after);
    if (!before.length) return `New ${axis} variant axis: ${after.join(', ')}`;
    if (!after.length) return `${axis} variant axis removed (${before.join(', ')})`;
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    const parts = [added.length ? `${andList(added)} added to ${axis}` : '', removed.length ? `${andList(removed)} removed from ${axis}` : ''].filter(Boolean);
    return parts.join('; ') || `${axis} values reordered: ${after.join(', ')}`;
  }
  if ((m = /^Prop (.+)$/.exec(c.field))) {
    const name = m[1]!;
    const b = propShape(c.before);
    const a = propShape(c.after);
    if (!b && a) return `New ${a.type} prop ${name}${a.def ? `, default ${a.def}` : ''}`;
    if (b && !a) return `${name} prop removed`;
    if (b && a && b.type === a.type) return `${name} default goes from ${b.def || 'empty'} to ${a.def || 'empty'}`;
    return `${name} prop goes from ${c.before ?? 'none'} to ${c.after ?? 'none'}`;
  }
  if ((m = /^Swapped instance(?: \((.*)\))?$/.exec(c.field))) return `Shows ${c.after ?? 'another instance'} instead of ${c.before ?? 'the coded one'} ${m[1] ? `in ${m[1]}` : 'in every variant'}`;
  if ((m = /^Look of (.+)$/.exec(c.field))) return `Looks different in ${m[1]}; no variable explains it`;
  const layer = parseStructureChange(c);
  if (layer) return structurePhrase(layer);
  // A token binding: "Fill" or "Fill (Size=sm, Tone=primary)".
  m = /^(.*?)(?: \((.*)\))?$/.exec(c.field)!;
  const where = m[2] ? ` in ${m[2]}` : '';
  const before = c.before && c.before !== 'none' ? c.before : '';
  const after = c.after && c.after !== 'none' ? c.after : '';
  if (!after) return `${m[1]} no longer uses ${before || 'a token'}${where}`;
  if (!before) return `${m[1]} now uses ${after}${where}`;
  return `${m[1]} uses ${after} instead of ${before}${where}`;
}

/**
 * The deterministic change line of a detected component change: what changed, in one sentence, from the diff only.
 * The first change is spelled out, the others counted ("and 2 more"). Empty when nothing was detected.
 */
export function draftChangeLine(kind: RequestKind, changes: RequestChange[]): string {
  if (kind === 'new-component') {
    const axes = changes.filter((x) => x.field.startsWith('Variant ')).length;
    const props = changes.filter((x) => x.field.startsWith('Prop ')).length;
    const parts = [axes ? plural(axes, 'variant axis', 'variant axes') : '', props ? plural(props, 'prop') : ''].filter(Boolean);
    return `New component${parts.length ? ` with ${andList(parts)}` : ''}, not in code yet`;
  }
  if (!changes.length) return '';
  const first = changePhrase(changes[0]!);
  const rest = changes.length - 1;
  const tail = rest ? ` (and ${rest} more)` : '';
  return capital(clipText(cleanDraftText(first), DRAFT_LINE_MAX - tail.length)) + tail;
}

// ---------------------------------------------------------------------------------------------
// Push description (variables pull request and the requests sent with it)

const tokenOf = (e: DiffEntry) => e.figma ?? e.head ?? e.base;
const pathOf = (e: DiffEntry) => tokenOf(e)?.path ?? e.path;

/** One line per variable edit for a change table: the token, its value before, its value in Figma. */
export function pushChangeRows(entries: DiffEntry[]): RequestChange[] {
  return entries.map((e) => {
    const before = e.head ?? e.base;
    const after = e.figma;
    const show = (t: typeof before) => {
      if (!t) return undefined;
      const modes = Object.keys(t.values);
      if (modes.length <= 1) return formatValue(t.type, t.values[modes[0] ?? '']);
      return modes.map((m) => `${modeDisplayName(m)} ${formatValue(t.type, t.values[m])}`).join('; ');
    };
    const renamed = e.local?.kind === 'renamed' && before && after && before.path !== after.path;
    return { field: renamed ? `${before.path} -> ${after.path}` : pathOf(e), before: show(before), after: show(after) };
  });
}

/** "a, b and c", or "7 tokens, including a and b" when the list is long. */
function names(paths: string[]): string {
  if (paths.length <= 3) return andList(paths);
  return `${paths.length} tokens, including ${andList(paths.slice(0, 2))}`;
}

/** Modes a changed token's value moved in ("Light and Dark"), for a single changed token. */
function valueModes(e: DiffEntry): string[] {
  return (e.local?.fields ?? []).filter((f) => f.field === 'value' && f.mode && f.mode !== 'value').map((f) => modeDisplayName(f.mode!));
}

export interface PushDraftComponent {
  component: string;
  kind: RequestKind;
}

/**
 * The deterministic Push description: what the checked variable edits do and which components get a request.
 * 1 or 2 sentences, never a reason (only the designer knows why). Empty when nothing is checked.
 */
export function draftPushDescription(entries: DiffEntry[], components: PushDraftComponent[] = []): string {
  const by: Record<'changed' | 'added' | 'renamed' | 'removed', DiffEntry[]> = { changed: [], added: [], renamed: [], removed: [] };
  for (const e of entries) by[e.local?.kind ?? 'changed'].push(e);
  const clauses: string[] = [];
  if (by.changed.length) {
    const only = by.changed.length === 1 ? by.changed[0]! : undefined;
    const fields = new Set((only?.local?.fields ?? []).map((f) => f.field));
    const modes = only ? valueModes(only) : [];
    if (only && fields.size === 1 && fields.has('description')) clauses.push(`updates the description of ${pathOf(only)}`);
    else if (only && modes.length) clauses.push(`changes ${pathOf(only)} in ${andList(modes)}`);
    else clauses.push(`changes ${names(by.changed.map(pathOf))}`);
  }
  if (by.added.length) clauses.push(`adds ${names(by.added.map(pathOf))}`);
  if (by.renamed.length) {
    const r = by.renamed[0]!;
    const from = (r.head ?? r.base)?.path;
    clauses.push(by.renamed.length === 1 && from && from !== pathOf(r) ? `renames ${from} to ${pathOf(r)}` : `renames ${names(by.renamed.map(pathOf))}`);
  }
  if (by.removed.length) clauses.push(`removes ${names(by.removed.map(pathOf))}`);
  const sentences: string[] = [];
  if (clauses.length) sentences.push(`${capital(andList(clauses))}.`);
  const fresh = components.filter((c) => c.kind === 'new-component').map((c) => c.component);
  const changed = [...new Set(components.filter((c) => c.kind !== 'new-component').map((c) => c.component))];
  const comp: string[] = [];
  if (changed.length) comp.push(`${changed.length === 1 ? 'a change' : 'changes'} to ${andList(changed)}`);
  if (fresh.length) comp.push(`the new ${andList(fresh)} component${fresh.length === 1 ? '' : 's'}`);
  if (comp.length) sentences.push(`Requests ${andList(comp)}.`);
  return cleanDraftText(sentences.join(' '));
}
