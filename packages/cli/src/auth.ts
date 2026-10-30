// Which GitHub token a bridge command uses. A write (an issue, a branch, a review, a merge, a comment) only ever uses a
// token the person passed on purpose: GITHUB_TOKEN or BRIDGE_GITHUB_TOKEN in the environment, --token, or their gh
// sign-in when they add --use-gh-auth. A read may borrow the gh sign-in, says so in one line on stderr, and that
// context refuses any write before it leaves.
import { BridgeContext, linkedOptions } from '@bridge-ds/mcp';
import type { RequestIO } from './request.js';

export interface AuthArgs {
  _: string[];
  flags: Record<string, string[]>;
}

/** read: may borrow the gh sign-in; write: only a token passed on purpose; local: no GitHub token at all. */
export type Access = 'read' | 'write' | 'local';

/** Where the token came from: --token, the environment, the gh sign-in, or none. */
export type TokenOrigin = 'flag' | 'env' | 'gh' | 'none';

/** How to give a write command a token, in the words of the CLI. */
export const WRITE_TOKEN_HOW = 'set GITHUB_TOKEN, pass --token <token>, or add --use-gh-auth to use your gh sign-in';

/** The rate-limit hint without a token, for the CLI (the MCP server names its own environment). */
export const CLI_TOKEN_HINT = 'set GITHUB_TOKEN or pass --token <token> (or add --use-gh-auth to use your gh sign-in)';

/** The help line every GitHub command shares. */
export const TOKEN_HELP = 'GitHub token: GITHUB_TOKEN or BRIDGE_GITHUB_TOKEN, or --token <token>. Writes only use a token you pass, or your gh\nsign-in with --use-gh-auth; reads may use your gh sign-in and say so on stderr. A public repo reads without one.';

/** Said once on stderr when a read borrows the gh sign-in. */
export const GH_READ_NOTE = 'Reading GitHub with your gh sign-in (gh auth token). Writes only use a token you pass: GITHUB_TOKEN, --token or --use-gh-auth.';

/** Refusal of a write in a context that only reads (gh sign-in borrowed for a read). */
export const READ_ONLY_REFUSAL = `This command only reads GitHub, with your gh sign-in, so Bridge refused to change anything there. To write, ${WRITE_TOKEN_HOW}.`;

const last = (a: AuthArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];

export function chooseToken(a: AuthArgs, io: RequestIO, access: Access): { token?: string; origin: TokenOrigin } {
  if (access === 'local') return { origin: 'none' };
  const passed = last(a, 'token');
  if (passed && passed !== 'true') return { token: passed, origin: 'flag' };
  const env = io.env.BRIDGE_GITHUB_TOKEN || io.env.GITHUB_TOKEN;
  if (env) return { token: env, origin: 'env' };
  const explicit = Boolean(a.flags['use-gh-auth']);
  // A write never falls back to the gh sign-in on its own: an audit run once filed a real issue that way.
  if (access === 'write' && !explicit) return { origin: 'none' };
  const gh = io.ghToken();
  if (!gh) return { origin: 'none' };
  if (!explicit) io.error(GH_READ_NOTE);
  return { token: gh, origin: 'gh' };
}

/**
 * The context for a command. `write`: the command may change GitHub (it still runs without a token: dry runs,
 * previews and local branches need none, and GitHub refuses the rest). `read`: it only reads; with a borrowed gh
 * sign-in every write is refused before it leaves.
 */
export async function cliContext(root: string, io: RequestIO, a: AuthArgs, access: Access): Promise<BridgeContext> {
  const { token, origin } = chooseToken(a, io, access);
  const borrowed = origin === 'gh' && !a.flags['use-gh-auth'];
  // Inside a connected product repository (.bridge/product.json): the design system it names, from GitHub.
  const place = await linkedOptions(root);
  return BridgeContext.create({
    ...place,
    ...(token ? { token } : {}),
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...(borrowed ? { readOnly: READ_ONLY_REFUSAL } : {}),
    surface: 'cli',
    tokenHint: CLI_TOKEN_HINT,
  });
}

/** Whether a write command left without a token the person passed: its failure gets the CLI's how-to line. */
export function needsWriteToken(message: string): boolean {
  return /needs a GitHub token|needs GITHUB_TOKEN|Requires authentication|Bad credentials|set GITHUB_TOKEN/i.test(message);
}
