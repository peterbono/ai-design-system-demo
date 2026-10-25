import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig, toConfigJson } from '../src/config';
import { siteRepoFromConfig } from '../src/repo-model';
import { branchVerdict, summarizeApprovals, summarizeCi } from '../src/review-gate';
import { classifyRisk } from '../src/risk';
import {
  canPublishTier1,
  leadsPublishTier1On,
  publishedWithoutReview,
  tier1Domain,
  tier1PublishedBy,
  tier1PublishReviewBody,
  tier1PublishSentence,
  TIER1_PUBLISH_HEADING,
} from '../src/tier1-publish';

describe('governance.leadsPublishTier1', () => {
  it('counts as on when absent, keeps an explicit off, and refuses anything but true or false', () => {
    const on = loadConfig({ repo: 'acme/ds' });
    expect(on.governance.leadsPublishTier1).toBeUndefined();
    expect(leadsPublishTier1On(on.governance)).toBe(true);
    expect(siteRepoFromConfig(on).leadsPublishTier1).toBe(true);
    const off = loadConfig({ repo: 'acme/ds', governance: { leadsPublishTier1: false } });
    expect(leadsPublishTier1On(off.governance)).toBe(false);
    expect(siteRepoFromConfig(off).leadsPublishTier1).toBe(false);
    expect((toConfigJson(off).governance as { leadsPublishTier1?: boolean }).leadsPublishTier1).toBe(false);
    expect(() => loadConfig({ governance: { leadsPublishTier1: 'yes' } } as never)).toThrow(/governance\.leadsPublishTier1/);
  });

  it('is in the published schema, on by default', () => {
    const schema = JSON.parse(readFileSync(new URL('../bridge.config.schema.json', import.meta.url), 'utf8'));
    const prop = JSON.stringify(schema).includes('"leadsPublishTier1"');
    expect(prop).toBe(true);
    const find = (o: unknown): { type?: string; default?: unknown } | null => {
      if (!o || typeof o !== 'object') return null;
      const rec = o as Record<string, unknown>;
      if (rec.leadsPublishTier1) return rec.leadsPublishTier1 as { type?: string; default?: unknown };
      for (const v of Object.values(rec)) {
        const hit = find(v);
        if (hit) return hit;
      }
      return null;
    };
    expect(find(schema)).toMatchObject({ type: 'boolean', default: true });
  });

  it('changing it is a Tier 3 change: bridge.config.json is a guardrail file', () => {
    expect(classifyRisk({ files: [{ path: 'bridge.config.json' }] }).tier).toBe(3);
  });
});

describe('who publishes a Tier 1 change without review', () => {
  const approvers = { design: ['dana'], tech: ['theo'] };
  const base = { tier: 1 as const, domain: 'design' as const, approvers, admin: false, enabled: true };

  it('reads the domain from the files: design for docs and guidance, tech for stories and tests', () => {
    expect(tier1Domain(['packages/react/src/components/Button/Button.docs.json'])).toBe('design');
    expect(tier1Domain(['docs/USAGE.md', '.changeset/x.md'])).toBe('design');
    expect(tier1Domain(['packages/react/src/components/Button/Button.stories.tsx'])).toBe('tech');
    expect(tier1Domain(['packages/react/src/components/Button/Button.docs.json', 'packages/react/src/components/Button/Button.test.tsx'])).toBe('tech');
  });

  it('lets team admins and the matching reviewer publish, nobody else', () => {
    expect(canPublishTier1({ ...base, viewer: 'dana' })).toBe(true);
    expect(canPublishTier1({ ...base, viewer: '@Dana' })).toBe(true);
    expect(canPublishTier1({ ...base, viewer: 'theo' })).toBe(false);
    expect(canPublishTier1({ ...base, viewer: 'theo', domain: 'tech' })).toBe(true);
    expect(canPublishTier1({ ...base, viewer: 'sam' })).toBe(false);
    expect(canPublishTier1({ ...base, viewer: 'sam', admin: true })).toBe(true);
  });

  it('never for Tier 2 or 3, signed out, or when the team turned it off', () => {
    expect(canPublishTier1({ ...base, viewer: 'dana', tier: 2 })).toBe(false);
    expect(canPublishTier1({ ...base, viewer: 'dana', tier: 3 })).toBe(false);
    expect(canPublishTier1({ ...base, viewer: 'dana', tier: null })).toBe(false);
    expect(canPublishTier1({ ...base, viewer: null, admin: true })).toBe(false);
    expect(canPublishTier1({ ...base, viewer: 'dana', enabled: false })).toBe(false);
    expect(canPublishTier1({ ...base, viewer: 'sam', admin: true, enabled: false })).toBe(false);
  });

  it('never matches a team entry not read yet as a person', () => {
    expect(canPublishTier1({ ...base, viewer: 'acme/design', approvers: { design: ['@acme/design'], tech: [] } })).toBe(false);
  });
});

describe('the record', () => {
  it('says who published it without review, and reads it back', () => {
    expect(publishedWithoutReview('Dana Reyes')).toBe('Published by Dana Reyes without review (Tier 1).');
    const body = tier1PublishReviewBody('Dana Reyes', '@dana');
    expect(body.startsWith(TIER1_PUBLISH_HEADING)).toBe(true);
    expect(tier1PublishedBy(body)).toBe('Dana Reyes');
    expect(tier1PublishedBy('Looks good')).toBeNull();
    expect(tier1PublishedBy(null)).toBeNull();
  });

  it('describes the rule for the CLI and the MCP server, on and off, without an em dash', () => {
    expect(tier1PublishSentence(true)).toMatch(/team admins and the reviewers of that part publish it without review/);
    expect(tier1PublishSentence(false)).toMatch(/Tier 1 needs one owner approval/);
    for (const t of [tier1PublishSentence(true), tier1PublishSentence(false), tier1PublishReviewBody('A', 'a')]) expect(t).not.toMatch(/—/);
  });
});

describe('the verdict on a published Tier 1 change', () => {
  const owners = { design: ['dana'], tech: ['theo'] };
  const green = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'success' }]);
  const running = summarizeCi([{ name: 'CI', status: 'in_progress', conclusion: null }]);
  const red = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'failure' }]);
  const none = summarizeApprovals([], owners, 'dana');
  const base = { tier: 1 as const, owners, state: 'open', draft: false, mergeable: true, approvals: none, autoMerge: true, tier1Published: true };

  it('is on its way while the checks run or pass', () => {
    expect(branchVerdict({ ...base, ci: running }).autoShip).toBe(true);
    expect(branchVerdict({ ...base, ci: green }).autoShip).toBe(true);
  });

  it('falls back to review when a check fails, when it is not armed, or above Tier 1', () => {
    expect(branchVerdict({ ...base, ci: red }).autoShip).toBe(false);
    expect(branchVerdict({ ...base, ci: green, autoMerge: false }).autoShip).toBe(false);
    expect(branchVerdict({ ...base, ci: green, tier: 2 }).autoShip).toBe(false);
    expect(branchVerdict({ ...base, ci: green, tier1Published: false }).autoShip).toBe(false);
  });
});
