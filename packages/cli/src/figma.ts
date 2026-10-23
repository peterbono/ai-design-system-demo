// bridge figma: component changes sent from Figma, from the terminal. The same operations as the MCP server
// (packages/mcp/src/figma.ts), over the same @bridge-ds/core functions as the DS Bridge Figma plugin. Reads work
// without a token on a public repo; writes need one.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { branches, figma } from '@bridge-ds/mcp';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';
import { changesFlag } from './suggest.js';
import { cliContext, TOKEN_HELP, type Access } from './auth.js';

export const FIGMA_HELP = `bridge figma: component changes sent from Figma

Usage:
  bridge figma [--all] [--json]                  the library branches the DS Bridge plugin opened for components
                                                 changed in Figma, and where each stands
  bridge figma show <n> [--draft] [--json]       one of them: its spec and the brief to draft the code; --draft
                                                 runs Claude Code on the brief (\`claude\` on PATH)
  bridge figma drafted <n> [--json]              the code is pushed: label it drafted by Claude AI for review
  bridge figma push <diff.json> [--dry-run] [--json]
                                                 send a structured component diff like the plugin does: an exact
                                                 token change, or a branch with the spec for Claude AI

${TOKEN_HELP}
Exit codes: 0 ok, 2 usage or setup error.`;

const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

const context = (root: string, io: RequestIO, a: RequestArgs, access: Access) => cliContext(root, io, a, access);

function number(a: RequestArgs, usage: string): number {
  const raw = a._[2];
  if (!raw) throw new RequestUsageError(`Usage: ${usage}`);
  return branches.branchNumber(raw);
}

export async function runFigma(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (sub === 'help' || has(a, 'help')) {
    io.print(FIGMA_HELP);
    return 0;
  }
  const json = has(a, 'json');
  const writes = (sub === 'drafted' || sub === 'push') && !has(a, 'dry-run');
  const ctx = await context(root, io, a, writes ? 'write' : 'read');
  const out = (r: unknown, text: () => void) => (json ? io.print(JSON.stringify(r, null, 2)) : text(), 0);
  switch (sub) {
    case undefined:
    case 'list': {
      const r = await figma.figmaChangesOp(ctx, { state: has(a, 'all') ? 'all' : 'open' });
      return out(r, () => {
        // The route only when the status does not already say it ("Drafted with Claude" needs no "(Claude AI drafts)").
        for (const c of r.changes) io.print(`#${c.pr} ${c.title}${/Claude/.test(c.status) ? '' : ` (${c.route})`}: ${c.status}. ${c.said}`);
        io.print(`Next: ${r.next}`);
      });
    }
    case 'show': {
      const r = await figma.getFigmaChangeOp(ctx, { pr: number(a, 'bridge figma show <n>') });
      if (has(a, 'draft')) {
        if (!r.brief) throw new RequestUsageError(`#${r.pr} is an exact token change: there is no code to draft.`);
        if (!io.hasClaude()) throw new RequestUsageError('`claude` is not on PATH: install Claude Code, or paste the brief from `bridge figma show <n>` into Claude.');
        return io.runClaude(r.brief, root);
      }
      return out(r, () => {
        io.print(`#${r.pr} ${r.title}${/Claude/.test(r.status) ? '' : ` (${r.route})`}: ${r.status}. ${r.said}`);
        io.print(`  ${r.url}`);
        if (r.brief) io.print(`\n${r.brief}`);
      });
    }
    case 'drafted': {
      const r = await figma.markFigmaDraftedOp(ctx, { pr: number(a, 'bridge figma drafted <n>') });
      return out(r, () => io.print(`#${r.pr}: ${r.status}. ${r.said}`));
    }
    case 'push': {
      const file = a._[2];
      if (!file) throw new RequestUsageError('Usage: bridge figma push <diff.json> [--dry-run]');
      let diff: unknown;
      try {
        diff = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
      } catch (err) {
        throw new RequestUsageError(`${file} could not be read as JSON: ${(err as Error).message}`);
      }
      const changes = changesFlag(a);
      const r = await figma.pushFigmaComponentOp(ctx, { diff: diff as never, dryRun: has(a, 'dry-run'), source: 'cli', ...(changes ? { changes } : {}) });
      return out(r, () => {
        io.print(`${r.component}: ${r.route}. ${r.said}`);
        for (const x of r.reasons ?? []) io.print(`  ${x}`);
        for (const x of r.fixInFigma ?? []) io.print(`  Fix in Figma: ${x.what} ${x.todo}`);
        if (r.library) io.print(`  #${r.library.number} ${r.library.url}`);
        if (r.suggestion) io.print(`  suggestion #${r.suggestion.number} ${r.suggestion.url}`);
        io.print(`Next: ${r.next}`);
      });
    }
    default:
      throw new RequestUsageError(`Unknown subcommand "${sub}". ${FIGMA_HELP}`);
  }
}
