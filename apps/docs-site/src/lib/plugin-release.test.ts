// The docs send designers to one download (PLUGIN_ZIP_URL); .github/workflows/figma-plugin-release.yml publishes it.
// A renamed tag or asset on either side breaks the link, so both are read here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GITHUB_URL, PLUGIN_RELEASE_TAG, PLUGIN_ZIP, PLUGIN_ZIP_URL, ROOT } from './repo';

const workflow = readFileSync(join(ROOT, '.github/workflows/figma-plugin-release.yml'), 'utf8');
const manifest = JSON.parse(readFileSync(join(ROOT, 'apps/figma-plugin/manifest.json'), 'utf8')) as { name: string; main: string; ui: string };

describe('Figma plugin download', () => {
  it('points at the asset and release the workflow publishes', () => {
    expect(workflow).toContain(`TAG: ${PLUGIN_RELEASE_TAG}`);
    expect(workflow).toContain(`PLUGIN_ZIP: ${PLUGIN_ZIP}`);
    expect(PLUGIN_ZIP_URL).toBe(`${GITHUB_URL}/releases/download/${PLUGIN_RELEASE_TAG}/${PLUGIN_ZIP}`);
  });

  it('never takes the Latest badge from the npm package releases', () => {
    expect(workflow.match(/--latest=false/g)?.length).toBe(2);
  });

  it('names the plugin the way Figma lists it', () => {
    const page = readFileSync(join(ROOT, 'apps/docs-site/src/pages/docs/figma-plugin.astro'), 'utf8');
    expect(page).toContain(`Development &gt; ${manifest.name}</strong>`);
    expect(page).toContain('{PLUGIN_ZIP_URL}');
    expect(workflow).toContain(`Plugins > Development > ${manifest.name},`);
  });
});
