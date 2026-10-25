// bridge build: build requests (docs/BUILD-REQUESTS.md), the structure changes pushed from Figma that developers build.
// Read only, over the same operations as the MCP tools (packages/mcp/src/build-requests.ts).
import { BUILD_FILTER_LABEL, BUILD_STATUS_LABEL, type BuildFilter } from '@bridge-ds/core';
import { buildRequests } from '@bridge-ds/mcp';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';
import { cliContext, TOKEN_HELP } from './auth.js';

const FILTERS = Object.keys(BUILD_FILTER_LABEL) as BuildFilter[];

export const BUILD_HELP = `bridge build: build requests, structure changes pushed from Figma that developers build

Usage:
  bridge build list [--filter ${FILTERS.join('|')}] [--component Button] [--json]
                     every build request with its status (Requested, Picked up, In progress, In review,
                     Shipped), who builds it, its age (stale after 7 days), the pull request and the Jira key
  bridge build show <number> [--brief] [--json]
                     what was sent, the status timeline, the links and the brief for Claude;
                     --brief prints only the brief: claude "$(bridge build show 42 --brief)"

Read only: assign yourself and link your pull request ("Closes #n") on GitHub, Bridge reads it.
${TOKEN_HELP}
Exit codes: 0 ok, 1 not a build request, 2 usage or setup error.`;

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '');

export async function runBuild(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (!sub || sub === 'help' || has(a, 'help')) {
    io.print(BUILD_HELP);
    return sub || has(a, 'help') ? 0 : 2;
  }
  const json = has(a, 'json');
  switch (sub) {
    case 'list': {
      const filter = (flag(a, 'filter') ?? 'all') as BuildFilter;
      if (!FILTERS.includes(filter)) throw new RequestUsageError(`--filter takes ${FILTERS.join(', ')}, got "${filter}"`);
      const ctx = await cliContext(root, io, a, 'read');
      const component = flag(a, 'component');
      const r = await buildRequests.listBuildRequests(ctx, { filter, ...(component ? { component } : {}) });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(r.summary);
      if (!r.buildRequests.length) return io.print(`No build request${filter === 'all' ? '' : ` ${BUILD_FILTER_LABEL[filter].toLowerCase()}`} in ${r.repo}${component ? ` for ${component}` : ''}.`), 0;
      const w = Math.max(...r.buildRequests.map((x) => x.component.length));
      const s = Math.max(...r.buildRequests.map((x) => x.statusLabel.length));
      for (const x of r.buildRequests) {
        const who = x.builders.length ? `  ${x.builders.map((b) => `@${b}`).join(', ')}` : '';
        const pr = x.pull ? `  PR #${x.pull.number} ${x.pull.state}` : '';
        const jira = x.jira ? `  ${x.jira}` : '';
        io.print(`#${String(x.number).padEnd(5)} ${x.statusLabel.padEnd(s)}${x.stale ? ' !' : '  '} ${x.component.padEnd(w)}  ${x.title}${who}${pr}${jira}`);
      }
      return 0;
    }
    case 'show': {
      const raw = (a._[2] ?? '').replace(/^#/, '');
      const n = Number(raw);
      if (!raw || !Number.isInteger(n) || n <= 0) throw new RequestUsageError('Usage: bridge build show <number> [--brief] [--json]');
      const ctx = await cliContext(root, io, a, 'read');
      let r: Awaited<ReturnType<typeof buildRequests.getBuildRequest>>;
      try {
        r = await buildRequests.getBuildRequest(ctx, { number: n });
      } catch (e) {
        if (/is not a build request/.test((e as Error).message)) {
          io.error(`bridge: ${(e as Error).message}`);
          return 1;
        }
        throw e;
      }
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      if (has(a, 'brief')) {
        if (!r.brief) {
          io.error(`bridge: #${n} has no brief yet: its spec could not be read.`);
          return 1;
        }
        return io.print(r.brief), 0;
      }
      io.print(`#${r.number} ${r.component}: ${r.title}`);
      io.print(`${r.label}. ${r.said}`);
      io.print(r.url);
      if ('request' in r && r.request) {
        const q = r.request;
        io.print(`\n${q.summary}`);
        if (q.changes.length) {
          io.print('\nChanges in Figma:');
          for (const c of q.changes) io.print(`  ${c.field}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`);
        }
        if (q.build.props?.length) {
          io.print('\nProps needed:');
          for (const p of q.build.props) io.print(`  ${p.change ?? 'new'} ${p.name}${p.type ? ` (${p.type})` : ''}${p.values?.length ? `: ${p.values.join(', ')}` : ''}${p.default ? `, default ${p.default}` : ''}`);
        }
        if (q.build.before?.length) io.print(`\nBefore: ${q.build.before.join(' ')}`);
        if (q.build.after?.length || q.images?.length) io.print(`After: ${(q.build.after ?? q.images ?? []).join(' ')}`);
      }
      io.print('\nStatus:');
      for (const e of r.timeline) io.print(`  ${BUILD_STATUS_LABEL[e.status].padEnd(11)} ${day(e.at)}${e.who ? `  @${e.who}` : ''}`);
      if (r.figma) io.print(`\nDesign: ${r.figma}`);
      if (r.pull) io.print(`Pull request: #${r.pull.number} ${r.pull.state}${r.pull.url ? `  ${r.pull.url}` : ''}`);
      if (r.jira) io.print(`Jira: ${r.jira}`);
      io.print(`\nNext: ${r.next}`);
      if (r.brief) io.print(`Brief for Claude: bridge build show ${r.number} --brief`);
      return 0;
    }
    default:
      throw new RequestUsageError(`Unknown build command "${sub}".\n\n${BUILD_HELP}`);
  }
}
