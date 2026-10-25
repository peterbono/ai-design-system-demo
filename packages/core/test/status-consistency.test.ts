// The fixes from seeding the demo repo (Acme Design, peterbono/bridge-demo-ds): one branch status everywhere (no CI is a calm state, a merge not
// computed yet never hides a missing approval), Outdated suggestions, final suggestion labels, the visual check only
// where the workflow exists, and titles never prefixed twice.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CI_STATE_LABEL,
  GitHubClient,
  hasVisualWorkflow,
  loadConfig,
  markSuggestionsAppliedOnGitHub,
  REVIEW_STATUS_LABEL,
  requestIssueTitle,
  reviewStatusKind,
  subjectTitle,
  suggestionIssueTitle,
  suggestionLabelChanges,
  suggestionStalenessOnGitHub,
  summarizeApprovals,
  summarizeCi,
  visualOffer,
  withOutdated,
  type SuggestionDetail,
} from '../src/index';

const owners = { design: ['dana'], tech: ['teo'] };
const noCi = summarizeCi([], []);
const none = summarizeApprovals([], owners, 'ann');
const both = summarizeApprovals(
  [
    { user: { login: 'dana' }, state: 'APPROVED', submitted_at: '2026-10-20T00:00:00Z' },
    { user: { login: 'teo' }, state: 'APPROVED', submitted_at: '2026-10-20T00:01:00Z' },
  ],
  owners,
  'ann',
);
const open = { state: 'open', draft: false, merged_at: null };

describe('branch status without automated checks', () => {
  it('a repo with no checks is its own calm state, and the status comes from the approvals', () => {
    expect(noCi.state).toBe('none');
    expect(CI_STATE_LABEL[noCi.state]).toBe('No automated checks');
    for (const mergeable of [true, null, undefined]) {
      expect(reviewStatusKind({ ...open, ci: noCi, approvals: none, tier: 3, mergeable })).toBe('needs-design');
      expect(reviewStatusKind({ ...open, ci: noCi, approvals: none, tier: 1, mergeable })).toBe('needs-approval');
    }
    expect(reviewStatusKind({ ...open, ci: noCi, approvals: both, tier: 3, mergeable: true })).toBe('ready');
  });

  it('"checking" only holds back Ready to merge while GitHub computes the merge, in words that say so', () => {
    expect(reviewStatusKind({ ...open, ci: noCi, approvals: both, tier: 3, mergeable: null })).toBe('checking');
    expect(REVIEW_STATUS_LABEL.checking).toBe('Checking for conflicts');
    // A known conflict still wins over a missing approval.
    expect(reviewStatusKind({ ...open, ci: noCi, approvals: none, tier: 3, mergeable: false })).toBe('conflict');
  });

  it('every status has designer words, never "Checking" alone', () => {
    expect(Object.values(REVIEW_STATUS_LABEL)).not.toContain('Checking');
    expect(REVIEW_STATUS_LABEL['needs-design']).toBe('Needs design approval');
  });
});

describe('titles', () => {
  it('never prefixes a title that already starts with the component, with or without a colon, any case', () => {
    expect(subjectTitle('Select', 'select: keyboard focus on open')).toBe('Select: keyboard focus on open');
    expect(subjectTitle('Select', 'Select: Keyboard focus on open')).toBe('Select: keyboard focus on open');
    expect(subjectTitle('Select', 'SELECT keeps focus on open')).toBe('Select keeps focus on open');
    expect(subjectTitle('EmptyState', 'EmptyState: always offer the next step')).toBe('EmptyState: always offer the next step');
    expect(subjectTitle('EmptyState', 'emptyState: always offer the next step.')).toBe('EmptyState: always offer the next step');
    // A longer word is not the component.
    expect(subjectTitle('Select', 'Selection stays after closing')).toBe('Select: selection stays after closing');
  });

  it('lowers the first letter, never a proper component name', () => {
    expect(subjectTitle('Tokens', 'Snappier dialogs and accordions')).toBe('Tokens: snappier dialogs and accordions');
    expect(subjectTitle('Docs', 'EmptyState always offers the next step')).toBe('Docs: EmptyState always offers the next step');
    expect(subjectTitle('Tokens', 'WCAG contrast for muted text')).toBe('Tokens: WCAG contrast for muted text');
    expect(subjectTitle('Tokens', 'Button gets a calmer focus ring', ['Button'])).toBe('Tokens: Button gets a calmer focus ring');
  });

  it('requests and suggestions use the same rule', () => {
    expect(requestIssueTitle({ component: 'Select', title: 'Select: add a clear button' })).toBe('Select: add a clear button');
    expect(requestIssueTitle({ component: 'Button', title: 'Add a danger ghost variant.' })).toBe('Button: add a danger ghost variant');
    const docs = (title: string) => suggestionIssueTitle({ kind: 'docs', title, docs: [{ component: 'EmptyState', path: 'x', after: {} as never }] });
    expect(docs('EmptyState: always offer the next step')).toBe('EmptyState: always offer the next step');
    expect(docs('Always offer the next step')).toBe('EmptyState: always offer the next step');
  });
});

describe('suggestion status and labels', () => {
  it('Outdated wins over the review states only', () => {
    expect(withOutdated('needs-review', true)).toBe('outdated');
    expect(withOutdated('approved', true)).toBe('outdated');
    expect(withOutdated('needs-review', false)).toBe('needs-review');
    expect(withOutdated('applying', true)).toBe('applying');
    expect(withOutdated('applied', true)).toBe('applied');
  });

  it('an applied and closed suggestion keeps the final label only (#8 in the demo repo)', () => {
    const stale = ['bridge-suggestion', 'tier: 1', 'suggestion: token-change', 'suggestion: needs review', 'suggestion: applying'];
    expect(suggestionLabelChanges(stale, 'applied')).toEqual({ add: ['suggestion: applied'], remove: ['suggestion: needs review', 'suggestion: applying'] });
    expect(suggestionLabelChanges(['suggestion: applied'], 'applied')).toEqual({ add: [], remove: [] });
    expect(suggestionLabelChanges(['suggestion: needs review'], 'declined')).toEqual({ add: ['suggestion: declined'], remove: ['suggestion: needs review'] });
    expect(suggestionLabelChanges(['suggestion: needs review'], 'outdated')).toEqual({ add: [], remove: [] });
  });

  /** A GitHub client double with just the calls these helpers make. */
  function ghDouble(issues: Record<number, { labels: string[] }>, extra: Partial<Record<string, unknown>> = {}) {
    const calls: string[] = [];
    const gh = {
      getIssue: async (n: number) => {
        if (!issues[n]) throw new Error('Not Found');
        return { number: n, labels: [...issues[n]!.labels], state: 'closed', stateReason: 'completed' };
      },
      removeLabel: async (n: number, l: string) => {
        calls.push(`-${n}:${l}`);
        issues[n]!.labels = issues[n]!.labels.filter((x) => x !== l);
      },
      addLabels: async (n: number, ls: string[]) => {
        calls.push(`+${n}:${ls.join(',')}`);
        issues[n]!.labels.push(...ls);
        return true;
      },
      ...extra,
    } as unknown as GitHubClient;
    return { gh, calls, issues };
  }

  it('a merged pull request marks the suggestions it closes applied, and leaves other issues alone', async () => {
    const { gh, issues } = ghDouble({
      8: { labels: ['bridge-suggestion', 'suggestion: needs review', 'suggestion: applying'] },
      9: { labels: ['bridge-request'] },
    });
    const r = await markSuggestionsAppliedOnGitHub(gh, { body: 'Applies it.\n\nCloses #8, fixes #9, resolves #404' });
    expect(r.applied).toEqual([8]);
    expect(issues[8]!.labels).toEqual(['bridge-suggestion', 'suggestion: applied']);
    expect(issues[9]!.labels).toEqual(['bridge-request']);
    expect(r.warnings).toEqual([expect.stringMatching(/^Suggestion #404 could not be marked applied/)]);
  });

  it('staleness reads nothing more when main has not moved, or moved without touching what it writes', async () => {
    const payload = { base: { ref: 'main', sha: 'aaa' }, files: [{ path: '.changeset/x.md' }], tokens: { edits: [{ op: 'set', path: 'motion.duration.moderate', value: '180ms' }], changes: [] } };
    const d = { parsed: { ok: true, payload, sha: 'f'.repeat(64), edited: false }, comments: [], issue: { state: 'open', author: 'dana' } } as unknown as SuggestionDetail;
    const config = loadConfig(readFileSync(new URL('../../../bridge.config.json', import.meta.url), 'utf8'));
    let planned = false;
    const at = (mainSha: string, files: string[]) =>
      ({
        getBranchSha: async () => mainSha,
        compare: async () => ({ status: 'ahead', aheadBy: 1, behindBy: 0, files: files.map((filename) => ({ filename, status: 'modified' })) }),
        listFiles: async () => {
          planned = true;
          return [];
        },
      }) as unknown as GitHubClient;
    expect(await suggestionStalenessOnGitHub(at('aaa', []), d, { config })).toMatchObject({ mainMoved: false, outdated: false, plan: null });
    expect(await suggestionStalenessOnGitHub(at('bbb', ['README.md']), d, { config })).toMatchObject({ mainSha: 'bbb', mainMoved: true, outdated: false, plan: null });
    expect(planned).toBe(false);
    // A closed one is never outdated.
    expect((await suggestionStalenessOnGitHub(at('bbb', ['packages/tokens/src/semantic/base.tokens.json']), { ...d, issue: { ...d.issue, state: 'closed' } } as SuggestionDetail, { config })).outdated).toBe(false);
  });
});

describe('visual checks only where the workflow exists', () => {
  it('detects the visual impact workflow from the workflow files', () => {
    expect(hasVisualWorkflow(['.github/workflows/ci.yml', '.github/workflows/visual-impact.yml'])).toBe(true);
    expect(hasVisualWorkflow(['visual-impact.yaml'])).toBe(true);
    expect(hasVisualWorkflow(['.github/workflows/bridge-data.yml'])).toBe(false);
    expect(hasVisualWorkflow([])).toBe(false);
  });

  it('offers the run with the workflow, a calm set-up link without it, nothing when nothing visual changes', () => {
    expect(visualOffer({ touchesVisuals: true, workflow: true })).toBe('run');
    expect(visualOffer({ touchesVisuals: true, workflow: false })).toBe('set-up');
    expect(visualOffer({ touchesVisuals: true, workflow: null })).toBe('run');
    expect(visualOffer({ touchesVisuals: false, workflow: true })).toBe('none');
  });
});
