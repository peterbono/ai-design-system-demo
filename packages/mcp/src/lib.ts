// Public API of @bridge-ds/mcp, used by the `bridge` CLI.
import { execFileSync } from 'node:child_process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { BridgeContext, type ContextOptions } from './context.js';
import { createServer, type ServerOptions, VERSION } from './server.js';
import { linkedOptions } from './product-link.js';

export { BridgeContext, type ContextOptions } from './context.js';
export { findProductLink, GIT_CONFIG_KEYS, linkedOptions, parseProductPointer, PRODUCT_POINTER, type ProductLink, type ProductPointer } from './product-link.js';
export { BlockedError, isBlocked, say } from './say.js';
export { createServer, SERVER_INFO, VERSION, type ServerOptions } from './server.js';
export { CONFIG_FILE, detectConfig, parseConfig, toConfigJson, type BridgeConfig } from './config.js';
export { core } from './core-adapter.js';
export { LocalSource, GitRefSource, GitHubSource, type RepoSource } from './source.js';
export { auditSnippet } from './audit.js';
export * as ops from './ops.js';
export * as history from './history.js';
export * as brand from './brand.js';
export * as requests from './requests.js';
export * as buildRequests from './build-requests.js';
export * as explorations from './explorations.js';
export * as drafts from './drafts.js';
export * as branches from './branches.js';
export * as studio from './studio.js';
export * as pieces from './pieces.js';
export * as figma from './figma.js';
export * as figmaFixes from './figma-fixes.js';
export * as suggestions from './suggestions.js';
// The docs logic the docs-draft GitHub Action (scripts/docs-draft.mjs) runs, from the core compiled into this bundle:
// the workflow builds the MCP library, not core.
export { DOCS_DRAFT_MODEL, anthropicReplyText, anthropicRequest, formatDocsJson, mergeDocsDraft, missingProse, parseDocsReply } from '@bridge-ds/core';

/** Where the server's GitHub token came from: the environment, the gh sign-in, or nowhere. Never the token itself. */
export type TokenSource = 'env' | 'gh' | 'none';

export interface ServeOptions extends ContextOptions {
  tokenSource?: TokenSource;
}

/** The gh sign-in (`gh auth token`), or undefined when gh is missing or signed out. Never logged. */
export function ghAuthToken(): string | undefined {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Said once at start, on stderr: where the token came from, or what the server does without one. Never the token. */
export function tokenNote(source: TokenSource | undefined): string | undefined {
  if (source === 'gh') return 'GitHub token: your gh sign-in (gh auth token), since GITHUB_TOKEN and BRIDGE_GITHUB_TOKEN are not set.';
  if (source === 'none')
    return 'No GitHub token: GITHUB_TOKEN and BRIDGE_GITHUB_TOKEN are not set and gh is not signed in. Bridge reads GitHub without a token (60 requests an hour) and cannot write there. Set GITHUB_TOKEN where the server runs, or run gh auth login, then restart the server.';
  return undefined;
}

/**
 * One Streamable HTTP request to a Bridge MCP server (the hosted connector, apps/docs-site/api/mcp): stateless, a
 * server per request on `ctx` (a remote repo with the signed-in person's GitHub token), JSON answers, no session id.
 * `parsedBody` is the JSON-RPC body when the caller already read it; `opts.exclude` leaves tools out (createServer).
 *
 * The first POST of a Claude session answers 400, on purpose. Bridge speaks the initialize-based ("legacy") MCP
 * revisions up to 2025-11-25, the newest the SDK supports. Claude is a dual-era client: it first tries a request of the
 * stateless 2026-07-28 revision (no initialize, `MCP-Protocol-Version: 2026-07-28`), the SDK rejects that version with
 * 400 and a plain -32000 error, and Claude falls back to initialize (200), notifications/initialized (202), tools/list
 * (200). That 400 is the era detection the spec defines (2026-07-28 Streamable HTTP, Backward Compatibility; Versioning,
 * compatibility matrix "Dual-era client, Legacy server"): a 4xx without a recognized modern error means "fall back".
 * Never answer it with a modern error (UnsupportedProtocolVersionError -32022, HeaderMismatch -32020): Claude would
 * then treat Bridge as a 2026-07-28 server and retry instead of falling back. The 400 goes away only when Bridge
 * implements 2026-07-28 itself (server/discover, per-request _meta), which needs an SDK that supports it.
 */
export async function handleHttp(ctx: BridgeContext, req: Request, parsedBody?: unknown, opts: ServerOptions = {}): Promise<Response> {
  const server = createServer(ctx, opts);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, parsedBody === undefined ? {} : { parsedBody });
  } finally {
    await server.close().catch(() => {});
  }
}

/** Starts the stdio MCP server. Logs go to stderr: stdout belongs to the protocol. */
export async function serveStdio(opts: ServeOptions = {}): Promise<void> {
  const { tokenSource, ...context } = opts;
  // Started inside a connected product repository (.bridge/product.json, `bridge connect`): the design system it names,
  // read from GitHub, with this checkout and its product.
  const ctx = await BridgeContext.create(await linkedOptions(context.root ?? process.cwd(), context));
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`bridge-mcp ${VERSION}: ${ctx.describe()}\n`);
  const note = tokenNote(tokenSource);
  if (note) process.stderr.write(`bridge-mcp: ${note}\n`);
}

/**
 * Parses `--root <dir> --repo <owner/name> --ref <ref>`. Token: BRIDGE_GITHUB_TOKEN or GITHUB_TOKEN, else the gh
 * sign-in (`gh auth token`), in the same order as the bridge CLI. `tokenSource` says which, for the start line.
 */
export function optionsFromArgv(argv: string[], env: NodeJS.ProcessEnv = process.env, gh: () => string | undefined = ghAuthToken): ServeOptions {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    return eq?.slice(flag.length + 1);
  };
  const fromEnv = env.BRIDGE_GITHUB_TOKEN || env.GITHUB_TOKEN || undefined;
  const token = fromEnv ?? gh();
  const tokenSource: TokenSource = fromEnv ? 'env' : token ? 'gh' : 'none';
  const root = get('--root') ?? env.BRIDGE_ROOT;
  const repo = get('--repo') ?? env.BRIDGE_REPO;
  const ref = get('--ref') ?? env.BRIDGE_REF;
  return { ...(root ? { root } : {}), ...(repo ? { repo } : {}), ...(ref ? { ref } : {}), ...(token ? { token } : {}), tokenSource };
}
