// api/_lib/figma-ship.ts keeps the server's copy of the Figma push rules of @bridge-ds/core (the /api functions load no
// workspace package at runtime). Both run on the same fixtures here: any drift fails.
import { describe, expect, it } from 'vitest';
import { figmaPushScope as coreScope, figmaShipReviewBody as coreReview, isFigmaPush as corePush, loadConfig, tokenFileChanges as coreChanges } from '@bridge-ds/core';
import { figmaPushScope, figmaShipReviewBody, isFigmaPush, shipConfig, tokenFileChanges } from '../../api/_lib/figma-ship';

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
  });

  it('token change kinds and the review body', () => {
    const a = JSON.stringify({ c: { a: { $type: 'color', $value: '#000' }, b: { $value: 1, $description: 'x' }, gone: { $value: 1 }, g: { $type: 'color', n: { $value: '#1' } } } });
    const b = JSON.stringify({ c: { a: { $type: 'color', $value: '#111' }, b: { $value: 1, $description: 'y' }, fresh: { $value: 2 }, g: { $type: 'color', n: { $value: '#1', $extensions: { x: 1 } } } } });
    for (const pair of [{ before: a, after: b }, { before: null, after: b }, { before: a, after: null }, { before: a, after: a }]) expect(tokenFileChanges([pair])).toEqual(coreChanges([pair]));
    for (const who of ['sam', '@sam', 'Sam Lee', null]) expect(figmaShipReviewBody(who)).toBe(coreReview(who));
  });
});
