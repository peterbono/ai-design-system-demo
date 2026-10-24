// The words for "what to do next" in the reader's surface. The same operations answer Claude through the MCP server
// (tool names and their arguments) and a person in a terminal through the bridge CLI (commands and flags): a CLI user
// is never told to call a tool or pass a JSON field.
type Surface = { surface: 'mcp' | 'cli' };

/** The MCP wording or the CLI wording, for this context's reader. */
export function say(ctx: Surface, mcp: string, cli: string): string {
  return ctx.surface === 'cli' ? cli : mcp;
}

/** Where a change comes from, as the labels say ("source: cli"): what the caller passed, else this context's reader. */
export const sourceOf = (ctx: Surface, source?: 'mcp' | 'cli' | undefined): 'mcp' | 'cli' => source ?? ctx.surface;

/** The tool in pull request bodies and commit messages: "Bridge MCP" or "the bridge CLI". */
export const toolName = (source: 'mcp' | 'cli') => (source === 'cli' ? 'the bridge CLI' : 'Bridge MCP');

/** The same with its source label: "Bridge MCP (source: mcp)". */
export const toolTag = (source: 'mcp' | 'cli') => `${toolName(source)} (source: ${source})`;

/** How to give Bridge a token where it runs. */
export function addToken(ctx: Surface): string {
  return say(ctx, 'set GITHUB_TOKEN (or BRIDGE_GITHUB_TOKEN) where the Bridge MCP server runs, or run gh auth login and restart it','set GITHUB_TOKEN, pass --token <token>, or add --use-gh-auth to use your gh sign-in');
}

/** "Read-only: ... to open this as a pull request." for previews without a token. */
export function readOnlyPreview(ctx: Surface, what = 'open this as a pull request'): string {
  return `Read-only: ${addToken(ctx)} to ${what}.`;
}

/** Thrown when a rule blocks the action (the merge gate, the owner override): not a usage error. */
export class BlockedError extends Error {
  readonly blocked = true;
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

export const isBlocked = (e: unknown): e is BlockedError => Boolean(e && typeof e === 'object' && (e as { blocked?: unknown }).blocked === true);
