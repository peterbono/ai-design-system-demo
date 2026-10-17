// Public API of @bridge-ds/mcp, used by the `bridge` CLI.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeContext, type ContextOptions } from './context.js';
import { createServer, VERSION } from './server.js';

export { BridgeContext, type ContextOptions } from './context.js';
export { createServer, VERSION } from './server.js';
export { CONFIG_FILE, detectConfig, parseConfig, toConfigJson, type BridgeConfig } from './config.js';
export { core } from './core-adapter.js';
export { LocalSource, GitRefSource, GitHubSource, type RepoSource } from './source.js';
export { auditSnippet } from './audit.js';
export * as ops from './ops.js';
export * as history from './history.js';
export * as brand from './brand.js';
export * as requests from './requests.js';
export * as explorations from './explorations.js';
export * as drafts from './drafts.js';

export interface ServeOptions extends ContextOptions {}

/** Starts the stdio MCP server. Logs go to stderr: stdout belongs to the protocol. */
export async function serveStdio(opts: ServeOptions = {}): Promise<void> {
  const ctx = await BridgeContext.create(opts);
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`bridge-mcp ${VERSION}: ${ctx.describe()}\n`);
}

/** Parses `--root <dir> --repo <owner/name> --ref <ref>`; token from GITHUB_TOKEN or BRIDGE_GITHUB_TOKEN. */
export function optionsFromArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): ServeOptions {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    return eq?.slice(flag.length + 1);
  };
  const token = env.BRIDGE_GITHUB_TOKEN || env.GITHUB_TOKEN || undefined;
  const root = get('--root') ?? env.BRIDGE_ROOT;
  const repo = get('--repo') ?? env.BRIDGE_REPO;
  const ref = get('--ref') ?? env.BRIDGE_REF;
  return { ...(root ? { root } : {}), ...(repo ? { repo } : {}), ...(ref ? { ref } : {}), ...(token ? { token } : {}) };
}
