// "Change this component" on a team (components/ds/studio/ChangeComponent.tsx): files one build request on the team's
// repository with the viewer's session, the same issue the Figma plugin files (@bridge-ds/core
// createBuildRequestOnGitHub). A GitHub member writes it with their own token; an email member goes through Bridge's
// server (/api/contribute, which allows POST issues and adds "Requested by <name> through Bridge."). The labels and
// assignees of bridge.config.json integrations.requests apply, like on Bridge's own drawer. Being built reads it next.
import { createBuildRequestOnGitHub, type BuildRequestInput, type IntegrationsConfig, type PublishOutcome } from '@bridge-ds/core';
import { buildCacheKey } from '../lib/building-view';
import { getToken, studioClient } from './github-session';

/** Being built reads the lists again after a send, so the new request shows there at once. */
export function forgetBuildLists(repo: string) {
  for (const what of ['requests', 'builds'] as const) {
    try {
      sessionStorage.removeItem(buildCacheKey(repo, what));
    } catch {
      /* storage blocked: the cache was never kept either */
    }
  }
}

/** Files the build request on `repo` ("owner/name"). Throws what GitHub or Bridge's server said. */
export async function sendBuildRequest(repo: string, input: BuildRequestInput, opts: { integrations?: IntegrationsConfig | undefined; componentUrl?: string | undefined } = {}): Promise<PublishOutcome> {
  const cfg = opts.integrations?.requests ?? {};
  const gh = studioClient(repo, getToken());
  const out = await createBuildRequestOnGitHub(gh, input, {
    labels: cfg.labels ?? [],
    assignees: cfg.assignees ?? [],
    ...(opts.componentUrl ? { componentUrl: opts.componentUrl } : {}),
  });
  forgetBuildLists(repo);
  return out;
}
