// The exploration page while it runs (?exploration=N, boards X1 and X2): paints components/ds/studio/ExplorationPage.tsx
// for a running exploration, in the design system repository or a product's own. Reads, all in one go: the files of the
// pull request (shared with the product branch page, so "not started" is the same rule as #620's "no build of its
// own"), its commits (one call, for the activity in words), what Vercel reported (the preview), and, only when the
// files touch tokens or components, the visual impact manifest for a captured image. Writes: Done exploring (the
// shared dialog) and Archive, with the viewer's token, as on the other exploration pages.
import { archiveExplorationOnGitHub, explorationStage, type BranchCommitLike, type ProductConfig } from '@bridge-ds/core';
import { activityRows, doneActionFor, faceOf, gitNamesOf, headlineOf, libraryPreviewApp, pageLines, startedTail, type DoneAction } from '../lib/exploration-page';
import { ARCHIVED_LINE, explorationKey, takeItLines, type ExplorationPullLike, type ExplorationRow } from '../lib/explorations-view';
import { developerLines, productCrumbs, productTodayUrl, tryInProductView, TRY_BUILDING_NOTE, TRY_UNAVAILABLE_NOTE } from '../lib/product-branch';
import { touchesVisuals } from '../lib/visual-impact';
import { jiraKeyOf } from '../lib/vocabulary';
import { safeUrl } from '../lib/html';
import { canKeepExploration, keepExplorationLine, productKeeperLine } from '../lib/write-route';
import type { ExplorationPageProps } from '../components/ds/studio/ExplorationPage';
import { askDoneExploring } from './exploration-done';
import { explorationsConfig } from './exploration-start';
import { changedFiles, namesOf, previewSources, productPreviewOf, withToolbar } from './product-branch';
import { productClient, productRepoByKey } from './product-repos';
import { currentAccess, currentContributor, currentViewer, ghGet, hasWorkingToken, studioClient } from './github-session';
import { changesModeOnPage } from './changes-mode';
import { viewerRole } from './needs-you';
import { sampleVisitor } from './demo-gate';
import { copyText } from './explorer/util';
import { loadVisualImpact } from './reviews/visual-impact';

const CFG = explorationsConfig();
const R = `/repos/${CFG.owner}/${CFG.repo}`;

type Module = typeof import('../components/ds/studio/ExplorationPage');
let mod: Module | null = null;
let current: { key: string; props: ExplorationPageProps } | null = null;

const connected = () => Boolean(hasWorkingToken() && currentViewer());
const dsClient = () => studioClient(`${CFG.owner}/${CFG.repo}`, undefined, { protectedBranches: [CFG.defaultBranch] });

/** The branch's commits, read once per head (an empty list when GitHub cannot be read: the activity then says less). */
const commitsBy = new Map<string, Promise<BranchCommitLike[]>>();
function branchCommits(r: ExplorationRow): Promise<BranchCommitLike[]> {
  const own = productRepoByKey(r.product);
  const k = `${explorationKey(r)}@${r.headSha}`;
  let c = commitsBy.get(k);
  if (!c) {
    c = ghGet<BranchCommitLike[]>(`${own ? `/repos/${own.repo}` : R}/pulls/${r.number}/commits?per_page=100`)
      .then((f) => f.data)
      .catch(() => []);
    commitsBy.set(k, c);
  }
  return c;
}

/** A signed-out visitor: the author's name from their public GitHub profile (one anonymous read, cached), else none. */
async function publicName(login: string): Promise<Record<string, string>> {
  const { personOf } = await import('./home-data');
  const p = await personOf(login);
  return p.name && p.name !== login ? { [login]: p.name } : {};
}

/** True when the page shows this exploration while it runs (X1 or X2); later states keep their own pages. */
export const runsHere = (r: Pick<ExplorationRow, 'status' | 'archived'>) => r.status === 'active' && !r.archived;

function repaint(d: HTMLElement, key: string, patch: Partial<ExplorationPageProps>) {
  if (!current || current.key !== key || !mod) return;
  current.props = { ...current.props, ...patch };
  mod.paintExplorationPage(d, current.props);
}

/** A captured image of the change: the visual impact's biggest change, after. Null when Bridge has none. */
async function capturedImage(r: ExplorationRow, files: readonly string[] | null): Promise<string | null> {
  if (r.product || !files || !touchesVisuals([...files])) return null;
  try {
    const v = await loadVisualImpact(document.createElement('div'), { owner: CFG.owner, repo: CFG.repo, pr: r.number, sha: r.headSha, actionsUrl: `https://github.com/${CFG.owner}/${CFG.repo}/actions/workflows/visual-impact.yml`, designer: true });
    const after = v.top?.images.after ?? v.top?.images.before;
    return v.base && after ? safeUrl(`${v.base}/${after}`) || null : null;
  } catch {
    return null;
  }
}

/** Paints a running exploration in place. `product`: its product (the library for a library exploration). `reopen` reloads it after a write. */
export async function openExplorationPage(d: HTMLElement, r: ExplorationRow, pull: ExplorationPullLike, product: ProductConfig, products: readonly ProductConfig[], reopen: () => void) {
  mod ??= await import('../components/ds/studio/ExplorationPage');
  const key = explorationKey(r);
  const own = productRepoByKey(r.product);
  const gh = own ? productClient(own.repo, pull.base?.ref) : dsClient();
  const viewer = currentViewer()?.login ?? null;
  // Who may say Done exploring or archive it: the person who started it or a reviewer, with GitHub, in direct mode.
  const keeper = canKeepExploration({ viewer, author: r.author, reviewer: viewerRole() === 'reviewer', write: own ? null : (currentAccess()?.write ?? null) });
  const emailOnProduct = Boolean(own && currentContributor());
  const direct = changesModeOnPage() === 'direct';
  const writable = connected() && direct && keeper && !emailOnProduct;
  // Signed out or without write access (a PM, a stakeholder): no Done exploring card, the preview and activity stay.
  const done: DoneAction = doneActionFor({
    direct,
    demo: sampleVisitor(),
    connected: connected(),
    write: own ? null : (currentAccess()?.write ?? null),
    keeper,
    keeperNote: keepExplorationLine(r.author),
    productNote: emailOnProduct ? productKeeperLine(product.name) : null,
  });
  const isLibrary = !own && product.default === true;
  const lines = pageLines({ number: r.number, name: r.name, productName: product.name, product: own?.product.key, repo: own?.repo });
  let reported: Awaited<ReturnType<typeof previewSources>> = null;
  current = {
    key,
    props: {
      number: r.number,
      crumbs: productCrumbs(product.name, jiraKeyOf(pull.title), r.name),
      title: r.name,
      stage: 'loading',
      author: faceOf(r.author, false),
      startedTail: startedTail(product.name, pull.created_at ?? null),
      lines,
      todayUrl: null,
      headline: null,
      previewUrl: null,
      previewNote: null,
      thumb: null,
      activity: null,
      done,
      onDone: (focus) =>
        askDoneExploring(r, pull.body, {
          client: () => gh,
          ...(own ? { library: () => dsClient() } : {}),
          previewUrl: current?.props.previewUrl ?? null,
          products,
          focus,
          after: (line) => {
            repaint(d, key, { said: line });
            reopen();
          },
        }),
      onArchive: writable
        ? async () => {
            await archiveExplorationOnGitHub(gh, r.number, { archived: true });
            reopen();
            return ARCHIVED_LINE;
          }
        : null,
      onCopy: (text) => copyText(text),
      developer: developerLines({ number: r.number, branch: r.branch, links: [], ...(own ? { product: own.product.key, repo: own.repo } : {}) }),
      take: takeItLines(r.branch),
      githubUrl: safeUrl(r.url, '#'),
    },
  };
  mod.paintExplorationPage(d, current.props);

  const [files, commits, sources] = await Promise.all([changedFiles(r), branchCommits(r), previewSources(r)]);
  reported = sources;
  if (current?.key !== key) return;
  const stage = explorationStage({ status: r.status, archived: r.archived, files });
  const app = own ? undefined : isLibrary ? (libraryPreviewApp(files, CFG.apps) ?? 'docs') : (product.key as 'admin');
  const todayRaw = isLibrary ? (app ? (CFG.production?.[app] ?? null) : null) : productTodayUrl(product, { production: own ? null : CFG.production, defaultBranch: own ? (pull.base?.ref ?? 'main') : CFG.defaultBranch });
  const todayUrl = todayRaw ? safeUrl(todayRaw) || null : null;
  const logins = [...new Set([r.author, ...commits.map((c) => c.author?.login ?? '').filter(Boolean)])];
  // Signed in: the GitHub profile names. Signed out: the git names on the commits, then the author's public profile.
  const names = { ...gitNamesOf(commits), ...(await (connected() ? namesOf(logins) : publicName(r.author)).catch(() => ({}) as Record<string, string>)) };
  if (current?.key !== key) return;
  const preview = productPreviewOf(r, reported, app);
  // The branch's own build: the Bridge toolbar on the product, the plain link on the library's apps.
  const v = tryInProductView(preview, { tryUrl: isLibrary ? (u) => safeUrl(u) || null : withToolbar(r), todayUrl, files });
  const previewUrl = v.state === 'branch' ? v.url : v.state === 'today' ? todayUrl : null;
  const previewBuilding = v.state === 'building';
  const previewNote = v.state === 'today' ? 'These changes do not show there yet: it opens the product as it is today.' : previewBuilding ? TRY_BUILDING_NOTE : v.state === 'failed' ? TRY_UNAVAILABLE_NOTE : v.state === 'unknown' ? 'Your preview appears a few minutes after each change.' : null;
  repaint(d, key, {
    stage: stage === 'not-started' ? 'not-started' : 'exploring',
    author: faceOf(r.author, false, names),
    startedTail: startedTail(product.name, pull.created_at ?? commits[0]?.commit.author?.date ?? null),
    todayUrl,
    headline: headlineOf({ commits, files, author: r.author, names }),
    activity: activityRows({ commits, author: r.author, startedAt: pull.created_at ?? null, names }),
    previewUrl,
    previewNote,
    previewBuilding,
  });
  if (stage === 'exploring') {
    const thumb = await capturedImage(r, files);
    if (thumb) repaint(d, key, { thumb });
  }
}

/** Leaves the page (another view opens in the same place). */
export function closeExplorationPage() {
  current = null;
  mod?.unmountExplorationPage();
}
