// bridge_exploration_to_figma: "put this exploration in Figma". Bridge never writes to Figma and holds no Figma token:
// the designer's Claude rebuilds the exploration in a new page of the team's Figma file, with real component instances,
// through its own Figma connector (use_figma, Plugin API). This tool gives Claude everything it needs, read only: the
// team's file, the screens the exploration changed, the Library components they use with their component map links
// (bridge.components.json), what has no link, the preview to look at, and the recipe a manual run proved.
import { branchPreviewUrl, branchPreviewUrls, COMPONENT_MAP_FILE, explorationNotePathOf, explorationRefLabel, explorationStage, explorationStatus, figmaFileOf, figmaFileUrl, figmaLinkOf, figmaReach, findExplorationOnGitHub, GitHubError, isArchivedExploration, parseExplorationBody, parseExplorationNotes, previewLinksOf, productPreviewOnGitHub, productsOf, readProductBranchOnGitHub, type ComponentMapFile } from '@bridge-ds/core';
import { importsOf } from '@bridge-ds/core/audit';
import type { BridgeContext } from './context.js';
import { readMap } from './component-map.js';
import { designSystemIndex } from './ops.js';
import { locate, type Located } from './product-repos.js';
import { whoami } from './whoami.js';

/** How much source one answer carries: a tool answer Claude can still read in full. The rest is flagged, never dropped silently. */
const SOURCE_LIMITS = { file: 24_000, total: 60_000 } as const;

const JSX_FILE = /\.[cm]?[jt]sx$|\.(astro|vue|svelte)$/;
const SCRIPT_FILE = /\.[cm]?[jt]sx?$|\.(astro|vue|svelte)$/;

/** "Put Bridge exploration admin-app#1 "Name" in Figma." (Studio's line) back to the ref the resolver reads. */
export const figmaRefOf = (text: string): string =>
  text
    .replace(/^\s*put\s+bridge\s+exploration\s+/i, '')
    .replace(/\s+".*$/, '')
    .replace(/\s+in\s+figma\.?\s*$/i, '')
    .trim();

/** The page's name: "Exploration: <name>". */
export const figmaPageName = (name: string): string => `Exploration: ${name.replace(/^exploration:\s*/i, '').trim()}`;

/** The Library component behind an export: itself, or the longest name it starts with (CardBody is a part of Card). */
export function libraryComponentOf(exported: string, components: readonly string[]): string | null {
  if (components.includes(exported)) return exported;
  return (
    [...components]
      .filter((c) => exported.startsWith(c) && /^[A-Z]/.test(exported.charAt(c.length)))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

/** What the changed files render: the Library's exports (by component, with the parts used) and the product's own components. */
export function componentsUsed(files: readonly { path: string; after: string | null }[], ds: { packages: readonly string[]; components: readonly string[] }) {
  const library = new Map<string, { usedAs: Set<string>; files: Set<string> }>();
  const own = new Map<string, Set<string>>();
  const fromLibrary = (mod: string) => ds.packages.some((p) => mod === p || mod.startsWith(`${p}/`));
  for (const f of files) {
    if (!f.after || !SCRIPT_FILE.test(f.path)) continue;
    for (const [local, from] of importsOf(f.path, f.after)) {
      // An element, not a type argument (useGetList<Order>).
      if (!/^[A-Z]/.test(local) || !new RegExp(`(?:^|[^\\w.)\\]])<${local}[\\s/>.]`, 'm').test(f.after)) continue;
      if (fromLibrary(from.module)) {
        const name = libraryComponentOf(from.imported, ds.components) ?? from.imported;
        const row = library.get(name) ?? { usedAs: new Set<string>(), files: new Set<string>() };
        row.usedAs.add(from.imported);
        row.files.add(f.path);
        library.set(name, row);
      } else if (from.module.startsWith('.')) own.set(local, (own.get(local) ?? new Set<string>()).add(f.path));
    }
  }
  return { library, own };
}

/** One component's link as Claude needs it, or why it has none. */
function linkOf(map: ComponentMapFile | null, name: string, fileKey: string) {
  const link = figmaLinkOf(map, name);
  if (!link) return { linked: false as const, why: 'Not linked to Figma yet.' };
  const reach = figmaReach(link, fileKey);
  if (reach === 'none') return { linked: false as const, why: `Linked in another Figma file with no key: a node id works only inside its own file, and this page is built in the team's file.` };
  const id = Object.keys(map!.components).find((k) => k.toLowerCase() === name.toLowerCase())!;
  const properties = map!.components[id]!.figma!.properties;
  return {
    linked: true as const,
    figma: {
      name: link.name,
      url: link.url,
      file: link.file,
      ...(link.node ? { node: link.node } : {}),
      ...(link.key ? { key: link.key } : {}),
      ...(properties ? { properties } : {}),
      reach: reach === 'node' ? ('node id: getNodeByIdAsync' as const) : ('key: import it from the published Library' as const),
    },
  };
}

/** The source to read: the head of each file within the limits, then the base of the files that existed, so Claude sees what changed. */
function screensOf(files: readonly { path: string; before: string | null; after: string | null }[]) {
  let left: number = SOURCE_LIMITS.total;
  const take = (text: string | null) => {
    if (text === null || left <= 0) return { text: null, cut: text !== null };
    const room = Math.min(SOURCE_LIMITS.file, left);
    left -= Math.min(text.length, room);
    return { text: text.slice(0, room), cut: text.length > room };
  };
  // The screens first: a style file says less about what to build. The bases come last, from what is left.
  const ordered = [...files].sort((a, b) => Number(JSX_FILE.test(b.path)) - Number(JSX_FILE.test(a.path)));
  const heads = ordered.map((f) => take(f.after));
  return ordered.map((f, i) => {
    const head = heads[i]!;
    const base = take(f.before);
    return {
      path: f.path,
      status: f.before === null ? ('new' as const) : ('changed' as const),
      source: head.text,
      ...(base.text ? { baseSource: base.text } : {}),
      ...(head.cut || base.cut ? { cut: true } : {}),
    };
  });
}

/** The recipe a manual run proved, for one page of the team's file. */
export function figmaRecipe(page: string): string[] {
  return [
    `Page: \`const page = figma.createPage(); page.name = ${JSON.stringify(page)}\`, then \`await figma.setCurrentPageAsync(page)\` once. If a page already has that name, add " (2)": never reuse or edit an older page. Never touch the page that holds the components.`,
    'Components: for "node id", `await figma.getNodeByIdAsync(node)`. For "key", `await figma.importComponentSetByKeyAsync(key)`, or `importComponentByKeyAsync` for a single component. On a COMPONENT_SET pick a variant by parsing the `Prop=value` pairs of each child\'s name, then `createInstance()`; a COMPONENT is instantiated as it is.',
    'Layout: a root frame 1440 wide with a white fill, auto layout frames inside. Append a child to its auto layout frame first, then set FILL.',
    'Overrides: `setProperties` for VARIANT, TEXT and BOOLEAN properties, with the exact names in `properties` (the "#12:0" part included). Text with no property: find its TEXT layer, load its fonts first (`getRangeAllFontNames` + `loadFontAsync`), then set `characters`.',
    'Instances are named like the set, not the variant: never find one by a variant name.',
    'A combination may not exist (Alert warning + inline): pick the closest variant that exists and report the substitution, never fail.',
    'Plain text only when no component fits, in the font of a text of the kit.',
    'Hide what the instance does not use with `child.visible = false` (a Card footer).',
    'Report what could not be expressed: substitutions, slots that take only one text, missing actions, components with no link.',
  ];
}

/** Which ids work where, from the links this exploration needs. */
function fileRuleOf(rows: { figma: { file: string } }[], fileKey: string): string {
  const others = rows.filter((r) => r.figma.file !== fileKey).length;
  const base = "Node ids work only inside the file that holds them, so build in the team's file. From another file a component needs its key and a published Library: without both, say it is missing, never rebuild it by hand.";
  return others ? `${others} linked component${others === 1 ? ' lives' : 's live'} in another file: import them by key, which needs that Library published and enabled in this file. ${base}` : `Every linked component lives in the team's file: use their node ids. ${base}`;
}

async function previewOf(ctx: BridgeContext, at: Located, p: { number: number; headRef: string; headSha: string }): Promise<string | null> {
  const { config } = await ctx.config();
  const previews = at.product
    ? [await productPreviewOnGitHub(at.gh, at.product, { number: p.number, branch: p.headRef, sha: p.headSha }).catch(() => null)].filter((x) => x !== null)
    : await branchPreviewUrls(at.gh, p.number, config, { branch: p.headRef, sha: p.headSha }).catch(() => []);
  return previewLinksOf(previews)[0]?.url ?? (at.product ? branchPreviewUrl(at.product.preview, p.headRef) : null);
}

/** bridge_exploration_to_figma. Reads only: Claude builds with its own Figma connector, Bridge writes nothing. */
export async function explorationToFigma(ctx: BridgeContext, a: { ref: string }) {
  // The hosted connector knows who this is: a Reader changes nothing. Locally the token's own rights decide.
  const person = ctx.opts.identity ? await whoami(ctx).catch(() => null) : null;
  if (person?.role === 'Reader') throw new Error('You can view this team. Ask an admin for Can edit to put an exploration in Figma.');
  const { config } = await ctx.config();
  const file = figmaFileOf(config);
  if (!file) return { status: 'no-figma-file' as const, say: 'Your team has no Figma file in Bridge yet. A lead or an admin adds it in Studio, Settings, Figma file. Then ask again.', next: 'Say this to the designer and stop: never pick a Figma file yourself.' };
  const ds = await ctx.github();
  if (!ds) throw new Error('No GitHub repo known: set "repo" in bridge.config.json or add an origin remote.');
  const at = await locate(ctx, figmaRefOf(a.ref), ds);
  const gh = at.gh;
  const unreachable = (err: unknown) => {
    if (at.repo && err instanceof GitHubError && (err.status === 403 || err.status === 404)) return new Error(`Bridge cannot read this exploration in ${at.repo}. Ask an admin to connect ${at.product?.name ?? 'this product'} to Bridge, or to give you access to it.`);
    return err;
  };
  const read = await (async () => {
    const p = await findExplorationOnGitHub(gh, at.ref);
    return { p, branch: await readProductBranchOnGitHub(gh, p.number, { products: productsOf(config) }) };
  })().catch((err: unknown) => {
    throw unreachable(err);
  });
  const { p, branch } = read;
  const e = parseExplorationBody(p.body);
  const name = e?.name ?? p.title.replace(/^Exploration:\s*/i, '');
  const ref = explorationRefLabel({ number: p.number, product: at.product?.key, repo: at.repo });
  const prFiles = await gh.listPullRequestFiles(p.number).then((f) => f.map((x) => x.filename)).catch(() => null);
  const status = explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body });
  const stage = explorationStage({ status, archived: isArchivedExploration(p.labels), files: prFiles });
  if (stage === 'not-started') return { status: 'nothing-built' as const, ref, name, say: `Nothing is built in "${name}" yet, so there is nothing to put in Figma.`, next: 'Say this to the designer, and offer to build it first.' };
  const dsIndex = await designSystemIndex(ctx);
  const { map, problems } = await readMap(ctx);
  const used = componentsUsed(branch.files, { packages: dsIndex.packages, components: [...new Set([...dsIndex.components, ...Object.keys(map?.components ?? {})])] });
  const linked: { name: string; usedAs: string[]; files: string[]; figma: Extract<ReturnType<typeof linkOf>, { linked: true }>['figma'] }[] = [];
  const notLinked: { name: string; usedAs: string[]; files: string[]; why: string }[] = [];
  for (const [name, u] of [...used.library].sort(([x], [y]) => x.localeCompare(y))) {
    const row = { name, usedAs: [...u.usedAs].sort(), files: [...u.files].sort() };
    const link = linkOf(map, name, file.key);
    if (link.linked) linked.push({ ...row, figma: link.figma });
    else notLinked.push({ ...row, why: link.why });
  }
  const screens = screensOf(branch.files);
  const preview = await previewOf(ctx, at, p);
  const notes = stage === 'handed' ? null : parseExplorationNotes(await gh.getFileText(explorationNotePathOf(prFiles, p.headRef), p.headRef).catch(() => undefined));
  const page = figmaPageName(name);
  // MCP only: the tool is Claude's, the CLI has no such command.
  const saveLink = stage === 'handed' ? 'Its notes went to the developers on Done exploring: give the designer the page link, nothing to save.' : `Record the page link: bridge_save_exploration { exploration: "${ref}", message: "Put it in Figma", notes: { figmaPage: "<the page link>" } }, so Studio links to it.`;
  const gaps = [
    ...notLinked.map((c) => `${c.name}: ${c.why}`),
    ...[...used.own.keys()].sort().map((c) => `${c}: a part of the product, not of the Library.`),
    ...(branch.skipped ? [`${branch.skipped} more changed files were not read.`] : []),
    ...(screens.some((s) => s.cut) ? ['Some source was cut to fit: look at the preview for the rest.'] : []),
    ...(problems.length ? [`${COMPONENT_MAP_FILE} has problems: ${problems.join('; ')}`] : []),
  ];
  return {
    status: 'ready' as const,
    ref,
    name,
    product: branch.product.name,
    figma: { file: file.key, url: file.url },
    page,
    ...(notes?.figmaPage ? { alreadyInFigma: notes.figmaPage } : {}),
    preview,
    previewNote: 'The preview is the visual reference: the source alone does not show the data, spacing or states on screen. Look at it when you can. If you cannot open it, build from the source and say so in your report.',
    screens,
    components: linked,
    notLinked,
    productComponents: [...used.own.entries()].map(([name, files]) => ({ name, files: [...files].sort() })).sort((x, y) => x.name.localeCompare(y.name)),
    gaps,
    fileRule: fileRuleOf(linked, file.key),
    recipe: figmaRecipe(page),
    next: [
      'Build it now with your Figma connector (use_figma, Plugin API) in the file above, following the recipe. Bridge does not write to Figma. If you have no Figma connector, tell the designer to connect Figma in their Claude connectors, and stop.',
      linked.length ? '' : 'No component used here has a Figma link yet: tell the designer that a lead can link them with "Link our Library components to Figma with Bridge", and ask before building with plain layers.',
      `Rebuild what is on screen, not the code: productComponents are made of Library pieces, build them from the components you have, or report them. End with the page link (${figmaFileUrl(file.key)}?node-id=<page id, with a dash>) and the gaps in plain words, one line each.`,
      saveLink,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
