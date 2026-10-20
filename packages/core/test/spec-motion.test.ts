// Motion in component specs: CSS transitions to prototype interactions, resolved from the motion tokens; what Figma
// cannot play; and the exported helpers (componentMotion, componentsUsingMotionToken) other surfaces reuse.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ComponentSpec, REDUCED_MOTION_NOTE, componentMotion, componentsUsingMotionToken, parseComponentSpecs, validateComponentSpec } from '../src/component-spec';
import { generateComponentSpec, type SpecGeneratorOptions } from '../src/node/component-specs';
import { parseCssModule } from '../src/node/spec-css';
import {
  type MotionToken,
  changedProperties,
  entryFor,
  motionNotes,
  openingTransitions,
  parseTransitions,
  resolveDuration,
  resolveEasing,
  transitionBetween,
} from '../src/node/spec-motion';

const ROOT = join(__dirname, '../../..');

const MOTION: [string, MotionToken][] = [
  ['--motion-duration-instant', { path: 'motion.duration.instant', type: 'duration', value: { value: 75, unit: 'ms' } }],
  ['--motion-duration-fast', { path: 'motion.duration.fast', type: 'duration', value: { value: 150, unit: 'ms' } }],
  ['--motion-duration-slow', { path: 'motion.duration.slow', type: 'duration', value: '0.3s' }],
  ['--motion-easing-standard', { path: 'motion.easing.standard', type: 'cubicBezier', value: [0.2, 0, 0, 1] }],
  ['--motion-easing-linear', { path: 'motion.easing.linear', type: 'cubicBezier', value: [0, 0, 1, 1] }],
];
const tokens = new Map<string, MotionToken>(MOTION);
const m = (o: Record<string, string>) => new Map(Object.entries(o));

describe('token resolution', () => {
  it('durations: tokens (object or string value) and literals, in ms', () => {
    expect(resolveDuration('var(--motion-duration-instant)', tokens)).toEqual({ ms: 75, token: 'motion.duration.instant' });
    expect(resolveDuration('var(--motion-duration-slow)', tokens)).toEqual({ ms: 300, token: 'motion.duration.slow' });
    expect(resolveDuration('0.2s', tokens)).toEqual({ ms: 200 });
    expect(resolveDuration('120ms', tokens)).toEqual({ ms: 120 });
    expect(resolveDuration('var(--space-2)', tokens)).toBeUndefined();
  });

  it('easings: a cubic bezier token or keyword is played exactly; linear stays linear; steps() is approximated', () => {
    expect(resolveEasing('var(--motion-easing-standard)', tokens)).toEqual({ easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier: [0.2, 0, 0, 1] }, token: 'motion.easing.standard' });
    expect(resolveEasing('var(--motion-easing-linear)', tokens)).toEqual({ easing: { type: 'LINEAR' }, token: 'motion.easing.linear' });
    expect(resolveEasing('ease-out', tokens)).toEqual({ easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier: [0, 0, 0.58, 1] } });
    expect(resolveEasing('cubic-bezier(0.16, 1, 0.3, 1)', tokens)).toEqual({ easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier: [0.16, 1, 0.3, 1] } });
    expect(resolveEasing('steps(4, end)', tokens)).toMatchObject({ easing: { type: 'LINEAR' }, approximated: expect.stringMatching(/steps/) });
  });
});

describe('CSS transitions', () => {
  it('the shorthand and the longhands, local custom properties substituted, shorter lists repeated', () => {
    const short = m({ '--_d': 'var(--motion-duration-fast)', transition: 'width var(--_d) var(--motion-easing-standard), opacity 0.1s linear 50ms' });
    expect(parseTransitions(short, tokens)).toEqual([
      { property: 'width', duration: 'var(--motion-duration-fast)', easing: 'var(--motion-easing-standard)', delay: '0s' },
      { property: 'opacity', duration: '0.1s', easing: 'linear', delay: '50ms' },
    ]);
    const long = m({ 'transition-property': 'background-color, border-color', 'transition-duration': 'var(--motion-duration-instant)', 'transition-timing-function': 'var(--motion-easing-standard)' });
    expect(parseTransitions(long, tokens).map((e) => `${e.property} ${e.duration}`)).toEqual(['background-color var(--motion-duration-instant)', 'border-color var(--motion-duration-instant)']);
  });

  it('a longhand is animated by its shorthand or by all', () => {
    const entries = parseTransitions(m({ 'transition-property': 'border-color, background' }), tokens);
    expect(entryFor('border-top-color', entries)?.property).toBe('border-color');
    expect(entryFor('background-color', entries)?.property).toBe('background');
    expect(entryFor('color', entries)).toBeUndefined();
    expect(entryFor('color', parseTransitions(m({ transition: 'all 1s' }), tokens))?.property).toBe('all');
  });

  it('changed properties compare resolved values and ignore what is never drawn', () => {
    const a = m({ '--_bg': 'var(--a)', 'background-color': 'var(--_bg)', cursor: 'pointer' });
    const b = m({ '--_bg': 'var(--b)', 'background-color': 'var(--_bg)', cursor: 'default' });
    expect(changedProperties(a, b, tokens)).toEqual(['background-color']);
  });

  it('the transition of a change: the destination state animates it; one speed, the longest, approximated when parts differ', () => {
    const from = new Map([
      ['root', m({ 'border-top-color': 'var(--x)', 'transition-property': 'border-color', 'transition-duration': 'var(--motion-duration-instant)', 'transition-timing-function': 'var(--motion-easing-standard)' })],
      ['icon', m({ opacity: '0', transition: 'opacity var(--motion-duration-fast) ease-out' })],
    ]);
    const to = new Map([
      ['root', m({ 'border-top-color': 'var(--y)', 'transition-property': 'border-color', 'transition-duration': 'var(--motion-duration-instant)', 'transition-timing-function': 'var(--motion-easing-standard)' })],
      ['icon', m({ opacity: '1', transition: 'opacity var(--motion-duration-fast) ease-out' })],
    ]);
    expect(transitionBetween(from, to, tokens)).toEqual({
      duration: 150,
      durationToken: 'motion.duration.fast',
      easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier: [0, 0, 0.58, 1] },
      properties: ['border-color', 'opacity'],
      approximated: 'parts move at 150 ms and 75 ms in code, Figma plays one speed: 150 ms',
    });
    // Nothing that changes is animated: an instant change.
    expect(transitionBetween(new Map([['root', m({ color: 'var(--a)' })]]), new Map([['root', m({ color: 'var(--b)' })]]), tokens)).toBeNull();
  });

  it('what Figma cannot play: looping keyframes, keyboard focus, opening; only for the parts the set draws', () => {
    const { rules } = parseCssModule(
      'S.module.css',
      `.spin { animation: spin var(--motion-duration-fast) linear infinite; }
.box:focus-visible { outline: 2px solid; }
.panel[data-starting-style] { opacity: 0; }
.other { animation: pulse 1s infinite; }
@keyframes spin { to { transform: rotate(1turn); } }`,
    );
    const notes = motionNotes(rules, new Set(['S.module.css|spin', 'S.module.css|box', 'S.module.css|panel']), tokens, 'popup');
    expect(notes.map((n) => n.what)).toEqual(['Looping animation spin, 150 ms', 'Keyboard focus', 'Opening and closing the popup']);
  });
});

describe('opening and closing', () => {
  const css = `.popup { opacity: 1; transition-property: opacity, transform; transition-duration: var(--motion-duration-fast); transition-timing-function: var(--motion-easing-standard); }
.popup[data-swiping] { transition-duration: 1ms; }
.side[data-starting-style], .side[data-ending-style] { opacity: 0; transform: scale(0.96); }
.popup[data-ending-style] { transition-duration: var(--motion-duration-instant); transition-timing-function: var(--motion-easing-linear); }
.chevron { transition: transform var(--motion-duration-slow) var(--motion-easing-standard); }
.other { transition: opacity 1s; }`;
  const { rules } = parseCssModule('P.module.css', css);

  it('enter and exit transitions of the element that opens, its classes taken together; other state rules ignored', () => {
    const { enter, exit } = openingTransitions(rules, [['P.module.css|popup', 'P.module.css|side']], tokens);
    expect(enter).toEqual({ duration: 150, durationToken: 'motion.duration.fast', easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier: [0.2, 0, 0, 1] }, easingToken: 'motion.easing.standard', properties: ['opacity', 'transform'] });
    expect(exit).toMatchObject({ duration: 75, durationToken: 'motion.duration.instant', easing: { type: 'LINEAR' }, easingToken: 'motion.easing.linear' });
    // An element without open-state rules does not open.
    expect(openingTransitions(rules, [['P.module.css|chevron']], tokens)).toEqual({ enter: null, exit: null });
  });

  it('the opening note carries them, and componentMotion lists their tokens', () => {
    const notes = motionNotes(rules, new Set(['P.module.css|popup', 'P.module.css|side']), tokens, 'popup', [['P.module.css|popup', 'P.module.css|side']]);
    expect(notes).toEqual([expect.objectContaining({ what: 'Opening and closing the popup', enter: expect.objectContaining({ duration: 150 }), exit: expect.objectContaining({ duration: 75 }) })]);
    const motion = componentMotion({ name: 'P/Popup', variants: [], motion: notes });
    expect(motion.opening?.enter?.durationToken).toBe('motion.duration.fast');
    expect(motion.tokens).toEqual(['motion.duration.fast', 'motion.duration.instant', 'motion.easing.linear', 'motion.easing.standard']);
    expect(motion.reducedMotion).toBe(REDUCED_MOTION_NOTE);
    expect(componentsUsingMotionToken({ components: [{ name: 'P/Popup', variants: [], motion: notes } as unknown as ComponentSpec] }, 'motion.duration.fast')).toEqual(['P/Popup']);
  });
});

describe('generator', () => {
  const files: Record<string, string> = {
    'c/Chip/Chip.tsx': `import styles from './Chip.module.css';
export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> { tone?: 'quiet' | 'loud' }
export const Chip = forwardRef(function Chip({ tone = 'quiet', children, ...rest }, ref) {
  return <button className={cx(styles.chip, styles[tone])} {...rest}>{children}</button>;
});`,
    'c/Chip/Chip.module.css': `.chip { --_bg: var(--color-bg); --_hover: var(--color-bg-hover); display: inline-flex; padding: var(--space-2); background-color: var(--_bg);
  transition-property: background-color; transition-duration: var(--motion-duration-instant); transition-timing-function: var(--motion-easing-standard); }
@media (hover: hover) { .chip:hover:not(:disabled) { background-color: var(--_hover); } }
.chip:active:not(:disabled) { background-color: var(--color-bg-active); }
.chip:disabled { background-color: var(--color-bg-disabled); }
.chip:focus-visible { outline: var(--space-2) solid; }
.loud { --_bg: var(--color-bg-loud); --_hover: var(--color-bg-loud); }`,
  };
  const all = new Map<string, { path: string; type: string; value?: unknown }>([
    ...MOTION,
    ...['space-2', 'color-bg', 'color-bg-hover', 'color-bg-active', 'color-bg-disabled', 'color-bg-loud'].map((n) => [`--${n}`, { path: n.replace('-', '.'), type: n.startsWith('color') ? 'color' : 'dimension' }] as const),
  ]);
  const opts: SpecGeneratorOptions = { componentsDir: 'c', read: (p) => files[p], tokens: all, components: ['Chip'] };

  it('hover and press from the State axis, with the code transition; only where the variants differ', () => {
    const spec = generateComponentSpec('Chip', opts);
    expect(spec.axes.find((a) => a.name === 'State')!.values).toEqual(['Default', 'Hover', 'Pressed', 'Disabled']);
    const t = { duration: 75, durationToken: 'motion.duration.instant', easing: { type: 'CUSTOM_CUBIC_BEZIER', bezier: [0.2, 0, 0, 1] }, easingToken: 'motion.easing.standard', properties: ['background-color'] };
    // The loud chip does not change on hover: no hover interaction for it.
    expect(spec.interactions).toEqual([
      { trigger: 'ON_HOVER', axis: 'State', from: 'Default', to: 'Hover', variants: ['State=Default, Tone=quiet'], transition: t },
      { trigger: 'ON_PRESS', axis: 'State', from: 'Hover', to: 'Pressed', transition: t },
    ]);
    expect(spec.motion).toEqual([{ what: 'Keyboard focus', reason: expect.any(String) }]);
    expect(validateComponentSpec(spec)).toEqual([]);
  });

  it('componentMotion: reactions per variant, tokens, properties, reduced motion; componentsUsingMotionToken follows aliases', () => {
    const spec = generateComponentSpec('Chip', opts);
    const motion = componentMotion(spec);
    expect(motion.reactions.map((r) => `${r.label}: ${r.fromKey} -> ${r.toKey}`)).toEqual([
      'While hovering: State=Default, Tone=quiet -> State=Hover, Tone=quiet',
      'While pressing: State=Hover, Tone=quiet -> State=Pressed, Tone=quiet',
      'While pressing: State=Hover, Tone=loud -> State=Pressed, Tone=loud',
    ]);
    expect(motion.triggers.map((t) => t.count)).toEqual([1, 2]);
    expect(motion.tokens).toEqual(['motion.duration.instant', 'motion.easing.standard']);
    expect(motion.properties).toEqual(['background-color']);
    expect(motion.reducedMotion).toBe(REDUCED_MOTION_NOTE);
    const file = { components: [spec, { ...spec, name: 'Still', interactions: undefined } as ComponentSpec] };
    expect(componentsUsingMotionToken(file, 'motion.duration.instant')).toEqual(['Chip']);
    expect(componentsUsingMotionToken(file, 'duration.75')).toEqual([]);
    expect(componentsUsingMotionToken(file, 'duration.75', (p) => (p === 'motion.duration.instant' ? [p, 'duration.75'] : [p]))).toEqual(['Chip']);
  });

  it('validation: interactions name real axes, values and variants', () => {
    const spec = generateComponentSpec('Chip', opts);
    const bad = { ...spec, interactions: [{ trigger: 'ON_HOVER' as const, axis: 'State', from: 'Default', to: 'Nope', variants: ['X=1'], transition: null }] };
    expect(validateComponentSpec(bad)).toEqual(['Chip: interaction 1: Default to Nope are not two values of State', 'Chip: interaction 1: variant X=1 does not exist']);
  });
});

describe('the repo', () => {
  const specs = parseComponentSpecs(readFileSync(join(ROOT, 'packages/react/component-specs.json'), 'utf8'));
  const byName = new Map(specs.components.map((c) => [c.name, c]));

  it('Dialog opens in motion.duration.moderate with the enter easing and closes faster; popups use their open motion tokens', () => {
    const dialog = componentMotion(byName.get('Dialog/Popup')!);
    expect(dialog.opening?.enter).toMatchObject({ duration: 200, durationToken: 'motion.duration.moderate', easingToken: 'motion.easing.enter', properties: ['opacity', 'transform'] });
    expect(dialog.opening?.exit).toMatchObject({ duration: 150, durationToken: 'motion.duration.fast', easingToken: 'motion.easing.exit' });
    expect(componentsUsingMotionToken(specs, 'motion.duration.moderate')).toEqual(expect.arrayContaining(['AlertDialog/Popup', 'Dialog/Popup']));
    expect(componentMotion(byName.get('Drawer/Popup')!).opening?.enter).toMatchObject({ duration: 300, durationToken: 'motion.duration.slow' });
  });

  it('Button: hover and press at motion.duration.instant with the standard easing; Switch toggles on click', () => {
    const button = componentMotion(byName.get('Button')!);
    expect(button.triggers.map((t) => t.label)).toEqual(expect.arrayContaining(['While hovering', 'While pressing']));
    expect(button.tokens).toEqual(['motion.duration.instant', 'motion.easing.standard']);
    const sw = componentMotion(byName.get('Switch')!);
    expect(sw.triggers.map((t) => `${t.label} ${t.axis} ${t.from}>${t.to}`)).toEqual(['Mouse enter State Default>Hover', 'Mouse leave State Hover>Default', 'On click Checked false>true', 'On click Checked true>false']);
    expect(sw.reactions.find((r) => r.trigger === 'ON_CLICK')!.transition).toMatchObject({ duration: 150, properties: ['background-color', 'transform'] });
    // A radio only checks.
    expect(componentMotion(byName.get('Radio')!).triggers.filter((t) => t.trigger === 'ON_CLICK').map((t) => `${t.from}>${t.to}`)).toEqual(['false>true']);
  });

  it('looping animations are listed as motion Figma cannot play', () => {
    expect(componentMotion(byName.get('Spinner')!).cannotPlay.map((n) => n.what)).toEqual(['Looping animation spin, 700 ms']);
    expect(componentMotion(byName.get('Spinner')!).tokens).toEqual(['motion.duration.spin']);
    expect(componentsUsingMotionToken(specs, 'motion.duration.fast')).toEqual(expect.arrayContaining(['Checkbox', 'Switch']));
  });
});
