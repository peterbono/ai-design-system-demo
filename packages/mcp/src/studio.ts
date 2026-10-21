// The rest of what a designer does in Bridge Studio, from Claude or the terminal: save component guidance (docs.json)
// on a new branch or an open one, read the settings that are safe to read (roles, who ships, the owner override,
// protection, products, previews) and the Figma coverage. Same @bridge-ds/core functions as Studio: docs-proposal
// (validateDocs, the editor's cleaning, one pull request), component-spec (figmaCell), protection, rights.
import {
  approverEntries,
  soloOwnerOf,
  soloOwnerSentence,
  baseBranchOf,
  cleanDocs,
  commitFileOnGitHub,
  coverageSummary,
  DEFAULT_COMPONENT_SPECS_FILE,
  DOCS_MCP_ORIGIN,
  docsFileText,
  docsSlug,
  findOpenDocsProposalOnGitHub,
  entryLabel,
  FIGMA_REFERENCES_BRANCH,
  FIGMA_REFERENCES_MANIFEST,
  figmaCell,
  loadProtection,
  parseComponentSpecs,
  parseJiraKey,
  productsOf,
  proposeDocsOnGitHub,
  protectionSentence,
  shipPolicy,
  TeamDirectory,
  unreadableTeams,
  validateDocs,
  whoCanShipSentence,
  defaultProduct,
  DEFAULT_OVERRIDE,
  type ChangesMode,
  type ComponentDocsJson,
  type FigmaReferenceManifest,
} from '@bridge-ds/core';
import { branchNumber, productMarks, resolveProduct, RIGHTS, viewerOf } from './branches.js';
import { appliedNext, changesFor, noSuggestionAccess, suggestionBase } from './suggestions.js';
import type { BridgeContext } from './context.js';

const DOC_KEYS = ['summary', 'preview', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines', 'anatomy'] as const;

/**
 * Save a component's guidance (docs.json) the way the Library edit mode does: merged into the docs on the branch,
 * cleaned, validated (a summary, no empty items, no em dash), then either one new branch sent for review (Tier 1,
 * patch changeset, the Jira key first in its name) or one commit on an open branch (`pr`).
 */
export async function saveDocs(
  ctx: BridgeContext,
  a: {
    component: string;
    docs: Record<string, unknown>;
    pr?: number | string | undefined;
    title?: string | undefined;
    notes?: string | undefined;
    jira?: string | undefined;
    product?: string | undefined;
    dryRun?: boolean | undefined;
    /** "suggest" or "direct" for this call; default: `changes` in bridge.config.json, else "suggest". */
    changes?: ChangesMode | undefined;
    source?: 'mcp' | 'cli' | undefined;
  },
) {
  const { config } = await ctx.config();
  if (!config.components) throw new Error('No components.dir in bridge.config.json: Bridge does not know where component docs live.');
  const name = a.component.trim();
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`"${a.component}" is not a component name. Use the exported name, like Button (bridge_list_components lists them).`);
  const unknown = Object.keys(a.docs).filter((k) => !(DOC_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`Unknown docs sections: ${unknown.join(', ')}. Use ${DOC_KEYS.join(', ')}.`);
  const path = `${config.components.dir}/${name}/${name}${config.components.docsSuffix}`;
  const jira = parseJiraKey(a.jira);
  const product = await resolveProduct(ctx, a.product);

  const next = (current: string | null): string => {
    let base: Partial<ComponentDocsJson> = {};
    if (current) {
      try {
        base = JSON.parse(current) as Partial<ComponentDocsJson>;
      } catch {
        throw new Error(`${path} is not valid JSON on that branch. Fix it there first.`);
      }
    }
    const merged = { summary: '', whenToUse: [], whenNotToUse: [], dos: [], donts: [], accessibility: [], ...base, ...a.docs } as ComponentDocsJson;
    const issues = validateDocs(merged);
    if (issues.length) throw new Error(`The docs are not ready: ${issues.map((i) => `${i.field}: ${i.message}`).join(' ')}`);
    return docsFileText(cleanDocs(merged), current);
  };

  const gh = await ctx.github();
  // Suggest mode files new docs as a suggestion; `pr` still names a branch to commit on.
  const mode = a.pr === undefined ? await changesFor(ctx, a.changes) : 'direct';
  // One open docs proposal per component (same rule as the Library editor): without `pr`, an open one is continued.
  const open = a.pr === undefined && gh && mode === 'direct' ? await findOpenDocsProposalOnGitHub(gh, { name, slug: docsSlug(name) }, ctx.ref ?? baseBranchOf(config)).catch(() => null) : null;
  const target = a.pr ?? open?.number;
  if (target !== undefined) {
    const n = branchNumber(target);
    if (!gh) throw new Error('No GitHub repo known: set "repo" in bridge.config.json or add an origin remote.');
    const pr = await gh.getPullRequest(n);
    if (pr.state !== 'open') throw new Error(`#${n} is ${pr.state}: save the docs on a new branch instead (leave pr out).`);
    const current = (await gh.getFile(path, pr.headRef))?.text ?? null;
    if (current === null) throw new Error(`${path} is not on #${n}. Save the docs on a new branch instead (leave pr out), or check the component name.`);
    const text = next(current);
    if (a.dryRun) return { status: 'dry-run' as const, pr: n, path, content: text };
    if (!ctx.canWriteRemote && open) return { status: 'preview' as const, pr: n, path, content: text, said: `Nothing sent: the ${name} docs have an open proposal (#${n}) and adding to it needs a GitHub token with ${RIGHTS.docs}. Set GITHUB_TOKEN.` };
    if (!ctx.canWriteRemote) throw new Error(`Saving docs on #${n} needs a GitHub token with ${RIGHTS.docs}. Set GITHUB_TOKEN where the Bridge MCP server runs, or save it in the Library edit mode.`);
    const sha = await commitFileOnGitHub(gh.withBranchPrefix(undefined), { path, branch: pr.headRef, message: `docs(${name.toLowerCase()}): edit usage guidance with Claude (Bridge MCP)`, next });
    const joined = open ? ` It continues the open ${name} docs proposal by @${open.author} (one open proposal per component).` : '';
    return {
      status: sha ? ('committed' as const) : ('unchanged' as const),
      pr: n,
      path,
      commit: sha || null,
      ...(open ? { continued: true } : {}),
      said: (sha ? `Saved the ${name} docs on #${n}. Reviewers see them now.` : 'The docs on that branch already say this.') + joined,
    };
  }

  const original = await ctx.source.read(path);
  const text = next(original);
  if (original === text) return { status: 'unchanged' as const, path, said: `The ${name} docs on main already say this.` };
  const edit = { path, component: name, slug: docsSlug(name), before: original, after: text };
  const marks = productMarks(productsOf(config), product);
  const notes = [a.notes?.trim(), marks.line].filter(Boolean).join('\n\n');
  if (a.dryRun || !gh || !ctx.canWriteRemote) {
    return {
      status: a.dryRun ? ('dry-run' as const) : ('preview' as const),
      path,
      content: text,
      product: product.name,
      changesMode: mode,
      ...(a.dryRun ? {} : { said: mode === 'suggest' ? noSuggestionAccess(ctx, gh) : `Nothing sent: saving docs for review needs a GitHub token with ${RIGHTS.docs}. Set GITHUB_TOKEN, or write the file yourself on a branch.` }),
    };
  }
  if (mode === 'suggest') {
    const base = await suggestionBase(ctx, gh, config);
    const viewer = await viewerOf(ctx, gh);
    const r = await proposeDocsOnGitHub(gh, [edit], {
      base: base.ref,
      baseSha: base.sha,
      mode: 'suggest',
      title: a.title,
      notes,
      jira,
      origin: DOCS_MCP_ORIGIN,
      extraLabels: marks.labels,
      source: a.source ?? 'mcp',
      ...(viewer ? { suggestedBy: viewer } : {}),
    });
    return {
      status: 'suggested' as const,
      number: r.number,
      url: r.url,
      title: r.title,
      path,
      product: product.name,
      changesMode: mode,
      ...('warnings' in r && r.warnings.length ? { warnings: r.warnings } : {}),
      said: `Suggested the ${name} docs as #${r.number}. Docs only: one approval, then a developer applies it.`,
      next: appliedNext(r.number),
    };
  }
  const r = await proposeDocsOnGitHub(gh.withBranchPrefix('docs/'), [edit], {
    base: ctx.ref ?? baseBranchOf(config),
    title: a.title,
    notes,
    jira,
    origin: DOCS_MCP_ORIGIN,
    extraLabels: marks.labels,
    commitNote: 'Proposed with Claude through the Bridge MCP server.',
  });
  return { status: 'sent-for-review' as const, pr: r.number, url: r.url, title: r.title, path, product: product.name, said: `Sent the ${name} docs for review as #${r.number}. Docs only: one approval ships them.` };
}

/** The settings a designer reads in Studio Settings, safe to show: roles, who ships, the owner override, protection, products, previews. */
export async function getSettings(ctx: BridgeContext) {
  const { config } = await ctx.config();
  const { owners, rights } = config.governance;
  const override = config.governance.override ?? DEFAULT_OVERRIDE;
  const gh = await ctx.github();
  const teams = gh ? await new TeamDirectory(gh).resolve(owners).catch(() => undefined) : undefined;
  const entries = approverEntries(owners, rights);
  const ship = shipPolicy(owners, rights, teams);
  const protection = gh ? await loadProtection(gh, baseBranchOf(config)).catch(() => null) : null;
  const products = productsOf(config);
  const unreadable = teams ? unreadableTeams(teams) : [];
  const solo = soloOwnerOf(config.governance, teams);
  return {
    repo: config.repo ? `${config.repo.owner}/${config.repo.name}` : (gh?.fullName ?? null),
    main: baseBranchOf(config),
    roles: {
      designApproval: entries.design.map((e) => entryLabel(e, teams)),
      techApproval: entries.tech.map((e) => entryLabel(e, teams)),
      ship: ship ? whoCanShipSentence(ship) : 'Anyone with write access can merge.',
      ...(solo ? { soloOwner: soloOwnerSentence(solo) } : {}),
      ...(unreadable.length ? { teamsNotRead: unreadable.map((t) => t.message) } : {}),
    },
    ownerOverride: override.allowed.length
      ? { on: true, who: override.allowed.map((l) => `@${l}`), reason: override.requireReason ? `A reason of at least ${override.minReasonLength} characters, posted on the branch.` : 'No reason required.' }
      : { on: false, who: [], reason: 'Nobody can merge without the approvals.' },
    protection: protection ? protectionSentence(protection) : 'Not read (no GitHub repo known, or GitHub did not answer).',
    products: products.map((p) => ({ key: p.key, name: p.name, default: p === defaultProduct(products) })),
    previews: Object.entries(config.previews?.apps ?? {}).filter(([, t]) => Boolean(t)).map(([app]) => app),
    visualImpact: config.visualImpact?.mode ?? 'auto',
    note: 'Settings change in bridge.config.json through a reviewed branch, or in Studio Settings. Tokens and secrets are never shown.',
  };
}

/** Which components are in Figma (Studio's "In Figma" column), and whether code images exist for the fidelity check. */
export async function figmaCoverage(ctx: BridgeContext, a: { component?: string | undefined } = {}) {
  const text = await ctx.source.read(DEFAULT_COMPONENT_SPECS_FILE);
  if (!text) return { components: [], summary: `No ${DEFAULT_COMPONENT_SPECS_FILE} in this repo: run \`npm run specs\` (or the DS Bridge Figma plugin) to record what is in Figma.` };
  const file = parseComponentSpecs(text);
  const s = coverageSummary(file);
  const gh = await ctx.github();
  const manifest = gh ? await gh.readFile(FIGMA_REFERENCES_MANIFEST, FIGMA_REFERENCES_BRANCH).catch(() => undefined) : undefined;
  let references: { components: number; variants: number; sha: string } | null = null;
  try {
    const m = manifest ? (JSON.parse(manifest) as FigmaReferenceManifest) : null;
    if (m?.components) references = { components: Object.keys(m.components).length, variants: Object.values(m.components).reduce((n, c) => n + Object.keys(c.variants ?? {}).length, 0), sha: m.sha };
  } catch {
    references = null;
  }
  const list = (file.coverage ?? []).filter((c) => !a.component || c.name.toLowerCase() === a.component.toLowerCase());
  if (a.component && !list.length) throw new Error(`${a.component} is not in the coverage list. bridge_list_components lists the components.`);
  return {
    summary: `${s.inFigma} of ${s.visual} components are in Figma${s.drafted ? ` (${s.drafted} drafted with Claude)` : ''}; ${s.layout} layout helpers use auto layout.`,
    components: list.map((c) => ({ name: c.name, inFigma: figmaCell(c)?.label ?? 'Unknown', ...(c.reason ? { why: c.reason } : {}) })),
    fidelity:
      references === null
        ? 'No code images for the fidelity check yet (they live on the bridge-visual branch). The DS Bridge Figma plugin compares Figma with them.'
        : `Code images of ${references.variants} variants (${references.components} components, commit ${references.sha.slice(0, 7)}) are ready for the fidelity check. The DS Bridge Figma plugin compares each Figma variant with them; the scores live in Figma.`,
  };
}
