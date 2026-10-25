// Bridge's own Library renders from a build-time snapshot of the checkout, the shape a team publishes: it parses as
// one, and the model read back from it shows what the checkout model shows (tokens, components, contrast), with the
// releases, packages and motion a team's snapshot carries.
import { describe, expect, it } from 'vitest';
import { parseSnapshot, snapshotMotion } from '@bridge-ds/core';
import { releases } from './changelog';
import { repoModel } from './model';
import { libraryModel, sitePackages, siteSnapshot } from './site-snapshot';

describe('site snapshot', () => {
  it('is a snapshot a team shell would read', () => {
    expect(() => parseSnapshot(JSON.stringify(siteSnapshot))).not.toThrow();
    expect(siteSnapshot.repo).toMatchObject({ owner: repoModel.site.owner, name: repoModel.site.repo });
    expect(siteSnapshot.sourceSha).not.toBe('');
  });

  it('reads back to the model of the checkout', () => {
    expect(libraryModel.problems).toEqual([]);
    expect(libraryModel.tokens.rows).toEqual(repoModel.tokens.rows);
    expect(libraryModel.contrast.pairs).toEqual(repoModel.contrast.pairs);
    expect(libraryModel.config).toEqual(repoModel.config);
    expect(libraryModel.components?.list).toEqual(repoModel.components?.list);
    expect(libraryModel.components?.families).toEqual(repoModel.components?.families);
    expect(libraryModel.specs.coverage).toEqual(repoModel.specs.coverage);
  });

  it('carries the releases, packages and motion of this build', () => {
    expect(siteSnapshot.releases?.map((r) => r.name)).toEqual(releases().map((r) => r.name));
    expect(siteSnapshot.packages).toEqual(sitePackages());
    expect(siteSnapshot.packages?.map((p) => p.name)).toContain('@bridge-ds/react');
    expect(siteSnapshot.motion).toEqual(snapshotMotion(repoModel));
  });
});
