// The data Bridge's own Library pages hand the shared Library views (components/ds/library/views/): the model read
// back from this build's snapshot (lib/site-snapshot.ts, the shape a team publishes), no team (the site's own
// Library), the snapshot's releases and motion like a team shell passes them, and the extras only this build knows:
// the released version, the group usage notes of token-usage.json, this build's Storybook and, on the dev server, the
// failing contrast fixture.
import type { LibraryData, LibraryExtras } from '../components/ds/library/library-data';
import { versionInfo } from './changelog';
import { FAILING_FIXTURE } from './contrast';
import { libraryModel, siteSnapshot } from './site-snapshot';
import { groupNotes } from './sources';
import { DEFAULT_BRANCH, GITHUB_URL, STORYBOOK_URL } from './repo';

let version: string | undefined;

export function siteLibraryData(extras: LibraryExtras = {}): LibraryData {
  version ??= versionInfo().current;
  return { model: libraryModel, team: null, extras: { version, groupNotes: groupNotes(), ...extras } };
}

/**
 * What Bridge's own component pages add (pages/components/), as a team's component pages get it: the snapshot's
 * releases and motion, the Storybook its previews load from (STORYBOOK_URL: this branch's on a preview build) and
 * where its source files open on GitHub.
 */
export const siteComponentExtras = (): LibraryExtras => ({
  storybook: STORYBOOK_URL,
  ...(siteSnapshot.releases ? { releases: siteSnapshot.releases } : {}),
  ...(siteSnapshot.motion ? { motion: siteSnapshot.motion } : {}),
  sourceBase: `${GITHUB_URL}/blob/${DEFAULT_BRANCH}/`,
});

/** The dev server's failing contrast fixture (lib/contrast.ts pagePairs), never in a build. */
export const devContrastFixture = (dev: boolean) => (dev && process.env.BRIDGE_CONTRAST_FIXTURE === 'fail' ? FAILING_FIXTURE : undefined);
