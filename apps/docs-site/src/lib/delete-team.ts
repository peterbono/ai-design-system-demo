// "Delete this team" (a team made in Bridge) and "Disconnect this team from Bridge" (a repository's team): the words of
// the Danger zone at the foot of a team's Settings and of its confirm dialog (components/ds/studio/DeleteTeam.tsx), and
// the rule of the confirm field. The server (api/entry delete-team) checks the admin; nothing here is trusted.

import { isTeamKey } from './team-path';

export type DeleteKind = 'team' | 'repository';

/** A team made in Bridge (`_team/<id>`) is deleted; a repository's team is disconnected from Bridge. */
export const deleteKindOf = (team: string): DeleteKind => (isTeamKey(team) ? 'team' : 'repository');

/** The confirm field matches when it says the team's name exactly (spaces around it aside). */
export const confirmMatches = (typed: string, name: string): boolean => typed.trim() !== '' && typed.trim() === name.trim();

/** Where an admin removes the Bridge app from a repository on GitHub (its installed apps). */
export const githubAppsHref = (repo: string): string => {
  const [owner = '', name = ''] = repo.split('/');
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/settings/installations`;
};

export const DELETE_TEAM_WORDS = {
  band: 'Danger zone',
  intro: {
    team: 'What you do here cannot be undone.',
    repository: 'What you do here cannot be undone in Bridge. Your repository stays on GitHub.',
  },
  label: { team: 'Delete this team', repository: 'Disconnect this team from Bridge' },
  help: {
    team: 'Everyone on the team loses access. Invites, requests to join and connections in Claude stop working.',
    repository: 'Bridge forgets this team: its members, invites, requests to join and connections in Claude. The repository and its history stay on GitHub.',
  },
  button: { team: 'Delete this team', repository: 'Disconnect this team' },
  title: { team: (name: string) => `Delete ${name}?`, repository: (name: string) => `Disconnect ${name} from Bridge?` },
  text: {
    team: 'Everyone on the team loses access at once, and Bridge forgets its name, people and invites. This cannot be undone.',
    repository: "Everyone who joined with their email loses access at once, and Bridge forgets the team's people, invites and settings.",
  },
  github: 'The repository and its history stay on GitHub. People with access there can still open it in Bridge until an admin uninstalls the Bridge app.',
  githubLink: 'Uninstall the Bridge app on GitHub',
  confirmLabel: (name: string) => `Type ${name} to confirm`,
  cancel: 'Cancel',
  failed: 'Something went wrong. Try again in a minute.',
} as const;
