// Studio onboarding: the six steps, their state, and what this browser remembers.
import { describe, expect, it } from 'vitest';
import { doneSummary, firstRunTitle, onboardingKey, onboardingSteps, parseMemory, progressLabel, readMemoryText, showsChecklist, showsFirstRun, type OnboardingFacts } from './onboarding';

const base: OnboardingFacts = { login: 'ann', repo: 'acme/design-system', storybook: 'https://sb.acme.dev', products: ['Admin demo', 'Library'], changes: null };
const states = (f: OnboardingFacts) => onboardingSteps(f).map((s) => `${s.id}:${s.state}`);

describe('onboarding steps', () => {
  it('opens on how changes reach the code once signed in, while the file does not say it', () => {
    expect(states(base)).toEqual(['signin:done', 'library:done', 'changes:current', 'team:later', 'products:done', 'figma:later', 'claude:later']);
    const steps = onboardingSteps(base);
    expect(progressLabel(steps)).toBe('3 of 7 connected');
    expect(steps[1]).toMatchObject({ detail: 'Storybook and', code: 'acme/design-system', status: 'Connected' });
    expect(steps[2]!.status).toBe('Current');
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
    expect(steps[2]).toMatchObject({ state: 'done', detail: 'Pull requests Bridge opens' });
    expect(progressLabel(steps)).toBe('4 of 7 connected');
    expect(showsFirstRun(steps, { later: false })).toBe(false);
    expect(showsChecklist(steps, { hidden: false })).toBe(true);
    expect(showsChecklist(steps, { hidden: true })).toBe(false);
    expect(doneSummary(steps)).toBe('Signed in, design system, how changes reach your code and products');
  });

  it('waits on the pull request proposed from this browser', () => {
    const steps = onboardingSteps({ ...base, proposed: { pr: 182, mode: 'suggest' } });
    expect(steps[2]).toMatchObject({ state: 'waiting', status: 'In review, #182', pr: 182 });
    expect(showsFirstRun(steps, { later: false })).toBe(false);
  });

  it('marks Figma and Claude done only when the viewer says so, and hides the checklist when all is done', () => {
    const steps = onboardingSteps({ ...base, changes: 'suggest', marked: ['team', 'figma', 'claude', 'signin'] });
    expect(progressLabel(steps)).toBe('7 of 7 connected');
    expect(showsChecklist(steps, { hidden: false })).toBe(false);
  });

  it('says the repository alone when there is no Storybook, and products found later', () => {
    const steps = onboardingSteps({ ...base, storybook: null, products: [] });
    expect(steps[1]!.detail).toBe('Repository');
    expect(steps.find((s) => s.id === 'products')).toMatchObject({ state: 'later', status: 'Found with the repo' });
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

describe('invite your team', () => {
  it('waits as Later is fine, and is done once the link was copied', () => {
    const later = onboardingSteps({ ...base, changes: 'suggest' }).find((s) => s.id === 'team')!;
    expect(later).toMatchObject({ n: 4, title: 'Invite your team', state: 'later', status: 'Later is fine', detail: 'Share one link. GitHub decides who gets in.' });
    // Not a core step: the first run does not open for it alone.
    expect(showsFirstRun(onboardingSteps({ ...base, changes: 'suggest' }), { later: false })).toBe(false);
    const done = onboardingSteps({ ...base, changes: 'suggest', marked: ['team'] }).find((s) => s.id === 'team')!;
    expect(done).toMatchObject({ state: 'done', detail: 'Team link shared' });
    expect(parseMemory(JSON.stringify({ marked: ['team'] })).marked).toEqual(['team']);
  });
});

describe('step 2 on a team Bridge', () => {
  const lib = (f: Partial<OnboardingFacts>) => onboardingSteps({ ...base, storybook: null, ...f }).find((s) => s.id === 'library')!;
  it('checks, then connects for the team', () => {
    expect(lib({ hosted: { access: null } })).toMatchObject({ state: 'current', status: 'Checking' });
    expect(lib({ hosted: { access: 'writer' } })).toMatchObject({ state: 'done', status: 'Connected', detail: 'Repository' });
    expect(lib({ hosted: { access: 'outside-contributor' } })).toMatchObject({ state: 'done', status: 'Read only' });
  });

  it('asks to install Bridge while it is not set up, the install link for admins only', () => {
    expect(lib({ hosted: { access: 'not-installed', admin: true } })).toMatchObject({ state: 'current', status: 'Install Bridge' });
    expect(lib({ hosted: { access: 'not-installed' } })).toMatchObject({ state: 'current', status: 'Ask an admin' });
  });
});

describe('memory per repository', () => {
  const store = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
  };
  it('keys it by repository and moves the old shared key onto the build repository once', () => {
    expect(onboardingKey('Acme/DS')).toBe('bridge.onboarding.acme/ds');
    const { m, s } = store({ 'bridge.onboarding': '{"later":true}' });
    expect(readMemoryText(s, 'acme/other', 'peterbono/demo')).toBeNull();
    expect(m.has('bridge.onboarding')).toBe(true);
    expect(readMemoryText(s, 'peterbono/demo', 'peterbono/demo')).toBe('{"later":true}');
    expect(m.get('bridge.onboarding.peterbono/demo')).toBe('{"later":true}');
    expect(m.has('bridge.onboarding')).toBe(false);
    expect(readMemoryText(s, 'peterbono/demo', 'peterbono/demo')).toBe('{"later":true}');
  });
});

describe('the browser workspace (board EmptyB)', () => {
  const ws = (f: Partial<OnboardingFacts> = {}) => onboardingSteps({ login: 'ann', repo: '', storybook: null, products: [], changes: null, workspace: true, ...f });

  it('has six steps, without inviting a team: there is no team link before a repository', () => {
    const steps = ws();
    expect(steps.map((s) => s.id)).toEqual(['signin', 'library', 'changes', 'products', 'figma', 'claude']);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progressLabel(steps)).toBe('1 of 6 connected');
  });

  it('opens on the design system once signed in, and asks nothing else first', () => {
    expect(ws().map((s) => `${s.id}:${s.state}`)).toEqual(['signin:done', 'library:current', 'changes:later', 'products:later', 'figma:later', 'claude:later']);
    expect(ws({ login: null })[0]!.state).toBe('current');
  });

  it('counts a Storybook added in this browser as connected', () => {
    const lib = ws({ quickStart: { url: 'https://sb.acme.dev/', components: 12 } }).find((s) => s.id === 'library')!;
    expect(lib).toMatchObject({ state: 'done', status: 'Connected', detail: 'Storybook', code: 'sb.acme.dev' });
    expect(progressLabel(ws({ quickStart: { url: 'https://sb.acme.dev', components: 12 } }))).toBe('2 of 6 connected');
  });
});
