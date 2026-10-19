// The latest library as this build has it: the token files and the config the admin's own tokens.css was built from
// (the Live product side). Loaded only when changes are tried together, as one lazy chunk.
import { changeEdits, decodePicks, layoutOptions, loadConfig } from '@bridge-ds/core';
import configText from '../../../../bridge.config.json?raw';
import { together, togetherBase, togetherPairs, type TogetherBase } from './together';

// The toolbar reaches the combination through this one lazy module, so the main bundle never carries @bridge-ds/core.
export { changeEdits, decodePicks, together, togetherPairs };

const files = import.meta.glob<string>('../../../../packages/tokens/src/**/*.tokens.json', { query: '?raw', import: 'default', eager: true });

export function latestBase(tokensRoot: string): TogetherBase {
  const config = loadConfig(configText);
  const root = `${tokensRoot.replace(/^\/+|\/+$/g, '')}/`;
  const latest: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    const rel = path.replace(/^(\.\.\/)+/, '');
    if (rel.startsWith(root)) latest[rel.slice(root.length)] = text;
  }
  return togetherBase(latest, layoutOptions(config), config.modes);
}
