// The MCP surface: tools, resources and prompts over ./ops.ts.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { BridgeContext } from './context.js';
import { core } from './core-adapter.js';
import { listComponentNames } from './components.js';
import * as ops from './ops.js';

export const VERSION = '0.1.0';

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

export function createServer(ctx: BridgeContext): McpServer {
  const server = new McpServer(
    { name: 'bridge', version: VERSION },
    {
      instructions: [
        'Bridge exposes a design system repo (DTCG tokens, components, docs) to you.',
        'Read before you write: bridge_get_guidelines for the repo rules, bridge_search_tokens / bridge_get_token before using or proposing a token.',
        'Never hardcode a value in UI code when a token exists; never invent a token name (check it with bridge_get_token).',
        'bridge_audit measures how a product codebase adopts the design system (hardcoded values, foreign UI components) and suggests the tokens and components to use.',
        'Token changes go through bridge_propose_token_change only: it validates, checks contrast, and opens a branch or PR. It never writes to main.',
        'Adding, renaming or removing a token is Tier 3: tell the user it needs design and tech owner approval.',
      ].join(' '),
    },
  );

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
        'Propose token edits as a reviewable change. Applies edits with minimal JSON diffs, validates, runs the contrast gate before/after, computes the risk tier and semver bump, writes a changeset and a designer-friendly PR body. Blocked (nothing written) if it adds validation errors or breaks a contrast pair. Local repo: commits to a new local bridge/* branch without touching your working tree (never pushes). GitHub with token: new branch + draft PR labelled "source: mcp" and its tier. Never writes to main. Use dryRun to preview. Tell the user token changes are Tier 3.',
      inputSchema: {
        title: z.string().min(3).describe('Short imperative title, e.g. "Darken muted text in dark theme". Becomes the branch name and PR title.'),
        summary: z.string().optional().describe('Why: the problem and the intent, for the reviewers. Plain sentences, no em dash.'),
        edits: z.array(EditArg).min(1),
        dryRun: z.boolean().optional().describe('Return the diff, tier, files and PR body without writing.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run((a) => ops.proposeTokenChange(ctx, a)),
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
      description: 'Review a token change: designer-readable diff table, contrast before -> after, new validation errors, downstream impact, computed risk tier (and a warning if labelled lower), and for PRs the CI status and approvals. Pass `pr` (GitHub) or `branch` (local proposal branch).',
      inputSchema: { pr: z.number().int().positive().optional(), branch: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((a) => ops.getReview(ctx, a)),
  );

  server.registerTool(
    'bridge_review_pr',
    {
      title: 'Review pull request',
      description: 'Post a review on a PR as the token owner: comment, approve or request changes. Needs GITHUB_TOKEN. Only do this when the user asked for it; never merge (Bridge cannot).',
      inputSchema: { pr: z.number().int().positive(), event: z.enum(['comment', 'approve', 'request_changes']), body: z.string().min(1).describe('What to fix or why it is fine. Plain sentences.') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    run((a) => ops.reviewPr(ctx, a)),
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

  // --- adoption ---
  server.registerTool(
    'bridge_audit',
    {
      title: 'Audit design system adoption',
      description:
        'Measure how a product codebase uses this design system (local only). Scans CSS, SCSS, style/sx/styled objects, CSS-in-JS and Tailwind classes for hardcoded colors, spacing, radii, shadows, durations, z-index and fonts, each with the closest token (colors by deltaE across every mode) and a confidence; and JSX for DS components versus foreign UI libraries (MUI, react-admin, Radix, shadcn/ui...), native elements and re-created DS components. Returns token and component adoption, counts by category, top files and top fixes; for a single file (or findings: true) the findings with line numbers.',
      inputSchema: {
        path: z.string().min(1).describe('Product folder or file, absolute or relative to the design system repo root.'),
        baseline: z.string().optional().describe('Earlier report from `bridge audit --json` to compare with (progress per metric and file).'),
        label: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Top files and fixes to return. Default 10.'),
        findings: z.boolean().optional().describe('Include per-file findings with line numbers. Default: only when auditing one file.'),
      },
      annotations: RO,
    },
    run((a) => ops.auditOp(ctx, a)),
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

  return server;
}
