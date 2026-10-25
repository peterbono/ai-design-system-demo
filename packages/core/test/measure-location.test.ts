// Where the measure lives: every reader (the Claude fix tools, the plugin, Studio) looks in the repo first, then on the
// measure branch the automatic measure publishes to, and says calmly when there is none.
import { describe, expect, it } from 'vitest';
import { findMeasure, MEASURE_BRANCH, MEASURE_MISSING_TEXT, measureDir, measureFromWords, MeasureMissingError, measureSetupSteps } from '../src/measure-location';

const files = (repo: Record<string, string>, branches: Record<string, Record<string, string>> = {}) => ({
  repo: async (path: string) => repo[path],
  branch: async (path: string, branch: string) => branches[branch]?.[path],
});

describe('findMeasure', () => {
  it('the repo first: a measure committed on purpose wins', async () => {
    const m = await findMeasure(files({ 'measured-specs.json': 'repo' }, { [MEASURE_BRANCH]: { 'measured-specs.json': 'branch' } }));
    expect(m).toEqual({ text: 'repo', path: 'measured-specs.json' });
    expect(measureFromWords(m!)).toBe('measured-specs.json');
  });

  it('else the measure branch, the requests branch the plugin writes to', async () => {
    expect(MEASURE_BRANCH).toBe('bridge-requests');
    const m = await findMeasure(files({}, { 'bridge-requests': { 'measured-specs.json': 'branch' } }));
    expect(m).toEqual({ text: 'branch', path: 'measured-specs.json', branch: 'bridge-requests' });
    expect(measureFromWords(m!)).toBe('measured-specs.json on bridge-requests');
  });

  it('a custom path is read in both places', async () => {
    expect(await findMeasure(files({}, { 'bridge-requests': { 'ds/measured-specs.json': 'x' } }), 'ds/measured-specs.json')).toMatchObject({ branch: 'bridge-requests' });
    expect(measureDir('ds/measured-specs.json')).toBe('ds');
    expect(measureDir('measured-specs.json')).toBe('');
  });

  it('none, or no access to the branch, or no GitHub at all: undefined', async () => {
    expect(await findMeasure(files({}))).toBeUndefined();
    expect(await findMeasure({ repo: async () => undefined, branch: async () => Promise.reject(new Error('403')) })).toBeUndefined();
    expect(await findMeasure({ repo: async () => null })).toBeUndefined();
  });
});

describe('the missing measure, in words', () => {
  it('a designer reads one calm sentence with the next step, no command and no file', () => {
    expect(MEASURE_MISSING_TEXT).toBe("Bridge hasn't measured your components yet. A developer turns it on once: Set up automatic measure.");
    expect(MEASURE_MISSING_TEXT).not.toMatch(/npx|json|branch|CLI|MCP|—/i);
  });

  it('a developer gets the two ways to turn it on and where the measure goes', () => {
    const steps = measureSetupSteps('acme/ds').join('\n');
    expect(steps).toMatch(/^Set up automatic measure for acme\/ds, once:/);
    expect(steps).toMatch(/Studio: Settings, For developers, Set up automatic measure/);
    expect(steps).toMatch(/npx @bridge-ds\/cli measure setup, then commit \.github\/workflows\/bridge-measure\.yml/);
    expect(steps).toMatch(/publishes measured-specs\.json to the bridge-requests branch/);
    expect(steps).not.toMatch(/—/);
  });

  it('MeasureMissingError says the sentence first, then the steps', () => {
    const e = new MeasureMissingError(undefined, ['Until then, measure by hand.']);
    expect(e.code).toBe('measure-missing');
    expect(e.message.split('\n')[0]).toBe(MEASURE_MISSING_TEXT);
    expect(e.steps.at(-1)).toBe('Until then, measure by hand.');
  });
});
