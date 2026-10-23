// The team's display name (bridge.config.json `name`): the words of the setup step and of Settings > General, the
// check on what someone typed, and the format-preserving edit of the file that a config pull request carries
// (scripts/roles.ts proposeTeamName, the same path as `changes`). Which name a team goes by everywhere is
// teamDisplayName in lib/demo.ts. Pure, covered by team-name.test.ts.
import { fromPlain, getEntry, parseJson, serializeJson, teamName, TEAM_NAME_MAX, toPlain, type JsonObject } from '@bridge-ds/core';

export const TEAM_NAME_WORDS = {
  stepTitle: 'Name your team',
  stepLine: 'How your team shows up in Bridge',
  lead: 'A name people recognize, instead of the repository.',
  label: 'Team name',
  help: 'Your team sees it in Studio, the Library and invitations.',
  save: 'Save name',
  later: 'Do this later',
  /** Settings > General */
  generalTitle: 'General',
  generalIntro: 'How your team shows up for everyone in Bridge.',
  readOnly: 'Only an admin of the repository changes it.',
  notSet: 'Not set yet, Bridge uses the repository name.',
  requested: 'Sent for review',
  applies: 'It applies once your team approves and merges the branch.',
} as const;

/** What is wrong with a typed name, in one sentence; null when it can be saved. */
export function teamNameProblem(value: string): string | null {
  if (!value.trim()) return 'Type a name for your team.';
  if (value.trim().replace(/\s+/g, ' ').length > TEAM_NAME_MAX) return `Keep it to ${TEAM_NAME_MAX} characters.`;
  return null;
}

/** bridge.config.json with `name` set to `value` (cleaned), right after `version`; the rest byte for byte. */
export function withTeamName(configText: string, value: string): string {
  const name = teamName(value);
  if (!name) throw new Error(teamNameProblem(value) ?? 'Type a name for your team.');
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('bridge.config.json is not a JSON object.');
  const root = doc.root as JsonObject;
  const entry = getEntry(root, 'name');
  if (entry && toPlain(entry.value) === name) return configText;
  const node = fromPlain(name, entry?.value, true);
  if (entry) entry.value = node;
  else {
    const at = root.entries.findIndex((e) => e.key === 'version');
    root.entries.splice(at >= 0 ? at + 1 : 0, 0, { key: 'name', value: node });
  }
  root.raw = undefined;
  return serializeJson(doc);
}

/** Branch, title, body and commit message of the pull request that names the team. */
export function teamNameProposal(value: string, opts: { date: Date; prefix?: string; tierLabel: string }): { branch: string; title: string; body: string; message: string } {
  const name = teamName(value) ?? value.trim();
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'team';
  const title = `chore(config): name the team ${JSON.stringify(name)}`;
  const body = [
    '## The team name',
    '',
    `Sets \`name\` to ${JSON.stringify(name)} in \`bridge.config.json\`.`,
    '',
    '- Studio, the Library and invitations show it instead of the repository name.',
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio.',
  ].join('\n');
  return { branch: `${opts.prefix ?? ''}team-name-${slug}-${stamp}`, title, body, message: `${title}\n\nProposed from Bridge Studio.` };
}
