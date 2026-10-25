import { describe, expect, it } from 'vitest';
import { componentSlug, parseRun, runLine, runPill, runRoute } from './claude-runs-view';

describe("Claude's fixes, view", () => {
  it('reads only what it shows, and only a Studio review path', () => {
    const r = parseRun({ id: 'a'.repeat(16), component: 'TextInput', status: 'ready', label: "Claude's fix is ready", sentence: 'x', startedBy: 'Dana', review: 'changes/?pr=91', developer: 'secret cause' });
    expect(r).toMatchObject({ review: 'changes/?pr=91' });
    expect(r).not.toHaveProperty('developer');
    expect(parseRun({ id: 'a'.repeat(16), component: 'X', status: 'ready', review: 'https://evil.example' })!.review).toBeNull();
    expect(parseRun({ id: 'nope', component: 'X', status: 'ready' })).toBeNull();
    expect(parseRun({ id: 'a'.repeat(16), component: 'X', status: 'shipped' })).toBeNull();
  });

  it('one tag per status, a ready fix to its review, the others to the component', () => {
    expect(runPill({ status: 'running', label: 'Claude is on it' })).toEqual({ label: 'Claude is on it', tone: 'info' });
    expect(runPill({ status: 'ready', label: "Claude's fix is ready" }).tone).toBe('success');
    expect(runPill({ status: 'no-fix', label: 'No fix found' }).tone).toBe('neutral');
    expect(runPill({ status: 'failed', label: 'Not finished' }).tone).toBe('warning');
    expect(runRoute({ review: 'changes/?pr=91', component: 'TextInput' })).toBe('changes/?pr=91');
    expect(runRoute({ review: null, component: 'TextInput' })).toBe('components/?c=text-input');
    expect(componentSlug('IconButton')).toBe('icon-button');
    expect(runLine({ sentence: 'Claude is on TextInput: round 1 of 3.', startedBy: 'Dana' })).toBe('Claude is on TextInput: round 1 of 3. Asked by Dana.');
  });
});
