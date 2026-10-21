// The product branch page in place (?exploration=N for a branch started for a product): paints
// components/ds/studio/ProductBranch.tsx, reads the linked library branches through the core functions the MCP server
// and the CLI use (productBranchViewOnGitHub), the product preview Vercel reported, and the before and after of the
// visual impact. Actions (open a library branch, use its preview, switch to the published version, send for review,
// close) write with the viewer's token through the same core functions. The missing pieces themselves come from the
// branch description, where Claude or `bridge pieces --record` saved them: the audit does not run in the browser.
// In suggest mode (bridge.config.json "changes") a missing piece goes to the library as a suggestion (a token) or a
// request (a component), never a branch, and the branch actions (switch, use a preview, send for review, close) are
// not offered: suggest mode is a Bridge rule until the read-only GitHub App ships.
import {
  closeExplorationOnGitHub,
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
  promoteExplorationOnGitHub,
  suggestTokenProposalOnGitHub,
  switchToPublishedOnGitHub,
  tryInProductUrl,
  useLibraryPreviewOnGitHub,
  writeTokenProposalOnGitHub,
  type BranchPreviewSources,
  type ChangesMode,
  type LibraryTokenWrite,
  type LibraryBranchPlan,
  type ProductBranchView,
  type ProductConfig,
} from '@bridge-ds/core';
import { ASK_CLAUDE, developerLines, pieceRows, productCrumbs, whyItShows, type PieceActionKind, type PieceRowView } from '../lib/product-branch';
import { explorationPreviews, openRequestNumbers, promoteAsk, type ExplorationPullLike, type ExplorationRow } from '../lib/explorations-view';
import { touchesVisuals } from '../lib/visual-impact';
import { ghAction, sendButton, suggestionSentLine } from '../lib/gh-wording';
import { assertBranchWrites, changesModeOnPage } from './changes-mode';
import { jiraKeyOf } from '../lib/vocabulary';
import { safeUrl } from '../lib/html';
import type { Tier } from '../lib/review-rules';
import type { PromoteAskDetail } from '../components/ds/studio/PromoteToReview';
import type { ProductBranchProps } from '../components/ds/studio/ProductBranch';
import { currentViewer, ghGet, hasWorkingToken, prefersSignIn, studioClient } from './github-session';
import { explorationsConfig } from './exploration-start';
import { loadVisualImpact, renderTopChange } from './reviews/visual-impact';

const CFG = explorationsConfig();
const R = `/repos/${CFG.owner}/${CFG.repo}`;

type Module = typeof import('../components/ds/studio/ProductBranch');
let mod: Module | null = null;
let current: { n: number; props: ProductBranchProps } | null = null;

const connected = () => Boolean(hasWorkingToken() && currentViewer());
const client = () => studioClient(`${CFG.owner}/${CFG.repo}`, undefined, { protectedBranches: [CFG.defaultBranch] });

/** Display names of the people on the page, read once each (only with a token: anonymous reads are kept for statuses). */
async function namesOf(logins: string[]): Promise<Record<string, string>> {
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
    if (!mainSha) throw new Error(`Branch ${CFG.defaultBranch} not found.`);
    const latest = await loadRepoFiles(gh, mainSha, 'packages/tokens/src');
    if (!latest.config) throw new Error('bridge.config.json could not be read on main, so the token change cannot be planned.');
    const before = new LayeredTokenSet(latest.config, new Map(Object.entries(latest.files)));
    const p = planTokenProposal({ before, pairs: parseContrastChecks(latest.contrastChecks), edits: plan.edits, title: plan.title, summary: plan.summary, config: latest.config, tool: 'Bridge Studio' });
    if (!p) throw new Error('The library already has this token with that value.');
    if (ctx.mode === 'suggest') {
      if (p.blocked) throw new Error(`Not sent to the library: ${p.blocked}. Ask Claude to pick another value.`);
      const r = await suggestTokenProposalOnGitHub(gh, p, { base: CFG.defaultBranch, baseSha: mainSha, source: 'studio', suggestedBy: currentViewer()?.login, neededBy: plan.neededBy, labelsAfter: [NEEDED_BY_LABEL] });
      return { status: 'suggested', number: r.number, url: r.url };
    }
    if (p.blocked) throw new Error(`The library branch was not opened: ${p.blocked}. Ask Claude to pick another value.`);
    const opened = await writeTokenProposalOnGitHub(gh, p, { base: CFG.defaultBranch, branchPrefix: latest.config.governance.branchPrefix, labels: ['source: bridge-web'], labelsAfter: [NEEDED_BY_LABEL], tool: 'Bridge Studio' });
    return { number: opened.pr, url: opened.url, branch: opened.branch };
  };
}

async function previewSources(r: ExplorationRow): Promise<BranchPreviewSources | null> {
  try {
    const [comments, statuses] = await Promise.all([
      ghGet<{ body?: string | null }[]>(`${R}/issues/${r.number}/comments?per_page=100`).then((f) => f.data),
      ghGet<{ statuses: { context: string; state: string; target_url?: string | null }[] }>(`${R}/commits/${r.headSha}/status`).then((f) => f.data.statuses).catch(() => []),
    ]);
    return { comments, statuses };
  } catch {
    return null;
  }
}

/** The admin preview GitHub reported for the branch, opened with the Bridge toolbar. Only a reported URL, never a template. */
export function tryUrlOf(r: ExplorationRow, sources: BranchPreviewSources | null): string | null {
  if (!sources) return null;
  const admin = explorationPreviews(r, CFG.apps, sources).find((p) => p.app === 'admin');
  if (!admin?.url || admin.source === 'template' || admin.state === 'failed') return null;
  // The URL comes from a comment or a status on the branch: React 18 renders a javascript: href as is.
  return safeUrl(tryInProductUrl(admin.url, r.number, null)) || null;
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
  try {
    const files = (await ghGet<{ filename: string }[]>(`${R}/pulls/${r.number}/files?per_page=100`)).data;
    if (current?.n !== r.number) return;
    if (!touchesVisuals(files.map((f) => f.filename))) return repaint(d, { visual: 'none' });
    const v = await loadVisualImpact(document.createElement('div'), { owner: CFG.owner, repo: CFG.repo, pr: r.number, sha: r.headSha, actionsUrl: `https://github.com/${CFG.owner}/${CFG.repo}/actions/workflows/visual-impact.yml` }, slot);
    if (current?.n !== r.number) return;
    if (v.error || !v.changed || !v.top) return repaint(d, { visual: 'none' });
    renderTopChange(slot, v, `?pr=${r.number}`);
    repaint(d, { visual: 'shown' });
  } catch {
    repaint(d, { visual: 'none' });
  }
}

async function readView(r: ExplorationRow, products: readonly ProductConfig[]): Promise<{ view: ProductBranchView; names: Record<string, string> } | null> {
  try {
    const view = await productBranchViewOnGitHub(client(), r.number, { products, viewer: currentViewer()?.login ?? null });
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
  const gh = client();
  let lastView: ProductBranchView | null = null;
  const mode = changesModeOnPage();
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
        writeTokens: tokenWriter(gh),
        ...(viewer ? { openedBy: viewer } : {}),
        source: 'studio',
      });
      void refresh();
      if (res.status === 'suggested') return `${suggestionSentLine(res.link?.number ?? 0)}${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}`;
      if (mode === 'suggest') return `Sent to the library as a request for ${row.title}. Your DS lead decides on it.${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}`;
      const what = res.plan.kind === 'token-change' ? 'token change' : res.plan.kind === 'exploration' ? 'library branch' : 'request';
      return `Opened a ${what} for ${row.title}.${res.preview?.status === 'merged' ? ' Your branch uses its preview now.' : ''}${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}`;
    }
    // Suggest mode: the product branch is not written from Studio (a developer switches it or uses a preview).
    assertBranchWrites(kind === 'switch' ? 'switch branches to the published version' : 'change branches');
    if (kind === 'switch') {
      const res = await switchToPublishedOnGitHub(gh, r.number);
      void refresh();
      return res.said;
    }
    const l = lastView?.linked.find((x) => x.link.piece === row.id);
    if (!l || !l.link.branch) throw new Error('This library branch has nothing to preview yet.');
    const res = await useLibraryPreviewOnGitHub(gh, { productBranch: r.branch, libraryBranch: l.link.branch, libraryNumber: l.link.number });
    void refresh();
    return res.said;
  };
  const refresh = async () => {
    const read = await readView(r, products);
    if (current?.n !== r.number) return;
    if (!read) return repaint(d, { rows: [] });
    lastView = read.view;
    const rows = pieceActions(pieceRows({ record: read.view.record, linked: read.view.linked, names: read.names }), mode);
    const sentence = productBranchSentence(read.view.record, { viewer: currentViewer()?.login ?? null });
    repaint(d, {
      rows,
      checked: Boolean(read.view.record),
      sentence,
      why: whyItShows(rows),
      developer: developerLines({ number: r.number, branch: r.branch, links: read.view.record?.links ?? [] }),
    });
  };
  const promote = () => {
    const detail: PromoteAskDetail = {
      number: r.number,
      name: r.name,
      ask: async () => {
        const plan = await promoteExplorationOnGitHub(gh.withBranchPrefix('explore/'), r.number, { requests: openRequestNumbers(r), dryRun: true });
        const { loadTeams, siteApproverEntries } = await import('./teams');
        const { entryLabel } = await import('@bridge-ds/core');
        const teams = await loadTeams();
        const e = siteApproverEntries();
        return promoteAsk(plan.tier as Tier, { design: e.design.map((x) => entryLabel(x, teams)), tech: e.tech.map((x) => entryLabel(x, teams)) });
      },
      confirm: async () => {
        await promoteExplorationOnGitHub(gh.withBranchPrefix('explore/'), r.number, { requests: openRequestNumbers(r) });
        reopen();
      },
      closed: () => undefined,
    };
    document.dispatchEvent(new CustomEvent('bridge:promote-ask', { detail }));
  };
  // Suggest mode: send for review and close are branch writes, so they are not offered.
  const writable = connected() && r.status === 'active' && mode === 'direct';
  current = {
    n: r.number,
    props: {
      number: r.number,
      crumbs: productCrumbs(product.name, jira, r.name),
      title: r.name,
      sentence: productBranchSentence(record, { viewer: currentViewer()?.login ?? null }),
      tryUrl: null,
      rows: record ? null : [],
      checked: Boolean(record),
      why: null,
      visual: 'loading',
      product: product.name,
      connected: connected(),
      connectLabel: (goal) => ghAction(goal, prefersSignIn()),
      onAct: act,
      onPromote: writable ? promote : null,
      onClose: writable
        ? async () => {
            await closeExplorationOnGitHub(gh.withBranchPrefix('explore/'), r.number);
            reopen();
            return 'Closed without merging.';
          }
        : null,
      developer: developerLines({ number: r.number, branch: r.branch, links: record?.links ?? [] }),
      githubUrl: safeUrl(r.url, '#'),
      ask: ASK_CLAUDE,
    },
  };
  d.innerHTML = '';
  mod.paintProductBranch(d, current.props);
  void previewSources(r).then((s) => current?.n === r.number && repaint(d, { tryUrl: tryUrlOf(r, s) }));
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

/** bridge.config.json products, embedded by the layout (#bridge-repo); the defaults when absent. */
export function siteProducts(): ProductConfig[] {
  try {
    const site = JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { products?: ProductConfig[] };
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
