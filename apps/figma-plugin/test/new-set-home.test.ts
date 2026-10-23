// A file organised by hand (a page per family, sections): a new set goes next to the set its name extends, in that
// set's page and section, not on the Components page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma, type SimNode } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const pageOf = (n: SimNode): SimNode => (n.type === 'PAGE' ? n : pageOf(n.parent!));

test('Select moved into a section of a Forms page: Select/Popup is built in that section, below it; Accordion stays on Components', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  const only = (names: string[]) => JSON.stringify({ ...main, coverage: undefined, components: main.components.filter((c) => names.includes(c.name)) });
  files['packages/react/component-specs.json'] = only(['Select', 'Accordion']);
  const gh = new FakeGitHub(files);
  const client = gh.client();
  const pull = async () => {
    const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
    await applyPullPlan(buildPull(a, new Map()).plan);
    const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
    return applyComponentPlan(writablePlan(buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head)));
  };
  await pull();
  const figma = (globalThis as unknown as { figma: { createPage: () => SimNode; createSection: () => SimNode } }).figma;
  const forms = figma.createPage();
  forms.name = 'Forms';
  const section = figma.createSection();
  forms.appendChild(section);
  section.resize(800, 300);
  const select = sim.sets().find((s) => s.name === 'Select')!;
  section.appendChild(select);
  select.x = 40;
  select.y = 40;

  gh.pushToMain((f) => (f['packages/react/component-specs.json'] = only(['Select', 'Select/Popup', 'Accordion', 'AccordionItem'])));
  const report = await pull();
  assert.deepEqual(report.failed, []);
  const popup = sim.sets().find((s) => s.name === 'Select/Popup')!;
  assert.equal(popup.parent, section, 'in the section Select is in');
  assert.equal(popup.x, select.x);
  assert.ok(popup.y >= select.y + select.height, 'below Select');
  assert.ok(section.height >= popup.y + popup.height, 'the section grew to hold it');
  // Accordion is still on the Components page: its new item goes there too.
  const item = sim.sets().find((s) => s.name === 'AccordionItem')!;
  assert.equal(pageOf(item).name, 'Components');
  assert.equal(sim.sets().length, 4);
});
