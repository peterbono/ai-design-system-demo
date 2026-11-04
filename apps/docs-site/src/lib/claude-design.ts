// The team's Bridge Library in Claude Design, as Settings > Your AI tools shows it to admins: one quiet line,
// "Claude Design: Bridge Library 1.8.4 · Update available", and "Copy the request for Claude", the words a person
// pastes in Claude (with Bridge connected) so Claude adds or updates the Library there. Bridge never publishes it
// itself: artifacts are published from a Claude session (packages/mcp claude-design.ts has the tools).
//
// The version comes from the manifest this site serves (/claude-design-system/manifest.json, written by
// scripts/claude-design-system/release.mjs); the team's artifact from api/entry `?claude-design=<team>` (admins only).
// Pure, no DOM: covered by claude-design.test.ts. Designers never see these words: the line is for admins.

/** The Library the site serves now (from its manifest). */
export interface ServedLibrary {
  name: string;
  version: string;
}

/** What the team keeps about its Library in Claude Design (saved through Claude by an admin or lead). */
export interface TeamLibraryInClaude {
  url: string;
  version: string;
}

export type ClaudeDesignStatus = 'new' | 'update' | 'current';

export interface ClaudeDesignLine {
  /** "Claude Design: Bridge Library 1.8.4 · Update available" */
  text: string;
  /** The same without the label, for the settings row ("Bridge Library 1.8.4 · Update available"). */
  value: string;
  status: ClaudeDesignStatus;
  /** What "Copy the request for Claude" copies; null when there is nothing to do. */
  request: string | null;
}

export const CLAUDE_DESIGN_WORDS = {
  label: 'Claude Design',
  status: { new: 'Not added yet', update: 'Update available', current: 'Up to date' } satisfies Record<ClaudeDesignStatus, string>,
  copy: 'Copy the request for Claude',
  copied: 'Copied. Paste it in Claude with Bridge connected.',
} as const;

/** The manifest the site serves, read loosely: name and version, else null (the line stays hidden). */
export function parseServedLibrary(v: unknown): ServedLibrary | null {
  const m = v as { name?: unknown; version?: unknown } | null;
  if (!m || typeof m !== 'object' || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) return null;
  return { name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : 'Bridge Library', version: m.version };
}

/** The words Claude gets: call the Bridge tool, publish (only what changed), remember the link, refresh the canvases. */
export function claudeDesignRequest(served: ServedLibrary, team: TeamLibraryInClaude | null): string {
  if (!team)
    return `Add our ${served.name} ${served.version} to Claude Design: call the Bridge tool bridge_get_claude_design_system, create the Design System artifact it describes, then save its link for the team with bridge_set_claude_design_system_url.`;
  return `Update our ${served.name} in Claude Design to ${served.version}: call the Bridge tool bridge_get_claude_design_system, republish only the files that changed to our Design System artifact ${team.url} (never a new one), save it with bridge_set_claude_design_system_url, then re-run the install at ${served.version} in the canvases that use it.`;
}

/** The line, or null when this viewer does not see it (not an admin, or the site serves no Library). */
export function claudeDesignLine(x: { admin: boolean; served: ServedLibrary | null; team: TeamLibraryInClaude | null }): ClaudeDesignLine | null {
  if (!x.admin || !x.served) return null;
  const status: ClaudeDesignStatus = !x.team ? 'new' : x.team.version === x.served.version ? 'current' : 'update';
  const value = `${x.served.name} ${x.served.version} · ${CLAUDE_DESIGN_WORDS.status[status]}`;
  return {
    text: `${CLAUDE_DESIGN_WORDS.label}: ${value}`,
    value,
    status,
    request: status === 'current' ? null : claudeDesignRequest(x.served, x.team),
  };
}
