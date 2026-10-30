// The product branch page in place (?exploration=N for a branch started for a product): paints
// components/ds/studio/ProductBranch.tsx, reads the linked library branches through the core functions the MCP server
// and the CLI use (productBranchViewOnGitHub), the product preview Vercel reported, and the before and after of the
// visual impact. Actions (open a library branch, use its preview, switch to the published version, done exploring,
// archive; nothing closes it) write with the viewer's token through the same core functions. The missing pieces come from the
// branch description, where Claude or `bridge pieces --record` saved them: the audit does not run in the browser.
// In suggest mode (bridge.config.json "changes") a missing piece goes to the library as a suggestion (a token) or a
// request (a component), never a branch, and the branch actions (switch, use a preview, done exploring, archive) are
// not offered: suggest mode is a Bridge rule until the read-only GitHub App ships.
import {
  archiveExplorationOnGitHub,
  DEFAULT_PRODUCTS,
  LayeredTokenSet,
  loadRepoFiles,
  NEEDED_BY_LABEL,
  openLibraryBranchOnGitHub,
  parseContrastChecks,
  parsePiecesRecord,
  planTokenProposal,
  productBranchSentence,
  productBranchViewOnGitHub,
  suggestTokenProposalOnGitHub,
  switchToPublishedOnGitHub,
  tryInProductUrl,
  useLibraryPreviewOnGitHub,
  writeTokenProposalOnGitHub,
  type BranchPreview,
  type BranchPreviewSources,
  type PreviewApps,
  type ChangesMode,
  type LibraryTokenWrite,
  type LibraryBranchPlan,
  type ProductBranchView,
  type ProductConfig,
} from '@bridge-ds/core';
import { ASK_CLAUDE, developerLines, failedPreviewLine, pieceRows, productCrumbs, productTodayUrl, tryInProductView, whyItShows, type PieceActionKind, type PieceRowView } from '../lib/product-branch';
import { ARCHIVED_LINE, explorationKey, explorationPreviews, explorationStateLine, productPreviews, takeItLines, type ExplorationPullLike, type ExplorationRow } from '../lib/explorations-view';
import { productClient, productRepoByKey } from './product-repos';
import { touchesVisuals } from '../lib/visual-impact';
import { ghAction, sendButton, suggestionSentLine } from '../lib/gh-wording';
import { assertBranchWrites, changesModeOnPage } from './changes-mode';
import { jiraKeyOf } from '../lib/vocabulary';
import { safeUrl } from '../lib/html';
import { askDoneExploring } from './exploration-done';
import type { ProductBranchProps } from '../components/ds/studio/ProductBranch';
import { currentContributor, currentViewer, ghGet, hasWorkingToken, prefersSignIn, resolveAccess, studioClient } from './github-session';
import { canKeepExploration, keepExplorationLine, productKeeperLine, sendModeFor } from '../lib/write-route';
import { viewerRole } from './needs-you';
import { explorationsConfig } from './exploration-start';
import { loadVisualImpact, renderTopChange } from './reviews/visual-impact';
import { siteConfig } from './repo-context';

const CFG = explorationsConfig();
const R = `/repos/${CFG.owner}/${CFG.repo}`;

type Module = typeof import('../components/ds/studio/ProductBranch');
let mod: Module | null = null;
/** The branch on the page, by explorationKey ("12", or "shop#12" in the shop's own repository). */
let current: { n: string; props: ProductBranchProps } | null = null;

const connected = () => Boolean(hasWorkingToken() && currentViewer());
const client = () => studioClient(`${CFG.owner}/${CFG.repo}`, undefined, { protectedBranches: [CFG.defaultBranch] });

/** Display names of the people on the page, read once each (only with a token: anonymous reads are kept for statuses). */
export async function namesOf(logins: string[]): Promise<Record<string, string>> {
  if (!connected() || !logins.length) return {};
  const { personOf } = await import('./home-data');
  const people = await Promise.all([...new Set(logins)].map((l) => personOf(l).catch(() => null)));
  return Object.fromEntries(people.filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => [p.login, p.name]));
}

/**
 * Studio's token change for a token piece: the library's token files on main, the shared plan, then the write core
 * asks for. Direct: a branch and a pull request. Suggest: a suggestion that says which product branch needs it.
 */
function tokenWriter(gh: ReturnType<typeof client>) {
  return async (plan: Extract<LibraryBranchPlan, { kind: 'token-change' }>, ctx: { mode: ChangesMode }): Promise<LibraryTokenWrite> => {
    const mainSha = await gh.getBranchSha(CFG.defaultBranch);
    if (!mainSha) throw new Error(`The library (${CFG.defaultBranch}) was not found on GitHub.`);
    const latest = await loadRepoFiles(gh, mainSha, 'packages/tokens/src');
    if (!latest.config) throw new Error('bridge.config.json could not be read in the library, so the token change cannot be planned.');
    const before = new LayeredTokenSet(latest.config, new Map(Object.entries(latest.files)));
    const p = planTokenProposal({ before, pairs: parseContrastChecks(latest.contrastChecks), edits: plan.edits, title: plan.title, summary: plan.summary, config: latest.config, tool: 'Bridge Studio' });
    if (!p) throw new Error('The library already has this token with that value.');
    if (ctx.mode === 'suggest') {
      if (p.blocked) throw new Error(`Not sent to the library: ${p.blocked}. Ask Claude to pick another value.`);
      const r = await suggestTokenProposalOnGitHub(gh, p, { base: CFG.defaultBranch, baseSha: mainSha, source: 'studio', suggestedBy: currentViewer()?.login, neededBy: plan.neededBy, labelsAfter: [NEEDED_BY_LABEL] });
      return { status: 'suggested', number: r.number, url: r.url };
    }
    if (p.blocked) throw new Error(`The library change was not started: ${p.blocked}. Ask Claude to pick another value.`);
    const opened = await writeTokenProposalOnGitHub(gh, p, { base: CFG.defaultBranch, branchPrefix: latest.config.governance.branchPrefix, labels: ['source: bridge-web'], labelsAfter: [NEEDED_BY_LABEL], tool: 'Bridge Studio' });
    return { number: opened.pr, url: opened.url, branch: opened.branch };
  };
}

export async function previewSources(r: ExplorationRow): Promise<BranchPreviewSources | null> {
  // In the product's own repository, what Vercel reported there.
  const own = productRepoByKey(r.product);
  const RR = own ? `/repos/${own.repo}` : R;
  try {
    const [comments, statuses] = await Promise.all([
      ghGet<{ body?: string | null }[]>(`${RR}/issues/${r.number}/comments?per_page=100`).then((f) => f.data),
      ghGet<{ statuses: { context: string; state: string; description?: string | null; target_url?: string | null }[] }>(`${RR}/commits/${r.headSha}/status`).then((f) => f.data.statuses).catch(() => []),
    ]);
    return { comments, statuses };
  } catch {
    return null;
  }
}

/**
 * The product's preview of the branch, as GitHub reported it (null while unread). `app`: which of the design system
 * repository's previews (the product's key, admin by default).
 */
export function productPreviewOf(r: ExplorationRow, sources: BranchPreviewSources | null, app: keyof PreviewApps = 'admin'): BranchPreview | null {
  if (!sources) return null;
  const own = productRepoByKey(r.product);
  return (own ? productPreviews(r, own.product, sources)[0] : explorationPreviews(r, CFG.apps, sources).find((p) => p.app === app)) ?? null;
}

/** The preview opened with the Bridge toolbar. The URL comes from a comment or a status: React 18 renders a javascript: href as is. */
export const withToolbar = (r: ExplorationRow) => (url: string) => safeUrl(tryInProductUrl(url, r.number, null)) || null;

/**
 * The branch's own build, opened with the Bridge toolbar: only a reported URL, never a template, never a build that
 * failed or that Vercel skipped (its link opens a canceled deployment).
 */
export function tryUrlOf(r: ExplorationRow, sources: BranchPreviewSources | null): string | null {
  const v = tryInProductView(productPreviewOf(r, sources), { tryUrl: withToolbar(r), todayUrl: null });
  return v.state === 'branch' ? v.url : null;
}

/** The files the branch changed, read once per commit (null when GitHub cannot be read). */
const filesBy = new Map<string, Promise<string[] | null>>();
export function changedFiles(r: ExplorationRow): Promise<string[] | null> {
  const own = productRepoByKey(r.product);
  const k = `${explorationKey(r)}@${r.headSha}`;
  let files = filesBy.get(k);
  if (!files) {
    files = ghGet<{ filename: string }[]>(`${own ? `/repos/${own.repo}` : R}/pulls/${r.number}/files?per_page=100`)
      .then((f) => f.data.map((x) => x.filename))
      .catch(() => null);
    filesBy.set(k, files);
  }
  return files;
}

function repaint(d: HTMLElement, patch: Partial<ProductBranchProps>) {
  if (!current || !mod) return;
  current.props = { ...current.props, ...patch };
  mod.paintProductBranch(d, current.props);
}

/** The before and after of the visual impact (the product's screens, against main) into #pb-visual; none: one column. */
async function paintVisual(d: HTMLElement, r: ExplorationRow) {
  const slot = document.getElementById('pb-visual');
  if (!slot) return;
  // The visual impact workflow runs in the design system repository only: the product preview is the comparison.
  if (r.product) return repaint(d, { visual: 'none' });
  try {
    const files = await changedFiles(r);
    if (current?.n !== explorationKey(r)) return;
    if (!files || !touchesVisuals(files)) return repaint(d, { visual: 'none' });
    const v = await loadVisualImpact(document.createElement('div'), { owner: CFG.owner, repo: CFG.repo, pr: r.number, sha: r.headSha, actionsUrl: `https://github.com/${CFG.owner}/${CFG.repo}/actions/workflows/visual-impact.yml` }, slot);
    if (current?.n !== explorationKey(r)) return;
    if (v.error || !v.changed || !v.top) return repaint(d, { visual: 'none' });
    renderTopChange(slot, v, `?pr=${r.number}`);
    repaint(d, { visual: 'shown' });
  } catch {
    repaint(d, { visual: 'none' });
  }
}

async function readView(r: ExplorationRow, gh: ReturnType<typeof client>, products: readonly ProductConfig[]): Promise<{ view: ProductBranchView; names: Record<string, string> } | null> {
  try {
    // In the product's own repository, the linked requests and library branches are read in the design system's.
    const view = await productBranchViewOnGitHub(gh, r.number, { products, viewer: currentViewer()?.login ?? null, ...(r.product ? { library: client() } : {}) });
    const names = await namesOf([...view.linked.flatMap((l) => l.people), view.pull.author]);
    return { view, names };
  } catch {
    return null;
  }
}

/** Paints a product branch in place. `reopen` reloads it after a write. */
export async function openProductBranch(d: HTMLElement, r: ExplorationRow, pull: ExplorationPullLike, product: ProductConfig, products: readonly ProductConfig[], reopen: () => void) {
  mod ??= await import('../components/ds/studio/ProductBranch');
  const record = parsePiecesRecord(pull.body);
  const jira = jiraKeyOf(pull.title);
  // An exploration in the product's own repository is written there; the library side is the design system's.
  const own = productRepoByKey(r.product);
  const lib = client();
  const gh = own ? productClient(own.repo, pull.base?.ref) : lib;
  const key = explorationKey(r);
  let lastView: ProductBranchView | null = null;
  // A reader in a direct-mode team suggests the missing pieces (lib/write-route): nothing fails at GitHub after a click.
  const access = connected() ? await resolveAccess().catch(() => null) : null;
  const mode = sendModeFor(access, changesModeOnPage());
  const act = async (row: PieceRowView, kind: PieceActionKind): Promise<string | void> => {
    const viewer = currentViewer()?.login;
    if (kind === 'open') {
      const res = await openLibraryBranchOnGitHub(gh, {
        // Core opens a branch when the mode is left out: Studio always says which one this repo uses.
        mode,
        pr: r.number,
        piece: row.id,
        base: CFG.defaultBranch,
        products,
        exploration: { packages: CFG.packages, apps: CFG.apps },
        writeTokens: tokenWriter(lib),
        ...(own ? { library: lib } : {}),
        ...(viewer ? { openedBy: viewer } : {}),
        source: 'studio',
      });
      void refresh();
      if (res.status === 'suggested') return `${suggestionSentLine(res.link?.number ?? 0)}${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}`;
      if (mode === 'suggest') return `Sent to the library as a request for ${row.title}. Your DS lead decides on it.${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}`;
      const what = res.plan.kind === 'token-change' ? 'token change' : res.plan.kind === 'exploration' ? 'library change' : 'request';
      return `Opened a ${what} for ${row.title}.${res.preview?.status === 'merged' ? ' Your feature uses its preview now.' : ''}${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}`;
    }
    // Suggest mode: the product branch is not written from Studio (a developer switches it or uses a preview).
    assertBranchWrites(kind === 'switch' ? 'switch features to the published version' : 'update features');
    if (kind === 'switch') {
      const res = await switchToPublishedOnGitHub(gh, r.number);
      void refresh();
      return res.said;
    }
    const l = lastView?.linked.find((x) => x.link.piece === row.id);
    if (!l || !l.link.branch) throw new Error('This library change has nothing to preview yet.');
    const res = await useLibraryPreviewOnGitHub(gh, { productBranch: r.branch, libraryBranch: l.link.branch, libraryNumber: l.link.number });
    void refresh();
    return res.said;
  };
  const refresh = async () => {
    const read = await readView(r, gh, products);
    if (current?.n !== key) return;
    if (!read) return repaint(d, { rows: [] });
    lastView = read.view;
    const rows = pieceActions(pieceRows({ record: read.view.record, linked: read.view.linked, names: read.names }), mode);
    const sentence = productBranchSentence(read.view.record, { viewer: currentViewer()?.login ?? null });
    repaint(d, {
      rows,
      checked: Boolean(read.view.record),
      sentence,
      why: whyItShows(rows),
      developer: [...developerLines({ number: r.number, branch: r.branch, links: read.view.record?.links ?? [], ...(own ? { product: own.product.key, repo: own.repo } : {}) }), ...devPreview],
    });
  };
  // Done exploring: the dialog lists the pieces still without a library side, the ticked ones go to the DS lead as
  // requests with the product preview, and the branch goes to the developers. Nothing closes.
  let reported: BranchPreviewSources | null = null;
  // A preview that did not build: designers read "Preview not available yet", developers read why.
  let devPreview: { label: string; value: string }[] = [];
  const done = (focus: HTMLElement | null) =>
    askDoneExploring(r, pull.body, {
      client: () => gh,
      ...(own ? { library: () => lib } : {}),
      previewUrl: tryUrlOf(r, reported),
      products,
      focus,
      after: (line) => {
        repaint(d, { said: line });
        reopen();
      },
    });
  // Suggest mode: done exploring and archive are branch writes, so they are not offered. They have no suggestion
  // path: the person who started it or a reviewer, with write access.
  const keeper = canKeepExploration({ viewer: currentViewer()?.login ?? null, author: r.author, reviewer: viewerRole() === 'reviewer', write: own ? null : (access?.write ?? null) });
  const open = r.status === 'active' || r.status === 'ready' || r.status === 'building';
  // An email member writes through Bridge in the design system only: not in the product's own repository.
  const emailOnProduct = Boolean(own && currentContributor());
  const writable = connected() && open && mode === 'direct' && keeper && !emailOnProduct;
  current = {
    n: key,
    props: {
      number: r.number,
      crumbs: productCrumbs(product.name, jira, r.name),
      title: r.name,
      sentence: productBranchSentence(record, { viewer: currentViewer()?.login ?? null }),
      tryUrl: null,
      tryNote: null,
      rows: record ? null : [],
      checked: Boolean(record),
      exploring: r.status === 'active',
      why: null,
      visual: 'loading',
      product: product.name,
      connected: connected(),
      connectLabel: (goal) => ghAction(goal, prefersSignIn()),
      onAct: act,
      onDone: writable && r.status === 'active' && !r.archived ? done : null,
      onArchive: writable
        ? async () => {
            await archiveExplorationOnGitHub(gh, r.number, { archived: !r.archived });
            reopen();
            return r.archived ? 'Back in the lists.' : ARCHIVED_LINE;
          }
        : null,
      archived: Boolean(r.archived),
      state: r.archived ? ARCHIVED_LINE : r.status === 'active' ? null : explorationStateLine(r.status),
      keepNote: emailOnProduct && open ? productKeeperLine(product.name) : connected() && open && changesModeOnPage() === 'direct' && !keeper ? keepExplorationLine(r.author) : null,
      developer: developerLines({ number: r.number, branch: r.branch, links: record?.links ?? [], ...(own ? { product: own.product.key, repo: own.repo } : {}) }),
      take: r.status === 'closed' ? null : takeItLines(r.branch),
      githubUrl: safeUrl(r.url, '#'),
      ask: ASK_CLAUDE,
    },
  };
  d.innerHTML = '';
  mod.paintProductBranch(d, current.props);
  // "Try it in the product" never opens a canceled deployment: a branch Vercel skipped, or that only changed notes,
  // opens the product as it is today; a build in progress or a failed one is said next to the button.
  const today = productTodayUrl(product, { production: own ? null : CFG.production, defaultBranch: own ? (pull.base?.ref ?? 'main') : CFG.defaultBranch });
  void Promise.all([previewSources(r), changedFiles(r)]).then(([s, files]) => {
    reported = s;
    if (current?.n !== key) return;
    const preview = productPreviewOf(r, s);
    const v = tryInProductView(preview, { tryUrl: withToolbar(r), todayUrl: today ? safeUrl(today) || null : null, files });
    devPreview = v.state === 'failed' && preview ? [failedPreviewLine(preview)] : [];
    repaint(d, { tryUrl: v.url, tryNote: v.note, ...(devPreview.length ? { developer: [...current.props.developer, ...devPreview] } : {}) });
  });
  void paintVisual(d, r);
  if (record) void refresh();
}

/**
 * The piece actions in the repo's mode: in suggest mode a missing piece is suggested to the library ("Suggest to the
 * library"), and a linked suggestion offers no branch action (no preview to use, nothing to switch).
 */
function pieceActions(rows: PieceRowView[], mode: ChangesMode): PieceRowView[] {
  if (mode === 'direct') return rows;
  return rows.map((row) => (row.action?.kind === 'open' ? { ...row, action: { ...row.action, label: sendButton('piece', mode) } } : row.action ? { ...row, action: null } : row));
}

/** bridge.config.json products (repo-context siteConfig); the defaults when absent. */
export function siteProducts(): ProductConfig[] {
  try {
    const site = siteConfig() as { products?: ProductConfig[] };
    return site.products?.length ? site.products : DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

/** Leaves the page (another view opens in the same place). */
export function closeProductBranch() {
  current = null;
  mod?.unmountProductBranch();
}
