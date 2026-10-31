// The exploration page while it runs (?exploration=N, boards X1 and X2): paints components/ds/studio/ExplorationPage.tsx
// for a running exploration, in the design system repository or a product's own. Reads, all in one go: the files of the
// pull request (shared with the product branch page, so "not started" is the same rule as #620's "no build of its
// own"), its commits (one call, for the activity in words), what Vercel reported (the preview), and, only when the
// files touch tokens or components, the visual impact manifest for a captured image. Writes: Done exploring (the
// shared dialog), and in the "..." menu Rename, Back to exploring and Archive, with the viewer's token, as on the other exploration pages.
// After Done exploring (Waiting for code, Being built, Shipped) the same page: who said done (Bridge's commit at that
// moment, else the label event), the developers on it, the four steps (the review: one read of the pull request's
// reviews once the developers started), and the library part. A product exploration never checked against the
// library is checked here, once, by the server (api/mcp ?view=pieces runs the adoption audit with the
// viewer's GitHub sign-in and records it); without a way to run it, one quiet "Check in Claude".
import { archiveExplorationOnGitHub, explorationStage, renameExplorationOnGitHub, reopenExplorationOnGitHub, parseExplorationBody, startedWhen, type BranchCommitLike, type ChangesMode, type ProductConfig } from '@bridge-ds/core';
import {
  activityRows,
  buildersOf,
  changedScreenOf,
  checkInClaudeLine,
  doneActionFor,
  doneByOf,
  explorationMenu,
  faceOf,
  gitNamesOf,
  handoffActivity,
  handoffSteps,
  headlineOf,
  isHandoffStatus,
  libraryPreviewApp,
  pageLines,
  requestPieces,
  reviewersAsked,
  reviewVerdictOf,
  startedTail,
  type DoneAction,
  type LibraryPieces,
  type PullReviewLike,
  type SentPiece,
} from '../lib/exploration-page';
import { pieceRows, type PieceRowView } from '../lib/product-branch';
import { checkPieces } from './connector-api';
import { forgetClaudeLink, knownClaudeLink, viewerClaudeLink } from './claude-link';
import { connectorUrl, copilotSetup, terminalSetup } from '../lib/claude-connector';
import { ARCHIVED_LINE, BACK_TO_EXPLORING_LINE, explorationKey, RENAMED_LINE, takeItLines, type ExplorationPullLike, type ExplorationRow } from '../lib/explorations-view';
import { developerLines, productCrumbs, productProduction, productTodayUrl, tryInProductView, TRY_BUILDING_NOTE, TRY_UNAVAILABLE_NOTE } from '../lib/product-branch';
import { touchesVisuals } from '../lib/visual-impact';
import { jiraKeyOf } from '../lib/vocabulary';
import { safeUrl } from '../lib/html';
import { canKeepExploration, keepExplorationLine, productKeeperLine } from '../lib/write-route';
import type { ExplorationPageProps } from '../components/ds/studio/ExplorationPage';
import { askDoneExploring } from './exploration-done';
import { explorationsConfig } from './exploration-start';
import { changedFiles, namesOf, pieceActions, pieceActor, previewSources, productPreviewOf, readView, withToolbar } from './product-branch';
import { productClient, productRepoByKey } from './product-repos';
import { currentAccess, currentContributor, currentViewer, ghGet, hasWorkingToken, studioClient } from './github-session';
import { changesModeOnPage } from './changes-mode';
import { sendModeFor } from '../lib/write-route';
import { viewerRole } from './needs-you';
import { sampleVisitor } from './demo-gate';
import { copyText } from './explorer/util';
import { loadVisualImpact } from './reviews/visual-impact';
import { previewShotOf } from './preview-shots';
import { knownNames } from './people';
import { loginKey } from '../lib/people';
import { siteApprovers } from './teams';
import { pullReviewsOf } from './review-reads';
import { libraryScope } from './next-release';
import { inNextRelease, libraryRelease, parseReleaseBody } from '../lib/release-view';
import { explorationLifecycle, reviewStateOf } from '../lib/review-state';

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

/**
 * The names this browser already knows for these logins, with no call to GitHub: the viewer's own profile name, then
 * the names Studio looked up this week (scripts/people.ts). "Started by Florian", not the login, even when GitHub's
 * hourly limit stops the profile reads; the login stays only when no name is known.
 */
export function knownNamesOf(logins: readonly string[]): Record<string, string> {
  const cache = knownNames();
  const v = currentViewer();
  const out: Record<string, string> = {};
  for (const login of logins) {
    const name = v?.name?.trim() && loginKey(v.login) === loginKey(login) ? v.name.trim() : cache[loginKey(login)]?.name?.trim();
    if (name && name !== login) out[login] = name;
  }
  return out;
}

/** True when the page shows this exploration while it runs (X1 or X2); later states keep their own pages. */
export const runsHere = (r: Pick<ExplorationRow, 'status' | 'archived'>) => r.status === 'active' && !r.archived;

/** True after Done exploring (Waiting for code, Being built, Shipped): the same page, in its hand-off state. */
export const handedOffHere = (r: Pick<ExplorationRow, 'status' | 'archived'>) => isHandoffStatus(r.status) && !r.archived;

/** Who added the ready-for-devs label, and when: Done exploring said without Bridge's note commit. */
async function readyLabelEvent(r: ExplorationRow): Promise<{ login: string; at: string } | null> {
  const own = productRepoByKey(r.product);
  try {
    const events = (await ghGet<{ event: string; label?: { name?: string }; actor?: { login?: string } | null; created_at: string }[]>(`${own ? `/repos/${own.repo}` : R}/issues/${r.number}/events?per_page=100`)).data;
    const e = [...events].reverse().find((x) => x.event === 'labeled' && x.label?.name === 'ready-for-devs' && x.actor?.login);
    return e ? { login: e.actor!.login!, at: e.created_at } : null;
  } catch {
    return null;
  }
}

/** The pull request's reviews (one read, once the developers have started, shared with the lists' cache); none when GitHub cannot be read. */
async function pullReviews(r: ExplorationRow, version: string | null): Promise<PullReviewLike[]> {
  const own = productRepoByKey(r.product);
  return (await pullReviewsOf(own ? own.repo : `${CFG.owner}/${CFG.repo}`, r.number, version)) ?? [];
}

/**
 * Whether a merged library exploration waits for the library release: the release pull request (one read of the open
 * ones, only for a shipped library exploration) lists its merge commit under a library package.
 */
async function waitsForRelease(mergeSha: string | null | undefined): Promise<boolean> {
  if (!mergeSha) return false;
  try {
    const open = (await ghGet<{ state: string; head?: { ref?: string }; body?: string | null }[]>(`${R}/pulls?state=open&per_page=100`)).data;
    const body = open.find((p) => /^changeset-release\//.test(p.head?.ref ?? ''))?.body;
    return body ? inNextRelease(mergeSha, libraryRelease(parseReleaseBody(body), libraryScope()).ids) : false;
  } catch {
    return false;
  }
}

/** The library check runs once per head in this tab: a refusal or a failure is not retried on every paint. */
const checkedHeads = new Set<string>();

/** A piece row of the product branch page, as the hand-off card lists it. */
const sentOf = (row: PieceRowView): SentPiece => ({
  id: row.id,
  title: row.title,
  href: row.library?.href ?? null,
  line: row.library?.line ?? null,
  tone: row.library?.tone ?? 'neutral',
  value: row.value,
  ...(row.library ? { opens: row.library.opens, number: row.library.number } : {}),
  action: row.action,
});

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

/**
 * Paints a running exploration in place. `product`: its product (the library for a library exploration). `reopen`
 * reads it again after a write and opens the page of its new state with `said`, the line the write produced.
 */
export async function openExplorationPage(d: HTMLElement, r: ExplorationRow, pull: ExplorationPullLike, product: ProductConfig, products: readonly ProductConfig[], reopen: (said?: string) => void, said?: string) {
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
  // The "..." menu: Rename, Back to exploring (waiting for code only), Archive, for the same people as Archive.
  const menu = explorationMenu({ writable, status: r.status });
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
  const handedOff = handedOffHere(r);
  const lines = pageLines({ number: r.number, name: r.name, productName: product.name, product: own?.product.key, repo: own?.repo });
  let reported: Awaited<ReturnType<typeof previewSources>> = null;
  current = {
    key,
    props: {
      number: r.number,
      crumbs: productCrumbs(product.name, jiraKeyOf(pull.title), r.name),
      title: r.name,
      stage: 'loading',
      author: faceOf(r.author, false, knownNamesOf([r.author])),
      startedTail: startedTail(product.name, pull.created_at ?? null),
      lines,
      todayUrl: null,
      headline: null,
      previewUrl: null,
      tryUrl: null,
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
          // A product exploration never checked: Bridge checks it while the dialog is open, then offers the pieces.
          check: !isLibrary && connected() && direct && !emailOnProduct ? { repo: `${CFG.owner}/${CFG.repo}`, ref: r.product ? `${r.product}#${r.number}` : String(r.number), body: () => ghGet<ExplorationPullLike>(`${own ? `/repos/${own.repo}` : R}/pulls/${r.number}`).then((f) => f.data.body) } : null,
          after: (line) => {
            repaint(d, key, { said: line });
            reopen(line);
          },
        }),
      onRename: menu.rename
        ? async (name: string) => {
            await renameExplorationOnGitHub(gh, r.number, name);
            reopen(RENAMED_LINE);
            return RENAMED_LINE;
          }
        : null,
      onReopen: menu.reopen
        ? async () => {
            const back = await reopenExplorationOnGitHub(gh, r.number);
            // A token without the right to edit labels: the body says it runs again, designers never read why.
            if (back.warnings.length) console.warn('Back to exploring:', back.warnings.join(' '));
            reopen(BACK_TO_EXPLORING_LINE);
            return BACK_TO_EXPLORING_LINE;
          }
        : null,
      onArchive: menu.archive
        ? async () => {
            await archiveExplorationOnGitHub(gh, r.number, { archived: true });
            reopen(ARCHIVED_LINE);
            return ARCHIVED_LINE;
          }
        : null,
      onCopy: (text) => copyText(text),
      developer: developerLines({ number: r.number, branch: r.branch, links: [], ...(own ? { product: own.product.key, repo: own.repo } : {}) }),
      take: takeItLines(r.branch),
      githubUrl: safeUrl(r.url, '#'),
      ...(said ? { said } : {}),
      // Continue in Claude: the steps first while the viewer's own Claude has no Bridge (read once per session).
      claudeLink: knownClaudeLink(),
      connectorAddress: connectorUrl(location.origin),
      onClaudeConnected: () => {
        forgetClaudeLink();
        repaint(d, key, { claudeLink: 'unknown' });
      },
      terminalSetup: own ? terminalSetup(`${CFG.owner}/${CFG.repo}`) : null,
      // VS Code (Copilot): bridge connect --tool copilot in the product, or the server added to VS Code for the library.
      copilotSetup: copilotSetup(`${CFG.owner}/${CFG.repo}`, Boolean(own)),
    },
  };
  mod.paintExplorationPage(d, current.props);
  if (current.props.claudeLink === 'unknown') void viewerClaudeLink().then((v) => v !== 'unknown' && repaint(d, key, { claudeLink: v }));

  // The preview capture (one raw file for every exploration, no API call) arrives with the reads it waits beside, so
  // the frame paints once: the capture, or the plate.
  const [files, commits, sources, shot] = await Promise.all([changedFiles(r), branchCommits(r), previewSources(r), previewShotOf(r).catch(() => null)]);
  reported = sources;
  if (current?.key !== key) return;
  const stage = explorationStage({ status: r.status, archived: r.archived, files });
  const app = own ? undefined : isLibrary ? (libraryPreviewApp(files, CFG.apps) ?? 'docs') : (product.key as 'admin');
  const todayRaw = isLibrary ? (app ? (CFG.production?.[app] ?? null) : null) : productTodayUrl(product, { production: own ? null : CFG.production, defaultBranch: own ? (pull.base?.ref ?? 'main') : CFG.defaultBranch });
  const todayUrl = todayRaw ? safeUrl(todayRaw) || null : null;
  const logins = [...new Set([r.author, ...commits.map((c) => c.author?.login ?? '').filter(Boolean)])];
  // Signed in: the GitHub profile names. Signed out: the git names on the commits, then the author's public profile.
  // A name already known on this browser (the viewer's own, the week's cache) beats a login a failed read left.
  const looked = await (connected() ? namesOf(logins) : publicName(r.author)).catch(() => ({}) as Record<string, string>);
  const known = knownNamesOf(logins);
  const names = { ...gitNamesOf(commits), ...known, ...Object.fromEntries(Object.entries(looked).filter(([l, n]) => n && n !== l)) };
  if (current?.key !== key) return;
  const preview = productPreviewOf(r, reported, app, isLibrary ? null : product);
  // The branch's own build. Open the preview opens it with the Bridge toolbar (tryUrl) for a product
  // whose production Bridge knows (Live product, the Before side); never for the library's apps.
  const v = tryInProductView(preview, { tryUrl: (u) => safeUrl(u) || null, todayUrl, files });
  const previewUrl = v.state === 'branch' ? v.url : v.state === 'today' ? todayUrl : null;
  const tryUrl = v.state === 'branch' && v.url && !isLibrary && productProduction(product, own ? null : CFG.production) ? withToolbar(r)(v.url) : null;
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
    tryUrl,
    previewNote,
    previewBuilding,
  });
  const plate = { product: isLibrary ? 'Library' : product.name, screen: changedScreenOf(files) ?? shot?.screen ?? null, seed: key };
  const shotProps = shot ? { thumb: shot.src, thumbCapturedAt: shot.capturedAt } : {};
  if (!handedOff) {
    repaint(d, key, { plate, ...shotProps });
    if (stage === 'exploring' && !shot) {
      const thumb = await capturedImage(r, files);
      if (thumb) repaint(d, key, { thumb, thumbCapturedAt: null });
    }
    return;
  }

  // After Done exploring: who said it and when, the developers on it, the four steps, the library part.
  const status = r.status as 'ready' | 'building' | 'shipped';
  const block = parseExplorationBody(pull.body);
  const label = doneByOf(commits) ? null : await readyLabelEvent(r);
  const doneLogin = doneByOf(commits) ?? label?.login ?? r.author;
  const doneAt = block?.doneAt ?? label?.at ?? null;
  const builders = buildersOf({ assignees: (pull as { assignees?: { login: string }[] }).assignees ?? [], commits, doneAt, author: r.author });
  // The review step: the pull request's reviews (one read, once the developers have started), its draft state, and who
  // is asked: the requested reviewers, else the design approvers of the team.
  const reviews = status === 'ready' ? [] : await pullReviews(r, (pull as { updated_at?: string }).updated_at ?? r.headSha);
  const verdict = reviewVerdictOf(reviews);
  const requested = (pull as { requested_reviewers?: { login?: string }[] }).requested_reviewers ?? [];
  const asked = reviewersAsked({ requested, approvers: siteApprovers().design, builders });
  // The lifecycle's stage (lib/review-state), the same words as Being built, Changes and the home.
  const library = !own && isLibrary;
  const nextRelease = status === 'shipped' && library ? await waitsForRelease((pull as { merge_commit_sha?: string | null }).merge_commit_sha) : false;
  const lifecycle = explorationLifecycle({ status, review: reviewStateOf({ draft: pull.draft ?? null, requested, approvers: siteApprovers().design, builders, reviews }), nextRelease });
  const more = connected() ? await namesOf([...new Set([doneLogin, ...builders, ...asked, ...(verdict ? [verdict.login] : [])])]).catch(() => ({}) as Record<string, string>) : {};
  if (current?.key !== key) return;
  const allNames = { ...names, ...knownNamesOf([...asked, ...(verdict ? [verdict.login] : [])]), ...more };
  const doneBy = faceOf(doneLogin, false, allNames);
  const shippedAt = (pull as { merged_at?: string | null }).merged_at ?? null;
  const review = {
    // Reviewers asked on a draft: the developers asked for a review all the same.
    draft: pull.draft !== false && !requested.length,
    asked: asked.map((l) => faceOf(l, false, allNames)),
    verdict: verdict ? { kind: verdict.kind, by: faceOf(verdict.login, false, allNames) } : null,
    viewer,
    compareUrl: v.state === 'branch' ? v.url : null,
  };
  const steps = handoffSteps({ status, doneBy, doneAt, builders: builders.map((l) => faceOf(l, false, allNames)), shippedAt, product: isLibrary ? 'the library' : product.name, library: isLibrary, review, nextRelease });
  const ref = r.product ? `${r.product}#${r.number}` : String(r.number);
  // Who may run the check: someone who can write it, signed in with GitHub, in a team that writes branches.
  const canCheck = connected() && direct && !emailOnProduct && (keeper || currentAccess()?.write === true);
  const claudeLine = connected() ? checkInClaudeLine(r.name, `#${ref}`) : null;
  const mode: ChangesMode = sendModeFor(currentAccess(), changesModeOnPage());
  const lib = dsClient();
  let lastView: Awaited<ReturnType<typeof readView>> = null;
  const piecesNow = async (): Promise<LibraryPieces> => {
    if (isLibrary) return r.requests.length ? { state: 'rows', rows: requestPieces(r.requests) } : { state: 'hidden' };
    const read = await readView(r, gh, products);
    lastView = read;
    if (!read) return { state: 'unchecked', claude: claudeLine };
    if (!read.view.record) return { state: 'unchecked', claude: claudeLine };
    const rows = pieceActions(pieceRows({ record: read.view.record, linked: read.view.linked, names: read.names }), mode);
    return rows.length ? { state: 'rows', rows: rows.map(sentOf) } : { state: 'none' };
  };
  const refreshPieces = async () => {
    const pieces = await piecesNow();
    if (current?.key !== key || !current.props.handoff) return;
    repaint(d, key, { handoff: { ...current.props.handoff, pieces } });
  };
  const act = pieceActor({ r, gh, lib, own: Boolean(own), mode, products, lastView: () => lastView?.view ?? null, refresh: () => void refreshPieces() });
  repaint(d, key, {
    stage: 'handed-off',
    plate,
    ...shotProps,
    activity: handoffActivity({ commits, author: r.author, startedAt: pull.created_at ?? null, doneBy: doneLogin, doneAt, names: allNames }),
    // Shipped: the product itself, where it lives now.
    ...(status === 'shipped' ? { previewUrl: todayUrl, tryUrl: null, previewNote: null, previewBuilding: false } : {}),
    handoff: {
      status,
      stage: lifecycle,
      doneBy,
      doneWhen: doneAt ? startedWhen(doneAt) : '',
      steps,
      pieces: { state: 'loading' },
      onPiece: writable ? (piece) => act({ id: piece.id, title: piece.title }, piece.action?.kind ?? 'open') : null,
    },
  });
  if (!shot) {
    const thumb = await capturedImage(r, files);
    if (thumb) repaint(d, key, { thumb, thumbCapturedAt: null });
  }
  const first = await piecesNow();
  if (current?.key !== key || !current.props.handoff) return;
  const head = `${key}@${r.headSha}`;
  if (first.state === 'unchecked' && canCheck && !checkedHeads.has(head)) {
    checkedHeads.add(head);
    repaint(d, key, { handoff: { ...current.props.handoff, pieces: { state: 'checking' } } });
    const ok = await checkPieces(`${CFG.owner}/${CFG.repo}`, ref).then(
      () => true,
      () => false,
    );
    if (current?.key !== key || !current.props.handoff) return;
    if (ok) return void refreshPieces();
  }
  repaint(d, key, { handoff: { ...current.props.handoff, pieces: first } });
}

/** Leaves the page (another view opens in the same place). */
export function closeExplorationPage() {
  current = null;
  mod?.unmountExplorationPage();
}
