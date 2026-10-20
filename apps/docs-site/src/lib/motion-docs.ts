// The "Motion and interaction" section of a component page, generated like the props table: what makes the component
// move (hover, press, check, open), what changes, the motion tokens with their values, the easing, and what reduced
// motion does. Built on componentMotion from @bridge-ds/core (the same reading the Figma prototypes use), from the
// component specs `npm run specs` writes. Pure: no fs, no DOM. Unit tested in motion-docs.test.ts.
import { componentMotion, type ComponentSpec, type SpecCoverage, type SpecTransition } from '@bridge-ds/core';

/** A motion token as the page shows it: the token name (mono) and its value in words ("75 ms"). */
export interface MotionValue {
  token?: string | undefined;
  value: string;
}

export interface MotionRow {
  /** The part that moves, when the component has several ("Popup", "Checkbox item"). */
  part?: string | undefined;
  /** What makes it move, designer words ("Hover", "Open", "Check and uncheck"). */
  when: string;
  /** What changes ("Background and text color"). */
  what: string;
  duration: MotionValue;
  easing: MotionValue | null;
}

export interface MotionDocs {
  /** One sentence: what animates, or that nothing does. */
  summary: string;
  rows: MotionRow[];
  /** What reduced motion does, one sentence; null when nothing animates. */
  reduced: string | null;
  /** Whether to show a Part column (several parts move). */
  showPart: boolean;
  /** Motion tokens the component's CSS uses for motion the rows do not list (a tab indicator sliding). */
  unlisted: string[];
}

const PROPERTY_WORDS: Record<string, string> = {
  'background-color': 'background',
  'border-color': 'border',
  color: 'text color',
  'text-decoration-color': 'underline',
  'box-shadow': 'shadow',
  opacity: 'fade',
  transform: 'movement',
  height: 'height',
  width: 'width',
};

/** CSS properties in designer words, joined: ["background-color", "color"] -> "Background and text color". */
export function propertyWords(props: string[]): string {
  const words = [...new Set(props.map((p) => PROPERTY_WORDS[p] ?? p.replace(/-/g, ' ')))];
  if (!words.length) return '';
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0]!;
  return list.charAt(0).toUpperCase() + list.slice(1);
}

const EASING_WORDS: Record<string, string> = {
  standard: 'settles in place',
  enter: 'starts fast, lands softly',
  exit: 'starts softly, leaves fast',
  linear: 'constant speed',
};

/** A duration in ms, with its token. */
export const durationValue = (t: Pick<SpecTransition, 'duration' | 'durationToken'>): MotionValue => ({ token: t.durationToken, value: `${Math.round(t.duration)} ms` });

/** An easing in words, with its token: motion.easing.enter -> "starts fast, lands softly". */
export function easingValue(t: Pick<SpecTransition, 'easing' | 'easingToken'>): MotionValue {
  const role = t.easingToken?.split('.').pop();
  if (role && EASING_WORDS[role]) return { token: t.easingToken, value: EASING_WORDS[role]! };
  if (t.easing.type === 'LINEAR') return { token: t.easingToken, value: 'constant speed' };
  return { token: t.easingToken, value: `cubic-bezier(${(t.easing.bezier ?? []).join(', ')})` };
}

/** The part a set draws, in words: "Combobox/Popup" -> "Popup", "MenuCheckboxItem" -> "Checkbox item". */
export function partLabel(spec: Pick<ComponentSpec, 'name' | 'component' | 'view'>, component: string): string {
  if (spec.name === component) return spec.view === 'without-popup' ? 'Trigger' : component;
  const rest = spec.name.startsWith(`${component}/`) ? spec.name.slice(component.length + 1) : spec.name.startsWith(component) ? spec.name.slice(component.length) : spec.name;
  const words = rest.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const sameSpeed = (a: SpecTransition, b: SpecTransition) =>
  a.duration === b.duration && a.durationToken === b.durationToken && a.easingToken === b.easingToken && JSON.stringify(a.easing) === JSON.stringify(b.easing);

/** A moment a set moves: what makes it move ("Hover", "Open"), the transition, the properties it animates. */
export interface MotionMoment {
  when: string;
  t: SpecTransition;
  props: string[];
}

/**
 * The moments a set moves, from its interactions and its opening and closing: one per trigger and speed (Hover,
 * Press, Check, Uncheck, Open, Close). Instant changes are left out.
 */
export function motionMoments(spec: Pick<ComponentSpec, 'name' | 'variants' | 'interactions' | 'motion'>): MotionMoment[] {
  const m = componentMotion(spec);
  const groups: MotionMoment[] = [];
  const push = (when: string, t: SpecTransition) => {
    const g = groups.find((x) => x.when === when && sameSpeed(x.t, t));
    if (g) g.props.push(...t.properties);
    else groups.push({ when, t, props: [...t.properties] });
  };
  for (const x of m.triggers) {
    if (!x.transition) continue;
    if (x.trigger === 'ON_HOVER' || x.trigger === 'MOUSE_ENTER' || x.trigger === 'MOUSE_LEAVE') push('Hover', x.transition);
    else if (x.trigger === 'ON_PRESS') push('Press', x.transition);
    else if (x.axis === 'Checked') push(x.to === 'false' ? 'Uncheck' : 'Check', x.transition);
    else push(`${x.axis}: ${x.from} to ${x.to}`, x.transition);
  }
  if (m.opening?.enter) push('Open', m.opening.enter);
  if (m.opening?.exit) push('Close', m.opening.exit);
  return groups;
}

/** Rows of one set: interactions, opening and closing, loops. Same trigger and speed merge into one row. */
function setRows(spec: ComponentSpec, part: string | undefined): MotionRow[] {
  const m = componentMotion(spec);
  const groups = motionMoments(spec);
  // Check and uncheck (open and close) at the same speed and on the same properties read as one row.
  for (const [a, b, both] of [['Check', 'Uncheck', 'Check and uncheck'], ['Open', 'Close', 'Open and close']] as const) {
    const x = groups.find((g) => g.when === a);
    const y = groups.find((g) => g.when === b);
    if (x && y && sameSpeed(x.t, y.t) && propertyWords(x.props) === propertyWords(y.props)) {
      x.when = both;
      groups.splice(groups.indexOf(y), 1);
    }
  }
  const rows: MotionRow[] = groups.map((g) => ({ ...(part ? { part } : {}), when: g.when, what: propertyWords(g.props), duration: durationValue(g.t), easing: easingValue(g.t) }));
  for (const n of m.cannotPlay) {
    const loop = /^Looping animation (\S+), (\d+) ms/.exec(n.what);
    if (!loop) continue;
    rows.push({ ...(part ? { part } : {}), when: 'While shown', what: `Loops (${loop[1]})`, duration: { token: n.durationToken, value: `${loop[2]} ms` }, easing: null });
  }
  return rows;
}

const listWords = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

/**
 * The section for one component: its sets (specs whose `component`, or name, is the component), and its Figma coverage
 * entry for the components the generator does not read (drafted, layout helpers).
 */
export function motionDocs(component: string, specs: ComponentSpec[], coverage?: Pick<SpecCoverage, 'status' | 'reason'>, codeTokens: string[] = []): MotionDocs {
  const sets = specs.filter((s) => (s.component ?? s.name) === component && !s.drafted);
  const codeMotion = [...new Set(codeTokens.filter((t) => /^motion\.duration\./.test(t)))].sort();
  const reducedAll = 'With reduced motion turned on, its changes happen at once.';
  const notListed = (why: string): MotionDocs => ({
    summary: `${component} has motion in code that this page cannot list yet${why}: try it in the preview.`,
    rows: [],
    reduced: reducedAll,
    showPart: false,
    unlisted: codeMotion,
  });
  if (!sets.length) {
    if (codeMotion.length) return notListed(coverage?.status === 'drafted' && coverage.reason ? ` (it ${coverage.reason})` : '');
    const drafted = coverage?.status === 'drafted' || specs.some((s) => (s.component ?? s.name) === component && s.drafted);
    return {
      summary: drafted
        ? `Motion for ${component} is not listed yet: Bridge cannot read it from the code on its own${coverage?.reason ? ` (it ${coverage.reason})` : ''}.`
        : coverage?.status === 'layout'
          ? `${component} does not animate: it only lays out other components.`
          : coverage && coverage.status !== 'generated'
            ? `Motion for ${component} is not listed yet${coverage.reason ? `: ${coverage.reason}` : ''}.`
            : `${component} does not animate.`,
      rows: [],
      reduced: null,
      showPart: false,
      unlisted: [],
    };
  }
  const perSet = sets.map((s) => ({ s, rows: setRows(s, undefined) })).filter((x) => x.rows.length);
  const showPart = perSet.length > 1;
  const rows = perSet.flatMap(({ s, rows: r }) => (showPart ? r.map((row) => ({ ...row, part: partLabel(s, component) })) : r));
  if (!rows.length) return codeMotion.length ? notListed('') : { summary: `${component} does not animate: its states change at once.`, rows: [], reduced: null, showPart: false, unlisted: [] };
  const whens = [...new Set(rows.filter((r) => r.when !== 'While shown').flatMap((r) => r.when.toLowerCase().split(' and ')))];
  const loops = rows.filter((r) => r.when === 'While shown');
  const summary = whens.length ? `${component} animates on ${listWords(whens)}${loops.length ? ', and loops while it is shown' : ''}.` : `${component} loops while it is shown.`;
  // tokens.css under prefers-reduced-motion: every motion.duration.* is 0 ms, except the spin, which only slows down.
  const isSpin = (r: MotionRow) => !!r.duration.token?.endsWith('.spin');
  const effects = [
    ...(whens.length ? ['every change happens at once'] : []),
    ...(loops.some((r) => !isSpin(r)) ? ['the loop stops'] : []),
    ...(loops.some(isSpin) ? ['the spinner keeps turning, slower, so it never looks frozen'] : []),
  ];
  const reduced = `With reduced motion turned on, ${listWords(effects)}`;
  const listed = new Set(rows.map((r) => r.duration.token));
  return { summary, rows, reduced: `${reduced}.`, showPart, unlisted: codeMotion.filter((t) => !listed.has(t)) };
}
