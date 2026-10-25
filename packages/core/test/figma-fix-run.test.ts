// The fix loop as steps (figma-fix-run.ts): the state between rounds is plain JSON, so a runner can stop after any
// round and go on later (Bridge's server does one round per request); the outcome and the change for review are the
// same for every runner, and refuse fixes that move the component further from the code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNANCE, figmaFixesProposal, fixLoopOutcome, fixLoopRound, gapCaseFor, parseFidelityRun, parseMeasuredSpecsFile, startFixLoop, type BridgeConfig, type FixLoopState } from '../src';

const GAP = join(__dirname, 'fixtures/gap');
const input = {
  component: 'TextInput',
  measured: parseMeasuredSpecsFile(readFileSync(join(GAP, 'carbon-measured-hidden-boxes.json'), 'utf8')),
  run: parseFidelityRun(readFileSync(join(GAP, 'textinput-fidelity.json'), 'utf8')),
};
const config = { governance: DEFAULT_GOVERNANCE } as unknown as BridgeConfig;
const labelFixed = { id: 'textinput-label-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', height: 'fixed', reason: 'Carbon keeps 24 px for the label row.', by: 'claude' };
const outerFixed = { id: 'textinput-field-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-field-outer-wrapper', height: 'fixed', reason: 'The field keeps its measured height.', by: 'claude' };
const shrink = { id: 'textinput-label-shrink', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', height: 4, reason: 'Smaller label row.', by: 'claude' };
const replies = (list: string[]) => {
  let i = 0;
  return async () => list[i++] ?? '[]';
};
/** What a server keeps between requests: the state through JSON. */
const roundTrip = (s: FixLoopState): FixLoopState => JSON.parse(JSON.stringify(s));

describe('fix loop steps', () => {
  it('goes on from a state kept as JSON, keeps the closest fixes, and stops once every difference is resolved', async () => {
    const ask = replies([JSON.stringify([labelFixed]), JSON.stringify([labelFixed, outerFixed])]);
    let s = startFixLoop('TextInput');
    const one = await fixLoopRound(input, roundTrip(s), ask);
    expect(one.round).toMatchObject({ round: 1, verdict: 'closer' });
    s = roundTrip(one.state);
    expect(s).toMatchObject({ round: 1, done: false });
    const two = await fixLoopRound(input, s, ask);
    expect(two.state).toMatchObject({ round: 2, done: true });
    expect(two.state.best!.fixes).toEqual([labelFixed, outerFixed]);
    const out = fixLoopOutcome(gapCaseFor(input).gap, two.state);
    expect(out.kind).toBe('fixes');
    expect(out.summary).toMatch(/^Claude's fixes bring TextInput closer to its story\./);
  });

  it('a reply Claude cannot be read from counts as a round, with the reason for the next one', async () => {
    const r = await fixLoopRound(input, startFixLoop('TextInput'), replies(['no idea']));
    expect(r.round.verdict).toBeUndefined();
    expect(r.state.attempts[0]!.feedback).toContain('Answer with a JSON array of fix objects only.');
  });

  it('an error from Claude leaves the state as it was (a runner retries the same round)', async () => {
    const s = startFixLoop('TextInput');
    await expect(fixLoopRound(input, s, async () => Promise.reject(new Error('overloaded')))).rejects.toThrow('overloaded');
    expect(s).toEqual(startFixLoop('TextInput'));
  });

  it('three rounds without closer: done, and the outcome is an honest status fix', async () => {
    const ask = replies([JSON.stringify([shrink]), JSON.stringify([shrink]), JSON.stringify([shrink])]);
    let s = startFixLoop('TextInput');
    const verdicts: unknown[] = [];
    while (!s.done) {
      const r = await fixLoopRound(input, s, ask);
      verdicts.push(r.round.verdict);
      s = r.state;
    }
    expect(verdicts).toEqual(['worse', 'worse', 'worse']);
    expect(s.best).toBeUndefined();
    const out = fixLoopOutcome(gapCaseFor(input).gap, s);
    expect(out).toMatchObject({ kind: 'status', fixes: [{ kind: 'status', status: 'differs', by: 'claude' }] });
  });
});

describe('figmaFixesProposal', () => {
  const base = { ...input, config, fixesPath: 'figma-fixes.json', tool: 'Bridge (source: test)', source: 'test', summary: 'TextInput keeps its label row height.' };

  it('the change for review: figma-fixes.json, labels, a draft on the component branch', () => {
    const p = figmaFixesProposal({ ...base, proposed: [labelFixed, outerFixed] });
    expect(p.status).toBe('ready');
    if (p.status !== 'ready') return;
    expect(p.branchStem).toBe('bridge/figma-fixes-text-input');
    expect(p.labels).toEqual(expect.arrayContaining(['drafted-by-claude', 'figma-fixes', 'source: test']));
    expect(p.draft).toBe(true);
    expect(JSON.parse(p.fileContents[0]!.content).fixes).toHaveLength(2);
    expect(p.fixes.map((f) => f.reason)).toEqual([labelFixed.reason, outerFixed.reason]);
    expect(p.prBody).toContain('Drafted by Claude through Bridge (source: test)');
  });

  it('refuses fixes that move the component further from the code', () => {
    const p = figmaFixesProposal({ ...base, proposed: [shrink] });
    expect(p).toMatchObject({ status: 'blocked', verdict: 'worse' });
    expect(p.status === 'blocked' && p.why).toContain('further from the code');
  });

  it('throws on an invalid fix or a summary that is not one', () => {
    expect(() => figmaFixesProposal({ ...base, proposed: [{ ...labelFixed, height: 'tall' }] })).toThrow(/^Not proposed: /);
    expect(() => figmaFixesProposal({ ...base, summary: 'short', proposed: [labelFixed] })).toThrow(/summary/);
  });
});
