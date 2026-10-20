import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig, parseComponentSpecs, type ComponentSpec } from '@bridge-ds/core';
import { tokenFiles } from './explorer';
import { alsoChanges, durationMs, motionChanges, motionHeadline, motionPreview } from './motion-changes';
import { exists, readText } from './repo';

const options = layoutOptions(loadConfig(exists('bridge.config.json') ? readText('bridge.config.json') : '{}'));
const files = tokenFiles();
const main = buildTokenSet(files, options);
const specs = parseComponentSpecs(readFileSync(join(__dirname, '../../../../packages/react/component-specs.json'), 'utf8'));

/** The token files with one JSON edit applied to semantic/base or primitives/motion. */
function edit(file: string, change: (json: Record<string, any>) => void) {
  const key = Object.keys(files).find((k) => k.endsWith(file))!;
  const json = JSON.parse(files[key]!);
  change(json);
  return buildTokenSet({ ...files, [key]: JSON.stringify(json) }, options);
}

describe('motion changes of a branch', () => {
  it('nothing when the branch changes no motion', () => {
    expect(motionChanges({ base: main, head: main, baseSpecs: specs, headSpecs: specs })).toEqual([]);
    const color = edit('primitives/space.tokens.json', () => {});
    expect(motionChanges({ base: main, head: color, baseSpecs: specs, headSpecs: specs })).toEqual([]);
  });

  it('a duration token moves: before, after, and every component that uses it, a popup first', () => {
    const head = edit('semantic/base.tokens.json', (j) => (j.motion.duration.moderate.$value = '{duration.150}'));
    const [c, ...rest] = motionChanges({ base: main, head, baseSpecs: specs, headSpecs: specs });
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ source: 'token', kind: 'duration', token: 'motion.duration.moderate', before: { ms: 200, label: '200 ms' }, after: { ms: 150, label: '150 ms' } });
    expect(c!.components[0]).toMatch(/\/Popup$/);
    expect(c!.components).toEqual(expect.arrayContaining(['Accordion', 'AlertDialog/Popup', 'Dialog/Popup']));
    expect(motionHeadline(c!, specs)).toEqual({ lead: 'Popups open faster', token: 'motion.duration.moderate', before: '200 ms', after: '150 ms' });
    const preview = motionPreview(c!, specs)!;
    expect(preview).toMatchObject({ component: 'Dialog', shape: 'popup', verb: 'opens', before: { ms: 200, bezier: [0.16, 1, 0.3, 1] }, after: { ms: 150, bezier: [0.16, 1, 0.3, 1] } });
    const also = alsoChanges(c!, specs);
    expect(also.all[0]).toBe('Dialog');
    expect(also.first).not.toContain('Dialog');
    expect(also.first.length).toBeLessThanOrEqual(3);
  });

  it('a primitive that changes is reported through the motion tokens that alias it', () => {
    const head = edit('primitives/motion.tokens.json', (j) => (j.duration['75'].$value = { value: 100, unit: 'ms' }));
    const changes = motionChanges({ base: main, head, baseSpecs: specs, headSpecs: specs });
    expect(changes.map((c) => c.token)).toEqual(['motion.duration.instant']);
    expect(changes[0]!.components).toEqual(expect.arrayContaining(['Button', 'Link']));
    expect(motionHeadline(changes[0]!, specs).lead).toBe('Hover feedback is slower');
    expect(motionPreview(changes[0]!, specs)!.shape).toBe('control');
  });

  it('an easing token: a new curve, the preview keeps the duration', () => {
    const head = edit('semantic/base.tokens.json', (j) => (j.motion.easing.enter.$value = '{easing.standard}'));
    const [c] = motionChanges({ base: main, head, baseSpecs: specs, headSpecs: specs });
    expect(c).toMatchObject({ kind: 'easing', token: 'motion.easing.enter', before: { bezier: [0.16, 1, 0.3, 1] }, after: { bezier: [0.2, 0, 0, 1] } });
    expect(motionHeadline(c!, specs).lead).toBe('Popups open on a new curve');
    expect(motionPreview(c!, specs)).toMatchObject({ component: 'Menu', before: { ms: 150, bezier: [0.16, 1, 0.3, 1] }, after: { ms: 150, bezier: [0.2, 0, 0, 1] } });
  });

  it('a component whose CSS switches to another token for the same moment, grouped across components', () => {
    const swap = (s: ComponentSpec): ComponentSpec => ({
      ...s,
      motion: s.motion?.map((n) => (n.enter ? { ...n, enter: { ...n.enter, duration: 300, durationToken: 'motion.duration.slow' } } : n)),
    });
    const head = { components: specs.components.map((s) => (s.name === 'Dialog/Popup' || s.name === 'AlertDialog/Popup' ? swap(s) : s)) };
    const changes = motionChanges({ base: main, head: main, baseSpecs: specs, headSpecs: head });
    expect(changes).toEqual([
      {
        source: 'transition',
        kind: 'duration',
        token: 'motion.duration.slow',
        when: 'Open',
        before: { token: 'motion.duration.moderate', ms: 200, label: '200 ms' },
        after: { token: 'motion.duration.slow', ms: 300, label: '300 ms' },
        components: ['Dialog/Popup', 'AlertDialog/Popup'],
      },
    ]);
    expect(motionHeadline(changes[0]!, head)).toEqual({ lead: 'Popups open slower', token: 'motion.duration.slow', before: '200 ms', after: '300 ms' });
  });

  it('a token value change does not also report every component as a transition change', () => {
    const head = edit('semantic/base.tokens.json', (j) => (j.motion.duration.fast.$value = '{duration.100}'));
    const headSpecs = { components: specs.components.map((s) => ({ ...s, interactions: s.interactions?.map((x) => (x.transition?.durationToken === 'motion.duration.fast' ? { ...x, transition: { ...x.transition, duration: 100 } } : x)) })) };
    expect(motionChanges({ base: main, head, baseSpecs: specs, headSpecs }).map((c) => c.source)).toEqual(['token']);
  });

  it('durations as objects or CSS strings', () => {
    expect(durationMs({ value: 0.2, unit: 's' })).toBe(200);
    expect(durationMs('150ms')).toBe(150);
    expect(durationMs('nope')).toBeUndefined();
  });
});
