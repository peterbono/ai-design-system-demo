// Settings, Claude: the team's own Claude, connected by a team admin (components/ds/studio/ClaudeSection.tsx, the server
// is api/claude). Words and the small rules the section shows; pure, so tests read them.
//
// What is true, and so what the words say (settled rule "Claude copy must be true"): the key is the team's Anthropic
// API key, so Claude's work is billed to the team's Anthropic account; Bridge keeps it encrypted on its server and
// never shows it again; Claude proposes fixes and a person on the team reviews each one. Nothing here says Claude ships
// anything on its own.

export const CLAUDE_CONNECT_WORDS = {
  title: 'Claude',
  intro: "Connect your team's Claude so it can fix differences for you. When a component in Figma does not match the code, Claude proposes a fix and someone on your team reviews it.",
  row: "Your team's Claude",
  notConnected: 'Not connected.',
  notConnectedHelp: "Paste your team's Anthropic API key. Bridge keeps it encrypted and never shows it again.",
  billed: "Claude's work is billed to your team's Anthropic account.",
  connect: 'Connect Claude',
  connectSubmit: 'Connect',
  cancel: 'Cancel',
  disconnect: 'Disconnect',
  keyLabel: 'Anthropic API key',
  keyHint: 'From the Claude Console, under API keys. It starts with sk-ant-.',
  connected: (name: string, date: string) => (name ? `Connected, added by ${name} on ${date}.` : `Connected on ${date}.`),
  saved: 'Connected. Claude can now fix differences for your team.',
  removed: 'Disconnected. Claude no longer fixes differences for your team.',
  unavailable: 'Connecting Claude is not available yet on this site.',
  noRepo: "Connect your design system first. Then connect your team's Claude.",
  readError: 'Bridge could not read your Claude connection. Try again in a minute.',
  adminDoes: 'can connect it',
  sample: 'On the sample team, nothing is connected.',
} as const;

/** "Oct 25, 2026" for a connection date; the date as given when it does not read. */
export function connectedDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** An Anthropic API key as pasted: trimmed, spaces and line breaks gone. Same pattern as the server (api/_lib/claude-key). */
export function cleanKey(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export const looksLikeKey = (key: string): boolean => /^sk-ant-[A-Za-z0-9_-]{16,256}$/.test(key);

/** The connection as the section shows it. */
export interface ClaudeConnectionView {
  /** This site can store a key (the server answers and is set up). */
  available: boolean;
  connected: boolean;
  addedBy?: string;
  at?: string;
  canManage: boolean;
}
