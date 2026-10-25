// Mounts the "Motion changes" block of a branch review into a host element: reads the token sets and the component
// specs at the change's base and head commits, computes the motion changes (lib/motion-changes.ts) and renders
// components/ds/studio/MotionChanges. Renders nothing (and empties the host) when the branch changes no motion.
//
//   import { mountMotionChanges } from './reviews/motion-changes';
//   const unmount = await mountMotionChanges(host, { owner, repo, baseSha: pull.base.sha, headSha: pull.head.sha });
//
// The review page decides when to call it (the change touches token files or packages/react). Errors are swallowed:
// motion is a supporting block, the review reads without it.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { contextFor, parseComponentSpecs, resolve, type ComponentSpecsFile, type TokenSet } from '@bridge-ds/core';
import MotionChanges from '../../components/ds/studio/MotionChanges';
import { motionChanges, type MotionChange } from '../../lib/motion-changes';
import { ghGet } from '../github-session';
import { tokenSetsOf } from './token-review';

export const SPECS_PATH = 'packages/react/component-specs.json';

async function specsAt(owner: string, repo: string, sha: string): Promise<ComponentSpecsFile | null> {
  try {
    const r = await ghGet<string>(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${SPECS_PATH}`, { raw: true });
    return parseComponentSpecs(r.data);
  } catch {
    return null;
  }
}

/** The alias chain of a token on the branch, so a primitive change finds the components using its motion tokens. */
export const chainIn = (set: TokenSet) => (path: string) => {
  const t = set.byPath.get(path);
  const mode = t ? Object.keys(t.values)[0] : undefined;
  return t && mode !== undefined ? resolve(set.byPath, path, contextFor(set, t.tier, mode)).chain : [path];
};

/** The motion changes of a change, from GitHub: token sets and component specs at its base and head. */
export async function readMotionChanges(input: { owner: string; repo: string; baseSha: string; headSha: string }) {
  const [sets, baseSpecs, headSpecs] = await Promise.all([tokenSetsOf(input), specsAt(input.owner, input.repo, input.baseSha), specsAt(input.owner, input.repo, input.headSha)]);
  const changes: MotionChange[] = motionChanges({ base: sets.base, head: sets.head, baseSpecs, headSpecs });
  return { changes, specs: headSpecs ?? baseSpecs, chainOf: chainIn(sets.head) };
}

/** Renders the block into `host`; resolves to an unmount function. Empty host when nothing about motion changes. */
export async function mountMotionChanges(host: HTMLElement, input: { owner: string; repo: string; baseSha: string; headSha: string }): Promise<() => void> {
  let data: Awaited<ReturnType<typeof readMotionChanges>>;
  try {
    data = await readMotionChanges(input);
  } catch {
    host.replaceChildren();
    return () => {};
  }
  if (!data.changes.length) {
    host.replaceChildren();
    return () => {};
  }
  const root = createRoot(host);
  root.render(createElement(MotionChanges, data));
  return () => root.unmount();
}
