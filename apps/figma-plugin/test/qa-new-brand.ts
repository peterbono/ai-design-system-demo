// Data for the QA harness of the "New brand detected" card (scripts/qa-new-brand.mjs): the real token files as a
// fake GitHub repo, and a Figma snapshot pulled from it with an extra "Acme" mode in the Brand collection.
import { analyze, buildPull } from '../src/sync/flows';
import { DEFAULT_SETTINGS, type FigmaSnapshot } from '../src/shared/messages';
import { FakeGitHub } from './fake-github';
import { addBrandMode, applyPlanToSnapshot, setBrandColor } from './figma-sim';
import { realChecksText, realConfigText, realFiles } from './helpers';

export async function newBrandHarnessData(): Promise<{ files: Record<string, string>; headSha: string; snapshot: FigmaSnapshot }> {
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const gh = new FakeGitHub(files);
  const a = await analyze(gh.client(), DEFAULT_SETTINGS, {}, { fileName: 'Bridge tokens', collections: [], variables: [] });
  const snapshot = applyPlanToSnapshot(buildPull(a, new Map()).plan);
  snapshot.fileName = 'Bridge tokens';
  addBrandMode(snapshot, 'Acme');
  setBrandColor(snapshot, 'palette/primary/700', 'Acme', '#1F5F3A');
  return { files, headSha: a.headSha, snapshot };
}
