import { describe, expect, it } from 'vitest';
import { approvalHelp, checkStory, classifyCheck, developerOnlyFailures, failingSentence, jobIdFromUrl, reviewAskMessage, shipWhen, type DesignFacts } from './check-explain';

// The three failing checks of change #101 (color.bg.default from neutral.0 to neutral.50), as GitHub reported them.
const run = (id: number) => `https://github.com/peterbono/ai-design-system-demo/actions/runs/39133143413/job/${id}`;
const PR101 = [
  { name: 'Figma plugin (DS Bridge)', url: run(117692229504), step: 'Test plugin (codec round trip, resolver, diff, WCAG, validators)', failures: [{ path: '.github', title: '', message: 'Process completed with exit code 1.' }] },
  {
    name: 'Unit and a11y tests',
    url: run(117692229432),
    step: 'Vitest (keyboard, ARIA and axe-core checks)',
    failures: [
      { path: '.github', title: '', message: 'Process completed with exit code 1.' },
      { path: 'apps/docs-site/src/lib/library-rows.test.ts', title: 'apps/docs-site/src/lib/library-rows.test.ts > foundation rows on this repo > does not call the page background unused', message: "AssertionError: expected 'neutral 50 · 950' to be 'neutral 0 · 950'\n\nExpected" },
    ],
  },
  {
    name: 'MCP server and CLI',
    url: run(117692229383),
    step: 'Test MCP server and CLI (real tokens, fixture repo, fake GitHub, stdio smoke test)',
    failures: [{ path: 'packages/mcp/test/protocol.test.ts', title: 'packages/mcp/test/protocol.test.ts > MCP over stdio > serves the four prompts', message: "AssertionError: expected 'Audit' to contain 'var(--color-bg-default)'" }],
  },
];

const passingDesign: DesignFacts = { checked: 296, passing: 296, failingPairs: [], changedTokens: ['color.bg.default'], colorsOnly: true, problems: [] };

describe('jobIdFromUrl', () => {
  it('reads the job id of a check run URL', () => {
    expect(jobIdFromUrl(run(117692229432))).toBe(117692229432);
    expect(jobIdFromUrl('https://vercel.com/x')).toBeNull();
    expect(jobIdFromUrl(undefined)).toBeNull();
  });
});

describe('classifyCheck', () => {
  it('classifies the #101 failures as developer tests and keeps only real test cases', () => {
    const c = PR101.map(classifyCheck);
    expect(c.map((x) => [x.kind, x.topic])).toEqual([
      ['developer', 'tests'],
      ['developer', 'tests'],
      ['developer', 'tests'],
    ]);
    expect(c[0]!.cases).toEqual([]);
    expect(c[1]!.cases).toEqual([{ file: 'apps/docs-site/src/lib/library-rows.test.ts', title: 'foundation rows on this repo > does not call the page background unused', message: "AssertionError: expected 'neutral 50 · 950' to be 'neutral 0 · 950'" }]);
  });

  it('calls a failing token build a design rule, whatever job runs it', () => {
    expect(classifyCheck({ name: 'Guardrails', step: 'Build tokens (DTCG to CSS variables + TS, contrast gate)' })).toMatchObject({ kind: 'design', topic: 'token-rules' });
    expect(classifyCheck({ name: 'MCP server and CLI', step: 'bridge check (config, token validation, contrast)' })).toMatchObject({ kind: 'design', topic: 'token-rules' });
    expect(classifyCheck({ name: 'Figma plugin (DS Bridge)', step: 'Build tokens (the plugin tests read contrast.checks.json and resolved tokens)' }).kind).toBe('design');
    expect(classifyCheck({ name: 'Visual impact' })).toMatchObject({ kind: 'design', topic: 'visual' });
  });

  it('falls back on the check name when the job was not read', () => {
    expect(classifyCheck({ name: 'Unit and a11y tests' }).topic).toBe('tests');
    expect(classifyCheck({ name: 'Changeset present' }).topic).toBe('release-note');
    expect(classifyCheck({ name: 'Guardrails', step: 'Typecheck' })).toMatchObject({ kind: 'developer', topic: 'build' });
    expect(classifyCheck({ name: 'Guardrails' })).toMatchObject({ kind: 'developer', topic: 'other' });
  });
});

describe('checkStory', () => {
  it('#101: design passes, developer tests expect the old color', () => {
    const s = checkStory({ failed: PR101.map(classifyCheck), pending: 0, passed: 27, design: passingDesign, tokenOnly: true });
    expect(s.design).toEqual({ state: 'pass', text: '296 contrast checks still pass.' });
    expect(s.developer).toEqual({ state: 'fail', text: '3 developer tests expect the old color. A developer needs to update them.' });
    expect(s.designFails).toBe(false);
    expect(s.oldValue).toBe(true);
  });

  it('does not claim the old value without test annotations', () => {
    const s = checkStory({ failed: PR101.map((c) => classifyCheck({ name: c.name, url: c.url })), pending: 0, passed: 27, design: passingDesign, tokenOnly: true });
    // The plugin check names no test without its job: they read as checks.
    expect(s.developer?.text).toBe('3 developer checks fail on this branch. A developer needs to look at them.');
    expect(s.oldValue).toBe(false);
  });

  it('names the token and the pair when contrast fails', () => {
    const design: DesignFacts = {
      ...passingDesign,
      passing: 284,
      changedTokens: ['color.text.muted'],
      failingPairs: [
        { fg: 'color.text.muted', bg: 'color.bg.default', where: 'Bridge light', after: 3.5, min: 4.5 },
        { fg: 'color.text.muted', bg: 'color.bg.zone', where: 'Bridge light', after: 2.78, min: 4.5 },
      ],
    };
    const s = checkStory({ failed: [classifyCheck({ name: 'Guardrails', step: 'Build tokens (DTCG to CSS variables + TS, contrast gate)' })], pending: 0, passed: 10, design, tokenOnly: true });
    expect(s.design).toEqual({ state: 'fail', text: 'color.text.muted on color.bg.default drops to 3.50:1 in Bridge light, below 4.50:1. 1 more pair fails too. Change color.text.muted so they pass.' });
    expect(s.designFails).toBe(true);
    expect(s.developer).toEqual({ state: 'pass', text: 'All pass.' });
  });

  it('says a token problem is the designer’s, and a missing release note a developer’s', () => {
    const s = checkStory({ failed: [classifyCheck({ name: 'Guardrails', step: 'Build tokens' }), classifyCheck({ name: 'Changeset present' })], pending: 0, passed: 3, design: { ...passingDesign, problems: ['color.x in semantic/light.tokens.json has no $type.'] }, tokenOnly: true });
    expect(s.design?.text).toBe('color.x in semantic/light.tokens.json has no $type. Fix it in the token editor.');
    expect(s.developer?.text).toBe('The release note for this branch is missing. A developer adds it.');
  });

  it('reports running and passing checks', () => {
    expect(checkStory({ failed: [], pending: 2, passed: 5, design: null, tokenOnly: false })).toMatchObject({ design: null, developer: { state: 'pending', text: '2 checks still running.' } });
    expect(checkStory({ failed: [], pending: 0, passed: 5, design: null, tokenOnly: false }).developer).toEqual({ state: 'pass', text: 'All pass.' });
  });
});

describe('failingSentence', () => {
  const story = checkStory({ failed: PR101.map(classifyCheck), pending: 0, passed: 27, design: passingDesign, tokenOnly: true });
  it('never tells the author to fix developer tests', () => {
    const s = failingSentence({ story, author: 'peterbono', viewerIsAuthor: true, viewerApprovesDesign: false, approvalsMissing: true });
    expect(s).toEqual({ sentence: 'Waiting for a developer to update 3 tests, and for approvals. Your design is not the problem.', yourTurn: false });
    expect(s.sentence).not.toMatch(/fix/);
  });
  it('lets a design owner approve while developer tests fail', () => {
    expect(failingSentence({ story, author: 'ana', viewerIsAuthor: false, viewerApprovesDesign: true, approvalsMissing: true })).toEqual({ sentence: 'Your turn: approve the design. Merging waits for a developer to update 3 tests.', yourTurn: true });
  });
  it('names the author when a design rule fails', () => {
    const bad = { ...story, designFails: true };
    expect(failingSentence({ story: bad, author: 'ana', viewerIsAuthor: false, viewerApprovesDesign: false, approvalsMissing: true }).sentence).toBe('Waiting for @ana to fix a design rule.');
    expect(failingSentence({ story: bad, author: 'ana', viewerIsAuthor: true, viewerApprovesDesign: false, approvalsMissing: true })).toEqual({ sentence: 'Your turn: a design rule fails. Fix it before this can merge.', yourTurn: true });
  });
});

describe('approvalHelp', () => {
  it('#101: the author is the only owner and holds the override', () => {
    const h = approvalHelp({ viewerIsAuthor: true, waiting: ['design', 'tech'], eligible: { design: [], tech: [] }, viewerHoldsOverride: true, testsPass: false });
    expect(h?.rowText).toEqual({ design: 'Waiting for another design owner', tech: 'Waiting for another tech owner' });
    expect(h?.why).toBe('You made this branch, and GitHub does not let authors approve their own. No one else is an owner yet: add one in Settings and ask them, or merge it yourself with the owner override once tests pass.');
  });
  it('names who else can approve', () => {
    const h = approvalHelp({ viewerIsAuthor: true, waiting: ['design'], eligible: { design: ['ana'] }, viewerHoldsOverride: false, testsPass: true });
    expect(h).toEqual({ rowText: { design: 'Waiting for @ana' }, why: 'You made this branch, and GitHub does not let authors approve their own. Ask another design owner.', others: ['ana'] });
  });
  it('says nothing to someone who did not make the change', () => {
    expect(approvalHelp({ viewerIsAuthor: false, waiting: ['design'], eligible: {}, viewerHoldsOverride: true, testsPass: true })).toBeNull();
  });
});

describe('reviewAskMessage and shipWhen', () => {
  it('writes the message Ask for review copies', () => {
    expect(reviewAskMessage({ title: 'Darker default background', number: 101, url: 'https://bridge.example/studio/changes/?pr=101', roles: ['design', 'tech'], others: ['ana'] })).toBe(
      '@ana Could you review "Darker default background" (#101)? It needs a design and a tech approval. Bridge shows the before and after and the contrast checks: https://bridge.example/studio/changes/?pr=101',
    );
  });
  it('says what unlocks shipping, in plain words', () => {
    expect(shipWhen({ ciFail: true, missingApprovals: 2 })).toBe('Merge unlocks once tests pass and the approvals are in.');
    expect(shipWhen({ ciPending: true, missingApprovals: 1, conflict: true })).toBe('Merge unlocks once tests finish, the approval is in and the conflict is resolved.');
    expect(shipWhen({})).toBeNull();
  });
});

describe('developerOnlyFailures', () => {
  it('is true only when every failing check is a developer check', () => {
    expect(developerOnlyFailures(['Unit and a11y tests', 'Typecheck'])).toBe(true);
    expect(developerOnlyFailures(['Unit and a11y tests', 'Contrast checks'])).toBe(false);
    expect(developerOnlyFailures(['Visual impact'])).toBe(false);
    expect(developerOnlyFailures([])).toBe(false);
    expect(developerOnlyFailures(undefined)).toBe(false);
  });
});
