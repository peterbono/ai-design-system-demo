// The team's Figma file (bridge.config.json `figma.file`): the words of Settings > Figma file and of the component
// page's Figma line, the name a link shows, and the format-preserving edit of the file that a config pull request
// carries (scripts/roles.ts proposeFigmaFile, the same path as the team name). Designers never read "key" or "JSON":
// it is "your Figma file". Pure, covered by figma-file.test.ts.
import { fromPlain, getEntry, parseFigmaFile, parseJson, serializeJson, type JsonObject } from '@bridge-ds/core';

export const FIGMA_FILE_WORDS = {
  label: 'Figma file',
  help: 'Where your design system lives in Figma. Claude opens it to link your components to their Figma components.',
  placeholder: 'Paste the link of your Figma file',
  notSet: 'Not set yet.',
  /** An admin signed in by email: the file is a change to the design system's settings on GitHub. */
  githubOnly: 'A lead or an admin signed in with GitHub sets the Figma file.',
  requested: 'Sent for review',
  applies: 'It applies once your team approves it.',
  /** The team shell's band. */
  bandTitle: 'Figma',
  bandIntro: 'The Figma file your design system lives in, so each component links to its Figma component.',
  /** The component page. */
  inFigma: 'In Figma:',
  notLinked: 'Not linked to Figma yet.',
  howToLink: 'Ask Claude: "Link our Library components to Figma with Bridge."',
  setFileFirst: 'Add your Figma file in Settings first',
} as const;

/** The file name a Figma link carries (/design/<key>/<Name>), else "Open in Figma". */
export function figmaFileLabel(value: string): string {
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const name = /figma\.com$/i.test(url.hostname) && /^(design|file)$/.test(parts[0] ?? '') ? (parts[2] === 'branch' ? parts[4] : parts[2]) : undefined;
    if (name) return decodeURIComponent(name).replace(/-/g, ' ').trim() || 'Open in Figma';
  } catch {
    /* a key alone */
  }
  return 'Open in Figma';
}

/** bridge.config.json with `figma.file` set to `value` (trimmed); the rest byte for byte. */
export function withFigmaFile(configText: string, value: string): string {
  const file = value.trim();
  if (!parseFigmaFile(file)) throw new Error('Paste a link to a Figma file.');
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('The Bridge settings file is not readable.');
  const root = doc.root as JsonObject;
  const entry = getEntry(root, 'figma');
  const inner = entry?.value.kind === 'object' ? getEntry(entry.value, 'file') : undefined;
  if (inner?.value.kind === 'string' && inner.value.value === file) return configText;
  const node = fromPlain({ file }, undefined, true);
  if (entry) entry.value = node;
  else root.entries.push({ key: 'figma', value: node });
  root.raw = undefined;
  return serializeJson(doc);
}

/** Branch, title, body and commit message of the pull request that sets the team's Figma file. */
export function figmaFileProposal(value: string, opts: { date: Date; prefix?: string; tierLabel: string }): { branch: string; title: string; body: string; message: string } {
  const file = value.trim();
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const title = 'chore(config): set the team Figma file';
  const body = [
    '## The team Figma file',
    '',
    `Sets \`figma.file\` to ${file} in \`bridge.config.json\`.`,
    '',
    '- Claude reads it (bridge_get_config) to find the Figma components to link in `bridge.components.json`.',
    '- Component pages show "In Figma" once a component is linked.',
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio.',
  ].join('\n');
  return { branch: `${opts.prefix ?? ''}figma-file-${stamp}`, title, body, message: `${title}\n\nProposed from Bridge Studio.` };
}
