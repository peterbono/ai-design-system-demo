// The MCP surface: tools, resources and prompts over ./ops.ts.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { BridgeContext } from './context.js';
import { core } from './core-adapter.js';
import { listComponentNames } from './components.js';
import * as ops from './ops.js';
import * as history from './history.js';
import * as brand from './brand.js';
import * as requests from './requests.js';
import * as buildRequests from './build-requests.js';
import * as explorations from './explorations.js';
import * as drafts from './drafts.js';
import * as branches from './branches.js';
import * as studio from './studio.js';
import * as pieces from './pieces.js';
import * as figma from './figma.js';
import * as figmaFixes from './figma-fixes.js';
import * as suggestions from './suggestions.js';
import { DRAFT_LINE_MAX, DRAFT_PHRASE, FIX_LOOP_MAX_ROUNDS, DRAFT_TITLE_MAX, EXPLORATION_USE_CASES, REQUEST_KINDS } from '@bridge-ds/core';

declare const __BRIDGE_MCP_VERSION__: string | undefined;
/** The package version, injected at build time; tests and source runs fall back to "dev". */
export const VERSION = typeof __BRIDGE_MCP_VERSION__ === 'string' ? __BRIDGE_MCP_VERSION__ : 'dev';

/** The Bridge site: it serves the hosted connector (/mcp) and the official icons. */
export const BRIDGE_SITE = 'https://bridge.floriangouloubi.com';

/**
 * How clients show this server (MCP 2025-11-25, Implementation: `title` is the display name, `icons` the images; the
 * SDK here supports that version). `name` stays machine-safe. Icons are absolute https URLs on the same domain as the
 * hosted connector, PNG first since every client that renders icons must support it.
 */
export const SERVER_INFO = {
  name: 'bridge',
  title: 'Bridge',
  version: VERSION,
  websiteUrl: `${BRIDGE_SITE}/`,
  icons: [
    { src: `${BRIDGE_SITE}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
    { src: `${BRIDGE_SITE}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
    { src: `${BRIDGE_SITE}/favicon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
  ],
};

type Json = Record<string, unknown> | unknown[];
const ok = (data: Json | string) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message ?? String(e)}` }], isError: true });
const run =
  <A>(fn: (a: A) => Promise<Json | string>) =>
  async (a: A) => {
    try {
      return ok(await fn(a));
    } catch (e) {
      return fail(e);
    }
  };

const ModeArg = z.record(z.string(), z.string()).describe('Mode values, e.g. {"theme":"dark","brand":"ocean"}. Omitted modes use their default. See bridge_get_config for the modes this repo has.');

const EditArg = z.object({
  op: z.enum(['set', 'add', 'remove', 'rename']).describe('set: change value/description/type of an existing token. add: new token. remove: delete it from every file (or `file`). rename: move to newPath and repoint every alias.'),
  path: z.string().describe('Token path with dots: color.text.muted (a CSS variable like --color-text-muted also works for set).'),
  value: z.any().optional().describe('New $value. Friendly forms are converted to the repo format: "#ff5500", "12px", "150ms", or an alias "{palette.neutral.600}". Raw DTCG JSON also works.'),
  type: z.string().optional().describe('$type for add when the group does not set one: color, dimension, duration, number, fontWeight, shadow...'),
  description: z.string().optional().describe('$description (plain sentence, no em dash).'),
  newPath: z.string().optional().describe('rename only: the new path.'),
  file: z.string().optional().describe('Token file relative to the tokens root, e.g. semantic/dark.tokens.json. Needed when the token lives in several files (light and dark) unless `mode` is given.'),
  mode: ModeArg.optional().describe('Pick the file that defines the token for this mode, e.g. {"theme":"dark"}. Alternative to `file`.'),
});

const RO = { readOnlyHint: true, openWorldHint: false } as const;

const ChangesArg = z
  .enum(['suggest', 'direct'])
  .optional()
  .describe('How this change reaches the code: "suggest" files a suggestion (a GitHub issue the owners approve and a developer applies, Issues write only), "direct" opens a branch and a pull request. Default: "changes" in bridge.config.json, else "suggest". Only set it when the person asked.');

/** How a server is built for where it runs. */
export interface ServerOptions {
  /**
   * Tools this server neither lists nor runs. The hosted connector (Bridge inside the team's Claude) leaves out the
   * merge (bridge_merge_branch and its owner override): agents never merge there, a person does. The local CLI and
   * MCP server keep every tool.
   */
  exclude?: readonly string[] | undefined;
}

export function createServer(ctx: BridgeContext, opts: ServerOptions = {}): McpServer {
  const excluded = new Set(opts.exclude ?? []);
  const server = new McpServer(
    SERVER_INFO,
    {
      instructions: [
        'Bridge exposes a design system repo (DTCG tokens, components, docs) to you.',
        'Bridge never writes to the default branch: changes become suggestions (GitHub issues), branches and pull requests, or local branches that are never pushed. The library only changes through reviewed pull requests, and on a protected repo GitHub refuses direct pushes anyway.',
        `Access now: ${ctx.access()} bridge_get_config says the same.`,
        'How changes reach the code is the "changes" setting of bridge.config.json (bridge_get_config says which): "suggest" (the default) files token, docs, brand, revert, missing piece and Figma changes as suggestions, GitHub issues with the exact change that the owners approve (bridge_review_suggestion) and a developer applies (bridge_apply_suggestion, or `bridge apply <n>`); "direct" opens branches and pull requests. Writing tools take "changes" to pick one for a call; only pass it when the person asked. When the person says "Apply Bridge suggestion #n", call bridge_apply_suggestion with mode "dry-run" first, show the result, then apply it on a branch.',
        'Read before you write: bridge_get_guidelines for the repo rules, bridge_search_tokens / bridge_get_token before using or proposing a token.',
        'Never hardcode a value in UI code when a token exists; never invent a token name (check it with bridge_get_token).',
        'bridge_audit measures how a product codebase adopts the design system (hardcoded values, foreign UI components) and suggests the tokens and components to use.',
        'Token changes go through bridge_propose_token_change only: it validates, checks contrast, and opens a branch or PR. It never writes to main.',
        'Adding, renaming or removing a token is Tier 3: tell the user it needs design and tech owner approval.',
        'New brands: bridge_plan_brand first (dry run with ramps and the contrast gate for every theme), then bridge_propose_brand. A new brand is Tier 3.',
        'To undo a merged token change use bridge_plan_revert first (it shows conflicts with later changes), then bridge_propose_revert; never revert by hand-editing files.',
        'Component changes (new component, variant, prop, structure, visual, token binding) are requests: GitHub issues labeled component-change. bridge_list_requests finds them, bridge_get_request returns a brief to implement one in a pull request that says "Closes #n", bridge_create_request files a new one. Pushed from Figma, a component change that needs code is a build request (bridge_list_build_requests, bridge_get_build_request): the design is already approved in Figma, developers build it in a pull request that says "Closes #n".',
        'Pushes from the Figma plugin count as design-approved: token value changes ship by themselves once the automatic checks pass (bridge_branch_status says so), a token renamed or removed still needs the tech approval.',
        `Change texts from Figma and docs from Bridge Studio: when the user says "${DRAFT_PHRASE}" (or asks you to draft their Bridge changes or docs), call bridge_pending_drafts. For change items, look at the before and after images and write each title, summary and change line in the Bridge voice. For docs items (scope "docs"), follow the brief: write only the sections it asks for, grounded in the props, CSS module classes and source it quotes, never an invented prop or behavior, never anatomy. Then call bridge_write_drafts. The designer reviews them in the DS Bridge Figma plugin or on the Library page.`,
        'Studio parity: a designer can do in Claude what they do in Bridge Studio. Branches in review: bridge_what_needs_me (the queue), bridge_branch_status, bridge_send_for_review, bridge_back_to_draft, bridge_review_branch, bridge_ask_someone_else, bridge_comment, bridge_update_from_main (token conflicts too), bridge_try_branch (try it in a product, share it), bridge_combine_branches, bridge_close_branch, bridge_reopen_branch, bridge_merge_branch (same gate as Studio, owner override with a reason). Docs: bridge_save_docs. Writes act under the person\'s GitHub token: only do them when the person asked, and merge only when they explicitly asked to merge.',
        'Products: work starts for a product (bridge_list_products). Tools that start work take "product"; without it Bridge uses the product of the current folder or repo. Ask the person when it is not obvious.',
        'Product branches and the library: when a designer explores a product feature with you (an exploration for a product), check it with bridge_missing_pieces (record: true) before they share it; for each piece the library lacks, offer bridge_open_library_branch, which opens the library side linked to their branch. bridge_product_branch says where each library branch stands; bridge_switch_to_published moves the product branch to the real version once the library ships.',
        'Components from Figma: the DS Bridge plugin sends a component changed in Figma to a library branch. Token swaps go as exact token changes; new variants, properties and components go to a branch carrying the spec, waiting for Claude AI. When the person asks you to draft one, bridge_figma_changes lists them and bridge_get_figma_change gives the spec and the steps; write the code on that branch, push it, then bridge_mark_figma_change_drafted. Never claim a branch is drafted before its code is pushed.',
        'Fix with Claude: when a component built in Figma differs from its story, you are the team\'s Claude and Bridge is the referee. bridge_figma_gaps lists them, bridge_get_gap_case gives one gap case and the fix schema, bridge_try_figma_fix checks fixes on the measured values (at most 3 rounds per component), bridge_propose_figma_fixes opens them for review; a component that will not come closer gets a status fix (Differs or Can\'t check, with the reason), never Matches. The plugin\'s Check fidelity (the story shots) decides after the next pull.',
        'Explorations try experimental variables and components in a product staging branch without touching main: an explore/<slug> branch with a draft pull request labeled exploration, previews and a snapshot package. When a designer says they want to explore something, start one with bridge_start_exploration right away, named from their words, without asking for a purpose or a brief: for a product with its own repository it is created there, and the library comes as the npm package. bridge_list_explorations lists them. When the person says "Continue Bridge exploration #n" (or shop#n, or names one), call bridge_continue_exploration with that ref: it switches the checkout to its branch when safe and says where it stands; start your answer with that, in one or two plain sentences, then ask what to do next. At the start of a session, call bridge_list_explorations with mine: true once; if the person has explorations running, mention them in one line (names and refs) and offer to continue one. Say it once, never again in the session, and nothing when there are none. To work on one, pass "branch": "explore/<slug>" to bridge_propose_token_change, bridge_draft_docs and bridge_get_request, and never open a pull request to main from it. An exploration is a living prototype: when the person says they are done exploring, call bridge_promote_exploration ("Done exploring") with the pieces they picked; it hands the branch to the developers and never closes it. bridge_archive_exploration hides one from the lists while its preview stays alive.',
        ...(excluded.has('bridge_merge_branch') ? ['On this server you never merge: bridge_merge_branch is not available here. When a branch is ready, say so; a person merges it from Bridge Studio or GitHub.'] : []),
      ].join(' '),
    },
  );

  // Tools left out (opts.exclude) are registered then removed, so they are neither listed nor callable.
  const registered = new Map<string, { remove(): void }>();
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: never, cb: never) => {
    const tool = register(name, config, cb);
    registered.set(name, tool);
    return tool;
  }) as typeof server.registerTool;

  // --- read: config and tokens ---
  server.registerTool(
    'bridge_get_config',
    { title: 'Get Bridge config', description: 'Where the design system lives and what Bridge may do: source (local path or GitHub repo), write access, token tiers, modes (brand/theme/density...) and the full bridge.config.json. Call first in a new repo.', inputSchema: {}, annotations: RO },
    run(async () => ops.getConfig(ctx)),
  );

  server.registerTool(
    'bridge_list_tokens',
    {
      title: 'List tokens',
      description: 'List tokens with their resolved CSS value in one mode. Filter by tier (primitive, brand, semantic, density, component...), $type, or path prefix. Paginated (limit/offset).',
      inputSchema: {
        tier: z.string().optional().describe('Tier name from bridge_get_config.tokensPerTier.'),
        type: z.string().optional().describe('DTCG $type: color, dimension, duration, shadow, fontFamily, number...'),
        prefix: z.string().optional().describe('Path prefix, e.g. color.action or button.'),
        mode: ModeArg.optional(),
        limit: z.number().int().min(1).max(500).optional().describe('Default 100.'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: RO,
    },
    run((a) => ops.listTokens(ctx, a)),
  );

  server.registerTool(
    'bridge_get_token',
    {
      title: 'Get token',
      description: 'Everything about one token: CSS variable, type, tier, description, the files that define it, resolved value in every mode (brand x theme x density, collapsed where equal) with its alias chain, tokens that alias it, and components whose CSS uses it (directly or through a component token).',
      inputSchema: { path: z.string().describe('color.text.muted, --color-text-muted or var(--color-text-muted).') },
      annotations: RO,
    },
    run((a) => ops.getToken(ctx, a)),
  );

  server.registerTool(
    'bridge_search_tokens',
    {
      title: 'Search tokens',
      description: 'Find tokens by words in the path or description ("danger text", "focus ring"), by CSS variable, or by value ("#c2410c", "16px": exact and near colors). Use before writing UI code or proposing a new token.',
      inputSchema: { query: z.string().min(1), type: z.string().optional().describe('Restrict to a $type.'), limit: z.number().int().min(1).max(100).optional().describe('Default 20.') },
      annotations: RO,
    },
    run((a) => ops.searchTokens(ctx, a)),
  );

  // --- checks ---
  server.registerTool(
    'bridge_check_contrast',
    {
      title: 'Check contrast',
      description: "Run the repo's WCAG contrast gate (every pair in every brand x theme). Pass `edits` to preview a change: returns the pairs that move and any new failure, without writing anything. Pass `pairs` to check ad-hoc fg/bg pairs.",
      inputSchema: {
        edits: z.array(EditArg).optional().describe('Proposed edits to evaluate (nothing is written).'),
        pairs: z.array(z.object({ fg: z.string(), bg: z.string(), min: z.number().default(4.5) })).optional().describe('Ad-hoc pairs instead of the repo gate. min: 4.5 text, 3 non-text.'),
        mode: ModeArg.optional().describe('Only report these modes.'),
        includePassing: z.boolean().optional().describe('Return every result, not only failures and the tightest pairs.'),
      },
      annotations: RO,
    },
    run((a) => ops.checkContrast(ctx, a)),
  );

  server.registerTool(
    'bridge_validate_tokens',
    {
      title: 'Validate tokens',
      description: 'Validate tokens: DTCG 2025.10 shape per $type, names, broken and circular aliases in every mode, alias type mismatches, missing layer files, and mode parity (a semantic token must exist in both light and dark). Pass `edits` to validate a change before proposing it.',
      inputSchema: { edits: z.array(EditArg).optional(), includeWarnings: z.boolean().optional() },
      annotations: RO,
    },
    run((a) => ops.validateTokens(ctx, a)),
  );

  // --- components and docs ---
  server.registerTool(
    'bridge_list_components',
    {
      title: 'List components',
      description: 'List design system components with family and one-line summary (what it is for). Use before building UI: prefer an existing component over new markup.',
      inputSchema: { family: z.string().optional().describe('Storybook family, e.g. Forms, Overlays.'), withSummaries: z.boolean().optional().describe('Default true locally, false remotely (fewer requests).') },
      annotations: RO,
    },
    run((a) => ops.listComponentsOp(ctx, a)),
  );

  server.registerTool(
    'bridge_get_component',
    {
      title: 'Get component',
      description: 'One component: props parsed from TypeScript (type, default, description, allowed values), usage docs (summary, whenToUse, whenNotToUse, dos/donts with examples, accessibility, contentGuidelines, anatomy), CSS variables it uses, and story names.',
      inputSchema: { name: z.string().describe('Component name, e.g. Button.'), include: z.array(z.string()).optional().describe('Keep only these docs keys, e.g. ["whenToUse","accessibility"].') },
      annotations: RO,
    },
    run((a) => ops.getComponentOp(ctx, a)),
  );

  server.registerTool(
    'bridge_draft_docs',
    {
      title: 'Draft component docs',
      description:
        "Start or refresh a component's docs.json. Returns what the code tells (props table from TypeScript, tokens its stylesheet reads, tokens it reads through another component's stylesheet, anatomy from the CSS module classes, contrast checks those tokens take part in, a changelog line, existing prose kept, the keys still missing), the target path, and a prompt for you to write the missing prose in the repo conventions. Nothing is written: save the result with \"draftedBy\": \"claude\" and \"needsReview\": true so a reviewer accepts it in Bridge Studio.",
      inputSchema: {
        name: z.string().describe('Component name, e.g. Icon.'),
        branch: z.string().optional().describe('Exploration branch (explore/<slug>): read the component there (GitHub) and save the draft on that branch, not in a pull request to main.'),
        page: z.number().int().min(1).optional().describe('Page of the prompt (default 1). A long prompt comes in pages; promptPage.next says when there is more.'),
      },
      annotations: RO,
    },
    run(async ({ page, ...a }) => ops.pagedDraftDocs(await ops.draftDocsOp(ctx, a), page)),
  );

  server.registerTool(
    'bridge_get_design_language',
    {
      title: 'Get design language',
      description: 'The design language doc (principles, color, type, space, density, radius, elevation, motion, icons, voice, accessibility). Without `section`: table of contents. With it: that section ("4", "Color", "voice-and-tone"), or "all".',
      inputSchema: { section: z.string().optional() },
      annotations: RO,
    },
    run((a) => ops.getDesignLanguage(ctx, a)),
  );

  server.registerTool(
    'bridge_get_guidelines',
    {
      title: 'Get guidelines',
      description: 'Rules for agents in this repo (AGENTS.md): always / ask before / never lists, token conventions, risk tiers, and what Bridge enforces. Pass `section` for one section verbatim, or "all".',
      inputSchema: { section: z.string().optional() },
      annotations: RO,
    },
    run((a) => ops.getGuidelines(ctx, a)),
  );

  // --- write: proposals ---
  server.registerTool(
    'bridge_propose_token_change',
    {
      title: 'Propose token change',
      description:
        'Propose token edits as a reviewable change. Applies edits with minimal JSON diffs, validates, runs the contrast gate before/after, computes the risk tier and semver bump, writes a changeset and a designer-friendly PR body. Blocked (nothing written) if it adds validation errors or breaks a contrast pair. Suggest mode (the default unless bridge.config.json says "changes": "direct"): files a suggestion, a GitHub issue with the exact edits, the checks and the tier, status "suggested" with its number; owners approve it and a developer applies it (bridge_apply_suggestion). Direct mode: local repo, commits to a new local bridge/* branch without touching your working tree (never pushes); GitHub with token, new branch + draft PR labelled "source: mcp" and its tier. With branch or pr it writes to that branch whatever the mode. Never writes to main. Use dryRun to preview. Tell the user token changes are Tier 3.',
      inputSchema: {
        title: z.string().min(3).describe('Short imperative title, e.g. "Darken muted text in dark theme". Becomes the branch name and PR title.'),
        summary: z.string().optional().describe('Why: the problem and the intent, for the reviewers. Plain sentences, no em dash.'),
        edits: z.array(EditArg).min(1),
        dryRun: z.boolean().optional().describe('Return the diff, tier, files and PR body without writing.'),
        branch: z.string().optional().describe('Exploration branch (explore/<slug>) to commit the edits to instead of opening a new pull request. GitHub: one commit on that branch. Local: written to the working tree, which must have that branch checked out. Never main.'),
        pr: z.union([z.number().int().positive(), z.string().min(1)]).optional().describe('A branch already in review (12 or "#12") to add the edits to, as "Edit tokens in this branch" in Studio: one commit there and a comment for the reviewers. Its author or someone with write access; needs GITHUB_TOKEN.'),
        jira: z.string().optional().describe('Jira key like DS-42, as in Studio\'s Start a change: first in the branch name and title so Jira links them.'),
        product: z.string().optional().describe('Product key or name (bridge_list_products) the change is for. Default: the product of the current folder or repo. Ask the person when it is not obvious.'),
        changes: ChangesArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run((a) => ops.proposeTokenChange(ctx, { ...a, source: 'mcp' })),
  );

  const Hue = z.union([z.string(), z.number()]);
  const BrandArgs = {
    slug: z.string().describe('Lowercase letters, digits and single dashes, 2 to 24 characters: "acme", "north-star". Becomes brands/<slug>.tokens.json and the data-brand value.'),
    name: z.string().optional().describe('Display name. Default: the slug in title case.'),
    from: z.string().optional().describe('Brand to start from (see bridge_list_brands), or "blank". Default: the default brand. Its theme overrides are copied.'),
    primary: Hue.optional().describe('Primary color: "#rrggbb" (pinned at the step primary buttons use, so a too-light color fails the contrast gate) or an OKLCH hue in degrees. Also drives accent and link unless set.'),
    neutral: Hue.optional().describe('Neutral tint: "#rrggbb" (its hue and how tinted it is) or an OKLCH hue. Text and line steps keep Bridge contrast.'),
    accent: Hue.optional().describe('Separate accent ramp (signal, focus ring). Optional.'),
    link: Hue.optional().describe('Separate link ramp. Optional.'),
    radius: z
      .union([z.enum(['soft', 'balanced', 'crisp']), z.object({ inset: z.number().optional(), control: z.number().optional(), container: z.number().optional(), overlay: z.number().optional() })])
      .optional()
      .describe('Radius roles: a preset (soft 6/12/20/20, balanced 4/10/16/20, crisp 2/4/6/10) or px per role on the radius scale.'),
    fonts: z.object({ heading: z.string().optional(), text: z.string().optional() }).optional().describe('Font ids the repo self-hosts: fraunces (headings only), instrument-sans, plex-sans, system.'),
    notes: z.string().optional().describe('Why this brand exists, for the reviewers. Plain sentences, no em dash.'),
  };

  server.registerTool(
    'bridge_list_brands',
    { title: 'List brands', description: 'Brands of the repo: slug, name, default, primary action color and theme override files.', inputSchema: {}, annotations: RO },
    run(async () => brand.listBrands(ctx)),
  );

  server.registerTool(
    'bridge_plan_brand',
    {
      title: 'Plan a new brand',
      description:
        'Dry run of a new brand: the brand token file (generated primary and neutral ramps, radius and font roles), copied theme overrides, the bridge.config.json change, every contrast pair for the new brand in light and dark (ok, or the failing pairs), validation issues, the risk tier (always Tier 3, minor) and the PR body. Writes nothing.',
      inputSchema: BrandArgs,
      annotations: RO,
    },
    run((a) => brand.planBrand(ctx, a)),
  );

  server.registerTool(
    'bridge_propose_brand',
    {
      title: 'Propose a new brand',
      description:
        'Propose a new brand as a reviewable change. Same plan as bridge_plan_brand; blocked (nothing written) when an input is invalid or a contrast pair fails. Local repo: commits to a new local bridge/brand-<slug> branch without touching your working tree (never pushes). GitHub with token: new branch + draft PR labelled "source: mcp", "tier: 3" and "tokens". Never writes to main. Suggest mode (the default unless bridge.config.json says "changes": "direct"): one suggestion issue with the brand files instead, applied by a developer once approved. Tell the user a new brand is Tier 3: it needs design and tech owner approval.',
      inputSchema: { ...BrandArgs, dryRun: z.boolean().optional().describe('Return the plan and file contents without writing.'), changes: ChangesArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run((a) => brand.proposeBrand(ctx, { ...a, source: 'mcp' })),
  );

  server.registerTool(
    'bridge_list_reviews',
    {
      title: 'List reviews',
      description: 'Open pull requests on the repo (flagging the ones Bridge opened) and, locally, the bridge/* proposal branches.',
      inputSchema: { state: z.enum(['open', 'closed', 'all']).optional(), onlyBridge: z.boolean().optional().describe('Only PRs labelled source: mcp or on bridge/* branches.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => ops.listReviews(ctx, a)),
  );

  server.registerTool(
    'bridge_get_review',
    {
      title: 'Get review',
      description: 'Review a token change: designer-readable diff table, contrast before -> after, new validation errors, downstream impact, computed risk tier (and a warning if labelled lower), and for PRs the CI status, approvals and roles: who may approve design, approve tech and ship, with GitHub teams named and their size, and any team that cannot be read with the fix. Pass `pr` (GitHub) or `branch` (local proposal branch).',
      inputSchema: { pr: z.number().int().positive().optional(), branch: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => ops.getReview(ctx, a)),
  );

  server.registerTool(
    'bridge_review_pr',
    {
      title: 'Review pull request',
      description: 'Post a review on a PR as the token owner: comment, approve or request changes, with a body. Kept for older prompts: bridge_review_branch does the same in designer words (an approval may have no text). Needs GITHUB_TOKEN. Only do this when the user asked for it; merging is a separate step (bridge_merge_branch), only when the person asks.',
      inputSchema: { pr: z.number().int().positive(), event: z.enum(['comment', 'approve', 'request_changes']), body: z.string().min(1).describe('What to fix or why it is fine. Plain sentences.') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    run((a) => ops.reviewPr(ctx, a)),
  );

  // --- history and rollback ---
  const ResolutionsArg = z.record(z.string(), z.enum(['keep-current', 'use-before'])).describe('Per conflict key ("path@file" from bridge_plan_revert): keep-current (default) keeps the later value, use-before puts the value from before the reverted change back.');
  const RestoreArg = z
    .object({
      path: z.string().describe('Token path (or CSS variable).'),
      entry: z.string().optional().describe('History entry (id, #PR or sha) whose value to put back: the value right after that change.'),
      side: z.enum(['before', 'after']).optional().describe('before: the value from just before `entry` instead. Default after.'),
      value: z.any().optional().describe('Or the value itself: "#ff5500", "{palette.neutral.600}", raw DTCG.'),
      file: z.string().optional().describe('Token file relative to the tokens root, when the token lives in several files.'),
      mode: ModeArg.optional().describe('Alternative to file: {"theme":"dark"}.'),
    })
    .describe('Restore one token to an older value instead of reverting a whole change.');

  server.registerTool(
    'bridge_get_history',
    {
      title: 'Get token history',
      description: 'History of the design tokens: merged token-changing PRs and commits (local git: first parent of HEAD; GitHub: PR merge commits), newest first, each with author, date, why (changeset summary, PR or commit body), version it shipped in, risk tier, semver bump, breaking flag and change counts, plus the timeline of design system versions. Filter by token (path or group prefix), author, tier, version, breaking, dates or text.',
      inputSchema: {
        token: z.string().optional().describe('Token path or group prefix: color.text matches color.text.muted.'),
        author: z.string().optional(),
        tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        version: z.string().optional().describe('"1.2.0" or "Unreleased".'),
        breaking: z.boolean().optional(),
        since: z.string().optional().describe('ISO date, inclusive.'),
        until: z.string().optional().describe('ISO date, inclusive.'),
        query: z.string().optional().describe('Text in the title, why, PR number or sha.'),
        limit: z.number().int().min(1).max(200).optional().describe('Entries returned (default 20).'),
        includeChanges: z.boolean().optional().describe('List the token changes of each entry (always on with token).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => history.getHistory(ctx, a)),
  );

  server.registerTool(
    'bridge_get_token_history',
    {
      title: 'Get token history for one token',
      description: 'Every recorded change of one token, newest first, renames followed: value before and after per mode (raw and resolved CSS), who, when, the PR and why. Use before restoring a value or answering "when did this change and why".',
      inputSchema: { path: z.string().describe('color.text.muted or --color-text-muted.'), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => history.getTokenHistory(ctx, a)),
  );

  server.registerTool(
    'bridge_plan_revert',
    {
      title: 'Plan a revert (dry run)',
      description: 'What undoing a merged token change takes, computed against the CURRENT base branch (not a blind git revert): the inverse edits, conflicts where a token changed again later (with the later PR), changes already undone, contrast before and after, new validation errors, risk tier, files and the PR body ("Revert: <title>", links the original PR). Or pass restore to put one token back to an older value. Writes nothing.',
      inputSchema: {
        target: z.string().optional().describe('History entry to undo: id (pr-12), PR number (#12) or commit sha.'),
        restore: RestoreArg.optional(),
        resolutions: ResolutionsArg.optional(),
        restoreConflicts: z.boolean().optional().describe('Every conflict uses the value from before the change. Only when the user asked.'),
        includeBody: z.boolean().optional().describe('Include the PR body (default true).'),
        limit: z.number().int().min(1).max(500).optional().describe('Edits, conflicts, skipped and changes listed per call (default 50). counts gives the totals.'),
        offset: z.number().int().min(0).optional().describe('Skip that many of each list, to read the next page.'),
      },
      annotations: RO,
    },
    run((a) => history.planRevertOp(ctx, a)),
  );

  server.registerTool(
    'bridge_propose_revert',
    {
      title: 'Propose a revert',
      description: 'Plans the revert (or restore) like bridge_plan_revert, then: local repo, commits to a new local bridge/* branch without touching your working tree (never pushes); GitHub with token, new bridge/* branch and a PR labelled revert and its tier (draft for Tier 2 and 3). Blocked when it would add validation errors or break a contrast pair. Never writes to main. Suggest mode (the default unless bridge.config.json says "changes": "direct"): one suggestion issue with the files instead, applied by a developer once approved. Show the user the plan and its conflicts first.',
      inputSchema: {
        target: z.string().optional(),
        restore: RestoreArg.optional(),
        resolutions: ResolutionsArg.optional(),
        restoreConflicts: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        changes: ChangesArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run((a) => history.proposeRevert(ctx, { ...a, source: 'mcp' })),
  );

  server.registerTool(
    'bridge_scaffold_component',
    {
      title: 'Scaffold component',
      description: "Generate a new component folder per the repo checklist: Name.tsx (forwardRef, typed props), Name.module.css (existing tokens only), stories with AllStates, docs.json with the reference component's keys, a keyboard + axe test when interactive, index.ts. Locally writes the files (never overwrites); remotely returns them. New components are Tier 2: confirm with the user first.",
      inputSchema: {
        name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/).describe('PascalCase, e.g. SegmentedControl.'),
        family: z.string().describe('Storybook family, e.g. Forms, Navigation, Feedback.'),
        summary: z.string().describe('One sentence: what it is for (goes to docs.json and the JSDoc).'),
        element: z.string().default('div').describe('Root HTML element: div, button, span, nav, section, ul, a, input.'),
        interactive: z.boolean().default(true).describe('Adds the keyboard + axe test.'),
        basePrimitive: z.string().optional().describe('Base UI part it wraps, e.g. @base-ui/react/toggle-group.'),
        write: z.boolean().optional().describe('Local only: false returns the files without writing.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    run((a) => ops.scaffoldComponentOp(ctx, a)),
  );

  server.registerTool(
    'bridge_visual_impact',
    {
      title: 'Visual impact of a change',
      description:
        'Screenshots what a design system change touches, before and after, and pixel-diffs them. Picks the impacted stories from the changed token values (CSS variables each component reads) and changed component files, plus the app screens (admin back office, both tenants), in every brand and theme. Builds Storybook and the app at both refs, so a full run takes minutes and needs Chrome; plan: true answers in seconds with the selection only. Returns counts, the largest changes with paths to before | after | diff composites, and the manifest path. Local repos only.',
      inputSchema: {
        base: z.string().optional().describe('Base git ref (default main). The merge base with head is used, like a pull request.'),
        head: z.string().optional().describe('Head git ref (default HEAD). Commits only: uncommitted edits are not captured.'),
        out: z.string().optional().describe('Output folder, relative to the repo (default visual-impact/).'),
        only: z.array(z.enum(['stories', 'app'])).optional().describe('Limit to Storybook stories or app screens.'),
        plan: z.boolean().optional().describe('Only compute what would be captured and why. No build, no browser.'),
        threshold: z.number().min(0).max(1).optional().describe('Per-pixel color distance that counts as a change (pixelmatch YIQ distance, default 0.03; one step of a color ramp is about 0.1).'),
        maxStoriesPerComponent: z.number().int().min(1).max(50).optional().describe('Stories per directly impacted component (default 4, AllStates first).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    run((a) => ops.visualImpact(ctx, a)),
  );

  // --- adoption ---
  server.registerTool(
    'bridge_audit',
    {
      title: 'Audit design system adoption',
      description:
        'Measure how a product codebase uses this design system (local only). Reads CSS, SCSS, Less, TS/JS, TSX/JSX, and Astro, Vue and Svelte files (template markup, frontmatter and <script> blocks, <style> blocks). Finds hardcoded colors, spacing, radii, shadows, durations, z-index and fonts in style sheets, style attributes, style/sx/styled objects, CSS-in-JS and Tailwind classes, each with the closest token (colors by deltaE across every mode) and a confidence; and in JSX and template markup, DS components versus foreign UI libraries (MUI, react-admin, Radix, shadcn/ui...), native elements a DS component should render, and re-created DS components. Hidden inputs and elements inside <noscript> do not count. A `bridge-audit-ignore-next-line: reason` comment on the line above leaves one exception out; an allowlist file lists known file:line exceptions; both need a reason and stay listed under `ignored`. Returns token and component adoption, counts by category, top files and top fixes; for a single file (or findings: true) the findings with line numbers.',
      inputSchema: {
        path: z.string().min(1).describe('Product folder or file, absolute or relative to the design system repo root.'),
        baseline: z.string().optional().describe('Earlier report from `bridge audit --json` to compare with (progress per metric and file).'),
        label: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Top files and fixes to return. Default 10.'),
        findings: z.boolean().optional().describe('Include per-file findings with line numbers. Default: only when auditing one file.'),
        allowlist: z.string().optional().describe('Allowlist file of known exceptions: { "entries": [{ "file", "line", "what"?, "reason" }] }, paths relative to the audited folder.'),
      },
      annotations: RO,
    },
    run((a) => ops.auditOp(ctx, a)),
  );

  // --- component change requests ---
  const KindArg = z.enum(REQUEST_KINDS.map((k) => k.value) as [string, ...string[]]);
  server.registerTool(
    'bridge_list_requests',
    {
      title: 'List component change requests',
      description:
        'Component change requests: GitHub issues labeled component-change (from Figma, Bridge Studio, the CLI or Claude). Each row has the number, component, kind, title, status (requested: open, no pull request; in-progress: an open pull request says "Closes #n"; done: closed as completed or by a merged pull request; declined: closed otherwise), url and linked pull requests.',
      inputSchema: {
        status: z.enum(['requested', 'in-progress', 'done', 'declined', 'all']).optional().describe('Default all.'),
        component: z.string().optional().describe('Only requests for this component, e.g. Button.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 100.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => requests.listRequests(ctx, a)),
  );

  server.registerTool(
    'bridge_get_request',
    {
      title: 'Get a component change request',
      description:
        'One request, ready to implement: the parsed request (component, kind, summary, changes asked, Figma link, images), its status and linked pull requests, the component files found under the components directory, the agent rules file, and `brief`: the prompt to implement it in this repo. Then work on a branch named agent/request-<n> and open a pull request whose body says "Closes #<n>". If the request is unclear, comment on the issue instead of guessing.',
      inputSchema: {
        number: z.number().int().positive().describe('Issue number.'),
        branch: z.string().optional().describe('Exploration branch (explore/<slug>) to implement it on: the brief then says to work there and never open a pull request to main. Default: the exploration the request names, if any.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => requests.getRequest(ctx, a)),
  );

  server.registerTool(
    'bridge_list_build_requests',
    {
      title: 'List build requests',
      description:
        'Build requests: structure changes pushed from Figma (a new variant, option, layout or component) that developers build, as GitHub issues labeled component-change and bridge-build, plus library branches from Figma waiting for a developer. Read only: developers split and track the work in GitHub or Jira, Bridge reads it. Each row has the number, component, title, status (requested: nobody assigned; picked-up: assigned; in-progress: a linked draft pull request; in-review: a linked pull request ready for review; shipped: merged or closed as completed; not-planned), who builds it, its age, stale (requested for more than 7 days), the linked pull request and the Jira key.',
      inputSchema: {
        filter: z.enum(['all', 'waiting', 'in-progress', 'shipped-this-week']).optional().describe('Default all. waiting: nobody picked it up yet. in-progress: picked up, in progress or in review.'),
        component: z.string().optional().describe('Only build requests for this component, e.g. Button.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 100.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => buildRequests.listBuildRequests(ctx, a)),
  );

  server.registerTool(
    'bridge_get_build_request',
    {
      title: 'Get a build request',
      description:
        'One build request, ready to build: what the designer sent (the request, before and after images, props needed, the spec when the issue keeps it), the status timeline, the linked pull request, the Jira key, the component files and `brief`, the prompt to build it in this repo. Build it on a branch named agent/build-<n> and open a pull request whose body says "Closes #<n>". The design is approved in Figma: build what it shows, comment on the issue when something is unclear.',
      inputSchema: { number: z.number().int().positive().describe('Issue (or library branch) number.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => buildRequests.getBuildRequest(ctx, a)),
  );

  server.registerTool(
    'bridge_create_request',
    {
      title: 'Create a component change request',
      description:
        'File a component change request as a GitHub issue labeled component-change (source: mcp), in the same format as Figma and Bridge Studio requests. Use it for component work (new component, variant, prop, structure, visual, token binding, bug) that someone should implement in code; token value changes go through bridge_propose_token_change instead. Needs GITHUB_TOKEN with issues write. dryRun returns the issue without creating it. Only create one when the user asked for it.',
      inputSchema: {
        component: z.string().min(1).describe('Component name as exported (Button), or the proposed name of a new component.'),
        kind: KindArg.describe(REQUEST_KINDS.map((k) => `${k.value}: ${k.hint}`).join(' ')),
        title: z.string().min(3).describe('One line, sentence case: "Add a danger ghost variant".'),
        summary: z.string().min(1).describe('What should change and why, in plain sentences. No em dash.'),
        changes: z
          .array(z.object({ field: z.string().min(1).describe('A prop, variant axis, token or part: "size", "radius", "color.action.primary.bg".'), before: z.string().optional(), after: z.string().optional() }))
          .optional()
          .describe('What changes, from what to what.'),
        figmaUrl: z.string().url().optional().describe('Link to the design in Figma, when there is one.'),
        exploration: z.string().optional().describe('Exploration branch (explore/<slug>) to implement it on instead of a pull request to main. Adds the exploration label.'),
        product: z.string().optional().describe('Product key or name (bridge_list_products) it is for. Default: the product of the current folder or repo.'),
        dryRun: z.boolean().optional().describe('Return the issue title, body and labels without creating it.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run((a) => requests.createRequest(ctx, { ...a, kind: a.kind as requests.CreateRequestInput['kind'], source: 'mcp' })),
  );

  // --- change texts drafted with the designer's own Claude (DS Bridge Figma plugin) ---
  server.registerTool(
    'bridge_pending_drafts',
    {
      title: 'Pending change texts from Figma',
      description: [
        `Change texts a designer asked their own Claude to write from the DS Bridge Figma plugin ("Draft with my Claude"), waiting on the bridge-requests branch. Call it when the user says "${DRAFT_PHRASE}".`,
        'Returns the pending sessions (newest first) with each item: scope (request: a component change request; push: a pull request description of token edits; docs: component docs sections from Bridge Studio, with a brief holding the full prompt), component, kind, the change table, token edits, the designer\'s notes, the deterministic starting draft, the change lines to write (one per component change, with an id, its changes and a starting line), a brief, and the before and after image links; the images themselves follow as image content when small enough.',
        'Look at the before and after images, then write what changes for developers and why it matters for people who use the component. Sentence case, start the title with a verb, no em dash, no invented numbers, names or reasons: if the reason is unknown, leave it out.',
        `Write one short sentence per change line from the images: what changed for developers (the part, the variant, the values you can read), for example "Icon added after the label in primary sm: Pencil, 16px", and the title of the request it becomes, for example "Add an icon after the label".`,
        `Then call bridge_write_drafts with one result per item id: title at most ${DRAFT_TITLE_MAX} characters, summary at most 3 sentences, lines (one per change line id) with a line of at most ${DRAFT_LINE_MAX} characters and a title of at most ${DRAFT_TITLE_MAX}.`,
        'Docs items: read the brief. Sections to check (the code changed after they were written) go in the answer ONLY when something in them is no longer true for the code (a wrong or removed prop, a removed state, changed behavior), fixed with the writer\'s wording kept elsewhere; leave accurate ones out (a missing key means unchanged, "docs": {} when all are accurate). Otherwise write only the sections its task names (summary a string; whenToUse, whenNotToUse, accessibility, contentGuidelines lists of strings; dos and donts lists of {"title", "text"}) from the facts it quotes, never a prop, variant or keyboard behavior that is not in the code, never anatomy; answer with "docs": {sections}. A selection task rewrites one passage: answer with "replacement": "the passage". No title or summary for docs items.',
      ].join(' '),
      inputSchema: {
        sessionId: z.string().optional().describe('One session only. Default: every pending session.'),
        images: z.boolean().optional().describe('Inline the before and after PNGs as image content. Default true.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (a) => {
      try {
        const { answer, images } = await drafts.pendingDrafts(ctx, a);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(answer, null, 2) },
            ...images.flatMap((img) => [
              { type: 'text' as const, text: `${img.label === 'before' ? 'Before (baseline)' : 'After (now in Figma)'}: session ${img.sessionId}, item ${img.itemId}${img.line ? `, line ${img.line}` : ''}` },
              { type: 'image' as const, data: img.base64, mimeType: 'image/png' },
            ]),
          ],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'bridge_write_drafts',
    {
      title: 'Write change texts for Figma',
      description:
        `Write the titles, summaries and change lines (or, for docs items, the docs sections or the rewritten passage) you drafted for a session from bridge_pending_drafts. Docs results show up on the Library page marked "Drafted by Claude" for review, cleaned to the docs.json shapes (no em dash; only the sections the item asks for). The DS Bridge Figma plugin fills change texts in within seconds, marked "Drafted by Claude, review before sending"; it never overwrites text the designer typed meanwhile. Each change line becomes the main line of its component row and the first line of its request; its title becomes that request's title. Texts are cleaned to the contract (no em dash, titles at most ${DRAFT_TITLE_MAX} characters without a trailing period, summary at most 3 sentences, each line at most ${DRAFT_LINE_MAX} characters). Results without lines, or lines without a title, still work. Needs GITHUB_TOKEN with contents write. Writes only the session file on the bridge-requests branch, never main.`,
      inputSchema: {
        sessionId: z.string().min(1).describe('The sessionId from bridge_pending_drafts.'),
        results: z
          .array(
            z.object({
              id: z.string().min(1).describe('The item id from bridge_pending_drafts.'),
              title: z.string().optional().describe(`Change items: one line, sentence case, starts with a verb, at most ${DRAFT_TITLE_MAX} characters, no trailing period. A request title never repeats the component name. Leave it out for docs items.`),
              summary: z.string().optional().describe('Change items: at most 3 sentences, what changes for developers and why it matters. No em dash, no invented numbers. Leave it out for docs items.'),
              docs: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('Docs items with a sections task: only the sections the brief asks for (a section to check only when it is no longer true for the code; leave accurate ones out), in docs.json shapes: summary a string; whenToUse, whenNotToUse, accessibility, contentGuidelines lists of strings; dos and donts lists of {"title", "text"}.'),
              replacement: z.string().optional().describe('Docs items with a selection task: the rewritten passage only, plain text, Bridge voice, no em dash.'),
              lines: z
                .array(
                  z.object({
                    id: z.string().min(1).describe('A change line id from the item\'s "lines" in bridge_pending_drafts.'),
                    line: z.string().describe(`One sentence, at most ${DRAFT_LINE_MAX} characters, no trailing period: what changed for developers, read from the before and after images ("Icon added after the label in primary sm: Pencil, 16px").`),
                    title: z
                      .string()
                      .optional()
                      .describe(`The title of the request this component change becomes: short, sentence case, starts with a verb, at most ${DRAFT_TITLE_MAX} characters, no trailing period, never the component name ("Add an icon after the label").`),
                  }),
                )
                .optional()
                .describe('One per change line the item lists. Leave it out when the item lists none.'),
            }),
          )
          .min(1)
          .describe('One result per item.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    run((a) => drafts.writeDrafts(ctx, a)),
  );

  // --- explorations ---
  server.registerTool(
    'bridge_start_exploration',
    {
      title: 'Start an exploration',
      description:
        'Start an exploration: a branch explore/<slug> from the default branch with a note file, and a DRAFT pull request labeled exploration. When the designer says they want to explore, try or prototype something, start one right away: take the name from what they said, never ask them for a purpose, a brief or a use case. For a product with its own repository (bridge.config.json products[].repo, see bridge_list_products), the branch and the draft pull request are created IN THAT PRODUCT REPOSITORY by default, so developers check it out in their own environment; the library arrives there as the npm package (npm i @bridge-ds/react@<snapshot> for unreleased library changes). Otherwise (a product folder of the design system repo, the demo workspace) it is created in the design system repository with per-branch previews and a snapshot package. If Bridge cannot reach the product repository, the error says so: tell the designer plainly that an admin needs to connect that product to Bridge, and only start it in the design system repository (where: "library") if they choose that. Never merged as is: a person says "Done exploring" (bridge_promote_exploration) to hand it to developers. GitHub with GITHUB_TOKEN: branch and draft pull request. Local without a token: a local branch only, nothing pushed. dryRun previews it.',
      inputSchema: {
        name: z.string().min(1).describe('Short name, sentence case: "Pill buttons". Becomes explore/pill-buttons.'),
        purpose: z.string().optional().describe('Optional, never ask for it. The designer\'s own first sentence about what they explore, when they said one; otherwise leave it out. No em dash.'),
        useCase: z.enum(EXPLORATION_USE_CASES.map((u) => u.value) as [string, ...string[]]).optional().describe(EXPLORATION_USE_CASES.map((u) => `${u.value}: ${u.hint}`).join(' ')),
        experimental: z.array(z.string()).optional().describe('What is experimental, one line each: "color.action.primary.bg", "Button: pill radius".'),
        product: z.string().optional().describe('Product key or name (bridge_list_products) it is tried in. Default: the product of the current folder or repo.'),
        where: z.enum(['product', 'library']).optional().describe('product (default): in the product\'s own repository when it has one, else the design system repository. library: always the design system repository; only when the designer chose it after Bridge could not reach the product repository.'),
        dryRun: z.boolean().optional().describe('Return the branch, note and pull request body without writing.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run((a) => explorations.startExploration(ctx, { ...a, source: 'mcp' })),
  );

  server.registerTool(
    'bridge_list_explorations',
    {
      title: 'List explorations',
      description:
        'Explorations (pull requests on explore/* branches) of the design system repository and of every product with its own repository (bridge.config.json products[].repo, one read each; a product repository Bridge cannot reach is left out, bridge_list_products says which): ref ("#12", or "shop#12" in a product repository: pass it as is to the other exploration tools), repo, name, purpose, status (active: running; ready: done exploring, waiting for code; building: developers push to it; shipped: merged; promoted: sent to review the older way; closed), archived, author, last update, for open ones the preview links Vercel reports (url null while it has not reported one yet) and the install command a product staging branch uses, read from the preview comment on the pull request (state building until the snapshot of the latest commit is published, never a guessed command), and the component requests implemented on each. Archived ones are left out unless archived is true. Locally, also explore/* branches without a pull request.',
      inputSchema: {
        state: z.enum(['open', 'closed', 'all']).optional().describe('Pull request state. Default open: running ones and the ones with the developers.'),
        archived: z.boolean().optional().describe('true: only the archived ones (the Archived filter in Studio).'),
        mine: z.boolean().optional().describe('true: only the ones the person started (the GitHub token\'s account). Used once at the start of a session to offer to continue one.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => explorations.listExplorations(ctx, a)),
  );

  server.registerTool(
    'bridge_continue_exploration',
    {
      title: 'Continue an exploration',
      description:
        'Pick an exploration up where it was left, when the person says "Continue Bridge exploration #12" (Studio\'s Continue in Claude line; shop#12 for a product with its own repository) or asks to continue one by name. Resolves it, switches the local checkout of its repository to its explore/ branch when nothing is uncommitted (checkout: false leaves the working tree alone; remote: the write tools take "branch"), and returns where it stands: stage (not-started: nothing built beyond the Bridge note; exploring; handed: done exploring or later), whereItStands (one or two plain sentences), the last 3 activity events, the changed files, the missing pieces when recorded, and the Continue in Claude lines. Start your answer with where it stands, without technical words, then ask what to do next. Read only on GitHub.',
      inputSchema: {
        exploration: z.string().min(1).describe('Its ref (#12, or shop#12 in a product repository), the whole "Continue Bridge exploration #12" line, a name, explore/<name> branch or pull request link.'),
        checkout: z.boolean().optional().describe('false: do not switch the local working tree. Default: switch when it is a clean checkout of the exploration\'s repository.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    run((a) => explorations.continueExploration(ctx, { ref: a.exploration, checkout: a.checkout })),
  );

  server.registerTool(
    'bridge_promote_exploration',
    {
      title: 'Done exploring',
      description:
        '"Done exploring" on an exploration (explore/<name>), as in Studio (the tool keeps its old name). It never closes, merges or marks the draft ready for review: the pull request stays open so its preview link keeps working for the designer, the DS lead, stakeholders and developers. The pieces you pass (ids from bridge_missing_pieces; ask the person which ones) each become a request for the DS lead with a link to the preview; pieces left out are not proposed. For an exploration in a product\'s own repository (shop#42) the requests are filed in the design system repository, where the DS lead works, and link back to the product pull request; its status keeps following that pull request. Then the exploration label and note go and ready-for-devs comes: developers take the branch (git fetch origin, then git checkout explore/<name>) as a starting point, never as code ready to ship. Their pushes read "Being built", the merge "Shipped". Said again later, it only sends newly picked pieces. dryRun shows what it would send. Needs GITHUB_TOKEN (contents, pull requests and issues: write). Only when the person asked.',
      inputSchema: {
        exploration: z.string().min(1).describe('Its ref from bridge_list_explorations (#42, or shop#42 in a product repository), name, explore/<name> branch or pull request link.'),
        pieces: z.array(z.string()).optional().describe('Ids of the missing pieces the person ticked (bridge_missing_pieces). Omitted: none is proposed, and the result lists the ones not sent.'),
        dryRun: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    run((a) => explorations.doneExploring(ctx, { ref: a.exploration, pieces: a.pieces, dryRun: a.dryRun, source: 'mcp', agent: 'claude' })),
  );

  server.registerTool(
    'bridge_archive_exploration',
    {
      title: 'Archive an exploration',
      description:
        'Archive an exploration, as in Studio: the archived label on its still open pull request hides it from the default lists, home and counts (bridge_list_explorations with archived: true lists them). The preview link keeps working. unarchive: true brings it back. Prefer it to bridge_close_exploration, which removes the preview. Needs GITHUB_TOKEN (pull requests or issues: write). Only when the person asked.',
      inputSchema: { exploration: z.string().min(1).describe('Its ref from bridge_list_explorations (#42, or shop#42 in a product repository), name, explore/<name> branch or pull request link.'), unarchive: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    run((a) => explorations.archiveExploration(ctx, { ref: a.exploration, archived: !a.unarchive })),
  );

  server.registerTool(
    'bridge_close_exploration',
    {
      title: 'Close an exploration',
      description: 'Close an exploration without merging it. Its branch stays on GitHub, but closing removes its preview prerelease and visual images: archive it instead (bridge_archive_exploration) unless the person explicitly wants it closed. Needs GITHUB_TOKEN (pull requests: write). Only when the person asked.',
      inputSchema: { exploration: z.string().min(1).describe('Its ref from bridge_list_explorations (#42, or shop#42 in a product repository), name, explore/<name> branch or pull request link.') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    run((a) => explorations.closeExploration(ctx, { ref: a.exploration })),
  );

  // --- branches in review: the Studio actions (packages/mcp/src/branches.ts over @bridge-ds/core) ---
  const Pr = z.union([z.number().int().positive(), z.string().min(1)]).describe('The branch number Studio shows (12 or "#12"), its GitHub link, or "<product>#12" (shop#12, the ref bridge_list_explorations gives) for a branch in a product\'s own repository.');
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
  const READ = { readOnlyHint: true, openWorldHint: true } as const;

  // --- product branches and the library: missing pieces (packages/mcp/src/pieces.ts over @bridge-ds/core) ---
  const Piece = z.string().min(1).describe('The piece id bridge_missing_pieces returned ("badge-overdue-tone").');
  server.registerTool(
    'bridge_missing_pieces',
    {
      title: 'Find what a product branch adds outside the library',
      description:
        'Check a product branch (an exploration started for a product) against the library: the adoption audit on each product file it changes, at its start and at its head, keeps what the branch added. New hardcoded values become token pieces beside the closest token, values written on a library component become a variant of it ("Badge: overdue tone"), components from another UI library with no library equivalent become new components. Values equal to a token and components the library has are fixes, not pieces. With record: true, saves the result in the branch description, where Bridge Studio shows it (needs GITHUB_TOKEN, pull requests: write). Run it when a designer finishes exploring with you, then offer to open a library branch for each piece.',
      inputSchema: { pr: Pr, record: z.boolean().optional().describe('Save the pieces in the product branch description (Studio reads them there). Keeps the library branches already opened.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    run((a) => pieces.missingPiecesOp(ctx, a)),
  );

  server.registerTool(
    'bridge_open_library_branch',
    {
      title: 'Open a library branch for a missing piece',
      description:
        'Turn one recorded missing piece into a library branch linked to the product branch, as Bridge Studio does: a token piece opens a token change (same gate and body as bridge_propose_token_change, a draft for design and tech review) and the product branch takes its preview; a variant opens a library exploration with the brief to build it (build it there, then bridge_use_library_preview); a new component opens a component request. Both sides link: the library side says "Needed by" the product branch (label needed-by-product), the product branch records it. Suggest mode (the default unless bridge.config.json says "changes": "direct"): a token piece becomes a suggestion and a variant a component request, no branch; needs Issues write. Direct mode needs GITHUB_TOKEN (contents, pull requests and issues: write). dryRun shows what it would open. Only when the person asked.',
      inputSchema: { pr: Pr, piece: Piece, usePreview: z.boolean().optional().describe('Merge the new library branch into the product branch when it already changes something (default true).'), dryRun: z.boolean().optional(), changes: ChangesArg },
      annotations: WRITE,
    },
    run((a) => pieces.openLibraryBranchOp(ctx, { ...a, source: 'mcp' })),
  );

  server.registerTool(
    'bridge_product_branch',
    {
      title: 'Product branch and its library branches',
      description: 'A product branch as Studio shows it: the summary sentence, each linked library branch with its status and reviewers, what its preview means for the product branch and the next action, and the pieces with no library branch yet.',
      inputSchema: { pr: Pr },
      annotations: READ,
    },
    run((a) => pieces.productBranchOp(ctx, a)),
  );

  server.registerTool(
    'bridge_use_library_preview',
    {
      title: 'Use a library branch preview in a product branch',
      description: 'The product branch takes the latest commits of the library branch of a piece (Bridge merges it in), so the product preview shows the real library change before it ships. A conflict is left to a developer. Needs GITHUB_TOKEN (contents: write). Only when the person asked.',
      inputSchema: { pr: Pr, piece: Piece },
      annotations: WRITE,
    },
    run((a) => pieces.useLibraryPreviewOp(ctx, a)),
  );

  server.registerTool(
    'bridge_switch_to_published',
    {
      title: 'Switch a product branch to the published version',
      description: 'Once its library branches shipped, bring main into the product branch (GitHub update branch): it stops carrying the library change and uses the shipped one. Token conflicts go through bridge_update_from_main. Needs GITHUB_TOKEN (contents and pull requests: write). Only when the person asked.',
      inputSchema: { pr: Pr },
      annotations: WRITE,
    },
    run((a) => pieces.switchToPublishedOp(ctx, a)),
  );

  // --- components pushed from Figma (the DS Bridge plugin's Push tab) ---
  server.registerTool(
    'bridge_figma_changes',
    {
      title: 'Component changes sent from Figma',
      description: 'The library branches the DS Bridge Figma plugin opened for components changed in Figma (label from-figma), with where each stands: an exact token change (no AI, contrast gated), or a branch carrying the spec, waiting for Claude AI to draft the code, then drafted by Claude AI and reviewed by a person.',
      inputSchema: { state: z.enum(['open', 'closed', 'all']).optional().describe('Default open.') },
      annotations: READ,
    },
    run((a) => figma.figmaChangesOp(ctx, a)),
  );

  server.registerTool(
    'bridge_get_figma_change',
    {
      title: 'Get a component change from Figma, to draft it',
      description: 'One library branch sent from Figma: its spec (variant matrix, properties, bound variables per variant, layers, what code gave Figma before, the exact token swaps) and the brief to draft the code on that branch. Check out the branch, write the TSX, CSS module, examples, docs and changeset, run npm run specs and the tests, push, then call bridge_mark_figma_change_drafted.',
      inputSchema: { pr: Pr },
      annotations: READ,
    },
    run((a) => figma.getFigmaChangeOp(ctx, a)),
  );

  server.registerTool(
    'bridge_mark_figma_change_drafted',
    {
      title: 'Mark a Figma change drafted by Claude AI',
      description: 'After you pushed the code for a component change from Figma to its branch: mark its pull request ready for review, label it drafted-by-claude (no longer waiting-for-claude) and say so in its description, in one step, for a person to review. When GitHub refuses ready for review, the labels stay as they were and the error says why. Refused while the branch only carries the spec. Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: { pr: Pr },
      annotations: WRITE,
    },
    run((a) => figma.markFigmaDraftedOp(ctx, a)),
  );

  server.registerTool(
    'bridge_push_figma_component',
    {
      title: 'Send a component change from Figma',
      description:
        'What the DS Bridge plugin Push tab does, from a structured diff of a Figma component (the v 1 spec shape: component, figmaName, coded, kind, title, summary, changes, rebinds, needsCode, unknown, variantAxes, properties, bindings, anatomy). An exact token swap on a component token used nowhere else opens a token change (contrast gated, reviewed like any token change); anything that needs code opens a draft branch with the spec, waiting for Claude AI; detached layers, raw values and variables the library lacks are listed with what to do and never sent. Suggest mode (the default unless bridge.config.json says "changes": "direct"): a token suggestion or a component spec suggestion instead of a branch, Issues write only. dryRun shows the route. Direct mode needs GITHUB_TOKEN (contents and pull requests: write). Only when the person asked.',
      inputSchema: { diff: z.record(z.string(), z.unknown()).describe('The structured component diff (v 1).'), dryRun: z.boolean().optional(), changes: ChangesArg },
      annotations: WRITE,
    },
    run((a) => figma.pushFigmaComponentOp(ctx, { diff: a.diff as never, dryRun: a.dryRun, source: 'mcp', changes: a.changes })),
  );

  // --- Fix with Claude: the team's own Claude fixes components whose Figma build differs from their story ---
  const FixFiles = {
    measured: z.string().optional().describe('measured-specs.json path (default measured-specs.json): read in the repo, else on the bridge-requests branch where the automatic measure (bridge-measure workflow) publishes it.'),
    fidelity: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe('The Check fidelity run: a path in the repo, or the report itself (pasted from the plugin\'s "Copy the report"). Default: figma-fidelity.json in the repo, else on the bridge-requests branch where the plugin\'s "Fix with Claude" saves it.'),
    fixesFile: z.string().optional().describe('figma-fixes.json path in the repo (default figma-fixes.json).'),
  };
  const FixesArg = z.array(z.record(z.string(), z.unknown())).min(1).describe('Fix objects for figma-fixes.json, for this component only (bridge_get_gap_case gives the schema). A fix with the id of one already in the file replaces it.');

  server.registerTool(
    'bridge_figma_gaps',
    {
      title: 'Components that differ in Figma',
      description:
        "The components whose Figma build differs from their story (Differs) or cannot be checked (Can't check, with the reason), from the latest Check fidelity run of the DS Bridge plugin (the story shots are the referee), else from the measure's own check; a status fix in figma-fixes.json shows with its reason. Read only. Start of Fix with Claude: you are the team's Claude, Bridge is the referee and a person approves.",
      inputSchema: FixFiles,
      annotations: RO,
    },
    run((a) => figmaFixes.figmaGapsOp(ctx, a)),
  );

  server.registerTool(
    'bridge_get_gap_case',
    {
      title: 'Get the gap case of one component',
      description:
        'One component\'s gap case: per differing variant, its story, args, state, shot and every difference with the part id, property, expected (code) and actual (Figma) and the delta in px, plus the figma-fixes.json schema. Write fixes for this component only from the part ids and deltas it gives, never an invented part or token, then call bridge_try_figma_fix. Read only.',
      inputSchema: { component: z.string().min(1).describe('The Figma set name, e.g. "TextInput".'), ...FixFiles },
      annotations: RO,
    },
    run((a) => figmaFixes.getGapCaseOp(ctx, a)),
  );

  server.registerTool(
    'bridge_try_figma_fix',
    {
      title: 'Try fixes for one component (values referee)',
      description:
        `Checks proposed fixes offline, nothing is written: validates them (the strict figma-fixes.json validator), lays them on the measure, rebuilds the set the way the plugin pulls it, and compares each differing variant with what the code renders. Returns per variant every difference before and after with its delta, new differences the fixes add, and a verdict closer, same or worse. The pixel referee (story shot against the real Figma render) is not run here: it runs in the plugin's Check fidelity after the next pull. Use at most ${FIX_LOOP_MAX_ROUNDS} rounds per component: keep what moved closer, revise the rest; when no round is closer, propose a status fix (Differs or Can't check, with the reason) instead.`,
      inputSchema: { component: z.string().min(1).describe('The Figma set name.'), fixes: FixesArg, ...FixFiles },
      annotations: RO,
    },
    run((a) => figmaFixes.tryFigmaFixOp(ctx, a)),
  );

  server.registerTool(
    'bridge_propose_figma_fixes',
    {
      title: 'Propose fixes for review',
      description:
        'Opens the accepted fixes for review like other Bridge changes: figma-fixes.json with them on a new bridge/* branch and a draft pull request labelled drafted-by-claude, figma-fixes and its tier (locally: a new local branch, never pushed). The body has the gap, each fix with its reason, and the before and after deltas. Runs the values referee again first and refuses fixes that move the component further from the code, or part fixes that move nothing (propose a status fix instead); a fix that sizes, places or lays out a part opens on "same", since Check fidelity judges layout. Never main. dryRun shows the body and the file. Needs a GitHub token with Contents and Pull requests write in remote mode. Only when the person asked.',
      inputSchema: {
        component: z.string().min(1).describe('The Figma set name.'),
        fixes: FixesArg,
        summary: z.string().min(1).describe('One or two sentences for the reviewer: what the fixes do for the designer. No em dash.'),
        dryRun: z.boolean().optional(),
        ...FixFiles,
      },
      annotations: WRITE,
    },
    run((a) => figmaFixes.proposeFigmaFixesOp(ctx, { ...a, source: 'mcp' })),
  );

  server.registerTool(
    'bridge_list_products',
    {
      title: 'List products',
      description: 'The products of this design system (bridge.config.json "products": name, repo or folder, preview link pattern, framework; for a product with its own repository, connection: connected, read-only or not-connected, where not-connected means its explorations are left out of the lists until an admin installs the Bridge GitHub App there) and the one the current folder or repo belongs to, which tools that start work use when no product is given. Ask the person which product when it is not obvious.',
      inputSchema: {},
      annotations: RO,
    },
    run(async () => branches.listProducts(ctx)),
  );

  server.registerTool(
    'bridge_what_needs_me',
    {
      title: 'What needs me',
      description: 'The review queue, as Studio counts it (open branches, without running explorations and the release automation), each with its status in designer words, and first the ones where the person acts now: an approval they can give, their own branch blocked, ready for them to merge. Needs GITHUB_TOKEN to know who "me" is; without it, the queue only.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe('Branches read (default 20, each costs a few GitHub reads).') },
      annotations: READ,
    },
    run((a) => branches.whatNeedsMe(ctx, a)),
  );

  server.registerTool(
    'bridge_branch_status',
    {
      title: 'Branch status',
      description: 'One branch in review as Studio shows it: its product, status (draft, in review, needs design or tech approval, blocked by tests, conflict, ready to merge, merged, closed), approvals (Tier 1: one owner approval; a branch that applies an approved suggestion carries its approvals), tests, how it stands against main, whether the person may merge it (the same verdict as the Merge button and status chips in Studio), and the next step. For the token diff and contrast, use bridge_get_review.',
      inputSchema: { pr: Pr },
      annotations: READ,
    },
    run((a) => branches.branchStatus(ctx, a)),
  );

  server.registerTool(
    'bridge_list_comments',
    {
      title: 'List comments',
      description: 'The conversation on a branch and its line comment threads, with the ids to reply to (bridge_comment with replyTo).',
      inputSchema: { pr: Pr },
      annotations: READ,
    },
    run((a) => branches.listComments(ctx, a)),
  );

  server.registerTool(
    'bridge_try_branch',
    {
      title: 'Try it in a product, share it',
      description: 'Try a branch before it merges: the preview link of each product Vercel reported for it (the admin demo opens with the Bridge toolbar on, as "Try it in the product" in Studio), the other previews, and "Share with a product team": the install command a product team runs in a staging branch, or why there is none yet, with a ready-to-paste message. Never a guessed link. Writes nothing.',
      inputSchema: { pr: Pr },
      annotations: READ,
    },
    run((a) => branches.tryBranch(ctx, a)),
  );

  server.registerTool(
    'bridge_combine_branches',
    {
      title: 'Try 2 to 4 branches together',
      description: 'Combined preview of 2 to 4 token branches, as "Try together" in Studio: each branch\'s own token edits on the latest main, the tokens two branches set differently (pick one per key with picks), and the links that open the combination (the admin demo with the Bridge toolbar, the library views). Branches that change code are refused. Writes nothing.',
      inputSchema: {
        prs: z.array(Pr).min(2).max(4).describe('2 to 4 branch numbers.'),
        picks: z.record(z.string(), z.number().int().positive()).optional().describe('For each conflict key, the branch whose value to use: {"semantic/light.tokens.json#color.text.muted": 118}.'),
      },
      annotations: READ,
    },
    run((a) => branches.combineBranches(ctx, a)),
  );

  server.registerTool(
    'bridge_get_settings',
    {
      title: 'Get settings',
      description: 'What Studio Settings shows that is safe to read: who approves design and tech (GitHub teams named with their size), who may merge, the owner override (who, what reason), whether main is protected, the products, the preview apps and the visual impact mode. Never tokens or secrets.',
      inputSchema: {},
      annotations: READ,
    },
    run(async () => studio.getSettings(ctx)),
  );

  server.registerTool(
    'bridge_figma_coverage',
    {
      title: 'Figma coverage',
      description: 'Which components are in Figma, in Studio\'s words (Yes, Drafted, Auto layout, Not yet with the reason), and whether code images exist for the fidelity check the DS Bridge Figma plugin runs (its scores live in Figma).',
      inputSchema: { component: z.string().optional().describe('One component, e.g. Button.') },
      annotations: READ,
    },
    run((a) => studio.figmaCoverage(ctx, a)),
  );

  server.registerTool(
    'bridge_send_for_review',
    {
      title: 'Send for review',
      description: 'Ask for review: a draft branch becomes ready for review, as "Mark as ready" in Studio. Its author only. Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: { pr: Pr },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run((a) => branches.sendForReview(ctx, a)),
  );

  server.registerTool(
    'bridge_back_to_draft',
    {
      title: 'Back to draft',
      description: 'Take a branch out of review back to draft, as in Studio\'s More menu. Its author only. Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: { pr: Pr },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run((a) => branches.backToDraft(ctx, a)),
  );

  server.registerTool(
    'bridge_review_branch',
    {
      title: 'Review a branch',
      description: 'Approve, request changes or comment on a branch, as the review box in Studio, on the version the person saw, under their GitHub account. Request changes and comment need a text that says what to change; an approval may have none. Only when the person asked. Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: {
        pr: Pr,
        decision: z.enum(['approve', 'request_changes', 'comment']),
        body: z.string().optional().describe('What to change, or why it is fine. Plain sentences, no em dash.'),
      },
      annotations: WRITE,
    },
    run((a) => branches.reviewBranch(ctx, a)),
  );

  server.registerTool(
    'bridge_ask_someone_else',
    {
      title: 'Ask someone else to review',
      description: 'Ask the other people who can give the missing approvals to review a branch, as "Ask someone else to review" in the Studio review queue, and take the person off its requested reviewers. Never the person or the author. Only when the person asked; dryRun says who would be asked. Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: { pr: Pr, dryRun: z.boolean().optional() },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run((a) => branches.askSomeoneElse(ctx, a)),
  );

  server.registerTool(
    'bridge_comment',
    {
      title: 'Comment on a branch',
      description: 'Post a comment on a branch, or reply in the thread of a line comment (replyTo: its id from bridge_list_comments). Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: { pr: Pr, body: z.string().min(1).describe('Plain sentences, no em dash.'), replyTo: z.number().int().positive().optional().describe('Line comment thread to reply in.') },
      annotations: WRITE,
    },
    run((a) => branches.commentOnBranch(ctx, a)),
  );

  server.registerTool(
    'bridge_merge_branch',
    {
      title: 'Merge a branch',
      description:
        'Merge a branch into main through the same gate as Studio\'s Merge button: tests pass, the approvals its tier needs (Tier 1: one owner approval; Tier 2 and 3: design and tech; a branch that applies an approved suggestion with Closes #n carries its approvals while the suggestion stays approved and the tier is not higher), no changes requested, no conflict, not a draft or an exploration, and the person holds the right to ship (governance.rights). When it is blocked, the error says by what. Owner override: pass overrideReason when only approvals are missing and the person is an owner named in governance.override.allowed; the reason is always required (at least minReasonLength characters, 20 by default) and posted on the branch first. Only when the person explicitly asked to merge; dryRun checks without merging. Needs GITHUB_TOKEN (contents and pull requests: write); GitHub\'s own branch rules still apply.',
      inputSchema: {
        pr: Pr,
        overrideReason: z.string().optional().describe('Owner override only: why it merges without the missing approvals (at least the configured length). Posted on the branch.'),
        dryRun: z.boolean().optional().describe('Check the gate without merging.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    run((a) => branches.mergeBranch(ctx, a)),
  );

  server.registerTool(
    'bridge_close_branch',
    {
      title: 'Close a branch',
      description: 'Close a branch without merging it, as in Studio\'s More menu. Its work stays on GitHub and it can be reopened. Explorations close with bridge_close_exploration. Only when the person asked. Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: { pr: Pr },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    run((a) => branches.closeBranch(ctx, a)),
  );

  server.registerTool(
    'bridge_reopen_branch',
    {
      title: 'Reopen a branch',
      description: 'Reopen a closed branch, with Studio\'s rule: its author or an owner with write access, and only while its work is still on GitHub. Needs GITHUB_TOKEN (pull requests: write).',
      inputSchema: { pr: Pr },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run((a) => branches.reopenBranch(ctx, a)),
  );

  server.registerTool(
    'bridge_update_from_main',
    {
      title: 'Update from main',
      description:
        'Bring the latest main into a branch, as "Update from main" in Studio. Nothing conflicts: GitHub updates it. Only token files conflict: the tokens changed on both sides come back with keys; pass choices ("mine" keeps the branch value, "theirs" uses main\'s; tokens with a default keep the branch value) and Bridge commits the resolution. Code conflicts stay with a developer on GitHub. dryRun shows what would happen. Needs GITHUB_TOKEN (contents and pull requests: write).',
      inputSchema: {
        pr: Pr,
        choices: z.record(z.string(), z.enum(['mine', 'theirs'])).optional().describe('Per conflict key from a dry run: "mine" or "theirs".'),
        dryRun: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    run((a) => branches.updateFromMain(ctx, a)),
  );

  server.registerTool(
    'bridge_save_docs',
    {
      title: 'Save component docs',
      description:
        "Save a component's usage guidance (docs.json sections: summary, whenToUse, whenNotToUse, dos, donts, accessibility, contentGuidelines, anatomy, preview) the way the Library edit mode does: merged into the docs on the branch, cleaned and checked (a summary, no empty items, no em dash). Without pr: a new branch sent for review (docs only: one owner approval, patch release note), with an optional Jira key and product. With pr: one commit on that open branch. Suggest mode (the default unless bridge.config.json says \"changes\": \"direct\"), without pr: a docs suggestion issue instead of a branch (Issues write only). dryRun returns the file. Direct mode needs GITHUB_TOKEN (contents and pull requests: write). Prose you drafted carries \"draftedBy\": \"claude\" and \"needsReview\": true so a reviewer accepts it in Studio.",
      inputSchema: {
        component: z.string().min(1).describe('Component name, e.g. Button.'),
        docs: z.record(z.string(), z.unknown()).describe('The sections to set, in docs.json shapes: summary a string; whenToUse, whenNotToUse, accessibility, contentGuidelines lists of strings; dos and donts lists of {"title","text"}.'),
        pr: Pr.optional().describe('An open branch to save the docs on, instead of a new one.'),
        title: z.string().optional().describe('Title of the new branch. Default: "docs(<component>): usage guidance for <Component>".'),
        notes: z.string().optional().describe('Why, for the reviewers.'),
        jira: z.string().optional().describe('Jira key like DS-42: first in the branch name and title so Jira links them.'),
        product: z.string().optional().describe('Product key or name (bridge_list_products). Default: the product of the current folder or repo.'),
        dryRun: z.boolean().optional(),
        changes: ChangesArg,
      },
      annotations: WRITE,
    },
    run((a) => studio.saveDocs(ctx, { ...a, source: 'mcp' })),
  );

  // --- suggestions: changes filed as issues, approved by the owners, applied by a developer (packages/mcp/src/suggestions.ts) ---
  const SuggestionNumber = z.union([z.number().int().positive(), z.string().min(1)]).describe('The suggestion issue number (42 or "#42"), or its link.');
  server.registerTool(
    'bridge_list_suggestions',
    {
      title: 'List suggestions',
      description:
        'Suggestions in the repo: GitHub issues labeled bridge-suggestion, each an exact change (tokens, docs, a component spec, a brand, a revert, settings) that the owners approve and a developer applies. Each row has the number, title, kind, tier, status (needs-review, changes-requested, approved, applying, applied, declined, outdated) and linked pull requests. Statuses here come from labels, except that an open one whose change no longer applies to main reads outdated; bridge_get_suggestion counts the approvals.',
      inputSchema: {
        status: z.enum(['needs-review', 'changes-requested', 'approved', 'applying', 'applied', 'declined', 'outdated', 'all']).optional().describe('Default all open ones.'),
        state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state. Default: open, or closed for applied and declined.'),
        kind: z.enum(['token-change', 'docs', 'component-spec', 'brand', 'revert', 'config']).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 100.'),
      },
      annotations: READ,
    },
    run((a) => suggestions.listSuggestionsOp(ctx, a)),
  );

  server.registerTool(
    'bridge_get_suggestion',
    {
      title: 'Get a suggestion',
      description:
        'One suggestion: the change (tokens before and after, docs, component spec, files), the checks when suggested, links, its version (payloadSha: what approvals bind to), who approved it, which approvals are missing for its tier, reviews that no longer count (an older version, or not an owner), whether the machine-readable block was edited by hand, linked pull requests, and for a component spec the brief to implement it.',
      inputSchema: { number: SuggestionNumber },
      annotations: READ,
    },
    run((a) => suggestions.getSuggestionOp(ctx, a)),
  );

  server.registerTool(
    'bridge_create_suggestion',
    {
      title: 'Create a suggestion',
      description:
        'File any change as a suggestion from its payload (schema bridge.suggestion/1: kind, title, summary, and tokens edits, docs, componentSpec or files). Missing schema, source, date, base commit and checks are filled. The paths are checked against what the kind may change and the guardrail files before anything is sent. For token, docs, brand, revert and Figma changes prefer their own tools, which plan and check the change first. Needs GITHUB_TOKEN with Issues write. dryRun returns the issue. Only when the person asked.',
      inputSchema: {
        payload: z.record(z.string(), z.unknown()).describe('The suggestion payload (bridge.suggestion/1).'),
        labels: z.array(z.string()).optional().describe('More labels for the issue.'),
        dryRun: z.boolean().optional().describe('Return the issue title, body and labels without creating it.'),
      },
      annotations: WRITE,
    },
    run((a) => suggestions.createSuggestionOp(ctx, a)),
  );

  server.registerTool(
    'bridge_review_suggestion',
    {
      title: 'Review a suggestion',
      description:
        'Approve, request changes on, comment on or decline a suggestion, as the person whose GitHub token the server has. Approvals and requested changes count only from the owners in bridge.config.json (read from the default branch) and only on the version reviewed: pass payloadSha from bridge_get_suggestion so a newer version is never approved by mistake. Request changes and decline need a message. Decline closes the issue as not planned. "override": the owner override (docs/GOVERNANCE.md): an owner governance.override allows approves their own suggestion as owner when nobody else can review it, with the reason in message (at least the minimum length); it is recorded on the suggestion. Needs GITHUB_TOKEN (Issues: read and write). Only when the person asked, with the decision they asked for.',
      inputSchema: {
        number: SuggestionNumber,
        event: z.enum(['approve', 'request-changes', 'comment', 'decline', 'override']),
        message: z.string().optional().describe('What should change, why it is declined, or the comment. Plain sentences, no em dash.'),
        role: z.enum(['design', 'tech', 'approval']).optional().describe('The role you approve for, shown in the comment. Informative: what counts is who you are in the owner lists.'),
        payloadSha: z.string().optional().describe('The version you reviewed (payloadSha or version from bridge_get_suggestion).'),
      },
      annotations: WRITE,
    },
    run((a) => suggestions.reviewSuggestionOp(ctx, a)),
  );

  server.registerTool(
    'bridge_apply_suggestion',
    {
      title: 'Apply a suggestion',
      description:
        'Apply a Bridge suggestion to today\'s code ("Apply Bridge suggestion #42"). Bridge checks the paths, the approvals of the owners on its current version, re-applies token edits on the current tokens, merges files, re-runs validation, contrast and the tier, and stops on a conflict, a missing approval or a check that would fail. Local repo: mode "dry-run" (the plan and the diff, nothing written; run it first), "branch" (default: one commit on a new local branch, working tree untouched, never pushes), "write" (into the working tree, refused over uncommitted changes) or "patch" (a git format-patch text). Remote repo: the plan and the files to write yourself. Once a branch or files exist, it records on the issue that it is being applied (needs Issues write). Then push and open a pull request whose body says "Closes #<n>", and call bridge_link_suggestion. acceptEdited and forceUnapproved only when the person asked.',
      inputSchema: {
        number: SuggestionNumber,
        mode: z.enum(['dry-run', 'branch', 'write', 'patch']).optional().describe('Default branch. Run dry-run first.'),
        acceptEdited: z.boolean().optional().describe('Apply even though the machine-readable block was edited by hand after Bridge wrote it (check it first).'),
        forceUnapproved: z.boolean().optional().describe('Apply without every approval, or with a tier that went up. Recorded on the issue.'),
        base: z.string().optional().describe('Local mode, branch and patch: the ref to build on. Default HEAD.'),
        branch: z.string().optional().describe('Local mode, branch: the branch name. Default <branchPrefix>suggestion-<n>-<slug>.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    run((a) => suggestions.applySuggestionOp(ctx, a)),
  );

  server.registerTool(
    'bridge_link_suggestion',
    {
      title: 'Link the pull request that applies a suggestion',
      description:
        'Record the pull request (or branch, or commit) that applies a suggestion: a comment on the issue and the "suggestion: applying" label. Warns when the pull request does not say "Closes #<n>": add it so the suggestion closes when it merges. Needs GITHUB_TOKEN (Issues: read and write).',
      inputSchema: {
        number: SuggestionNumber,
        pr: z.number().int().positive().optional().describe('The pull request number.'),
        branch: z.string().optional(),
        commit: z.string().optional(),
      },
      annotations: WRITE,
    },
    run((a) => suggestions.linkSuggestionOp(ctx, a)),
  );

  // --- resources ---
  server.registerResource('resolved-tokens', 'bridge://tokens/resolved', { title: 'Resolved tokens', description: 'Every token resolved in the default mode, plus only the values that differ in each other mode combination.', mimeType: 'application/json' }, async (uri) => {
    const set = await ctx.tokens();
    const def = set.defaultCombo;
    const base = Object.fromEntries(set.allPaths().filter((p) => set.view(def).has(p)).map((p) => [p, set.resolve(p, def).css]));
    const overrides: Record<string, Record<string, string>> = {};
    for (const c of set.combos()) {
      const key = core.comboKey(c);
      if (key === core.comboKey(def)) continue;
      const diff: Record<string, string> = {};
      for (const p of set.view(c).keys()) {
        const v = set.resolve(p, c).css;
        if (base[p] !== v) diff[p] = v;
      }
      overrides[key] = diff;
    }
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ default: def, modes: set.config.axes, values: base, overrides }, null, 1) }] };
  });

  server.registerResource('design-language', 'bridge://design-language', { title: 'Design language', description: 'The design language doc, in full.', mimeType: 'text/markdown' }, async (uri) => {
    const { config } = await ctx.config();
    const text = (config.docs.designLanguage && (await ctx.source.read(config.docs.designLanguage))) || 'No design language doc configured.';
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });

  server.registerResource('guidelines', 'bridge://guidelines', { title: 'Agent guidelines', description: 'AGENTS.md: rules for AI agents in this repo.', mimeType: 'text/markdown' }, async (uri) => {
    const { config } = await ctx.config();
    const text = (config.docs.guidelines && (await ctx.source.read(config.docs.guidelines))) || 'No guidelines configured.';
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });

  server.registerResource(
    'component',
    new ResourceTemplate('bridge://components/{name}', {
      list: async () => {
        const { config } = await ctx.config();
        const names = await listComponentNames(ctx.source, config);
        return { resources: names.map((n) => ({ uri: `bridge://components/${n.name}`, name: n.name, mimeType: 'application/json' })) };
      },
      complete: {
        name: async (value) => {
          const { config } = await ctx.config();
          return (await listComponentNames(ctx.source, config)).map((n) => n.name).filter((n) => n.toLowerCase().startsWith(value.toLowerCase()));
        },
      },
    }),
    { title: 'Component', description: 'Props, docs and token usage of one component.', mimeType: 'application/json' },
    async (uri, vars) => {
      const data = await ops.getComponentOp(ctx, { name: String(vars.name) });
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
    },
  );

  // --- prompts ---
  server.registerPrompt(
    'review-token-pr',
    { title: 'Review a token PR', description: 'Review a token pull request (or local bridge/* branch) like a design system owner.', argsSchema: { pr: z.string().optional().describe('PR number'), branch: z.string().optional().describe('Local proposal branch') } },
    ({ pr, branch }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Review the token change ${pr ? `in pull request #${pr}` : branch ? `on branch ${branch}` : '(ask me which PR)'} as the design system owner.`,
              '',
              `1. Call bridge_get_review with ${pr ? `{ "pr": ${Number(pr)} }` : branch ? `{ "branch": "${branch}" }` : 'the PR number'}.`,
              '2. Call bridge_get_guidelines for the token conventions and risk tiers.',
              '3. Check: is the tier right (any token add/change/remove is Tier 3)? Do new semantic tokens exist in both light and dark and alias palette roles, not primitives? Do names follow the existing paths? Did any contrast pair get worse or fail? Is the downstream impact intended? Is CI green and are both owners approving?',
              '4. Give me a verdict (approve, request changes, or comment) with a short reason per finding, written for a designer.',
              '5. Only post it with bridge_review_pr after I confirm.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'add-component',
    { title: 'Add a component', description: 'Plan and scaffold a new component the way this repo expects.', argsSchema: { name: z.string().describe('PascalCase name'), description: z.string().describe('What it is for'), family: z.string().optional() } },
    ({ name, description, family }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `I want a new component: ${name}. Purpose: ${description}.`,
              '',
              '1. bridge_list_components: is there already a component (or a variant of one) that does this? If yes, say so and stop.',
              '2. bridge_get_guidelines (section "New component checklist") and bridge_get_design_language for the relevant sections.',
              '3. bridge_get_component on the two closest existing components to copy their API style, states and docs depth.',
              '4. Check whether Base UI has a primitive for it; plan the props (our names, not Base UI internals), states, and the tokens it uses (bridge_search_tokens; never invent one, list any missing token as a Tier 3 question instead).',
              '5. Show me the plan. New components are Tier 2 (draft PR, design review). After I confirm, call bridge_scaffold_component' + (family ? ` with family "${family}"` : '') + ', then fill the generated files and docs.json.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'audit-ui-for-tokens',
    { title: 'Audit UI for tokens', description: 'Find hardcoded colors, lengths, durations, shadows and z-index in a CSS/TSX snippet and map each to a token.', argsSchema: { code: z.string().describe('CSS, CSS-in-JS or TSX snippet') } },
    async ({ code }) => {
      let findings = '';
      try {
        const f = await ops.auditUi(ctx, code);
        findings = f.length ? JSON.stringify(f, null, 1) : '[] (no hardcoded value found)';
      } catch (e) {
        findings = `(automatic scan failed: ${(e as Error).message})`;
      }
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'Audit this UI code for hardcoded design values and rewrite it with design tokens.',
                '',
                '```',
                code,
                '```',
                '',
                'Bridge scanned it and suggests these tokens (nearest first, semantic/component tiers preferred):',
                '```json',
                findings,
                '```',
                '',
                'For each finding pick the token that matches the intent, not only the value (text color vs border vs surface); confirm with bridge_get_token when unsure.',
                'Components must use semantic or component tokens for color, elevation and focus, never primitives. If no token fits, say which token is missing instead of keeping the literal (adding one is Tier 3).',
                'Return the rewritten code and a table: line, literal, token, why.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'migrate-file-to-ds',
    {
      title: 'Migrate a file to the design system',
      description: 'Audit one product file, then rewrite it with design system components and tokens.',
      argsSchema: { path: z.string().describe('Product file, absolute or relative to the design system repo root') },
    },
    async ({ path }) => {
      let audit = '';
      try {
        audit = JSON.stringify(await ops.auditOp(ctx, { path, findings: true, limit: 50 }), null, 1);
      } catch (e) {
        audit = `(automatic audit failed: ${(e as Error).message}; call bridge_audit with the path)`;
      }
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Migrate \`${path}\` to the design system: DS components instead of foreign UI libraries and native elements, tokens instead of hardcoded values.`,
                '',
                'Bridge audited it (findings with line numbers, the closest token for each value, the DS component for each foreign or native one):',
                '```json',
                audit,
                '```',
                '',
                '1. Read the file. For each component finding, call bridge_get_component on the suggested DS component and map the props (variants, sizes, labels, events). If no DS component fits, keep the original and say why.',
                '2. For each value: use the suggested token when the confidence is exact or high and it matches the intent (text vs background vs border); check medium and low ones with bridge_search_tokens or bridge_get_token. Use semantic or component tokens for color, elevation and focus, never primitives. If no token fits, keep the literal and list the missing token (adding one is Tier 3).',
                '3. Keep behavior and accessibility: same data flow, labels wired, keyboard paths, no new dependencies.',
                '4. Return the rewritten file, then a table: line, before, after, why. End with what is left (values or components without a DS equivalent).',
                '5. Run bridge_audit on the file again and report the new token and component adoption.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  for (const name of excluded) registered.get(name)?.remove();
  server.registerTool = register;
  return server;
}
