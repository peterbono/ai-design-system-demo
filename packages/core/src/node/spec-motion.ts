// Motion for component specs: reads the CSS `transition` of the parts that change between two variants (hover, press,
// checked) and resolves it from the motion tokens to what a Figma prototype plays (Smart animate, a duration in ms and
// an easing). Also lists the motion Figma cannot play: looping keyframe animations, keyboard focus, popups opening.
// Pure: no DOM, no Node API.

import type { SpecEasing, SpecMotionNote, SpecTransition } from '../component-spec';
import { type CssRule, splitTop } from './spec-css';

/** A CSS custom property's token, with its value resolved in the default modes (durations and easings). */
export interface MotionToken {
  path: string;
  type: string;
  value?: unknown;
}

/** One entry of a `transition` list: the property, and its duration, easing and delay as written. */
export interface TransitionEntry {
  property: string;
  duration: string;
  easing: string;
  delay: string;
}

/** CSS easing keywords, as cubic beziers (CSS Easing Functions Level 1). */
const KEYWORDS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** Properties that never show in a drawing: not compared between variants. */
const SILENT = /^(cursor|pointer-events|user-select|-webkit-.*|transition.*|animation.*|will-change|outline.*|content|touch-action)$/;

/** `var(--x)` replaced by the value of a non-token custom property the element has, recursively. */
export function substituteVars(raw: string, computed: Map<string, string>, tokens: Map<string, MotionToken>, depth = 0): string {
  if (depth > 12) return raw;
  return raw.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (m, name: string, fallback?: string) => {
    if (tokens.has(name)) return m;
    const v = computed.get(name);
    if (v !== undefined && v !== 'initial') return substituteVars(v, computed, tokens, depth + 1);
    return fallback !== undefined ? substituteVars(fallback.trim(), computed, tokens, depth + 1) : m;
  });
}

const isTime = (t: string, tokens: Map<string, MotionToken>) => /^-?[\d.]+m?s$/i.test(t) || tokens.get(varName(t) ?? '')?.type === 'duration';
const varName = (t: string) => /^var\(\s*(--[\w-]+)/.exec(t)?.[1];

/**
 * The transitions an element declares: the `transition` shorthand and the longhands (transition-property, -duration,
 * -timing-function, -delay; shorter lists repeat, as in CSS). Local custom properties are substituted first.
 */
export function parseTransitions(computed: Map<string, string>, tokens: Map<string, MotionToken>): TransitionEntry[] {
  const sub = (k: string) => {
    const v = computed.get(k);
    return v === undefined ? undefined : substituteVars(v, computed, tokens);
  };
  const out: TransitionEntry[] = [];
  const short = sub('transition');
  if (short && short !== 'none') {
    for (const item of splitTop(short, ',')) {
      const words = splitTop(item.trim(), /\s/).filter(Boolean);
      const e: TransitionEntry = { property: 'all', duration: '0s', easing: 'ease', delay: '0s' };
      let times = 0;
      for (const w of words) {
        if (isTime(w, tokens)) {
          if (times++ === 0) e.duration = w;
          else e.delay = w;
        } else if (KEYWORDS[w] || w === 'linear' || /^(cubic-bezier|steps|linear)\(/.test(w) || /^step-(start|end)$/.test(w) || tokens.get(varName(w) ?? '')?.type === 'cubicBezier') e.easing = w;
        else e.property = w;
      }
      out.push(e);
    }
  }
  const props = sub('transition-property');
  if (props === undefined) return out;
  const list = (k: string, def: string) => {
    const v = sub(k);
    return v === undefined ? [def] : splitTop(v, ',').map((x) => x.trim());
  };
  const durations = list('transition-duration', '0s');
  const easings = list('transition-timing-function', 'ease');
  const delays = list('transition-delay', '0s');
  return splitTop(props, ',')
    .map((p) => p.trim())
    .filter((p) => p && p !== 'none')
    .map((property, i) => ({ property, duration: durations[i % durations.length]!, easing: easings[i % easings.length]!, delay: delays[i % delays.length]! }));
}

/** A duration as milliseconds, with its token: "var(--motion-duration-fast)" -> 150 (motion.duration.fast). */
export function resolveDuration(raw: string, tokens: Map<string, MotionToken>): { ms: number; token?: string } | undefined {
  const v = raw.trim();
  const lit = /^(-?[\d.]+)(m?s)$/i.exec(v);
  if (lit) return { ms: Number(lit[1]) * (lit[2]!.toLowerCase() === 's' ? 1000 : 1) };
  const t = tokens.get(varName(v) ?? '');
  if (!t || t.type !== 'duration') return undefined;
  const value = t.value as { value?: number; unit?: string } | string | undefined;
  if (typeof value === 'string') {
    const r = resolveDuration(value, new Map());
    return r ? { ms: r.ms, token: t.path } : undefined;
  }
  if (value && typeof value.value === 'number') return { ms: value.value * (value.unit === 's' ? 1000 : 1), token: t.path };
  return undefined;
}

/**
 * An easing Figma can play, with its token: a cubic bezier (token or `cubic-bezier()`, or a CSS keyword) is played
 * exactly as Figma's custom bezier; linear as linear. steps() has no Figma easing: linear, recorded as approximated.
 */
export function resolveEasing(raw: string, tokens: Map<string, MotionToken>): { easing: SpecEasing; token?: string; approximated?: string } | undefined {
  const v = raw.trim().toLowerCase();
  const curve = (b: number[]): SpecEasing =>
    b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 1 ? { type: 'LINEAR' } : { type: 'CUSTOM_CUBIC_BEZIER', bezier: [b[0]!, b[1]!, b[2]!, b[3]!] };
  if (v === 'linear') return { easing: { type: 'LINEAR' } };
  if (KEYWORDS[v]) return { easing: curve(KEYWORDS[v]!) };
  const cb = /^cubic-bezier\(([^)]*)\)$/.exec(v);
  if (cb) {
    const n = cb[1]!.split(',').map((x) => Number(x.trim()));
    return n.length === 4 && n.every((x) => Number.isFinite(x)) ? { easing: curve(n) } : undefined;
  }
  if (/^(steps\(|step-(start|end)$)/.test(v)) return { easing: { type: 'LINEAR' }, approximated: `${raw.trim()} moves in steps, Figma has no stepped easing: linear` };
  if (/^linear\(/.test(v)) return { easing: { type: 'LINEAR' }, approximated: 'a linear() curve has no Figma easing: linear' };
  const t = tokens.get(varName(raw.trim()) ?? '');
  if (!t || t.type !== 'cubicBezier') return undefined;
  const value = t.value;
  if (Array.isArray(value) && value.length === 4 && value.every((x) => typeof x === 'number')) return { easing: curve(value as number[]), token: t.path };
  if (typeof value === 'string') {
    const r = resolveEasing(value, new Map());
    return r ? { ...r, token: t.path } : undefined;
  }
  return undefined;
}

/** The property a longhand belongs to, without its side: border-top-color -> border-color, padding-left -> padding. */
export const shorthandOf = (prop: string) =>
  prop
    .replace(/-(top|bottom)-(left|right)(?=-|$)/, '')
    .replace(/-(top|right|bottom|left)(?=-|$)/, '')
    .replace(/-(block|inline)(-(start|end))?(?=-|$)/, '');

/** The transition entry that animates `prop`: same name, `all`, or a shorthand of it (border-color for border-top-color). */
export function entryFor(prop: string, entries: TransitionEntry[]): TransitionEntry | undefined {
  const general = shorthandOf(prop);
  // The last entry naming a property wins, as in CSS.
  for (let i = entries.length - 1; i >= 0; i--) {
    const p = entries[i]!.property;
    if (p === 'all' || p === prop || p === general || prop.startsWith(`${p}-`) || general.startsWith(`${p}-`)) return entries[i];
  }
  return undefined;
}

/** CSS properties whose value differs between two computed styles of a part (custom properties substituted). */
export function changedProperties(from: Map<string, string> | undefined, to: Map<string, string> | undefined, tokens: Map<string, MotionToken>): string[] {
  const a = from ?? new Map<string, string>();
  const b = to ?? new Map<string, string>();
  const out: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (k.startsWith('--') || SILENT.test(k)) continue;
    const x = a.get(k);
    const y = b.get(k);
    if ((x === undefined ? undefined : substituteVars(x, a, tokens)) !== (y === undefined ? undefined : substituteVars(y, b, tokens))) out.push(k);
  }
  return out.sort();
}

const fmtMs = (ms: number) => `${Math.round(ms)} ms`;

/**
 * The transition Figma plays when a component goes from one variant to another: for every part, the CSS properties that
 * change, animated by the destination state's `transition` (as in CSS). One duration and easing per reaction in
 * Figma: the longest animated change, recorded as approximated when parts animate at other speeds or with a delay.
 * Null when nothing that changes is animated in code (an instant change).
 */
export function transitionBetween(
  from: Map<string, Map<string, string>>,
  to: Map<string, Map<string, string>>,
  tokens: Map<string, MotionToken>,
): SpecTransition | null {
  const animated: { prop: string; ms: number; durationToken?: string; easing: SpecEasing; easingToken?: string; approximated?: string; delay: number }[] = [];
  for (const id of new Set([...from.keys(), ...to.keys()])) {
    const changed = changedProperties(from.get(id), to.get(id), tokens);
    if (!changed.length) continue;
    const entries = parseTransitions(to.get(id) ?? new Map(), tokens);
    for (const prop of changed) {
      const e = entryFor(prop, entries);
      if (!e) continue;
      const d = resolveDuration(e.duration, tokens);
      const ease = resolveEasing(e.easing, tokens);
      if (!d || d.ms <= 0 || !ease) continue;
      const delay = resolveDuration(e.delay, tokens)?.ms ?? 0;
      animated.push({ prop, ms: d.ms, ...(d.token ? { durationToken: d.token } : {}), easing: ease.easing, ...(ease.token ? { easingToken: ease.token } : {}), ...(ease.approximated ? { approximated: ease.approximated } : {}), delay });
    }
  }
  if (!animated.length) return null;
  const main = animated.reduce((m, x) => (x.ms > m.ms ? x : m), animated[0]!);
  const notes: string[] = [];
  const speeds = new Set(animated.map((x) => `${x.ms}|${JSON.stringify(x.easing)}`));
  if (speeds.size > 1) {
    const others = [...new Set(animated.filter((x) => x.ms !== main.ms).map((x) => fmtMs(x.ms)))];
    notes.push(others.length ? `parts move at ${[fmtMs(main.ms), ...others].join(' and ')} in code, Figma plays one speed: ${fmtMs(main.ms)}` : 'parts use different easings in code, Figma plays one');
  }
  if (animated.some((x) => x.delay > 0)) notes.push('a transition delay in code is not played');
  for (const x of animated) if (x.approximated && !notes.includes(x.approximated)) notes.push(x.approximated);
  return {
    duration: main.ms,
    ...(main.durationToken ? { durationToken: main.durationToken } : {}),
    easing: main.easing,
    ...(main.easingToken ? { easingToken: main.easingToken } : {}),
    properties: [...new Set(animated.map((x) => shorthandOf(x.prop)))].sort(),
    ...(notes.length ? { approximated: notes.join('; ') } : {}),
  };
}

/** Class names ("<module>|<class>") of the last compound of a selector: the element a rule styles. */
function targetClasses(rule: CssRule): string[] {
  const last = rule.selector.parts[rule.selector.parts.length - 1];
  return (last?.compound ?? []).filter((s): s is { t: 'class'; name: string } => s.t === 'class').map((s) => `${rule.module}|${s.name}`);
}

const OPEN_ATTR = /\[data-(starting-style|ending-style|open|closed|popup-open|panel-open|expanded)\]/;

/**
 * Motion a Figma prototype cannot play, for the parts a set draws (`classes`: their "<module>|<class>" names):
 * keyframe animations (a spinner, a shimmer), the keyboard focus ring, and opening or closing (a popup's enter motion,
 * an accordion panel). `view` is the set's view: a popup drawn open, or a trigger without its popup.
 */
export function motionNotes(
  rules: CssRule[],
  classes: Set<string>,
  tokens: Map<string, MotionToken>,
  view?: 'popup' | 'without-popup',
  elements: string[][] = [...classes].map((c) => [c]),
): SpecMotionNote[] {
  const out: SpecMotionNote[] = [];
  const add = (n: SpecMotionNote) => {
    if (!out.some((x) => x.what === n.what)) out.push(n);
  };
  const styled = (r: CssRule) => targetClasses(r).some((c) => classes.has(c));
  const opened = new Set<string>();
  for (const r of rules) {
    if (!styled(r)) continue;
    const values = new Map(r.decls.map((d) => [d.prop, d.value]));
    const anim = values.get('animation') ?? values.get('animation-name');
    if (anim && !/^none\b/.test(anim.trim())) {
      const words = splitTop(anim.trim(), /\s/).filter(Boolean);
      const name = values.get('animation-name') ?? words.find((w) => !isTime(w, tokens) && !resolveEasing(w, tokens) && !/^(infinite|\d+|alternate|reverse|normal|forwards|backwards|both|running|paused)$/.test(w));
      const dur = words.map((w) => resolveDuration(w, tokens)).find(Boolean) ?? (values.get('animation-duration') ? resolveDuration(values.get('animation-duration')!, tokens) : undefined);
      const loops = /\binfinite\b/.test(anim) || values.get('animation-iteration-count') === 'infinite';
      add({
        what: `${loops ? 'Looping animation' : 'Keyframe animation'} ${name ?? ''}${dur ? `, ${fmtMs(dur.ms)}` : ''}`.replace(/\s+,/, ',').trim(),
        reason: loops ? 'a Figma component cannot loop an animation on its own' : 'keyframes have no Figma equivalent between variants',
        ...(dur?.token ? { durationToken: dur.token } : {}),
      });
    }
    if (/:focus(-visible|-within)?\b/.test(r.text)) add({ what: 'Keyboard focus', reason: 'the focus ring shows when a keyboard moves to the component; Figma prototypes have no focus state' });
    if (OPEN_ATTR.test(r.text)) {
      for (const c of targetClasses(r)) if (classes.has(c)) opened.add(c);
      add({
        what: view === 'popup' ? 'Opening and closing the popup' : 'Opening and closing',
        reason: view === 'popup' ? 'the popup is its own set; a Figma component cannot open another one from its trigger' : 'the open state is not drawn as a variant',
      });
    }
  }
  const note = out.find((n) => n.what.startsWith('Opening and closing'));
  if (note) {
    const { enter, exit } = openingTransitions(rules, elements.filter((el) => el.some((c) => opened.has(c))), tokens);
    if (enter) note.enter = enter;
    if (exit) note.exit = exit;
  }
  return out;
}

const ENDING_ATTR = /\[data-(ending-style|closed)\]/;
const STATE_PSEUDO = /:(hover|active|focus|focus-visible|focus-within|disabled|checked)\b/;

/**
 * The code's transitions when a part opens and when it closes, for the elements with open-state rules (`elements`, each
 * the "<module>|<class>" names one element carries): the
 * destination state's `transition` animates, as in CSS. Opening ends in the base rules plus the open rules
 * ([data-open], [data-panel-open]...); closing ends in the base rules plus [data-ending-style] / [data-closed]. The
 * properties are the ones those rules change. One transition per direction: the longest, as for interactions.
 */
export function openingTransitions(rules: CssRule[], elements: string[][], tokens: Map<string, MotionToken>): { enter: SpecTransition | null; exit: SpecTransition | null } {
  type Found = { ms: number; durationToken?: string; easing: SpecEasing; easingToken?: string; props: Set<string> };
  const best: { enter?: Found; exit?: Found } = {};
  for (const el of elements) {
    const mine = rules.filter((r) => targetClasses(r).some((c) => el.includes(c))).sort((a, b) => a.order - b.order);
    // Base: the element at rest, without any state (open, swiping, hover...).
    const base = mine.filter((r) => !/\[data-/.test(r.text) && !STATE_PSEUDO.test(r.text));
    const states = mine.filter((r) => OPEN_ATTR.test(r.text));
    const opens = states.filter((r) => !/\[data-(starting-style|ending-style|closed)\]/.test(r.text));
    const endings = states.filter((r) => ENDING_ATTR.test(r.text));
    const changed = new Set(states.flatMap((r) => r.decls.map((d) => d.prop)).filter((p) => !p.startsWith('--') && !SILENT.test(p)));
    if (!changed.size) continue;
    const settle = (list: CssRule[]) => {
      const computed = new Map<string, string>();
      for (const r of [...list].sort((a, b) => a.order - b.order)) for (const d of r.decls) computed.set(d.prop, d.value);
      return computed;
    };
    const find = (computed: Map<string, string>): Found | undefined => {
      const entries = parseTransitions(computed, tokens);
      let main: Found | undefined;
      const props = new Set<string>();
      for (const prop of changed) {
        const e = entryFor(prop, entries);
        if (!e) continue;
        const d = resolveDuration(e.duration, tokens);
        const ease = resolveEasing(e.easing, tokens);
        if (!d || d.ms <= 0 || !ease) continue;
        props.add(shorthandOf(prop));
        if (!main || d.ms > main.ms) main = { ms: d.ms, ...(d.token ? { durationToken: d.token } : {}), easing: ease.easing, ...(ease.token ? { easingToken: ease.token } : {}), props };
      }
      return main;
    };
    for (const [dir, found] of [['enter', find(settle([...base, ...opens]))], ['exit', find(settle([...base, ...endings]))]] as const) {
      if (!found) continue;
      const cur = best[dir];
      if (!cur || found.ms > cur.ms) best[dir] = { ...found, props: new Set([...(cur?.props ?? []), ...found.props]) };
      else for (const p of found.props) cur.props.add(p);
    }
  }
  const out = (f: Found | undefined): SpecTransition | null =>
    f ? { duration: f.ms, ...(f.durationToken ? { durationToken: f.durationToken } : {}), easing: f.easing, ...(f.easingToken ? { easingToken: f.easingToken } : {}), properties: [...f.props].sort() } : null;
  return { enter: out(best.enter), exit: out(best.exit) };
}
