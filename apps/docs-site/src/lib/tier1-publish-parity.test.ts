// api/_lib/tier1-publish.ts keeps the server's copy of the Tier 1 publish rules of @bridge-ds/core (tier1-publish.ts and
// the Tier 1 part of risk.ts classifyRisk): the /api functions load no workspace package at runtime. Both run on the
// same fixtures here: any drift fails.
import { describe, expect, it } from 'vitest';
import {
  canPublishTier1,
  classifyRisk,
  leadsPublishTier1On as coreOn,
  loadConfig,
  publishedWithoutReview as coreRecord,
  tier1Domain as coreDomain,
  TIER1_PUBLISH_HEADING as CORE_HEADING,
  tier1PublishReviewBody as coreBody,
} from '@bridge-ds/core';
import { shipConfig } from '../../api/_lib/figma-ship';
import { isLead, isTier1, leadsPublishTier1On, publishedWithoutReview, tier1Domain, TIER1_PUBLISH_HEADING, tier1PublishReviewBody } from '../../api/_lib/tier1-publish';

const configs: Record<string, unknown>[] = [
  { tokens: { root: 'packages/tokens/src' }, contrast: { path: 'packages/tokens/src/contrast.checks.json' } },
  { tokens: { root: 'design/tokens' }, governance: { guardrails: ['AGENTS.md', '.github/', 'bridge.config.json', 'docs/GOVERNANCE.md'] } },
  {},
];

const fileSets = [
  ['packages/react/src/components/Button/Button.docs.json'],
  ['docs/USAGE.md', '.changeset/x.md'],
  ['packages/react/src/components/Button/Button.stories.tsx'],
  ['packages/react/src/components/Button/Button.test.tsx', 'README.md'],
  ['packages/react/src/components/Button/Button.tsx'],
  ['packages/react/src/components/Button/Button.docs.json', 'packages/react/src/components/Button/Button.module.css'],
  ['docs/GOVERNANCE.md'],
  ['AGENTS.md'],
  ['bridge.config.json'],
  ['.github/workflows/ci.yml'],
  ['packages/tokens/src/contrast.checks.json'],
  ['design/tokens/color.json'],
  ['packages/tokens/src/semantic/light.tokens.json'],
  [],
];

const tokenSets: ({ kind: 'added' | 'changed' | 'removed'; path: string; descriptionOnly?: boolean }[] | null)[] = [
  null,
  [],
  [{ kind: 'changed', path: 'color.a', descriptionOnly: true }],
  [{ kind: 'changed', path: 'color.a' }],
  [{ kind: 'changed', path: 'color.a', descriptionOnly: true }, { kind: 'added', path: 'color.b' }],
  [{ kind: 'removed', path: 'color.a' }],
];

describe('Tier 1 publish: the server copy agrees with core', () => {
  it('reads Tier 1 the same as classifyRisk, over files, token changes and configs', () => {
    for (const raw of configs) {
      const config = loadConfig({ repo: 'acme/ds', ...raw } as never);
      for (const paths of fileSets) {
        for (const tokenChanges of tokenSets) {
          const files = paths.map((path) => ({ path }));
          const core = classifyRisk({ files, ...(tokenChanges ? { tokenChanges } : {}), config }).tier === 1;
          expect(isTier1(files, tokenChanges, shipConfig(raw)), `${JSON.stringify(raw)} ${paths.join(',')} ${JSON.stringify(tokenChanges)}`).toBe(core);
        }
      }
    }
  });

  it('reads the domain the same', () => {
    for (const paths of fileSets) expect(tier1Domain(paths)).toBe(coreDomain(paths));
  });

  it('reads the setting the same, absent counting as on', () => {
    for (const governance of [undefined, {}, { leadsPublishTier1: true }, { leadsPublishTier1: false }]) {
      const raw = { repo: 'acme/ds', ...(governance ? { governance } : {}) };
      expect(leadsPublishTier1On(raw)).toBe(coreOn(loadConfig(raw).governance));
    }
  });

  it('decides who leads the same, once the change is Tier 1 and the setting on', () => {
    const approvers = { design: ['dana', '@acme/design'], tech: ['Malik'] };
    for (const viewer of ['dana', '@DANA', 'malik', 'sam', 'acme/design']) {
      for (const domain of ['design', 'tech'] as const) {
        for (const admin of [false, true]) {
          expect(isLead(viewer, { admin, approvers: approvers[domain] })).toBe(canPublishTier1({ viewer, tier: 1, domain, approvers, admin, enabled: true }));
        }
      }
    }
  });

  it('writes the same record', () => {
    expect(TIER1_PUBLISH_HEADING).toBe(CORE_HEADING);
    for (const name of ['Dana Reyes', 'dana', ' ']) expect(publishedWithoutReview(name)).toBe(coreRecord(name));
    expect(tier1PublishReviewBody('Dana Reyes', '@Dana')).toBe(coreBody('Dana Reyes', '@Dana'));
  });
});
