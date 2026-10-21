// Studio onboarding: the six steps, their state, and what this browser remembers.
import { describe, expect, it } from 'vitest';
import { doneSummary, firstRunTitle, onboardingSteps, parseMemory, progressLabel, showsChecklist, showsFirstRun, type OnboardingFacts } from './onboarding';

const base: OnboardingFacts = { login: 'ann', repo: 'acme/design-system', storybook: 'https://sb.acme.dev', products: ['Admin demo', 'Library'], changes: null };
const states = (f: OnboardingFacts) => onboardingSteps(f).map((s) => `${s.id}:${s.state}`);

describe('onboarding steps', () => {
  it('opens on how changes reach the code once signed in, while the file does not say it', () => {
    expect(states(base)).toEqual(['signin:done', 'library:done', 'products:done', 'changes:current', 'figma:later', 'claude:later']);
    const steps = onboardingSteps(base);
    expect(progressLabel(steps)).toBe('3 of 6 connected');
    expect(steps[1]).toMatchObject({ detail: 'Storybook and', code: 'acme/design-system', status: 'Connected' });
    expect(steps[3]!.status).toBe('Current');
    expect(showsFirstRun(steps, { later: false })).toBe(true);
    expect(showsFirstRun(steps, { later: true })).toBe(false);
  });

  it('starts at sign in for a signed-out viewer and never opens the first run', () => {
    const steps = onboardingSteps({ ...base, login: null });
    expect(steps[0]!.state).toBe('current');
    expect(showsFirstRun(steps, { later: false })).toBe(false);
    expect(showsChecklist(steps, { hidden: false })).toBe(false);
  });

  it('counts the mode as done when bridge.config.json sets it, and leaves the checklist for the rest', () => {
    const steps = onboardingSteps({ ...base, changes: 'direct' });
    expect(steps[3]).toMatchObject({ state: 'done', detail: 'Pull requests Bridge opens' });
    expect(progressLabel(steps)).toBe('4 of 6 connected');
    expect(showsFirstRun(steps, { later: false })).toBe(false);
    expect(showsChecklist(steps, { hidden: false })).toBe(true);
    expect(showsChecklist(steps, { hidden: true })).toBe(false);
    expect(doneSummary(steps)).toBe('Signed in, design system, products and how changes reach your code');
  });

  it('waits on the pull request proposed from this browser', () => {
    const steps = onboardingSteps({ ...base, proposed: { pr: 182, mode: 'suggest' } });
    expect(steps[3]).toMatchObject({ state: 'waiting', status: 'In review, #182', pr: 182 });
    expect(showsFirstRun(steps, { later: false })).toBe(false);
  });

  it('marks Figma and Claude done only when the viewer says so, and hides the checklist when all is done', () => {
    const steps = onboardingSteps({ ...base, changes: 'suggest', marked: ['figma', 'claude', 'signin'] });
    expect(progressLabel(steps)).toBe('6 of 6 connected');
    expect(showsChecklist(steps, { hidden: false })).toBe(false);
  });

  it('says the repository alone when there is no Storybook, and products found later', () => {
    const steps = onboardingSteps({ ...base, storybook: null, products: [] });
    expect(steps[1]!.detail).toBe('Repository');
    expect(steps[2]).toMatchObject({ state: 'later', status: 'Found with the repo' });
  });

  it('titles the first run by its step', () => {
    expect(firstRunTitle('Ann', 'changes')).toBe('Almost there. Choose how changes reach your code.');
    expect(firstRunTitle('Ann', 'library')).toBe("Welcome, Ann. Let's connect your design system.");
  });
});

describe('onboarding memory', () => {
  it('drops anything malformed', () => {
    expect(parseMemory(null)).toEqual({ later: false, hidden: false, marked: [], proposed: null });
    expect(parseMemory('{nope')).toEqual({ later: false, hidden: false, marked: [], proposed: null });
    expect(parseMemory(JSON.stringify({ later: true, marked: ['figma', 'changes', 3], proposed: { pr: -1, mode: 'suggest' } }))).toEqual({ later: true, hidden: false, marked: ['figma'], proposed: null });
    expect(parseMemory(JSON.stringify({ proposed: { pr: 9, mode: 'direct' } })).proposed).toEqual({ pr: 9, mode: 'direct' });
  });
});

describe('step 2 with the Storybook quick start', () => {
  it('names the Storybook added in this browser with the repository', () => {
    const steps = onboardingSteps({ ...base, storybook: null, quickStart: { url: 'https://sb.example.com', components: 12 } });
    expect(steps.find((s) => s.id === 'library')).toMatchObject({ detail: 'Storybook and', code: 'acme/design-system', state: 'done' });
    expect(onboardingSteps({ ...base, storybook: null }).find((s) => s.id === 'library')!.detail).toBe('Repository');
  });
});
