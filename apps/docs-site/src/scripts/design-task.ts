// The developers' task Done exploring opened from the design team's copy: one read of the issue.
import type { DesignTaskRead } from '../lib/review-state';
import { ghGet } from './github-session';

/** A design copy exploration's task in the developers' repository (its issue URL): null when it cannot be read. */
export async function readDesignTask(url: string): Promise<DesignTaskRead | null> {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/.exec(url.trim());
  if (!m) return null;
  try {
    const i = (await ghGet<{ assignees?: { login: string }[] | null; state: string; state_reason?: string | null; closed_at?: string | null }>(`/repos/${m[1]}/issues/${m[2]}`)).data;
    return { assignees: i.assignees ?? [], state: i.state, stateReason: i.state_reason ?? null, closedAt: i.closed_at ?? null };
  } catch {
    return null;
  }
}
