// Builds the Figma side of the gallery shot: the variables a Pull from this repo creates (same planner and
// simulated Figma as the flow tests), plus the edits a designer makes in Figma before a Push. Run by render.mjs.
import { writeFileSync } from 'node:fs';
import { analyze, buildPull } from '../../src/sync/flows';
import { DEFAULT_SETTINGS } from '../../src/shared/messages';
import { FakeGitHub } from '../../test/fake-github';
import { applyPlanToSnapshot, findIn, modeId } from '../../test/figma-sim';
import { realChecksText, realConfigText, realFiles } from '../../test/helpers';

const PREFIX = DEFAULT_SETTINGS.tokensPath;
const files: Record<string, string> = { 'bridge.config.json': realConfigText(), [`${PREFIX}/contrast.checks.json`]: realChecksText() };
for (const [rel, text] of Object.entries(realFiles())) files[`${PREFIX}/${rel}`] = text;

const client = new FakeGitHub(files).client();
const a = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Bridge tokens', collections: [], variables: [] });
const snap = applyPlanToSnapshot(buildPull(a, new Map()).plan);
snap.fileName = 'Bridge tokens';

/** Point a Semantic Light variable at another Brand palette role, as a designer does in the variables panel. */
const repoint = (name: string, target: string) => {
  findIn(snap, 'Semantic', name).valuesByMode[modeId(snap, 'Semantic', 'Light')] = { kind: 'alias', id: findIn(snap, 'Brand', target).id };
};
for (const arg of process.argv.slice(3)) {
  const [name, target] = arg.split('=');
  repoint(name!, target!);
}
writeFileSync(process.argv[2]!, JSON.stringify(snap));
console.log(`snapshot: ${snap.variables.length} variables in ${snap.collections.length} collections`);
