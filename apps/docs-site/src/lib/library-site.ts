// The data Bridge's own Library pages hand the shared Library views (components/ds/library/views/): the build-time
// repo model, no team (the site's own Library), and the extras only this build knows: the released version, the
// group usage notes of token-usage.json and, on the dev server, the failing contrast fixture.
import type { LibraryData, LibraryExtras } from '../components/ds/library/library-data';
import { versionInfo } from './changelog';
import { FAILING_FIXTURE } from './contrast';
import { repoModel } from './model';
import { groupNotes } from './sources';

let version: string | undefined;

export function siteLibraryData(extras: LibraryExtras = {}): LibraryData {
  version ??= versionInfo().current;
  return { model: repoModel, team: null, extras: { version, groupNotes: groupNotes(), ...extras } };
}

/** The dev server's failing contrast fixture (lib/contrast.ts pagePairs), never in a build. */
export const devContrastFixture = (dev: boolean) => (dev && process.env.BRIDGE_CONTRAST_FIXTURE === 'fail' ? FAILING_FIXTURE : undefined);
