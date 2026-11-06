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
import { archiveExplorationOnGitHub, branchPreviewUrl, cancelLeadAskOnGitHub, isWaitingForLead, leadApproveOnGitHub, leadChangesOnGitHub, EXPLORATION_PREFIX, figmaLines, explorationNote, explorationNotePathOf, explorationSlugFromBranch, mergeExplorationNotes, type GitHubClient, parseExplorationNotes, type ExplorationNotes, type NotesUpdate, explorationStage, liveAddressOf, startPageOf, renameExplorationOnGitHub, reopenExplorationOnGitHub, parseExplorationBody, requesterOf, startedWhen, type BranchCommitLike, type ChangesMode, type ProductConfig } from '@bridge-ds/core';
import {
  activityRows,
  canPutInFigma,
  canRunCheck,
  reopenedOf,
  buildersOf,
  changedScreenOf,
  commitsAs,
  checkInClaudeLine,
  doneActionFor,
  doneByOf,
  explorationMenu,
  faceOf,
  nameOnlyAuthors,
  gitNamesOf,
  handoffActivity,
  handoffSteps,
  headlineOf,
  linkAuthors,
  isHandoffStatus,
  libraryPreviewApp,
  pageLines,
  requestPieces,
  reviewersAsked,
  reviewVerdictOf,
  startedTail,
  startedAtOf,
  type DoneAction,
  type LibraryPieces,
  type PullReviewLike,
  type SentPiece,
  libraryTodayRoute,
  questionWords,
  todayLinkLabel,
} from '../lib/exploration-page';
import { libraryHref } from '../lib/library-shells';
import { pieceRows, type PieceRowView } from '../lib/product-branch';
import { checkPieces } from './connector-api';
import { forgetClaudeLink, knownClaudeLink, viewerClaudeLink } from './claude-link';
import { connectorUrl, copilotSetup, terminalSetup } from '../lib/claude-connector';
import { ARCHIVED_LINE, BACK_TO_EXPLORING_LINE, LEAD_CHANGES_LINE, LEAD_OK_LINE, UNARCHIVED_LINE, explorationKey, RENAMED_LINE, takeItLines, type ExplorationPullLike, type ExplorationRow } from '../lib/explorations-view';
import { developerLines, productCrumbs, productProduction, productTodayUrl, tryInProductView, TRY_BUILDING_NOTE, TRY_UNAVAILABLE_NOTE } from '../lib/product-branch';
import { touchesVisuals } from '../lib/visual-impact';
import { shownJiraKey } from '../lib/vocabulary';
import { safeUrl } from '../lib/html';
import { canKeepExploration, keepExplorationLine, productKeeperLine, startedByDesigner, startedByEmailMember } from '../lib/write-route';
import type { ExplorationPageProps, LeadView } from '../components/ds/studio/ExplorationPage';
import { askDoneExploring } from './exploration-done';
import { explorationsConfig } from './exploration-start';
import { siteConfig } from './repo-context';
import { changedFiles, namesOf, pieceActions, pieceActor, previewSources, productPreviewOf, readView, withToolbar } from './product-branch';
import { productClient, productRepoByKey } from './product-repos';
import { bringLatestIntoExploration, copyRepos, explorationBehind } from './design-copy';
import { claudeCodeUrl, COPY_WORDS } from '../lib/design-copy';
import { currentAccess, currentContributor, currentViewer, designerRoute, ghGet, hasWorkingToken, studioClient } from './github-session';
import { changesModeOnPage } from './changes-mode';
import { sendModeFor } from '../lib/write-route';
import { viewerRole } from './needs-you';
import { sampleVisitor } from './demo-gate';
import { copyText } from './explorer/util';
import { loadVisualImpact } from './reviews/visual-impact';
import { previewShotOf } from './preview-shots';
import { isSampleExploration, isSampleTeam, sampleExplorationPreview, samplePreviewPage } from '../lib/demo';
import { knownNames } from './people';
import { isEmailAddress, loginKey } from '../lib/people';
import { explorationAuthorFor, isNameAuthor } from '../lib/author';
import { siteApprovers } from './teams';
import { pullReviewsOf } from './review-reads';
import { libraryScope } from './next-release';
import { inNextRelease, libraryRelease, parseReleaseBody } from '../lib/release-view';
import { explorationState } from '../lib/exploration-state';
import { askerRole, declineNoteOf, devQuestionOf, taskDeclined, taskStage, taskStatus, devVersionUrl, type DesignAnswer } from '../lib/review-state';
import { answerDevPull, forgetQuestion, readDesignTask, readDevPull, replyOnTask, taskRef } from './design-task';
import { installReadPass } from './read-pass';
import { developersMessage, offersDevelopersMessage, teamMember } from '../lib/developers-message';
import { OLD_TOOLBAR_NOTE, toolbarTakesPass } from '../lib/read-pass-link';

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
      // Each commit with its GitHub account (lib/exploration-page linkAuthors): the same face in every row, Done exploring included.
      .then((f) => linkAuthors(f.data))
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
/** The name of an email member who started the exploration (its author is their address): their "Requested by" line. */
export function emailAuthorName(author: string, body: string | null | undefined): Record<string, string> {
  const name = isEmailAddress(author) ? requesterOf(body)?.name?.trim() : null;
  return name ? { [author]: name } : {};
}

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

/** Archived, not closed nor shipped: the same page, its preview and activity, with the Archived tag and Unarchive. */
export const archivedHere = (r: Pick<ExplorationRow, 'status' | 'archived'>) => Boolean(r.archived) && r.status !== 'closed' && r.status !== 'shipped';

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

/**
 * The page while the design lead has not answered. A lead (never the person who asked) answers here: Looks right runs
 * the hand-off with their GitHub access, Needs changes sends it back with their words. Who asked can take it back.
 */
function leadViewOf(
  r: ExplorationRow,
  body: string | null | undefined,
  o: { gh: GitHubClient; products: readonly ProductConfig[]; library: (() => GitHubClient) | null; previewUrl: string | null; keeper: boolean; reopen: (line: string) => void },
): LeadView | null {
  if (!isWaitingForLead(body)) return null;
  const block = parseExplorationBody(body);
  const asker = block?.leadAskedBy ?? r.author;
  const leads = reviewersAsked({ approvers: siteApprovers().design, builders: [asker] });
  const viewer = currentViewer()?.email ? null : (currentViewer()?.login ?? null);
  const isLead = Boolean(viewer && connected() && leads.some((l) => l.toLowerCase() === viewer.toLowerCase()));
  if (isLead) {
    const who = block?.leadAskedByName ?? block?.leadAskedBy ?? 'The designer';
    return {
      line: `${who} is done exploring. Look at the preview, then answer: nothing reaches the developers before you do.`,
      onAnswer: async (a) => {
        if (a.kind === 'looks-right') {
          await leadApproveOnGitHub(o.gh, r.number, { products: o.products, previewUrl: o.previewUrl, lead: viewer!, ...(o.library ? { library: o.library() } : {}), source: 'studio' });
          o.reopen(LEAD_OK_LINE);
          return LEAD_OK_LINE;
        }
        await leadChangesOnGitHub(o.gh, r.number, { note: a.text, lead: viewer! });
        o.reopen(LEAD_CHANGES_LINE);
        return LEAD_CHANGES_LINE;
      },
    };
  }
  const known = knownNamesOf(leads);
  const names = leads.length ? leads.map((l) => known[l] ?? l).join(', ') : 'your lead';
  return {
    line: `Waiting for ${names}. Nothing goes to the developers until they say it looks right.`,
    onCancel: o.keeper
      ? async () => {
          await cancelLeadAskOnGitHub(o.gh, r.number);
          o.reopen(BACK_TO_EXPLORING_LINE);
          return BACK_TO_EXPLORING_LINE;
        }
      : null,
  };
}

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
  // Try it in the product, on a private product too: the toolbar there reads the change with the member's pass.
  installReadPass();
  mod ??= await import('../components/ds/studio/ExplorationPage');
  const sample = isSampleTeam(`${CFG.owner}/${CFG.repo}`);
  // A sample exploration: its sample person, never the one account behind the sample team (its commits below too).
  const samplePerson = sample && isSampleExploration(r.branch);
  if (samplePerson) r = { ...r, author: explorationAuthorFor(r.author, pull.body) ?? r.author };
  const key = explorationKey(r);
  const own = productRepoByKey(r.product);
  const gh = own ? productClient(own.repo, pull.base?.ref) : dsClient();
  const viewer = currentViewer()?.login ?? null;
  // In the design team's copy of the product (products[].design): Claude Code opens the copy on this branch.
  const at = own ? copyRepos(product) : null;
  const inCopy = at && own && at.copy.toLowerCase() === own.repo.toLowerCase() ? at : null;
  // Someone who joined with their email has no GitHub for Claude Code: the Claude app with Bridge (the tools panel) is theirs.
  const member = currentContributor();
  // A designer signed in with GitHub works in the copy through Bridge too (no access to the copy on GitHub needed):
  // the Claude app with Bridge is theirs as well, Claude Code would need that access.
  const designer = Boolean(inCopy && !member && designerRoute());
  const codeUrl = (previewUrl: string | null) =>
    inCopy && !member && !designer ? claudeCodeUrl({ copy: inCopy.copy, branch: r.branch, name: r.name, purpose: r.purpose, product: product.name, previewUrl }) : null;
  // Who may say Done exploring or archive it: the person who started it or a reviewer, with GitHub, in direct mode; in
  // the design team's copy, also the email member Bridge started it for (the proxy checks it again on each write).
  const emailKeeper = Boolean(inCopy && member && startedByEmailMember(pull.body, member));
  const designerKeeper = Boolean(designer && startedByDesigner(pull.body, viewer));
  const keeper = emailKeeper || designerKeeper || canKeepExploration({ viewer, author: r.author, reviewer: viewerRole() === 'reviewer', write: own ? null : (currentAccess()?.write ?? null) });
  const emailOnProduct = Boolean(own && member && !inCopy);
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
  // "Put in Figma": for who can edit, only when the team has a Figma file (Bridge's rule: a fact goes to who can act on it).
  const figmaLine = (status: string) =>
    canPutInFigma({ figmaFile: (siteConfig() as { figma?: { file?: string } }).figma?.file, demo: sampleVisitor(), archived: Boolean(r.archived), status, memberRole: member?.role, designer, reviewer: viewerRole() === 'reviewer', write: currentAccess()?.write })
      ? figmaLines({ number: r.number, name: r.name, product: own?.product.key, repo: own?.repo })
      : null;
  let reported: Awaited<ReturnType<typeof previewSources>> = null;
  current = {
    key,
    props: {
      number: r.number,
      crumbs: productCrumbs(product.name, shownJiraKey(pull.title), r.name),
      title: r.name,
      stage: 'loading',
      author: faceOf(r.author, false, { ...knownNamesOf([r.author]), ...emailAuthorName(r.author, pull.body) }),
      startedTail: startedTail(product.name, startedAtOf(pull.body, pull.created_at)),
      lines,
      figma: figmaLine(r.status),
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
          check: !isLibrary && (connected() || Boolean(member && inCopy)) && direct && !emailOnProduct ? { repo: `${CFG.owner}/${CFG.repo}`, ref: r.product ? `${r.product}#${r.number}` : String(r.number), body: () => ghGet<ExplorationPullLike>(`${own ? `/repos/${own.repo}` : R}/pulls/${r.number}`).then((f) => f.data.body) } : null,
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
      onReopen: menu.reopen && !r.archived
        ? async () => {
            const back = await reopenExplorationOnGitHub(gh, r.number, { by: currentViewer()?.email ? null : (currentViewer()?.login ?? null) });
            // A token without the right to edit labels: the body says it runs again, designers never read why.
            if (back.warnings.length) console.warn('Back to exploring:', back.warnings.join(' '));
            reopen(BACK_TO_EXPLORING_LINE);
            return BACK_TO_EXPLORING_LINE;
          }
        : null,
      archived: Boolean(r.archived),
      onUnarchive:
        menu.archive && r.archived
          ? async () => {
              await archiveExplorationOnGitHub(gh, r.number, { archived: false });
              reopen(UNARCHIVED_LINE);
              return UNARCHIVED_LINE;
            }
          : null,
      onArchive: menu.archive && !r.archived
        ? async () => {
            await archiveExplorationOnGitHub(gh, r.number, { archived: true });
            reopen(ARCHIVED_LINE);
            return ARCHIVED_LINE;
          }
        : null,
      onCopy: (text) => copyText(text),
      developer: developerLines({ number: r.number, branch: r.branch, links: [], ...(own ? { product: own.product.key, repo: own.repo } : {}) }),
      take: takeItLines(r.branch, inCopy?.copy),
      claudeCodeUrl: codeUrl(null),
      githubUrl: safeUrl(r.url, '#'),
      ...(said ? { said } : {}),
      // Continue in Claude: the steps first while the viewer's own Claude has no Bridge (read once per session).
      claudeLink: knownClaudeLink(),
      ...(member || designer ? { emailMember: true } : {}),
      connectorAddress: connectorUrl(location.origin),
      onClaudeConnected: () => {
        forgetClaudeLink();
        repaint(d, key, { claudeLink: 'unknown' });
      },
      onClaudeLink: (v) => repaint(d, key, { claudeLink: v }),
      terminalSetup: own ? terminalSetup(`${CFG.owner}/${CFG.repo}`) : null,
      // VS Code (Copilot): bridge connect --tool copilot in the product, or the server added to VS Code for the library.
      copilotSetup: copilotSetup(`${CFG.owner}/${CFG.repo}`, Boolean(own)),
    },
  };
  mod.paintExplorationPage(d, current.props);
  if (current.props.claudeLink === 'unknown') void viewerClaudeLink().then((v) => v !== 'unknown' && repaint(d, key, { claudeLink: v }));

  // The preview capture (one raw file for every exploration, no API call) arrives with the reads it waits beside, so
  // the frame paints once: the capture, or the plate.
  // The sample team publishes no preview deploys: its explorations show the screen their card shows, and Open the
  // preview opens that screen running (lib/demo.ts).
  const sampleShot = sample ? sampleExplorationPreview(r.branch) : null;
  const samplePage = sample ? samplePreviewPage(r.branch) : null;
  const [files, readCommits, sources, shot] = await Promise.all([changedFiles(r), branchCommits(r), previewSources(r), sampleShot ? { src: sampleShot, screen: null, capturedAt: null } : previewShotOf(r).catch(() => null)]);
  const commits = samplePerson ? commitsAs(readCommits, r.author) : readCommits;
  reported = sources;
  if (current?.key !== key) return;
  // "Where it stands": the handover notes, while it runs (after Done exploring they went to the developers as the spec).
  // Handed off, the notes stay readable: the lead and the designer keep the decisions, whoever carries on.
  void paintNotes(d, key, r, gh, files, !handedOff && notesEditable({ writable, member: Boolean(member), designer, emailOnProduct, direct, own: Boolean(own) }) && !r.archived);
  // Archived: the page of the state it was archived in (not started or exploring), with the Archived tag.
  const stage = explorationStage({ status: r.archived ? 'active' : r.status, files });
  const app = own ? undefined : isLibrary ? (libraryPreviewApp(files, CFG.apps) ?? 'docs') : (product.key as 'admin');
  // A library exploration: the Library as it is today (its component's page when it asks about one), never the site's home.
  const todayRaw = isLibrary ? libraryHref(CFG.owner, CFG.repo, libraryTodayRoute(r.requests[0]?.component)) : productTodayUrl(product, { production: own ? null : CFG.production, defaultBranch: own ? (pull.base?.ref ?? 'main') : CFG.defaultBranch });
  const todayUrl = todayRaw ? safeUrl(todayRaw) || null : null;
  // An email member's exploration records their address as its author: named by their "Requested by" line, never looked up.
  const logins = [...new Set([r.author, ...commits.map((c) => c.author?.login ?? '').filter(Boolean)])].filter((l) => !isEmailAddress(l) && !isNameAuthor(l));
  // Signed in: the GitHub profile names. Signed out: the git names on the commits, then the author's public profile.
  // A name already known on this browser (the viewer's own, the week's cache) beats a login a failed read left.
  const looked = await (connected() ? namesOf(logins) : isEmailAddress(r.author) || isNameAuthor(r.author) ? Promise.resolve({}) : publicName(r.author)).catch(() => ({}) as Record<string, string>);
  const known = knownNamesOf(logins);
  const names = { ...gitNamesOf(commits), ...known, ...Object.fromEntries(Object.entries(looked).filter(([l, n]) => n && n !== l)), ...emailAuthorName(r.author, pull.body) };
  if (current?.key !== key) return;
  const preview = productPreviewOf(r, reported, app, isLibrary ? null : product);
  // The branch's own build. Open the preview opens it with the Bridge toolbar (tryUrl) for a product
  // whose production Bridge knows (Live product, the Before side); never for the library's apps.
  const v = tryInProductView(preview, { tryUrl: (u) => safeUrl(u) || null, todayUrl, files });
  const previewUrl = samplePage ?? (v.state === 'branch' ? v.url : v.state === 'today' ? todayUrl : null);
  const tryUrl = v.state === 'branch' && v.url && !isLibrary && productProduction(product, own ? null : CFG.production) ? withToolbar(r)(v.url) : null;
  const previewBuilding = v.state === 'building';
  const previewNote = samplePage ? null : v.state === 'today' ? 'These changes do not show there yet: it opens the product as it is today.' : previewBuilding ? TRY_BUILDING_NOTE : v.state === 'failed' ? TRY_UNAVAILABLE_NOTE : v.state === 'unknown' ? 'Your preview appears a few minutes after each change.' : null;
  repaint(d, key, {
    // Waiting for the lead: their answer shows even on an exploration with no change yet.
    stage: stage === 'not-started' && !isWaitingForLead(pull.body) ? 'not-started' : 'exploring',
    lead: leadViewOf(r, pull.body, { gh, products, library: own ? () => dsClient() : null, previewUrl, keeper, reopen: (line) => reopen(line) }),
    leadNote: parseExplorationBody(pull.body)?.leadNote ?? null,
    author: faceOf(r.author, false, names),
    startedTail: startedTail(product.name, startedAtOf(pull.body, pull.created_at, commits[0]?.commit.author?.date)),
    todayUrl,
    todayLabel: todayLinkLabel(isLibrary),
    headline: headlineOf({ commits, files, author: r.author, names }),
    activity: activityRows({ commits, author: r.author, startedAt: startedAtOf(pull.body, pull.created_at), reopened: reopenedOf(pull.body), names }),
    previewUrl,
    tryUrl,
    previewNote,
    previewBuilding,
    ...(inCopy ? { claudeCodeUrl: codeUrl(v.state === 'branch' ? v.url : null) } : {}),
  });
  // A branch started before its product moved to a toolbar that takes the read pass: that toolbar would leave the
  // pass in the address, and the product's hash router would show an empty page. The link opens without it, and says
  // how to get the change's details (Bring it in). One read of package.json at the branch, kept by Bridge's cache.
  if (tryUrl && own) {
    void gh
      .getFileText('package.json', r.branch)
      .then((text) => {
        if (toolbarTakesPass(text) !== false || current?.key !== key) return;
        repaint(d, key, { tryWithoutPass: true, previewNote: OLD_TOOLBAR_NOTE });
      })
      .catch(() => undefined);
  }
  // The screen the capture found its change on comes first (the real one), else a changed screen, else the product.
  const plate = { product: isLibrary ? 'Library' : product.name, screen: shot?.screen ?? changedScreenOf(files, { library: isLibrary }), seed: key };
  const shotProps = shot ? { thumb: shot.src, thumbCapturedAt: shot.capturedAt } : {};
  if (!handedOff) {
    repaint(d, key, { plate, ...shotProps });
    // In the design team's copy: the product moved since it started? A quiet "Bring it in" (its main into the branch).
    if (inCopy && writable && !r.archived) {
      void explorationBehind(inCopy.copy, r.branch).then((behind) => {
        if (!behind || current?.key !== key) return;
        repaint(d, key, {
          latest: {
            line: COPY_WORDS.explorationBehind(product.name),
            onBring: async () => {
              const res = await bringLatestIntoExploration(inCopy.copy, r.branch);
              if (res === 'ok') {
                reopen(COPY_WORDS.broughtIn);
                return COPY_WORDS.broughtIn;
              }
              return res === 'conflict' ? COPY_WORDS.bringConflict : COPY_WORDS.bringFailed;
            },
          },
        });
      });
    }
    if (stage === 'exploring' && !shot) {
      const thumb = await capturedImage(r, files);
      if (thumb) repaint(d, key, { thumb, thumbCapturedAt: null });
    }
    return;
  }

  // After Done exploring: who said it and when, the developers on it, the four steps, the library part.
  const block = parseExplorationBody(pull.body);
  // From the design team's copy, the developers work from their task in their own repository: who is assigned to it,
  // and whether they closed it as done (shipped). One read.
  // Its comments since Done exploring too, only when it has any (a question, or their word when they closed it), and
  // once shipped who said it looks right on their version.
  const task = inCopy && block?.task ? await readDesignTask(block.task, { doneAt: block.doneAt ?? null, shipped: true }) : null;
  // The developers' own pull request on that task (their version), with its branch and the designer's last answer.
  const devRepo = task?.devPull && block?.task ? (taskRef(block.task)?.repo ?? null) : null;
  const devRead = devRepo && task?.devPull ? await readDevPull(devRepo, task.devPull) : null;
  const fromTask = task ? taskStatus(task) : null;
  const status = (devRead && fromTask !== 'shipped' ? 'building' : fromTask ? (fromTask === 'closed' ? 'ready' : fromTask) : r.status) as 'ready' | 'building' | 'shipped';
  const labelled = doneByOf(commits) ? null : await readyLabelEvent(r);
  const label = labelled && samplePerson ? { ...labelled, login: r.author } : labelled;
  // Validated by a lead: the commits and the label are theirs, the block keeps the designer who said it (who started it, for a member without GitHub).
  const doneLogin = (block?.leadOkBy ? (block.doneBy ?? r.author) : null) ?? doneByOf(commits) ?? label?.login ?? r.author;
  const doneAt = block?.doneAt ?? label?.at ?? null;
  // Who explored it: their own comments on the task are answers, never a question of the developers.
  const designers = [r.author, block?.author, block?.doneBy, doneLogin];
  const question = task ? devQuestionOf(task, { doneAt, designers }) : null;
  // Closed without being built while the exploration still waits on them (Bridge's own Back to exploring would have
  // made it run again): the developers declined it.
  const declined = Boolean(task && taskDeclined(task));
  const declineNote = declined && task ? declineNoteOf(task, { designers }) : null;
  const builders = buildersOf({ assignees: task ? task.assignees : ((pull as { assignees?: { login: string }[] }).assignees ?? []), commits: inCopy ? [] : commits, doneAt, author: r.author });
  // The review step: the pull request's reviews (one read, once the developers have started), its draft state, and who
  // is asked: the requested reviewers, else the design approvers of the team.
  const reviews = status === 'ready' ? [] : await pullReviews(r, (pull as { updated_at?: string }).updated_at ?? r.headSha);
  const verdict = reviewVerdictOf(reviews);
  const requested = (pull as { requested_reviewers?: { login?: string }[] }).requested_reviewers ?? [];
  const asked = reviewersAsked({ requested, approvers: siteApprovers().design, builders });
  // The lifecycle's stage (lib/review-state), the same words as Being built, Changes and the home.
  const library = !own && isLibrary;
  const nextRelease = status === 'shipped' && library ? await waitsForRelease((pull as { merge_commit_sha?: string | null }).merge_commit_sha) : false;
  // The one status of every screen (lib/exploration-state), with the developers' task and their pull request as read here.
  const fromTaskStage = task ? taskStage({ ...task, devPull: devRead?.pull ?? task.devPull ?? null }) : null;
  const lifecycle = explorationState({ pull: { ...pull, requested_reviewers: requested }, task: fromTaskStage, approvers: siteApprovers().design, builders, reviews, nextRelease });
  const answer = devRead?.answer ?? null;
  const shippedAnswer = status === 'shipped' ? (task?.shippedAnswer ?? null) : null;
  const askers = [question?.login, declineNote?.login, shippedAnswer?.login].filter((l): l is string => Boolean(l));
  const more = connected() ? await namesOf([...new Set([doneLogin, ...builders, ...asked, ...(verdict ? [verdict.login] : []), ...(answer?.login ? [answer.login] : []), ...askers, ...(block?.leadOkBy ? [block.leadOkBy] : [])])]).catch(() => ({}) as Record<string, string>) : {};
  if (current?.key !== key) return;
  const allNames = { ...names, ...knownNamesOf([...asked, ...(verdict ? [verdict.login] : [])]), ...more };
  // Done exploring by someone known by name only (an email member's commit, or the requester of the app's pull
  // request): the name's face, never a GitHub account's photo of that name.
  const doneBy = faceOf(doneLogin, false, allNames, false, nameOnlyAuthors(commits));
  const shippedAt = task?.closedAt ?? (pull as { merged_at?: string | null }).merged_at ?? null;
  const review = {
    // Reviewers asked on a draft: the developers asked for a review all the same.
    draft: pull.draft !== false && !requested.length,
    asked: asked.map((l) => faceOf(l, false, allNames)),
    verdict: verdict ? { kind: verdict.kind, by: faceOf(verdict.login, false, allNames) } : null,
    viewer,
    compareUrl: v.state === 'branch' ? v.url : null,
    dev: devRead
      ? {
          // The product's own preview pattern: the developers' version deploys from their repository, not the copy.
          url: devVersionUrl(devRead.pull, (products.find((p) => p.key === product.key) ?? product).preview, branchPreviewUrl),
          answer: answer?.login ? { kind: answer.kind, by: faceOf(answer.login, false, allNames) } : null,
        }
      : shippedAnswer?.login
        ? { url: null, answer: { kind: shippedAnswer.kind, by: faceOf(shippedAnswer.login, false, allNames) } }
        : null,
  };
  if (devRead) review.draft = devRead.pull.draft === true;
  // Who asked, by name, and their part on the team when its settings say (a lead): never "the developers" by default.
  const askedBy = question?.login ? faceOf(question.login, false, allNames) : null;
  const questionOn = question ? { ...question, by: askedBy, role: askerRole(question.login, siteApprovers()) } : null;
  // A product added from its address: its developers work elsewhere and never see the task Bridge keeps. Team members
  // copy them one plain message from the "Developers build it" step (lib/developers-message).
  const address = isLibrary ? null : liveAddressOf(product);
  const onTeam = teamMember({ emailMember: Boolean(member), signedIn: connected(), access: currentAccess()?.state ?? null, sample: sampleVisitor() });
  const forDevelopers =
    address && offersDevelopersMessage({ address, status, declined, archived: Boolean(r.archived), member: onTeam })
      ? { message: developersMessage({ name: r.name, product: product.name, address, startPage: startPageOf(block), purpose: block?.purpose ?? r.purpose, previewUrl: (v.state === 'branch' ? v.url : null) ?? branchPreviewUrl(product.preview, r.branch), shotUrl: shot?.src ?? null }) }
      : null;
  const leadOkBy = block?.leadOkBy ?? null;
  const steps = handoffSteps({ status, doneBy, doneAt, leadOk: leadOkBy ? faceOf(leadOkBy, false, allNames) : null, builders: builders.map((l) => faceOf(l, false, allNames)), shippedAt, product: isLibrary ? 'the library' : product.name, library: isLibrary, review, nextRelease, question: questionOn, declined, elsewhere: Boolean(address) });
  const taskUrl = block?.task ?? null;
  const ref = r.product ? `${r.product}#${r.number}` : String(r.number);
  // Who may run the check: someone who can write it, in a team that writes branches. Bridge's server runs it for them:
  // with their GitHub sign-in, or for an email member in the design team's copy with their Bridge session.
  const canCheck = canRunCheck({ github: connected(), emailInCopy: Boolean(member && inCopy), direct, emailOnProduct, keeper, write: currentAccess()?.write === true });
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
    activity: handoffActivity({ commits, author: r.author, startedAt: startedAtOf(pull.body, pull.created_at), doneBy: doneLogin, doneAt, designAnswer: answer?.login ? answer : null, names: allNames }),
    figma: figmaLine(status),
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
      // Looks right or Needs changes on the developers' version: a comment on their pull request, as the viewer.
      onAnswer:
        devRead && devRepo && connected() && !emailOnProduct && !review.draft
          ? async (a: DesignAnswer) => {
              await answerDevPull(devRepo, devRead.pull.number, a);
              const said = a.kind === 'looks-right' ? 'Sent to the developers: it looks right.' : 'Sent to the developers.';
              reopen(said);
              return said;
            }
          : null,
      // The developers' question on their task, and the designer's reply through their own write route.
      question: question
        ? {
            text: question.text,
            by: askedBy,
            when: question.at ? startedWhen(question.at) : '',
            answered: question.answered,
            onReply:
              taskUrl && writable && !question.answered
                ? async (text: string) => {
                    await replyOnTask(gh, taskUrl, text);
                    forgetQuestion(viewer, taskUrl);
                    const sent = questionWords(askedBy).sent;
                    reopen(sent);
                    return sent;
                  }
                : null,
          }
        : null,
      forDevelopers,
      declined: declined ? { note: declineNote ? { text: declineNote.text, by: faceOf(declineNote.login, false, allNames), when: declineNote.at ? startedWhen(declineNote.at) : '' } : null } : null,
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

/**
 * Who edits "Where it stands" in place: whoever keeps the exploration (writable: the person who started it, a
 * reviewer, the email member or designer Bridge writes for in the copy), and in the library anyone signed in who can
 * write to it. The save goes through the same route as every other write of this page (GitHub, or Bridge's proxy for
 * a member, on the exploration's own branch only).
 */
export function notesEditable(x: { writable: boolean; member: boolean; designer: boolean; emailOnProduct: boolean; direct: boolean; own: boolean }): boolean {
  if (x.writable) return true;
  return !x.own && x.direct && !x.member && !x.designer && !x.emailOnProduct && connected() && currentAccess()?.write === true;
}

/** The notes read once per head (the note file at the branch), then painted; the save merges into a fresh read. */
async function paintNotes(d: HTMLElement, key: string, r: ExplorationRow, gh: GitHubClient, files: readonly string[] | null, editable: boolean) {
  const path = explorationNotePathOf(files, r.branch);
  const read = () => gh.getFileText(path, r.branch).catch(() => undefined);
  const view = (notes: ExplorationNotes | null) => ({ notes, onSave: editable ? save : null });
  const save = async (update: NotesUpdate): Promise<string | void> => {
    // A fresh read, so a section Claude or someone else wrote meanwhile stays; only the sections edited here change.
    const before = (await gh.getFileText(path, r.branch)) ?? explorationNote({ name: r.name, purpose: r.purpose ?? '', slug: explorationSlugFromBranch(r.branch) ?? undefined });
    const md = mergeExplorationNotes(before, update, { replace: true });
    if (md !== before) await gh.withBranchPrefix(EXPLORATION_PREFIX).commitToBranch({ branch: r.branch, message: 'Update where it stands', files: [{ path, content: md }] });
    repaint(d, key, { notes: view(parseExplorationNotes(md)) });
  };
  repaint(d, key, { notes: view(null) });
  const text = await read();
  if (current?.key !== key) return;
  repaint(d, key, { notes: view(parseExplorationNotes(text)) });
}

/** Leaves the page (another view opens in the same place). */
export function closeExplorationPage() {
  current = null;
  mod?.unmountExplorationPage();
}
