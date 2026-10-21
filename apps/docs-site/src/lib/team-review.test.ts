import { describe, expect, it } from 'vitest';
import { parseContrastChecks } from '@bridge-ds/core';
import { repoModel } from './model';
import { teamReviewBlocks } from './team-review';
import { contrastFailures } from './team-facts';

describe('teamReviewBlocks', () => {
  const sha = 'a'.repeat(40);
  const blocks = new Map(teamReviewBlocks({ owner: 'acme', repo: 'ds', sha, defaultBranch: 'trunk', model: repoModel }));

  it('writes every block the self-hosted review queue embeds', () => {
    expect([...blocks.keys()]).toEqual(['home-static', 'home-guidance', 'bridge-contrast', 'bridge-branches']);
  });

  it('points the branch review at the team, never the demo', () => {
    expect(blocks.get('bridge-branches')).toEqual({ owner: 'acme', repo: 'ds', defaultBranch: 'trunk', apps: {}, packages: [] });
    const { drafted } = blocks.get('home-guidance') as { drafted: { href: string }[] };
    for (const g of drafted) expect(g.href.startsWith(`https://github.com/acme/ds/blob/${sha}/`)).toBe(true);
  });

  it('counts contrast failures as the build gate does, and keeps the team pairs in the checks format', () => {
    expect(blocks.get('home-static')).toEqual({ contrastFail: contrastFailures(repoModel) });
    const pairs = parseContrastChecks(JSON.stringify(blocks.get('bridge-contrast')));
    expect(pairs).toHaveLength(repoModel.contrast.specs.length);
  });

  it('works for a repository without components or pairs', () => {
    const empty = new Map(teamReviewBlocks({ owner: 'acme', repo: 'ds', sha, defaultBranch: 'main', model: { components: null, contrast: { path: undefined, specs: [], pairs: [] } } }));
    expect(empty.get('home-guidance')).toEqual({ drafted: [] });
    expect(empty.get('home-static')).toEqual({ contrastFail: 0 });
  });
});
