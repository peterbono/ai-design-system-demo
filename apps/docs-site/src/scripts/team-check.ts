// The access check "Create a new team" (NewTeamDialog.tsx) shows as you type: the session's resolver, anonymous when
// signed out (one read per repository, cached). Shared by the team chip and the demo's "Use your own repo".
import type { TeamAccessCheck } from '../components/ds/studio/NewTeamDialog';

export const teamAccessCheck: TeamAccessCheck = async (o, r) => {
  const { resolveAccess } = await import('./github-session');
  const a = await resolveAccess({ owner: o, repo: r }, { anonymous: true, probe: true });
  return a && { state: a.state, repoAdmin: a.repoAdmin };
};
