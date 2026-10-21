// New brands for the MCP server and the CLI: list, plan (dry run) and propose (local branch or draft PR).
// The planner is @bridge-ds/core planNewBrand, the same one the Studio and the Figma plugin use.
import { baseBranchOf, composeNewBrandBody, type ChangesMode, listBrands as coreListBrands, planNewBrand, protectedBranchesOf, RADIUS_PRESETS, type BrandRadiusInput, type BrandSource, type NewBrandInput, type NewBrandPlan } from '@bridge-ds/core';
import { branchExists, commitToNewLocalBranch, currentBranch } from '@bridge-ds/core/node';
import type { BridgeContext } from './context.js';
import { CONFIG_FILE } from './config.js';
import { readTokenFiles } from './core-adapter.js';
import { changesFor, fileSuggestion, filesSuggestionPayload } from './suggestions.js';

export interface BrandArgs {
  slug: string;
  name?: string;
  from?: string;
  /** Hex ("#1F5F3A") or OKLCH hue in degrees. */
  primary?: string | number;
  neutral?: string | number;
  accent?: string | number;
  link?: string | number;
  /** A preset id (soft, balanced, crisp) or px per role. */
  radius?: string | BrandRadiusInput;
  fonts?: { heading?: string; text?: string };
  notes?: string;
}

async function brandSource(ctx: BridgeContext): Promise<BrandSource> {
  const { config } = await ctx.config();
  const [configText, files, contrastText] = await Promise.all([
    ctx.source.read(CONFIG_FILE),
    readTokenFiles(ctx.source, config),
    config.contrast ? ctx.source.read(config.contrast.path) : Promise.resolve(null),
  ]);
  return { config, configText: configText ?? undefined, files, contrastText: contrastText ?? undefined };
}

/** Radius from a preset id, "6,12,20,20" (inset, control, container, overlay) or an object. */
export function parseRadius(r: BrandArgs['radius']): BrandRadiusInput | undefined {
  if (r === undefined || r === '') return undefined;
  if (typeof r === 'object') return r;
  const preset = RADIUS_PRESETS.find((p) => p.id === r.trim().toLowerCase());
  if (preset) return preset.radius;
  const n = r.split(',').map((x) => Number(x.trim().replace(/px$/, '')));
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) throw new Error(`radius takes ${RADIUS_PRESETS.map((p) => p.id).join(', ')} or four px values "inset,control,container,overlay".`);
  return { inset: n[0]!, control: n[1]!, container: n[2]!, overlay: n[3]! };
}

const hue = (v: string | number | undefined) => (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);

function toInput(a: BrandArgs): NewBrandInput {
  if (!a.slug) throw new Error('Pass slug, for example "acme".');
  const radius = parseRadius(a.radius);
  const colors = { ...(a.accent !== undefined ? { accent: hue(a.accent)! } : {}), ...(a.link !== undefined ? { link: hue(a.link)! } : {}) };
  return {
    slug: a.slug,
    from: a.from ?? '',
    ...(a.name ? { name: a.name } : {}),
    ...(a.primary !== undefined ? { primaryHue: hue(a.primary)! } : {}),
    ...(a.neutral !== undefined ? { neutralHue: hue(a.neutral)! } : {}),
    ...(Object.keys(colors).length ? { colors } : {}),
    ...(radius ? { radius } : {}),
    ...(a.fonts ? { fonts: a.fonts } : {}),
  };
}

export async function listBrands(ctx: BridgeContext) {
  const brands = coreListBrands(await brandSource(ctx));
  return { brands, hint: 'Add one with bridge_plan_brand (dry run), then bridge_propose_brand. A new brand is Tier 3.' };
}

function summary(plan: NewBrandPlan, notes?: string) {
  return {
    ok: plan.ok,
    slug: plan.slug,
    name: plan.name,
    from: plan.from,
    title: plan.title,
    tier: plan.risk.tier,
    bump: plan.risk.bump,
    label: plan.risk.label,
    reasons: plan.risk.reasons.slice(0, 3),
    files: plan.files.map((f) => ({ path: f.path, action: f.action })),
    actionStep: plan.actionStep,
    ramps: Object.fromEntries(Object.entries(plan.ramps).map(([role, r]) => [role, Object.fromEntries(r.map((s) => [s.step, s.hex]))])),
    contrast: {
      checks: plan.contrast.checks,
      passing: plan.contrast.passing,
      themes: plan.contrast.themes,
      line: plan.contrast.failing.length ? `${plan.contrast.failing.length} pairs fail` : `All ${plan.contrast.checks} checks pass`,
      failing: plan.contrast.failing.slice(0, 20).map((r) => ({ pair: `${r.fg} on ${r.bg}`, modes: r.modes, ratio: r.ratio, min: r.min })),
    },
    issues: plan.issues,
    prBody: composeNewBrandBody(plan, { tool: 'Bridge MCP', agent: true, ...(notes ? { notes } : {}) }),
  };
}

/** Dry run: the brand file, ramps, contrast for every theme, tier and PR body. Writes nothing. */
export async function planBrand(ctx: BridgeContext, a: BrandArgs) {
  const plan = planNewBrand(await brandSource(ctx), toInput(a));
  return { status: 'plan', ...summary(plan, a.notes) };
}

export async function proposeBrand(ctx: BridgeContext, a: BrandArgs & { dryRun?: boolean; changes?: ChangesMode | undefined; source?: 'mcp' | 'cli' | undefined }) {
  const { config } = await ctx.config();
  const plan = planNewBrand(await brandSource(ctx), toInput(a));
  const report = summary(plan, a.notes);
  if (!plan.ok) {
    const errors = plan.issues.filter((i) => i.level === 'error').length;
    const why = [errors ? `${errors} problem(s) with the input or the tokens` : '', plan.contrast.failing.length ? `${plan.contrast.failing.length} contrast pair(s) fail` : ''].filter(Boolean).join(' and ');
    return { status: 'blocked', why: why || 'the contrast gate did not run', ...report, hint: 'Bridge never opens a PR that breaks the gate. Pick a deeper primary or another neutral, then plan again.' };
  }
  const files = plan.files.map((f) => ({ path: f.path, content: f.content as string | null }));
  const prefix = config.governance.branchPrefix;
  const stem = `${prefix}brand-${plan.slug}`;
  let branch = stem;
  // Suggest mode: one suggestion issue with the brand files, applied by a developer after design and tech approval.
  if ((await changesFor(ctx, a.changes)) === 'suggest') {
    const summary = a.notes?.trim() || `New brand "${plan.slug}", started from ${plan.from}. ${report.contrast.line} (${plan.contrast.themes.join(' and ')}).`;
    const r = await fileSuggestion(
      ctx,
      (base, by) => filesSuggestionPayload(ctx, { kind: 'brand', title: plan.title, summary, files, tier: { tier: plan.risk.tier, bump: plan.risk.bump }, base, source: a.source ?? 'mcp', suggestedBy: by }),
      { labels: ['tokens'], details: report.prBody, dryRun: a.dryRun },
    );
    if (r.status === 'dry-run') return { status: 'dry-run', ...report, changesMode: 'suggest', suggestion: r.suggestion, fileContents: files };
    if (r.status === 'preview') return { status: 'preview', message: r.message, ...report, changesMode: 'suggest', fileContents: files };
    return { status: 'suggested', ...report, changesMode: 'suggest', number: r.number, url: r.url, version: r.sha.slice(0, 7), labels: r.labels, ...(r.warnings.length ? { warnings: r.warnings } : {}), next: r.next };
  }
  if (a.dryRun) return { status: 'dry-run', ...report, branch, fileContents: files };
  const message = `feat(tokens): add the ${plan.name} brand\n\nNew brand "${plan.slug}", started from ${plan.from}. ${report.contrast.line} (${plan.contrast.themes.join(' and ')}).\n\nTier 3. Proposed through Bridge MCP (source: mcp).`;

  if (ctx.mode === 'local') {
    if (!ctx.isGit) return { status: 'preview', message: 'Not a git repo: nothing written. Apply fileContents yourself.', ...report, branch, fileContents: files };
    for (let i = 2; await branchExists(ctx.root!, branch); i++) branch = `${stem}-${i}`;
    const base = await currentBranch(ctx.root!);
    const protectedBranches = [...new Set([...protectedBranchesOf(config), baseBranchOf(config)])];
    const res = await commitToNewLocalBranch(ctx.root!, { base: 'HEAD', branch, message, files, protectedBranches, branchPrefix: prefix });
    return {
      status: 'branch-created',
      ...report,
      branch,
      base,
      commit: res.sha,
      next: `Your working tree is untouched. Review with \`git diff ${base}...${branch}\`; push and open a pull request when the design owner agrees. A new brand needs design and tech approval (Tier 3).`,
    };
  }
  if (!ctx.canWriteRemote) return { status: 'preview', message: 'Read-only: set GITHUB_TOKEN to open this as a pull request.', ...report, branch, fileContents: files };
  const gh = (await ctx.github())!;
  const base = ctx.ref ?? baseBranchOf(config);
  for (let i = 2; await gh.getBranchSha(branch).then(Boolean, () => false); i++) branch = `${stem}-${i}`;
  const commit = await gh.commitToNewBranch({ base, branch, message, files });
  const pr = await gh.createPullRequest({ base, head: branch, title: `feat(tokens): ${plan.title.charAt(0).toLowerCase()}${plan.title.slice(1)}`, body: report.prBody, draft: true });
  const labels = [...new Set([...config.governance.labels, 'tier: 3', 'tokens'])];
  await gh.addLabels(pr.number, labels);
  return { status: 'pr-opened', ...report, branch, commit: commit.sha, pr: pr.number, url: pr.url, labels, draft: true };
}
