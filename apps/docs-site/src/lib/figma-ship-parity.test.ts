// api/_lib/figma-ship.ts keeps the server's copy of the Figma push rules of @bridge-ds/core (the /api functions load no
// workspace package at runtime). Both run on the same fixtures here: any drift fails.
import { describe, expect, it } from 'vitest';
import { approverEntries, figmaPushOf as coreOf, figmaPushScope as coreScope, figmaShipReviewBody as coreReview, isFigmaPush as corePush, loadConfig, summarizeApprovals, tokenFileChanges as coreChanges } from '@bridge-ds/core';
import { approverEntriesOf, designApprovalOf, figmaPushScope, figmaShipReviewBody, isClaudeDraft, isFigmaPush, shipConfig, tokenFileChanges, valuesShipReviewBody } from '../../api/_lib/figma-ship';

const configs = [
  { tokens: { root: 'packages/tokens/src' }, contrast: { path: 'packages/tokens/src/contrast.checks.json' } },
  { tokens: { root: 'design/tokens' }, governance: { guardrails: ['AGENTS.md', '.github/', 'bridge.config.json', 'design/tokens/contrast.checks.json'] } },
  {},
];

const fileSets = [
  ['packages/tokens/src/semantic/light.tokens.json', '.changeset/x.md'],
  ['design/tokens/color.json'],
  ['tokens/a.tokens.json', 'docs/notes.md', '.bridge/figma/x.json'],
  ['packages/tokens/src/contrast.checks.json'],
  ['design/tokens/contrast.checks.json'],
  ['tokens/contrast.checks.json'],
  ['packages/react/src/components/Button/Button.tsx', 'tokens/a.tokens.json'],
  ['.github/workflows/ci.yml'],
  ['AGENTS.md'],
  ['bridge.config.json'],
  ['README.md'],
  ['src/index.ts'],
];

const changeSets = [null, [], [{ kind: 'changed' }], [{ kind: 'added' }, { kind: 'changed' }], [{ kind: 'removed' }], [{ kind: 'renamed' }]];

describe('the server copy of the Figma push rules matches @bridge-ds/core', () => {
  it('scope, for every config, file set and token change set', () => {
    for (const raw of configs) {
      const core = loadConfig(raw);
      const ship = shipConfig(raw);
      for (const files of fileSets)
        for (const changes of changeSets) {
          const f = files.map((path) => ({ path }));
          expect([raw, files, changes, figmaPushScope(f, changes, ship)]).toEqual([raw, files, changes, coreScope({ files: f, tokenChanges: changes, config: core })]);
        }
    }
  });

  it('what a push from Figma is', () => {
    const origin = (o: unknown) => `text\n<!-- bridge-from-figma ${JSON.stringify(o)} -->`;
    const cases = [
      { labels: ['source: figma'] },
      { labels: [{ name: 'From-Figma' }] },
      { labels: ['source: studio'] },
      { body: origin({ component: 'Button', figmaName: 'Button', route: 'claude-draft', kind: 'new-variant' }) },
      { body: origin({ component: 'Button', route: 'manual' }) },
      { body: '<!-- bridge-from-figma {nope -->' },
      {},
    ];
    for (const c of cases) expect([c, isFigmaPush(c)]).toEqual([c, corePush(c)]);
    // A Claude draft branch never ships by itself: the server refuses it where core reads it as code work.
    const values = { files: [{ path: 'tokens/a.tokens.json' }], tokenChanges: [{ kind: 'changed' }] };
    for (const c of [...cases, { labels: ['from-figma', 'waiting-for-claude'] }, { labels: ['source: figma', 'drafted-by-claude'] }]) {
      if (!corePush(c)) continue;
      expect([c, isClaudeDraft(c)]).toEqual([c, coreOf(c, values)?.scope !== 'token-values']);
    }
  });

  it('token change kinds and the review body', () => {
    const a = JSON.stringify({ c: { a: { $type: 'color', $value: '#000' }, b: { $value: 1, $description: 'x' }, gone: { $value: 1 }, g: { $type: 'color', n: { $value: '#1' } } } });
    const b = JSON.stringify({ c: { a: { $type: 'color', $value: '#111' }, b: { $value: 1, $description: 'y' }, fresh: { $value: 2 }, g: { $type: 'color', n: { $value: '#1', $extensions: { x: 1 } } } } });
    for (const pair of [{ before: a, after: b }, { before: null, after: b }, { before: a, after: null }, { before: a, after: a }]) expect(tokenFileChanges([pair])).toEqual(coreChanges([pair]));
    for (const who of ['sam', '@sam', 'Sam Lee', null]) expect(figmaShipReviewBody(who)).toBe(coreReview(who));
  });

  it('the design approval of a token value change (TV-1): approver lists and the approval read', () => {
    const govs = [
      {},
      { owners: { design: ['dana'], tech: ['malik'] } },
      { owners: { design: ['@Dana', '@acme/design'], tech: ['malik'] }, rights: { approveDesign: ['design', 'tech'] } },
      { owners: { design: ['dana'], tech: ['malik'] }, rights: { approveDesign: ['tech'], approveTech: ['tech'], ship: ['tech'] } },
      { owners: { design: [], tech: ['malik'] } },
    ];
    const H = 'h'.repeat(40);
    const r = (login: string, state: string, at: string, commit = H) => ({ user: { login }, state, submitted_at: at, commit_id: commit });
    const reviewSets = [
      [],
      [r('dana', 'APPROVED', '1')],
      [r('DANA', 'APPROVED', '1')],
      [r('malik', 'APPROVED', '1')],
      [r('dana', 'APPROVED', '2'), r('dana', 'CHANGES_REQUESTED', '1')],
      [r('dana', 'APPROVED', '1'), r('dana', 'DISMISSED', '2')],
      [r('dana', 'APPROVED', '1'), r('dana', 'COMMENTED', '2'), r('malik', 'CHANGES_REQUESTED', '3')],
      [r('sam', 'APPROVED', '1')],
      [r('ann', 'APPROVED', '1'), r('bo', 'APPROVED', '2')],
    ];
    for (const governance of govs) {
      const raw = { governance };
      const cfg = loadConfig(raw).governance;
      const lists = approverEntriesOf(raw);
      expect([governance, lists]).toEqual([governance, approverEntries(cfg.owners, cfg.rights ?? null)]);
      for (const reviews of reviewSets) {
        const core = summarizeApprovals(reviews, lists, 'sam');
        const ours = designApprovalOf(reviews, lists, 'sam', H);
        expect([governance, reviews, ours.design, ours.approvers, ours.changesRequested]).toEqual([governance, reviews, core.design, core.approvers, core.changesRequested]);
      }
    }
    expect(valuesShipReviewBody(['dana', '@ann'])).toContain('design approved by @dana, @ann');
  });
});
