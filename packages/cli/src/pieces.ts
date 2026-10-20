// bridge pieces: what a product branch adds outside the library, and the library branches that bring it back, from the
// terminal. The same operations as the MCP server (packages/mcp/src/pieces.ts), over the same @bridge-ds/core functions
// as Bridge Studio. Reads work without a token on a public repo; writes need one.
import { BridgeContext, branches, pieces } from '@bridge-ds/mcp';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';

export const PIECES_HELP = `bridge pieces: a product branch and the library

Usage:
  bridge pieces <n> [--record] [--json]          what the product branch adds that the library lacks (the audit
                                                 on its diff against main); --record saves it in the branch,
                                                 where Bridge Studio shows it
  bridge pieces status <n> [--json]              each linked library branch: status, reviewers, preview, next step
  bridge pieces open <n> <piece> [--no-preview] [--dry-run] [--json]
                                                 open the library side of a piece, linked both ways: a token
                                                 change, a library exploration (variant) or a request (component)
  bridge pieces preview <n> <piece>              the product branch takes the latest library branch (merged in)
  bridge pieces switch <n>                       once the library shipped: main into the product branch

GitHub token: GITHUB_TOKEN or BRIDGE_GITHUB_TOKEN, else \`gh auth token\`. Exit codes: 0 ok, 2 usage or setup error.`;

const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

async function context(root: string, io: RequestIO): Promise<BridgeContext> {
  const token = io.env.BRIDGE_GITHUB_TOKEN || io.env.GITHUB_TOKEN || io.ghToken();
  return BridgeContext.create({ root, ...(token ? { token } : {}), ...(io.fetch ? { fetch: io.fetch } : {}) });
}

function number(a: RequestArgs, at: number, usage: string): number {
  const raw = a._[at];
  if (!raw) throw new RequestUsageError(`Usage: ${usage}`);
  return branches.branchNumber(raw);
}

function piece(a: RequestArgs, at: number, usage: string): string {
  const raw = a._[at];
  if (!raw) throw new RequestUsageError(`Usage: ${usage}. \`bridge pieces <n>\` lists the piece ids.`);
  return raw;
}

export async function runPieces(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (!sub || sub === 'help' || has(a, 'help')) {
    io.print(PIECES_HELP);
    return sub || has(a, 'help') ? 0 : 2;
  }
  const json = has(a, 'json');
  const ctx = await context(root, io);
  const out = (r: unknown, text: () => void) => (json ? io.print(JSON.stringify(r, null, 2)) : text(), 0);
  switch (sub) {
    case 'status': {
      const r = await pieces.productBranchOp(ctx, { pr: number(a, 2, 'bridge pieces status <n>') });
      return out(r, () => {
        io.print(`#${r.pr} ${r.title} (${r.product})`);
        io.print(r.said);
        for (const l of r.linked) io.print(`  ${l.piece}: #${l.library.number} ${l.status}. ${l.preview}${l.action ? ` Next: ${l.action}.` : ''}`);
        for (const p of r.notLinked) io.print(`  ${p.title} (${p.id}): no library branch yet. bridge pieces open ${r.pr} ${p.id}`);
        if (r.next) io.print(r.next);
      });
    }
    case 'open': {
      const usage = 'bridge pieces open <n> <piece>';
      const r = await pieces.openLibraryBranchOp(ctx, { pr: number(a, 2, usage), piece: piece(a, 3, usage), usePreview: !has(a, 'no-preview'), dryRun: has(a, 'dry-run'), source: 'cli' });
      return out(r, () => {
        io.print(`${r.status === 'dry-run' ? 'Would open' : r.status === 'already-linked' ? 'Already linked' : 'Opened'} a ${r.opens}: ${r.title}, needed by ${r.neededBy}.`);
        if (r.library) io.print(`  #${r.library.number} ${r.library.url}`);
        if (r.preview) io.print(`  ${r.preview.said}`);
        for (const w of r.warnings ?? []) io.print(`  ${w}`);
        io.print(`Next: ${r.next}`);
      });
    }
    case 'preview': {
      const usage = 'bridge pieces preview <n> <piece>';
      const r = await pieces.useLibraryPreviewOp(ctx, { pr: number(a, 2, usage), piece: piece(a, 3, usage) });
      return out(r, () => io.print(r.said));
    }
    case 'switch': {
      const r = await pieces.switchToPublishedOp(ctx, { pr: number(a, 2, 'bridge pieces switch <n>') });
      return out(r, () => io.print(r.said));
    }
    default: {
      const r = await pieces.missingPiecesOp(ctx, { pr: number(a, 1, 'bridge pieces <n> [--record]'), record: has(a, 'record') });
      return out(r, () => {
        io.print(`#${r.pr} ${r.branch} (${r.product}): ${r.pieces.length ? `${r.pieces.length} ${r.pieces.length === 1 ? 'piece is' : 'pieces are'} missing from the library` : 'nothing is missing from the library'}, ${r.files} files read.`);
        for (const p of r.pieces) io.print(`  ${p.id}  ${p.title}: ${p.summary} Opens ${p.opens}.${'linked' in p ? ` Linked: #${p.linked}.` : ''}`);
        if (r.fixes.count) io.print(`${r.fixes.count} value${r.fixes.count === 1 ? '' : 's'} the library already has (use them instead):\n${r.fixes.sample.map((s) => `  ${s}`).join('\n')}`);
        if (r.skipped) io.print(r.skipped);
        io.print(`Next: ${r.next}`);
      });
    }
  }
}
