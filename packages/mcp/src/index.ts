#!/usr/bin/env node
// bridge-mcp: stdio MCP server. `npx @bridge-ds/mcp` or `node packages/mcp/dist/index.js [--root dir | --repo owner/name]`.
import { optionsFromArgv, serveStdio, VERSION } from './lib.js';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`bridge-mcp ${VERSION}: Bridge design system MCP server (stdio)

Usage:
  bridge-mcp [--root <dir>]                 local repo (default: current directory)
  bridge-mcp --repo <owner/name> [--ref r]  GitHub repo over the API

Env:
  GITHUB_TOKEN   optional (or BRIDGE_GITHUB_TOKEN). Without it Bridge is read-only on GitHub; a local git
                 repo still gets local bridge/* branches, never pushed. With it Bridge files suggestions and
                 requests (issues), reviews, comments, branches and pull requests, never the default branch.
                 Use a fine-grained token scoped to one repo. bridge_get_config says what this server may write.
`);
  process.exit(0);
}
if (argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

serveStdio(optionsFromArgv(argv)).catch((e: Error) => {
  process.stderr.write(`bridge-mcp: ${e.message}\n`);
  process.exit(1);
});
