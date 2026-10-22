import { describe, expect, it } from 'vitest';
import { DEMO, START, WORKSPACE } from './nav';
import { onboardingSteps } from './onboarding';
import {
  demoBack,
  CONNECT_HREF,
  DEMO_HOME,
  demoBannerKind,
  EMPTY_START,
  getStartedHref,
  hasWorkspace,
  MENU_WORDS,
  NEXT_AFTER_LIBRARY,
  ownTeams,
  parseStartMemory,
  resumeStep,
  showsStartScreen,
  START_PAGE,
  START_WORDS,
  startTitle,
  WORKSPACE_HOME,
  WORKSPACE_WORDS,
  workspaceHref,
  workspaceName,
  type StartFacts,
} from './start';
import type { ReservedPaths } from './team-path';

const facts = (f: Omit<Partial<StartFacts>, 'memory'> & { memory?: Partial<StartFacts['memory']> } = {}): StartFacts => ({
  recent: f.recent ?? [],
  storybook: f.storybook ?? false,
  memory: { ...EMPTY_START, ...f.memory },
});

const NONE_RESERVED: ReservedPaths = { firsts: [], pairs: [] };

describe('who sees the start screen', () => {
  it('shows while this browser remembers nothing', () => {
    expect(showsStartScreen(facts())).toBe(true);
    expect(hasWorkspace(facts())).toBe(false);
  });

  it('never counts the demo teams as a workspace', () => {
    const f = facts({ recent: ['peterbono/bridge-demo-ds', 'Peterbono/AI-Design-System-Demo'] });
    expect(ownTeams(f.recent)).toEqual([]);
    expect(showsStartScreen(f)).toBe(true);
  });

  it('hides once a team, a Storybook or a started connection is remembered', () => {
    expect(showsStartScreen(facts({ recent: ['acme/ds'] }))).toBe(false);
    expect(showsStartScreen(facts({ storybook: true }))).toBe(false);
    expect(showsStartScreen(facts({ memory: { connect: true } }))).toBe(false);
  });

  it('still shows after only looking at the demo', () => {
    expect(showsStartScreen(facts({ memory: { demo: true } }))).toBe(true);
  });
});

describe('where "Get started" goes', () => {
  it('opens the start screen without a workspace', () => {
    expect(getStartedHref(facts())).toBe(START_PAGE);
  });

  it('opens the most recent team of the visitor, skipping the demo', () => {
    const f = facts({ recent: ['peterbono/bridge-demo-ds', 'acme/ds', 'globex/tokens'], storybook: true });
    // No reserved list: the escape form, which always opens the team.
    expect(getStartedHref(f)).toBe('/studio/~/acme/ds/');
    expect(getStartedHref(f, NONE_RESERVED)).toBe('/studio/acme/ds/');
  });

  it('opens the browser workspace when there is no team', () => {
    expect(getStartedHref(facts({ storybook: true }))).toBe(WORKSPACE_HOME);
    expect(getStartedHref(facts({ memory: { connect: true } }))).toBe(WORKSPACE_HOME);
    expect(workspaceHref(facts())).toBeNull();
  });
});

describe('the demo banner and "Back to your workspace"', () => {
  it('keeps the visitor banner for someone who came straight to the demo', () => {
    expect(demoBannerKind(facts())).toBe('visitor');
  });

  it('after the start screen with no workspace yet, offers to connect the design system instead of a "back"', () => {
    const f = facts({ memory: { demo: true } });
    expect(demoBannerKind(f)).toBe('workspace');
    expect(demoBack(f)).toEqual({ href: CONNECT_HREF, connect: true });
  });

  it('leads back to the team, else the browser workspace', () => {
    expect(demoBannerKind(facts({ recent: ['acme/ds'] }))).toBe('workspace');
    expect(demoBack(facts({ recent: ['acme/ds'] }), NONE_RESERVED)).toEqual({ href: '/studio/acme/ds/', connect: false });
    expect(demoBack(facts({ memory: { connect: true } }))).toEqual({ href: WORKSPACE_HOME, connect: false });
  });
});

describe('resuming the setup', () => {
  const steps = (login: string | null, storybook = false) =>
    onboardingSteps({ login, repo: '', storybook: null, quickStart: storybook ? { url: 'https://sb.acme.com', components: 4 } : null, products: [], changes: null, workspace: true });

  it('resumes where the visitor left, while that step is still to do', () => {
    expect(resumeStep(steps('ann'), 'figma')).toBe('figma');
  });

  it('never resumes on a step that is done: the open step instead, never step 1', () => {
    expect(resumeStep(steps('ann'), 'signin')).toBe('library');
    expect(resumeStep(steps('ann'), null)).toBe('library');
  });

  it('starts at sign in for a signed-out visitor', () => {
    expect(resumeStep(steps(null), null)).toBe('signin');
  });

  it('goes past step 2 once a Storybook is added', () => {
    expect(resumeStep(steps('ann', true), 'library')).toBe('changes');
  });

  it('opens a team picked on step 2 at its next step', () => {
    expect(CONNECT_HREF).toBe(`${WORKSPACE_HOME}?setup=library`);
    expect(NEXT_AFTER_LIBRARY).toBe('changes');
  });
});

describe('start memory', () => {
  it('drops anything malformed', () => {
    expect(parseStartMemory(null)).toEqual(EMPTY_START);
    expect(parseStartMemory('nope')).toEqual(EMPTY_START);
    expect(parseStartMemory('{"connect":"yes","step":"nowhere","demo":1}')).toEqual(EMPTY_START);
    expect(parseStartMemory('{"connect":true,"step":"figma","demo":true}')).toEqual({ connect: true, step: 'figma', demo: true });
  });
});

describe('the addresses and words', () => {
  it('matches the build-time nav', () => {
    expect(START).toBe(START_PAGE);
    expect(WORKSPACE).toBe(WORKSPACE_HOME);
    expect(DEMO).toBe(DEMO_HOME);
  });

  it('names the visitor only when signed in (board EmptyC)', () => {
    expect(startTitle('Ann')).toBe('How do you want to start, Ann?');
    expect(startTitle(null)).toBe('How do you want to start?');
    expect(workspaceName('Ann')).toBe("Ann's workspace");
    expect(workspaceName(null)).toBe('Your workspace');
    expect(WORKSPACE_WORDS.welcome('Ann')).toBe('Welcome, Ann.');
  });

  it('writes no em dash and no developer words', () => {
    const all = JSON.stringify([START_WORDS, WORKSPACE_WORDS.nothing, WORKSPACE_WORDS.hint, MENU_WORDS]);
    expect(all).not.toMatch(/—|localStorage|pull request/);
  });
});
