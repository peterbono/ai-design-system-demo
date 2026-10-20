// Motion changes of a branch, for its review: which motion tokens move to another value (motion.duration.moderate
// from 200 ms to 150 ms), which components switch to other motion in their CSS, and which components each touches.
// Built on componentMotion / componentsUsingMotionToken from @bridge-ds/core and the component specs at both commits.
// Pure: no fetch, no DOM. Unit tested in motion-changes.test.ts; the review block is components/ds/studio/MotionChanges.
import { componentsUsingMotionToken, contextFor, resolve, type ComponentSpec, type ComponentSpecsFile, type SpecTransition, type TokenSet } from '@bridge-ds/core';
import { easingValue, motionMoments } from './motion-docs';

/** One side of a change: a duration in ms or an easing curve, in words, with the token behind it when there is one. */
export interface MotionSide {
  token?: string | undefined;
  /** Duration in ms (duration changes). */
  ms?: number | undefined;
  /** Cubic bezier x1, y1, x2, y2 (easing changes). */
  bezier?: [number, number, number, number] | undefined;
  /** "200 ms", or the easing in words. */
  label: string;
}

export interface MotionChange {
  /** "token": a motion token has another value. "transition": a component's CSS uses other motion. */
  source: 'token' | 'transition';
  kind: 'duration' | 'easing';
  /** The token that changed, or for a transition change the token the component uses now (when it uses one). */
  token: string | null;
  /** For a transition change: the moment that changed ("Open", "Hover"). */
  when?: string | undefined;
  before: MotionSide | null;
  after: MotionSide | null;
  /** Component sets that move differently ("Dialog/Popup"), the representative first. */
  components: string[];
}

type Specs = Pick<ComponentSpecsFile, 'components'>;

const BEZIER = (v: unknown): [number, number, number, number] | undefined =>
  Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number') ? (v as [number, number, number, number]) : undefined;

/** A resolved duration value in ms: { value, unit } or "200ms" / "0.2s". */
export function durationMs(v: unknown): number | undefined {
  if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number') {
    const d = v as { value: number; unit?: string };
    return d.value * (d.unit === 's' ? 1000 : 1);
  }
  const m = typeof v === 'string' ? /^(-?[\d.]+)(m?s)$/i.exec(v.trim()) : null;
  return m ? Number(m[1]) * (m[2]!.toLowerCase() === 's' ? 1000 : 1) : undefined;
}

const fmtMs = (ms: number) => `${Math.round(ms)} ms`;

function sideOf(set: TokenSet, path: string): { side: MotionSide; chain: string[]; kind: 'duration' | 'easing' } | null {
  const t = set.byPath.get(path);
  if (!t || (t.type !== 'duration' && t.type !== 'cubicBezier')) return null;
  const mode = Object.keys(t.values)[0];
  if (mode === undefined) return null;
  const r = resolve(set.byPath, path, contextFor(set, t.tier, mode));
  if (r.value === undefined) return null;
  if (t.type === 'duration') {
    const ms = durationMs(r.value);
    return ms === undefined ? null : { side: { token: path, ms, label: fmtMs(ms) }, chain: r.chain, kind: 'duration' };
  }
  const bezier = BEZIER(r.value);
  if (!bezier) return null;
  return { side: { token: path, bezier, label: easingValue({ easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier }, easingToken: path }).value }, chain: r.chain, kind: 'easing' };
}

/** Popups first (the most visible motion), the plainest name first among them (Dialog before AlertDialog). */
const popupFirst = (names: string[]) =>
  [...names].sort((a, b) => Number(b.endsWith('/Popup')) - Number(a.endsWith('/Popup')) || a.length - b.length || a.localeCompare(b));

const sideOfTransition = (t: SpecTransition, kind: 'duration' | 'easing'): MotionSide =>
  kind === 'duration'
    ? { token: t.durationToken, ms: t.duration, label: fmtMs(t.duration) }
    : { token: t.easingToken, ...(t.easing.type === 'CUSTOM_CUBIC_BEZIER' && t.easing.bezier ? { bezier: t.easing.bezier } : { bezier: [0, 0, 1, 1] as [number, number, number, number] }), label: easingValue(t).value };

/**
 * The motion changes between main (`base`) and a branch (`head`): every duration or easing token whose resolved value
 * differs (a primitive that changes is reported through the motion tokens that alias it), with the component sets that
 * use it; and, from the specs at both commits, the components whose CSS now uses another motion token or value for
 * the same moment. Empty when the branch changes no motion.
 */
export function motionChanges(input: { base: TokenSet; head: TokenSet; baseSpecs?: Specs | null | undefined; headSpecs?: Specs | null | undefined }): MotionChange[] {
  const { base, head } = input;
  const specs = input.headSpecs ?? input.baseSpecs ?? { components: [] };
  const changed: { path: string; kind: 'duration' | 'easing'; before: MotionSide | null; after: MotionSide | null; chain: string[] }[] = [];
  for (const path of [...new Set([...base.byPath.keys(), ...head.byPath.keys()])].sort()) {
    const a = sideOf(base, path);
    const b = sideOf(head, path);
    if (!a && !b) continue;
    if (a && b && a.side.label === b.side.label && JSON.stringify(a.side.bezier) === JSON.stringify(b.side.bezier) && a.side.ms === b.side.ms) continue;
    changed.push({ path, kind: (b ?? a)!.kind, before: a?.side ?? null, after: b?.side ?? null, chain: [...new Set([...(a?.chain ?? []), ...(b?.chain ?? [])])] });
  }
  // A primitive (duration.200) is shown through the motion tokens that alias it (motion.duration.moderate).
  const shown = changed.filter((c) => !changed.some((o) => o !== c && o.chain.includes(c.path)));
  const chainOf = (p: string) => {
    const t = head.byPath.get(p) ?? base.byPath.get(p);
    const set = head.byPath.has(p) ? head : base;
    const mode = t ? Object.keys(t.values)[0] : undefined;
    return t && mode !== undefined ? resolve(set.byPath, p, contextFor(set, t.tier, mode)).chain : [p];
  };
  const out: MotionChange[] = shown.map((c) => ({
    source: 'token',
    kind: c.kind,
    token: c.path,
    before: c.before,
    after: c.after,
    components: popupFirst([
      ...new Set([...componentsUsingMotionToken(specs, c.path, chainOf), ...(input.baseSpecs && input.headSpecs ? componentsUsingMotionToken(input.baseSpecs, c.path, chainOf) : [])]),
    ]),
  }));

  // Components whose CSS moved to other motion: the same moment, another token (or another literal value).
  if (input.baseSpecs && input.headSpecs) {
    const before = new Map(input.baseSpecs.components.map((s) => [s.name, s]));
    const groups = new Map<string, MotionChange>();
    for (const h of input.headSpecs.components) {
      const b = before.get(h.name);
      if (!b) continue;
      const old = new Map(motionMoments(b).map((m) => [m.when, m.t]));
      for (const m of motionMoments(h)) {
        const was = old.get(m.when);
        if (!was) continue;
        for (const kind of ['duration', 'easing'] as const) {
          const tokenBefore = kind === 'duration' ? was.durationToken : was.easingToken;
          const tokenAfter = kind === 'duration' ? m.t.durationToken : m.t.easingToken;
          // Same token on both sides: a token value change, reported above.
          if (tokenBefore && tokenBefore === tokenAfter) continue;
          const x = sideOfTransition(was, kind);
          const y = sideOfTransition(m.t, kind);
          if (x.label === y.label && x.token === y.token) continue;
          const key = `${kind}|${m.when}|${x.token}|${x.label}|${y.token}|${y.label}`;
          const g = groups.get(key);
          if (g) g.components.push(h.name);
          else groups.set(key, { source: 'transition', kind, token: y.token ?? null, when: m.when, before: x, after: y, components: [h.name] });
        }
      }
    }
    for (const g of groups.values()) out.push({ ...g, components: popupFirst([...new Set(g.components)]) });
  }
  return out;
}

/** The component name of a set: "Dialog/Popup" -> "Dialog" (its `component`, else the part before the slash). */
export const componentOf = (setName: string, specs?: Specs | null) => specs?.components.find((s) => s.name === setName)?.component ?? setName.split('/')[0]!;

/** The moment of the representative set the change shows: the one using the token, opening first. */
export function representativeMoment(change: MotionChange, specs: Specs | null | undefined, chainOf?: (path: string) => string[]) {
  const name = change.components[0];
  const spec = name ? specs?.components.find((s) => s.name === name) : undefined;
  if (!spec) return null;
  const moments = motionMoments(spec);
  if (change.when) return moments.find((m) => m.when === change.when) ?? null;
  const uses = (t: SpecTransition) => {
    const tok = change.kind === 'duration' ? t.durationToken : t.easingToken;
    return !!tok && (tok === change.token || (!!change.token && (chainOf?.(tok) ?? []).includes(change.token)));
  };
  const order = ['Open', 'Close', 'Check', 'Uncheck', 'Hover', 'Press'];
  const rank = (when: string) => (order.includes(when) ? order.indexOf(when) : order.length);
  return moments.filter((m) => uses(m.t)).sort((a, b) => rank(a.when) - rank(b.when))[0] ?? null;
}

/** Per moment: the sentence subject with its verb ("Popups open", "Hover feedback is") and the caption verb. */
const SUBJECT: Record<string, (popup: boolean) => { subject: string; isVerb: boolean; caption: string }> = {
  Open: (p) => ({ subject: p ? 'Popups open' : 'Panels open', isVerb: false, caption: 'opens' }),
  Close: (p) => ({ subject: p ? 'Popups close' : 'Panels close', isVerb: false, caption: 'closes' }),
  Hover: () => ({ subject: 'Hover feedback', isVerb: true, caption: 'reacts to hover' }),
  Press: () => ({ subject: 'Press feedback', isVerb: true, caption: 'reacts to a press' }),
  Check: () => ({ subject: 'Checking', isVerb: true, caption: 'checks' }),
  Uncheck: () => ({ subject: 'Unchecking', isVerb: true, caption: 'unchecks' }),
};

export interface MotionHeadline {
  /** "Popups open faster". */
  lead: string;
  /** The token in mono, when there is one. */
  token: string | null;
  before: string;
  after: string;
}

/**
 * The plain sentence of a change: "Popups open faster: motion.duration.moderate goes from 200 ms to 150 ms". The
 * subject comes from the representative set's moment; faster or slower from the durations; a new curve for easings.
 */
export function motionHeadline(change: MotionChange, specs: Specs | null | undefined, chainOf?: (path: string) => string[]): MotionHeadline {
  const moment = representativeMoment(change, specs, chainOf);
  const popup = !!change.components[0]?.endsWith('/Popup');
  const s = (moment && SUBJECT[moment.when]?.(popup)) || { subject: 'Motion', isVerb: true, caption: 'moves' };
  const a = change.before?.ms;
  const b = change.after?.ms;
  const lead =
    change.kind === 'easing'
      ? `${s.subject}${s.isVerb ? ' moves' : ''} on a new curve`
      : a !== undefined && b !== undefined && a !== b
        ? `${s.subject}${s.isVerb ? ' is' : ''} ${b < a ? 'faster' : 'slower'}`
        : `${s.subject}${s.isVerb ? ' changes' : ' differently'}`;
  return { lead, token: change.token, before: change.before?.label ?? 'nothing', after: change.after?.label ?? 'removed' };
}

/** What a preview plays on each side: the moment's duration and easing, before and after the change. */
export interface PreviewSide {
  ms: number;
  bezier: [number, number, number, number];
}

export interface MotionPreview {
  /** The component the previews play ("Dialog"). */
  component: string;
  /** "popup": scales and fades in; "panel": grows; "control": changes color; "toggle": a thumb slides. */
  shape: 'popup' | 'panel' | 'control' | 'toggle';
  /** "opens", "reacts to hover". */
  verb: string;
  before: PreviewSide;
  after: PreviewSide;
}

/** The previews of a change: the representative component playing the moment at the old and the new motion. */
export function motionPreview(change: MotionChange, specs: Specs | null | undefined, chainOf?: (path: string) => string[]): MotionPreview | null {
  const moment = representativeMoment(change, specs, chainOf);
  const name = change.components[0];
  if (!moment || !name) return null;
  const base = moment.t;
  const curve = (t: SpecTransition): [number, number, number, number] => (t.easing.type === 'CUSTOM_CUBIC_BEZIER' && t.easing.bezier ? t.easing.bezier : [0, 0, 1, 1]);
  const side = (s: MotionSide | null): PreviewSide => ({
    ms: change.kind === 'duration' ? (s?.ms ?? 0) : base.duration,
    bezier: change.kind === 'easing' ? (s?.bezier ?? curve(base)) : curve(base),
  });
  const popup = name.endsWith('/Popup');
  const shape: MotionPreview['shape'] =
    moment.when === 'Open' || moment.when === 'Close' ? (popup ? 'popup' : 'panel') : moment.when === 'Check' || moment.when === 'Uncheck' ? 'toggle' : 'control';
  const verb = SUBJECT[moment.when]?.(popup).caption ?? 'moves';
  return { component: componentOf(name, specs), shape, verb, before: side(change.before), after: side(change.after) };
}

/** "Also changes: A, B, C" and the full list: the other components, by component name, the representative left out. */
export function alsoChanges(change: MotionChange, specs: Specs | null | undefined, shown = 3): { first: string[]; all: string[] } {
  const names = [...new Set(change.components.map((n) => componentOf(n, specs)))];
  const rest = names.slice(1);
  return { first: rest.slice(0, shown), all: names };
}

export type { ComponentSpec };
