// The component map for the MCP server and the CLI (core component-map.ts): which Library components are linked to
// Figma, what `bridge check` reports about bridge.components.json, and bridge_propose_component_map, which turns the
// Figma components Claude read through the Figma connector into map entries opened for review like any Bridge change
// (a suggestion in suggest mode, a branch and a draft pull request in direct mode). Never written to main.
import {
  baseBranchOf,
  COMPONENT_MAP_FILE,
  componentMapProposalBody,
  componentMapReport,
  figmaFileOf,
  figmaLinkOf,
  mergeComponentMap,
  NOT_LINKED_TO_FIGMA,
  parseComponentFamilies,
  parseFigmaFile,
  proposeComponentMap,
  protectedBranchesOf,
  readComponentMap,
  serializeComponentMap,
  type BridgeConfig,
  type ChangesMode,
  type ComponentMapFile,
  type FigmaComponentInput,
  type LibraryComponentInput,
} from '@bridge-ds/core';
import { branchExists, commitToNewLocalBranch, currentBranch } from '@bridge-ds/core/node';
import type { BridgeContext } from './context.js';
import { listComponentNames, parseProps } from './components.js';
import { changesFor, fileSuggestion, filesSuggestionPayload } from './suggestions.js';
import { readOnlyPreview, sourceOf, toolName, toolTag } from './say.js';

/** The map as the repo holds it: null when absent or invalid (problems say why). */
export async function readMap(ctx: BridgeContext): Promise<{ text: string | null; map: ComponentMapFile | null; problems: string[] }> {
  const text = await ctx.source.read(COMPONENT_MAP_FILE).catch(() => null);
  return { text, ...readComponentMap(text) };
}

/** What a component's `figma` field says to an agent: its Figma component and link, or that it is not linked yet. */
export function figmaFieldOf(map: ComponentMapFile | null, name: string): { name: string; url: string } | string {
  const link = figmaLinkOf(map, name);
  return link ? { name: link.name, url: link.url } : NOT_LINKED_TO_FIGMA;
}

/** The package that holds the components (the nearest package.json above components.dir), and its barrel. */
async function libraryPackage(ctx: BridgeContext, config: BridgeConfig): Promise<{ name: string | null; index: string | null }> {
  const dir = config.components?.dir ?? '';
  const parts = dir.split('/').filter(Boolean);
  let name: string | null = null;
  for (let i = parts.length; i >= 0 && !name; i--) {
    const text = await ctx.source.read([...parts.slice(0, i), 'package.json'].join('/')).catch(() => null);
    if (!text) continue;
    try {
      const pkg = JSON.parse(text) as { name?: unknown; private?: unknown; workspaces?: unknown };
      // The repo root of a monorepo is not the components' package.
      if (typeof pkg.name === 'string' && !(i === 0 && pkg.workspaces)) name = pkg.name;
    } catch {
      /* not JSON: keep looking */
    }
  }
  const index = config.components?.index ? await ctx.source.read(config.components.index).catch(() => null) : null;
  return { name, index };
}

/** True when the barrel exports the component (export * from './components/Name', or a named export). */
function exported(index: string | null, name: string, componentsRel: string): boolean {
  if (!index) return false;
  if (parseComponentFamilies(`// All\n${index}`, componentsRel).some((f) => f.members.includes(name))) return true;
  return new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}|from\\s+['"][^'"]*/${name}['"]`).test(index);
}

const definesExport = (src: string, name: string) => new RegExp(`export\\s+(?:const|function|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(src);

/** The Library components with their props and import, as the proposer reads them. */
export async function libraryInputs(ctx: BridgeContext): Promise<LibraryComponentInput[]> {
  const { config } = await ctx.config();
  if (!config.components) return [];
  const names = await listComponentNames(ctx.source, config);
  const pkg = await libraryPackage(ctx, config);
  const indexDir = config.components.index?.split('/').slice(0, -1).join('/') ?? '';
  const rel = indexDir && config.components.dir.startsWith(`${indexDir}/`) ? config.components.dir.slice(indexDir.length + 1) : 'components';
  return Promise.all(
    names.map(async ({ name, files }) => {
      const tsx = files.find((f) => f.endsWith(`/${name}.tsx`) || f.endsWith(`/${name}.ts`));
      const src = tsx ? await ctx.source.read(tsx).catch(() => null) : null;
      const props = src ? (parseProps(src, name)?.props ?? []) : [];
      return {
        name,
        props: props.map((p) => ({ name: p.name, type: p.type, ...(p.values ? { values: p.values } : {}) })),
        // Only when the barrel re-exports it and the file exports that very name (a folder may export only hooks).
        ...(pkg.name && exported(pkg.index, name, rel) && src && definesExport(src, name) ? { import: { package: pkg.name, export: name } } : {}),
      };
    }),
  );
}

/** `bridge check`: whether the map is valid, and which Library components are not linked to Figma yet. */
export async function componentMapCheck(ctx: BridgeContext) {
  const { config } = await ctx.config();
  const names = config.components ? (await listComponentNames(ctx.source, config)).map((c) => c.name) : [];
  const { text } = await readMap(ctx);
  return componentMapReport(text, names);
}

export interface ProposeComponentMapArgs {
  /** The Figma components and component sets Claude read (name, key, node, variant properties). */
  components: FigmaComponentInput[];
  /** The Figma file they come from (link or key). Absent: figma.file of bridge.config.json. */
  file?: string | undefined;
  summary?: string | undefined;
  dryRun?: boolean | undefined;
  changes?: ChangesMode | undefined;
  source?: 'mcp' | 'cli' | undefined;
}

/**
 * bridge_propose_component_map: proposes map entries (core proposeComponentMap: by name, then variant properties; an
 * ambiguous match is reported, never guessed), adds them to bridge.components.json without touching links a person
 * already made, and opens the file for review. Suggest mode: a suggestion (kind config) a developer applies. Direct
 * mode: a new bridge/* branch and a draft pull request (locally, a branch never pushed).
 */
export async function proposeComponentMapOp(ctx: BridgeContext, a: ProposeComponentMapArgs) {
  const { config } = await ctx.config();
  const fileRef = parseFigmaFile(a.file) ?? figmaFileOf(config);
  if (!fileRef) {
    throw new Error(
      a.file
        ? `"${a.file}" is not a Figma file link or key.`
        : `Which Figma file? Pass "file" (the link of the team's Figma file), or ask an admin to set it in Studio, Settings, Figma file (figma.file in bridge.config.json).`,
    );
  }
  if (!Array.isArray(a.components) || !a.components.length) throw new Error('Pass the Figma components you read (name, key or node, and their variant properties).');
  const library = await libraryInputs(ctx);
  if (!library.length) throw new Error('No Library components found: set components.dir in bridge.config.json.');
  const proposal = proposeComponentMap({ library, figma: a.components, file: fileRef.key });
  const existing = await readMap(ctx);
  if (existing.problems.length) throw new Error(`${COMPONENT_MAP_FILE} is invalid, fix it first: ${existing.problems.join('; ')}`);
  const merged = mergeComponentMap(existing.map, proposal.proposed);
  const source = sourceOf(ctx, a.source);
  const body = componentMapProposalBody(proposal, merged, { fileUrl: fileRef.url, tool: toolTag(source) });
  const report = {
    file: fileRef.url,
    linked: merged.added,
    alreadyLinked: merged.kept,
    ambiguous: proposal.ambiguous,
    notInFigma: proposal.unmatched.library,
    figmaOnly: proposal.unmatched.figma,
    leftOut: Object.fromEntries(proposal.proposed.filter((p) => p.unmappedProperties.length).map((p) => [p.component, p.unmappedProperties])),
  };
  if (!merged.added.length) {
    return { status: 'nothing-to-propose', ...report, next: proposal.ambiguous.length ? 'Every match left is ambiguous: ask the person which Figma component each one is, then call again with only that one.' : 'Nothing new to link.' };
  }
  const content = serializeComponentMap(merged.map);
  const files = [{ path: COMPONENT_MAP_FILE, content }];
  const n = merged.added.length;
  const title = `Link ${n} Library component${n === 1 ? '' : 's'} to Figma`;
  const summary = a.summary?.trim() || `${title}: ${merged.added.join(', ')}.`;
  const prefix = config.governance.branchPrefix;
  const stem = `${prefix}component-map-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const after = 'A person checks each link opens the right component, then approves. Until then, nothing is linked.';

  if ((await changesFor(ctx, a.changes)) === 'suggest') {
    const r = await fileSuggestion(
      ctx,
      (base, by) => filesSuggestionPayload(ctx, { kind: 'config', title, summary, files, tier: { tier: 1, bump: 'patch' }, base, source: a.source ?? ctx.surface, suggestedBy: by }),
      { labels: ['component-map'], details: body, dryRun: a.dryRun },
    );
    if (r.status === 'dry-run') return { status: 'dry-run', changesMode: 'suggest', ...report, suggestion: r.suggestion, fileContents: files };
    if (r.status === 'preview') return { status: 'preview', message: r.message, changesMode: 'suggest', ...report, fileContents: files };
    return { status: 'suggested', changesMode: 'suggest', ...report, number: r.number, url: r.url, labels: r.labels, ...(r.warnings.length ? { warnings: r.warnings } : {}), next: `${after} ${r.next}` };
  }
  if (a.dryRun) return { status: 'dry-run', changesMode: 'direct', ...report, prBody: body, fileContents: files };
  const message = `chore(components): ${title.charAt(0).toLowerCase()}${title.slice(1)}\n\n${summary}\n\nProposed through ${toolTag(source)}.`;
  let branch = stem;
  if (ctx.mode === 'local') {
    if (!ctx.isGit) return { status: 'preview', message: 'Not a git repo: nothing written. Write fileContents yourself.', ...report, prBody: body, fileContents: files };
    for (let i = 2; await branchExists(ctx.root!, branch); i++) branch = `${stem}-${i}`;
    const base = await currentBranch(ctx.root!);
    const protectedBranches = [...new Set([...protectedBranchesOf(config), baseBranchOf(config)])];
    const res = await commitToNewLocalBranch(ctx.root!, { base: 'HEAD', branch, message, files, protectedBranches, branchPrefix: prefix });
    return { status: 'branch-created', ...report, branch, base, commit: res.sha, prBody: body, next: `Your working tree is untouched. Push ${branch} and open a draft pull request with the body above. ${after}` };
  }
  if (!ctx.canWriteRemote) return { status: 'preview', message: readOnlyPreview(ctx), ...report, prBody: body, fileContents: files };
  const gh = (await ctx.github())!;
  const base = ctx.ref ?? baseBranchOf(config);
  for (let i = 2; await gh.getBranchSha(branch).then(Boolean, () => false); i++) branch = `${stem}-${i}`;
  const commit = await gh.commitToNewBranch({ base, branch, message, files });
  const pr = await gh.createPullRequest({ base, head: branch, title: `chore(components): ${title.charAt(0).toLowerCase()}${title.slice(1)}`, body, draft: true });
  const labels = [...new Set([...config.governance.labels, 'component-map'])];
  await gh.addLabels(pr.number, labels);
  return { status: 'pr-opened', ...report, branch, commit: commit.sha, pr: pr.number, url: pr.url, labels, draft: true, next: `${after} Opened through ${toolName(source)}.` };
}

/** The check in lines for a terminal (`bridge check`). */
export { componentMapLines } from '@bridge-ds/core';
