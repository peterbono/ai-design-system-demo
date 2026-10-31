// Studio Quality for a team (multi-team PR 3b, components/ds/studio/TeamQuality.tsx): the numbers the self-hosted page
// gets from lib/stats.ts dashboard() at build time, computed in the browser from the team's repo model, then fed to
// the same pure rules (lib/quality.ts qualityModel, lib/library-health.ts healthFigures and healthSentence).
// Every link stays with the team: Studio pages through studioHref, files on GitHub at the commit the page was read
// at, never the demo's Library. Adoption comes from the team's snapshot (bridge-data branch) when it has audits.
// Pure: team-quality.test.ts covers it.
import { tokenUsage, type RepoModel, type SnapshotAudit } from '@bridge-ds/core';
import type { ContrastFailRow } from '../components/ds/studio/ContrastFailTable';
import type { GuidanceState } from './components';
import type { Issue } from './stats';
import { qualityModel, type ComboResult, type Finding } from './quality';
import { HEALTH_SECTION, combinedAdoption, healthFigures, healthSentence, type HealthFigure } from './library-health';
import { adoptionFigureInput, adoptionView, qualityPillars, qualityVerdict, type AdoptionView, type Pillar, type Verdict } from './quality-view';
import { fileUrl, HOSTED_DOCS_URL } from './team-load';
import { studioHref } from './team-path';

export interface TeamQualityInput {
  model: RepoModel;
  owner: string;
  repo: string;
  /** The commit the model was read at: GitHub links point there. */
  sha: string;
  /** Adoption audits of the team's snapshot; null without a snapshot. */
  audits: SnapshotAudit[] | null;
  /** When the snapshot was written: runs from that write are the current ones (lib/quality-view adoptionView). */
  snapshotAt?: string;
  /**
   * Who reads the page: a developer (a tech owner) gets the setup in config words; anyone else (a designer) reads what
   * is missing and that a developer turns it on, never a config file, a workflow or what Bridge could not parse.
   * Default developer.
   */
  audience?: 'developer' | 'designer';
}

export interface TeamGuidanceRow {
  name: string;
  slug: string;
  state: GuidanceState;
  /** Its docs.json on GitHub, or its folder when the file is missing. */
  href: string;
}

export interface TeamQuality {
  /** False when the repo names no contrast checks (or they did not resolve): nothing to pass or fail. */
  hasChecks: boolean;
  contrast: { total: number; fail: number; brands: number; combos: ComboResult[] };
  failRows: ContrastFailRow[];
  /** The contrast finding (always first in its section). */
  gate: Finding;
  tokenFindings: Finding[];
  guidanceFindings: Finding[];
  cleanup: Issue[];
  unusedTotal: number;
  figures: HealthFigure[];
  /** The shared summary's verdict line (Share). */
  sentence: string;
  /** The verdict card: mood, title, sentence and the page's one action (null when nothing needs the viewer). */
  verdict: Verdict;
  /** Accessibility, adoption, documentation: the same card each. */
  pillars: Pillar[];
  /** Studio Tokens filtered to the tokens nothing reads. */
  unusedHref: string;
  guidance: { total: number; reviewed: number; drafted: number; missing: number; rows: TeamGuidanceRow[] };
  /** Null: no audit to show (no snapshot, or a snapshot without audits). Otherwise the latest run per product first. */
  adoption: AdoptionView | null;
  /** What the model could not read (invalid config, a docs.json that does not parse). */
  problems: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A folder of the team's repository at a commit, on GitHub. */
const treeUrl = (owner: string, repo: string, sha: string, path: string) => fileUrl(owner, repo, sha, path).replace(/\/blob\//, '/tree/');

/** Studio Tokens focused on a token, for this team. */
const tokenHref = (path: string) => studioHref(`tokens/?focus=${encodeURIComponent(path)}`);

/** Everything Studio Quality shows for a team, from its repo model. */
export function teamQuality(input: TeamQualityInput): TeamQuality {
  const { model, owner, repo, sha } = input;
  const designer = input.audience === 'designer';
  const rows = model.tokens.rows;
  const { primitives, semantic, all } = rows;
  const components = model.components?.list ?? [];
  const pairs = model.contrast.pairs;
  const brands = rows.brands;
  const themes = rows.themes;
  const label = (b: string, m: string) => `${rows.brandLabels[b] ?? b} ${m}`;

  // Contrast: one check per pair per brand x theme, like the build gate (lib/stats.ts).
  const checks = pairs.flatMap((p) => brands.flatMap((b) => themes.map((m) => ({ pair: p, brand: b, mode: m, result: p.brands[b]?.[m] }))));
  const valid = checks.filter((c): c is typeof c & { result: NonNullable<typeof c.result> } => Boolean(c.result));
  const failing = valid.filter((c) => !c.result.aa);
  const combos: ComboResult[] = brands.flatMap((b) =>
    themes.map((m) => ({
      label: label(b, m),
      pass: valid.filter((c) => c.brand === b && c.mode === m && c.result.aa).length,
      total: valid.filter((c) => c.brand === b && c.mode === m).length,
    })),
  );
  const hasChecks = valid.length > 0;
  const contrast = { total: valid.length, fail: failing.length, brands: brands.length, combos };
  const failRows: ContrastFailRow[] = failing.map(({ pair: p, brand, mode, result: r }) => ({
    id: `fail-${p.fg}-${p.bg}-${brand}-${mode}`.replace(/[^a-z0-9-]+/gi, '-'),
    fg: p.fg,
    bg: p.bg,
    where: label(brand, mode),
    ratio: `${r.ratio.toFixed(2)}:1`,
    hexes: `${r.fgHex} / ${r.bgHex}`,
    needs: `${p.min}:1 (${p.usage === 'text' ? 'text' : 'UI'})`,
  }));

  // Usage: read by a component stylesheet or a global stylesheet of the library (components.styles), or aliased by a
  // token in use (core tokenUsage), the same definition as the self-hosted page. A model cached before global
  // stylesheets were read has none.
  const globalVars = model.styles?.vars ?? {};
  const byVar: Record<string, string[]> = {};
  for (const c of components) for (const t of c.tokensUsed) (byVar[t.name] ??= []).push(c.name);
  const refs = (t: (typeof all)[number]) =>
    brands.flatMap((b) => themes.flatMap((m) => t.brands[b]?.[m]?.chain ?? [])).concat(t.densities ? Object.values(t.densities).flatMap((d) => d.chain) : []);
  const usage = tokenUsage([...primitives.map((p) => ({ path: p.path, cssVar: p.cssVar, refs: [] })), ...all.map((t) => ({ path: t.path, cssVar: t.cssVar, refs: refs(t) }))], { byVar, globalVars });
  // Nothing reads any token (no component or global stylesheet read): every token would look unused, which says nothing.
  const scanned = Object.keys(byVar).length > 0 || Object.values(globalVars).some((v) => v.length > 0);
  const unusedSemantic = scanned ? semantic.filter((s) => !usage.used.has(s.path)) : [];
  const orphanPrimitives = scanned ? primitives.filter((p) => !usage.used.has(p.path)) : [];

  const guidanceOf = (c: (typeof components)[number]): GuidanceState => (!c.docs ? 'missing' : c.docs.needsReview ? 'review' : 'ok');
  const docsHref = (c: (typeof components)[number]) => (c.docs ? fileUrl(owner, repo, sha, c.files.docs) : treeUrl(owner, repo, sha, c.dir));
  const bySlug = new Map(components.map((c) => [c.slug, c]));

  const issues: Issue[] = [
    ...components.flatMap((c) =>
      c.tokensUsed
        .filter((t) => !t.known)
        .map((t) => ({
          kind: 'unknown-ref' as const,
          severity: 'fail' as const,
          title: `${c.name} reads ${t.name}`,
          detail: 'This variable is not defined in the token sources and renders as nothing.',
          href: fileUrl(owner, repo, sha, c.files.css),
        })),
    ),
    ...[...primitives, ...all]
      .filter((t) => t.deprecated)
      .map((t) => ({
        kind: 'deprecated' as const,
        severity: 'warn' as const,
        title: `${t.path} is deprecated`,
        detail: typeof t.deprecated === 'string' ? t.deprecated : 'Marked $deprecated in the token sources.',
        href: tokenHref(t.path),
      })),
    ...(unusedSemantic.length
      ? [
          {
            kind: 'unused' as const,
            severity: 'info' as const,
            title: `${unusedSemantic.length} semantic tokens not in use`,
            detail:
              unusedSemantic
                .slice(0, 6)
                .map((s) => s.path)
                .join(', ') + (unusedSemantic.length > 6 ? ` and ${unusedSemantic.length - 6} more` : ''),
            href: studioHref('tokens/?ft=semantic&usage=unused'),
          },
        ]
      : []),
    ...(orphanPrimitives.length
      ? [
          {
            kind: 'unused' as const,
            severity: 'info' as const,
            title: `${orphanPrimitives.length} primitives not in use`,
            detail: 'No component stylesheet reads them, directly or through an alias. Candidates for cleanup, or values waiting for a job.',
            href: studioHref('tokens/?ft=primitive&usage=unused'),
          },
        ]
      : []),
  ];

  const guidanceRows: TeamGuidanceRow[] = components.map((c) => ({ name: c.name, slug: c.slug, state: guidanceOf(c), href: docsHref(c) }));
  const { findings, cleanup } = qualityModel({
    contrast,
    components: guidanceRows.map((g) => ({ name: g.name, slug: g.slug, state: g.state, docsPath: bySlug.get(g.slug)!.files.docs })),
    issues,
    editHref: (slug) => docsHref(bySlug.get(slug)!),
  });

  // The contrast finding: the checks file on GitHub instead of the demo's contrast grid; no checks is not a pass.
  const checksHref = model.contrast.path ? fileUrl(owner, repo, sha, model.contrast.path) : HOSTED_DOCS_URL;
  const gate: Finding = hasChecks
    ? { ...findings.find((f) => f.kind === 'contrast')!, action: { label: 'Open the checks on GitHub', href: checksHref } }
    : {
        id: 'contrast',
        kind: 'contrast',
        severity: 'note',
        title: 'No contrast checks yet',
        detail: designer
          ? 'A developer of your team turns them on, then Bridge tests every color pair in each brand and theme.'
          : 'Name a checks file in bridge.config.json (contrast.path) and Bridge tests every pair in each brand and theme.',
        status: { label: 'Not set up', group: 'neutral' },
        ...(designer ? {} : { action: { label: 'How to add checks', href: HOSTED_DOCS_URL } }),
        combos: [],
      };
  const all2 = findings.map((f) => (f.kind === 'contrast' ? gate : f));
  const tokenFindings = all2.filter((f) => f.kind === 'validation');
  const guidanceFindings = all2.filter((f) => f.kind === 'guidance');

  const guidance = {
    total: guidanceRows.length,
    reviewed: guidanceRows.filter((g) => g.state === 'ok').length,
    drafted: guidanceRows.filter((g) => g.state === 'review').length,
    missing: guidanceRows.filter((g) => g.state === 'missing').length,
    rows: guidanceRows,
  };

  const audits = input.audits?.length ? input.audits : null;
  const reportHref = (a: SnapshotAudit) => `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/bridge-data/${a.path.split('/').map(encodeURIComponent).join('/')}`;
  const adoption: AdoptionView | null = audits
    ? adoptionView(
        audits.map((a) => ({
          id: a.id,
          label: a.label ?? a.target.path,
          product: a.target.path,
          ...(a.label ? {} : { productName: a.target.path }),
          generatedAt: a.generatedAt,
          token: a.metrics.tokenAdoption,
          component: a.metrics.componentAdoption,
          ds: a.metrics.dsComponentInstances,
          ui: a.metrics.uiComponentInstances,
          href: reportHref(a),
        })),
        input.snapshotAt ? { liveSince: input.snapshotAt } : {},
      )
    : null;

  // The three figures: the same rules as the self-hosted page, with the team's two honest exceptions (no checks, no
  // audit) said in words instead of a zero.
  const base = healthFigures({
    contrast,
    adoption: adoption ? adoptionFigureInput(adoption) : [],
    guidance,
    adoptionSince: 'at the first audit',
  });
  const figures: HealthFigure[] = [];
  for (const f of base) {
    if (f.id === 'contrast' && !hasChecks) {
      figures.push({
        ...f,
        value: 'No checks yet',
        detail: designer ? 'A developer of your team turns them on.' : 'Name a checks file in bridge.config.json.',
        sentence: 'No contrast checks are set up yet.',
        tone: null,
      });
    } else if (f.id === 'guidance' && guidance.total === 0) {
      figures.push({ ...f, value: 'No components', detail: designer ? 'A developer of your team points Bridge at them.' : 'Point components.dir in bridge.config.json at them.', sentence: 'Bridge found no components to check.', tone: null });
    } else figures.push(f);
    if (f.id === 'contrast' && !base.some((x) => x.id === 'adoption')) {
      figures.push({
        id: 'adoption',
        value: 'No audit yet',
        label: 'adoption in products',
        detail: audits ? 'The audits found no UI components.' : designer ? 'A developer of your team turns it on.' : 'Publish the Bridge snapshot with an audit.',
        sentence: 'No adoption audit has been published yet.',
        tone: null,
        href: `#${HEALTH_SECTION.adoption}`,
      });
    }
  }

  const open = all2.filter((f) => f.severity === 'fail' || f.severity === 'warn');
  const only = open.length === 1 ? open[0] : null;
  const sentence = healthSentence(contrast.fail, open.length, only?.title);
  const verdict = qualityVerdict({ contrastFail: contrast.fail, findings: all2 });
  const combined = adoption ? combinedAdoption(adoptionFigureInput(adoption)) : null;
  const pillars = qualityPillars({ figures, contrast: { total: contrast.total, fail: contrast.fail, hasChecks }, combos: contrast.combos, adoption: combined?.now ?? null, adoptionBefore: combined?.before, products: adoption?.products.map((p) => ({ name: p.name, pct: p.latest.component })), guidance });

  return {
    hasChecks,
    contrast,
    failRows,
    gate,
    tokenFindings,
    guidanceFindings,
    cleanup,
    unusedTotal: unusedSemantic.length + orphanPrimitives.length,
    figures,
    sentence,
    verdict,
    pillars,
    unusedHref: studioHref('tokens/?usage=unused'),
    guidance,
    adoption,
    // What Bridge could not parse (a config or docs file) is for developers: they fix the file.
    problems: designer ? [] : [...model.problems],
  };
}

/** "46 of 48 components have reviewed guidance." for the Guidance section lead. */
export const guidanceLead = (g: { total: number; reviewed: number }) =>
  g.total ? `${g.reviewed} of ${plural(g.total, 'component')} ${g.total === 1 ? 'has' : 'have'} reviewed usage guidance.` : 'Bridge found no components in this repository.';

/** A percentage as the page shows it: one decimal, "n/a" when the audit has nothing to count. */
export const pctLabel = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 10) / 10}%`);
