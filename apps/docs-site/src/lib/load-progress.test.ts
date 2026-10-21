import { describe, expect, it } from 'vitest';
import { storybookProgressView, teamProgress, teamProgressView, TEAM_PROGRESS_START, type TeamLoadEvent } from './load-progress';

const fold = (events: TeamLoadEvent[]) => events.reduce(teamProgress, TEAM_PROGRESS_START);
const files = (phase: 'tokens' | 'components' | 'docs', done: number, total: number, filesDone: number, filesTotal: number): TeamLoadEvent => ({ step: 'files', progress: { phase, done, total, filesDone, filesTotal } });

describe('teamProgressView', () => {
  it('starts indeterminate while it finds the default branch head', () => {
    const v = teamProgressView(TEAM_PROGRESS_START);
    expect(v).toMatchObject({ status: 'Finding your design system', value: null, done: false });
    expect(v.steps).toEqual([{ label: 'Finding your design system', state: 'current' }]);
  });

  it('fills the bar from real counts and names the phase in hand', () => {
    const v = teamProgressView(fold([{ step: 'head' }, files('tokens', 12, 48, 12, 214)]));
    expect(v).toMatchObject({ status: 'Reading tokens', detail: 'Reading tokens 12 of 48', value: 12, max: 214, valueText: '12 of 214 files read' });
    expect(v.steps.map((s) => s.label)).toEqual(['Found your design system', 'Reading 214 files']);
    expect(teamProgressView(fold([files('docs', 3, 40, 177, 214)]))).toMatchObject({ status: 'Reading docs', detail: 'Reading docs 3 of 40', value: 177 });
  });

  it('never guesses a total: nothing to count stays indeterminate', () => {
    expect(teamProgressView(fold([files('tokens', 0, 0, 0, 0)]))).toMatchObject({ value: null, detail: null });
  });

  it('the snapshot is one read: indeterminate, then Ready', () => {
    const p = fold([{ step: 'head' }, { step: 'snapshot' }]);
    expect(teamProgressView(p)).toMatchObject({ status: 'Using the saved snapshot', value: null });
    const done = teamProgressView(teamProgress(p, { step: 'ready' }));
    expect(done).toMatchObject({ status: 'Ready', value: 1, max: 1, done: true });
    expect(done.steps.map((s) => s.label)).toEqual(['Found your design system', 'Used the saved snapshot', 'Ready']);
  });

  it('Ready after a live read says how many files were read', () => {
    const v = teamProgressView(fold([files('docs', 40, 40, 214, 214), { step: 'ready' }]));
    expect(v.steps.map((s) => [s.label, s.state])).toEqual([
      ['Found your design system', 'done'],
      ['Read 214 files', 'done'],
      ['Ready', 'current'],
    ]);
  });

  it('a cache hit is done at once', () => {
    expect(teamProgressView(fold([{ step: 'head' }, { step: 'cache' }])).done).toBe(true);
  });
});

describe('storybookProgressView', () => {
  it('reads index.json without a known size, then counts the components', () => {
    expect(storybookProgressView({ step: 'storybook' })).toMatchObject({ status: 'Reading your Storybook', value: null });
    const v = storybookProgressView({ step: 'ready', components: 32 });
    expect(v).toMatchObject({ status: 'Ready', done: true });
    expect(v.steps[0]!.label).toBe('Found 32 components in your Storybook');
    expect(storybookProgressView({ step: 'ready', components: 1 }).steps[0]!.label).toBe('Found 1 component in your Storybook');
  });
});
