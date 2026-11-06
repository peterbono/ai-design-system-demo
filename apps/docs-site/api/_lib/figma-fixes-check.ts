// `bridge fixes check` on the server: the validation of figma-fixes.json from @bridge-ds/core (figma-fixes.ts
// validateFigmaFixes, with SPEC_FIELDS and COLOR_FIELDS of component-spec.ts), for api/ship's "approve-fixes". The /api
// functions load no workspace package at runtime, so the lines the server needs live here;
// src/lib/figma-fixes-check-parity.test.ts runs both on the same fixtures (and on a real fixes file) and fails
// the moment they disagree. docs/FIGMA-FIXES.md has the format.

export const FIGMA_FIXES_FILE = 'figma-fixes.json';
export const FIGMA_FIXES_VERSION = 1;

/** core component-spec.ts SPEC_FIELDS. */
export const SPEC_FIELDS: readonly string[] = [
  'fill', 'stroke', 'strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'cornerRadius',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing', 'width', 'height', 'minWidth', 'minHeight',
  'opacity', 'shadow', 'textFill', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textDecoration',
];
/** core component-spec.ts COLOR_FIELDS. */
export const COLOR_FIELDS: ReadonlySet<string> = new Set(['fill', 'stroke', 'textFill']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const STATES: readonly string[] = ['rest', 'hover', 'active', 'focus-visible', 'disabled'];
const KINDS = ['part', 'axis', 'story', 'status'] as const;
const BASE_KEYS = ['id', 'component', 'reason', 'by', 'where', 'kind'];
const KEYS: Record<(typeof KINDS)[number], string[]> = {
  part: ['part', 'set', 'width', 'height', 'direction', 'align', 'overlay', 'hide'],
  axis: ['action', 'arg', 'property', 'values'],
  story: ['use'],
  status: ['status'],
};
const PRIMARY = ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'];
const COUNTER = ['MIN', 'CENTER', 'MAX', 'STRETCH'];
const plain = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function whereProblems(w: unknown, at: (why: string) => void) {
  if (!isObj(w)) return at('where must be an object with args and/or state');
  for (const k of Object.keys(w)) if (k !== 'args' && k !== 'state') at(`where.${k} is not known (args, state)`);
  if (w.args !== undefined && (!isObj(w.args) || !Object.values(w.args).every(plain))) at('where.args maps arg names to a text, number or true/false');
  if (w.state !== undefined && !STATES.includes(w.state as string)) at(`where.state is one of ${STATES.join(', ')}`);
}

/**
 * Every problem in a fixes file, in plain words (empty when it is valid): version, unique ids, a component and a reason
 * on every fix, known kinds and keys, and each kind's fields.
 */
export function validateFigmaFixes(data: unknown): string[] {
  const out: string[] = [];
  if (!isObj(data)) return ['expected an object with version and fixes'];
  if (data.version !== FIGMA_FIXES_VERSION) out.push(`version ${String(data.version)} is not supported (expected ${FIGMA_FIXES_VERSION})`);
  for (const k of Object.keys(data)) if (!['$schema', 'version', 'fixes'].includes(k)) out.push(`${k} is not known (version, fixes)`);
  if (!Array.isArray(data.fixes)) return [...out, 'fixes must be a list'];
  const ids = new Set<string>();
  data.fixes.forEach((f, i) => {
    const label = isObj(f) && typeof f.id === 'string' ? `fix ${f.id}` : `fix ${i + 1}`;
    const at = (why: string) => out.push(`${label}: ${why}`);
    if (!isObj(f)) return at('must be an object');
    if (typeof f.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(f.id)) at('id must be lower case letters, digits and dashes');
    else if (ids.has(f.id)) at('id is repeated');
    else ids.add(f.id);
    if (typeof f.component !== 'string' || !f.component.trim()) at('component is missing (the Figma set name, like "Toggle")');
    if (typeof f.reason !== 'string' || f.reason.trim().length < 8) at('reason is missing: say why, in a sentence');
    else if (/\u2014/.test(f.reason)) at('reason uses an em dash: use a colon or a comma');
    if (f.by !== undefined && typeof f.by !== 'string') at('by must be a text');
    if (f.where !== undefined) whereProblems(f.where, at);
    if (!KINDS.includes(f.kind as (typeof KINDS)[number])) return at(`kind must be one of ${KINDS.join(', ')}`);
    const kind = f.kind as (typeof KINDS)[number];
    for (const k of Object.keys(f)) if (!BASE_KEYS.includes(k) && !KEYS[kind].includes(k)) at(`${k} is not a key of a ${kind} fix`);
    if (kind === 'part') partProblems(f, at);
    if (kind === 'axis') axisProblems(f, at);
    if (kind === 'story') {
      const u = f.use;
      if (!isObj(u) || typeof u.story !== 'string' || !u.story) at('use.story is the story id to draw the variant from');
      else {
        for (const k of Object.keys(u)) if (!['story', 'args', 'state'].includes(k)) at(`use.${k} is not known (story, args, state)`);
        if (u.args !== undefined && (!isObj(u.args) || !Object.values(u.args).every(plain))) at('use.args maps arg names to a text, number or true/false');
        if (u.state !== undefined && !STATES.includes(u.state as string)) at(`use.state is one of ${STATES.join(', ')}`);
      }
      if (!isObj(f.where) || (!f.where.args && !f.where.state)) at('where names the variant (args and/or state) the story is for');
    }
    if (kind === 'status') {
      if (f.status === 'matches') at('status cannot be "matches": only the shot comparison says a component matches');
      else if (f.status !== undefined && f.status !== 'differs' && f.status !== 'cant-check') at('status is differs or cant-check (absent: a note)');
    }
  });
  return out;
}

function partProblems(f: Record<string, unknown>, at: (why: string) => void) {
  if (typeof f.part !== 'string' || !f.part.trim()) at('part is a part id or a .class');
  const changes = ['set', 'width', 'height', 'direction', 'align', 'overlay', 'hide'].filter((k) => f[k] !== undefined);
  if (!changes.length) at('changes nothing: give set, width, height, direction, align, overlay or hide');
  if (f.hide !== undefined && typeof f.hide !== 'boolean') at('hide is true or false');
  if (f.hide === true && changes.length > 1) at('hide goes alone: a hidden part has nothing else to change');
  if (f.set !== undefined) {
    if (!isObj(f.set) || !Object.keys(f.set).length) at('set maps fields to values');
    else
      for (const [field, value] of Object.entries(f.set)) {
        if (!SPEC_FIELDS.includes(field)) {
          at(`set.${field} is not a field (${SPEC_FIELDS.join(', ')})`);
          continue;
        }
        const color = COLOR_FIELDS.has(field);
        if (value === 'full') {
          if (field !== 'cornerRadius') at(`set.${field}: "full" is for cornerRadius only`);
        } else if (value === null) {
          if (!color) at(`set.${field} cannot be none (only colors can)`);
        } else if (typeof value === 'number') {
          if (color) at(`set.${field} is a color: a token path or null, not a number`);
          else if (!Number.isFinite(value)) at(`set.${field} must be a finite number`);
        } else if (typeof value !== 'string' || !value.trim()) at(`set.${field} must be a token path, a number or null`);
        else if (field === 'textDecoration' && !/^(UNDERLINE|STRIKETHROUGH|NONE)$/.test(value)) at(`set.textDecoration is UNDERLINE, STRIKETHROUGH or NONE`);
      }
  }
  for (const side of ['width', 'height'] as const) {
    const v = f[side];
    if (v !== undefined && !['hug', 'fill', 'fixed'].includes(v as string) && !(typeof v === 'number' && v > 0)) at(`${side} is hug, fill, fixed or a size in px`);
  }
  if (f.direction !== undefined && f.direction !== 'HORIZONTAL' && f.direction !== 'VERTICAL') at('direction is HORIZONTAL or VERTICAL');
  if (f.align !== undefined) {
    const a = f.align;
    if (!isObj(a) || (a.primary === undefined && a.counter === undefined)) at('align gives primary and/or counter');
    else {
      if (a.primary !== undefined && !PRIMARY.includes(a.primary as string)) at(`align.primary is ${PRIMARY.join(', ')}`);
      if (a.counter !== undefined && !COUNTER.includes(a.counter as string)) at(`align.counter is ${COUNTER.join(', ')}`);
    }
  }
  if (f.overlay !== undefined && typeof f.overlay !== 'boolean') {
    const o = f.overlay;
    if (!isObj(o) || !Object.keys(o).length || !Object.entries(o).every(([k, v]) => ['top', 'right', 'bottom', 'left'].includes(k) && typeof v === 'number')) at('overlay is true, false, or offsets in px ({ "top": 3, "left": 3 })');
  }
  if (f.part === 'root' && (f.hide === true || f.overlay !== undefined)) at('the root cannot be hidden or overlaid');
}

function axisProblems(f: Record<string, unknown>, at: (why: string) => void) {
  const action = f.action;
  if (action !== 'map' && action !== 'ignore' && action !== 'prune') return at('action is map, ignore or prune');
  if (action !== 'prune' && (typeof f.arg !== 'string' || !f.arg)) at(`${action} needs arg (the story arg, like "kind")`);
  if (action === 'map') {
    if (f.property === undefined && f.values === undefined) at('map gives property (the Figma name) and/or values');
    if (f.property !== undefined && (typeof f.property !== 'string' || !f.property.trim())) at('property is the Figma property name');
    if (f.values !== undefined && (!isObj(f.values) || !Object.values(f.values).every((v) => typeof v === 'string' && v.trim()))) at('values maps code values to Figma values (texts)');
    else if (isObj(f.values)) {
      const figma = Object.values(f.values) as string[];
      if (new Set(figma).size !== figma.length) at('values gives two code values the same Figma value: use prune for the one to drop');
    }
  }
  if (action === 'ignore' && (f.property !== undefined || f.values !== undefined)) at('ignore takes no property or values');
  if (action === 'prune') {
    if (!isObj(f.where) || (!f.where.args && !f.where.state)) at('prune needs where (the args and/or state of the variants to drop)');
    if (f.property !== undefined || f.values !== undefined) at('prune takes no property or values');
  }
}
