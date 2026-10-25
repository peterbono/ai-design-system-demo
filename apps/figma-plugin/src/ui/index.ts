// Bridge UI: three tabs (Pull: code -> Figma, Push: Figma -> code, Settings). Plain TypeScript and DOM, no framework.
// The UI owns network calls and logic; figma.* access goes through request() to the main thread.
// Layout: tabs on top, scrolling content, and an action bar pinned to the bottom that always shows
// what the primary button will do (or why it is disabled).

import type { ConflictChoice, DiffEntry } from '@bridge-ds/core';
import { type Analysis, type PullProposal, type PushBrand, type PushProposal, analyze, buildPull, buildPush, changesModeOf, commitsBehind, pullCollections, pullHeadline } from '../sync/flows';
import { type ChangesMode, GitHubClient, type PullRequest, type PullRequestSummary, changesMode, figmaPushNextLine, loadConfig, parseRepo } from '@bridge-ds/core';
import type { RenameSuggestion } from '@bridge-ds/core';
import { type FigmaFidelityRun, type GapBuiltVariant, type GapCase, type MeasuredSpecsFile, affectedContrast, buildGapCase, defaultTitle } from '@bridge-ds/core';
import { DIFFERS_HANDOFF_TEXT, NO_REFERENCES_HANDOFF_TEXT, differsRequestForDeveloper, fixRequestForDeveloper, referencesRequestForDeveloper, writeFidelityRun } from '../sync/fix-with-claude';
import { type PathIndex, type ResolveContext, resolve } from '@bridge-ds/core';
import { contextFor, modesOf } from '@bridge-ds/core';
import { type LogicalToken, SINGLE_MODE } from '@bridge-ds/core';
import type { Issue, IssueCode, PushIssue } from '@bridge-ds/core';
import { formatValue, isAlias, parseColor, rgbaToHex } from '@bridge-ds/core';
import { type ContrastResult, contextLabel, pairKey } from '@bridge-ds/core';
import { type ApplyReport, type FigmaSnapshot, type InitPayload, type RepoSettings, STUDIO_ORIGIN, modeDisplayName } from '../shared/messages';
import { REQUEST_KINDS, type RequestKind, draftPushDescription, pushChangeRows, shortVariant, shortVariants } from '@bridge-ds/core';
import { type ComponentChangeItem, type ComponentScan, type RequestDraft, classifyComponents, pullBaselines, suggestLine, suggestSummary, suggestTitle, toRequest } from '../sync/components';
import { type ClaudeDraft, type ClaudeDraftInput, DRAFTED_NOTE } from '../sync/claude';
import { componentOfSet, loadCodedComponents, sendComponentRequest } from '../sync/requests';
import { DRAFT_PHRASE, type DraftField, DraftPoller, MY_CLAUDE_NEEDS_WRITE, type MyClaudeTarget, finishMyClaudeDrafts, mcpSnippets, myClaudeAccess, planFill, startMyClaudeDrafts } from '../sync/my-claude';
import { type LoadedSpecs, type ComponentApplyReport, type ComponentPullPlan, type CoverageView, type PlannedComponent, buildComponentPlan, componentReportView, coverageView, draftedSetNote, pushedInReview, pushedNumbers, specSource } from '../sync/component-pull';
import { type FigmaPushStatus, figmaPushStatusesOnGitHub } from '@bridge-ds/core';
import { type ComponentReview, onlyComponent, reviewUpdates } from '../sync/component-review';
import type { ComponentSignature } from '../sync/components';
import { type ComponentPush, ROUTE_TAG, componentPushes } from '../sync/component-push';
import { IMAGES_NEED_WRITE, type SentComponentPush, sendLabel, sentTitle, suggestionLines, tokenHelp } from '../sync/publish';
import { type Destination, type PublishItem, type PublishResult, sendComponentPush, applyDestination, componentKey, defaultUnchecked, experimentalTokenIds, groupState, heldTokenIds, isChecked, publish, publishItems, setGroup, variableIdsOf, variableKey } from '../sync/publish';
import { type ComponentsReadProblem, NEW_TOKEN_REFUSED, isOffline, TOKEN_REJECTED_CALLOUT, TOKEN_REJECTED_DETAIL, TOKEN_SETTINGS_URL, type TokenProblem, checkToken, componentsReadProblem, errorText, friendlyError, tokenProblem } from '../sync/token-health';
import { type BuildItem, type StudioTarget, developerMessage, sentLinks, studioChangeUrl, studioTeamUrl } from '../sync/studio';
import { type RoutedItem, type ShipPoll, type ShipStatus, ShipPoller, groupRoutes, routedItems, shipStateLabel, shippedNumbers, toArm, waitingLede } from '../sync/library-routes';
import { type ArmAnswer, figmaShipper } from '../sync/ship';
import { libraryArrivalOnGitHub } from '@bridge-ds/core';
import { type ExplorationChoice, explorationTestBuild, newExplorationProblems, runningExplorations, shareMessage, startExploration, targetOf, TestBuildPoller, triedLocally, tryItLinks } from '../sync/explorations';
import type { BranchPreview, ExplorationTryIt } from '@bridge-ds/core';
import { type Selection, onProgress, onSelection, request } from './bridge';
import { blockerLines } from '../sync/blockers';
import { MEASURED_SPECS_FILE, type MeasuredOverlayReport } from '../sync/measured-specs';
import type { MeasuredOnlyReport } from '@bridge-ds/core';
import { type FidelityOutcome, differsSentence, fidelityHeadline, fidelitySummary, loadReferenceManifest, runFidelityCheck } from '../sync/fidelity';
import { FIGMA_REFERENCES_BRANCH, FIGMA_REFERENCES_DIR, type FigmaReferenceManifest } from '@bridge-ds/core';
import { fidelityComponentLine, fidelityVerdict } from '@bridge-ds/core';
import { decodePng, encodePng } from './png';
import { type Child, h } from './dom';
import { icon } from './icons';
import { ILLUSTRATIONS, type IllustrationName } from './illustrations';
import { focusFirstItem, menuKeys } from './menu';
import { ASK_TTL_MS, type Asked, CLAUDE_NEW_CHAT, CONNECTOR_WORDS, WATCH_MS, askText, claudeUrl, findFix, parseAsked } from '../sync/claude-connector';
import { type FixSession, readFixSession, sessionHead } from '../sync/fix-session';
import { PREVIEW_WORDS, RENDER_CAP_MS, type UpdatePreview, codeImageSource, previewKey } from '../sync/update-preview';
import { BridgeSignInPoller, type LinkPoll, SIGN_IN_WORDS, startBridgeSignIn } from '../sync/bridge-sign-in';

type Tab = 'pull' | 'push' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pull', label: 'Pull' },
  { id: 'push', label: 'Push' },
  { id: 'settings', label: 'Settings' },
];
/** Rows rendered per list before "Show all": keeps large token sets responsive. */
const PAGE = 60;

interface PullState {
  analysis: Analysis;
  choices: Map<string, ConflictChoice>;
  /** "Replace with main": main wins over the Figma edits of tokens that exist on main. */
  overwrite: boolean;
  proposal: PullProposal;
  report?: ApplyReport | undefined;
  /** Component sets from component-specs.json on the branch; undefined when the repo has none. */
  components?: ComponentPullPlan | undefined;
  componentsError?: ComponentsReadProblem | undefined;
  /** Spec source Measured: how many variants a measured story gave values to. */
  measured?: MeasuredOverlayReport | undefined;
  /** Spec source Measured only: the sets built from the stories. */
  measuredOnly?: MeasuredOnlyReport | undefined;
  /** Measured only with screenshots: Check fidelity compares with the stories' renders (LoadedSpecs.shots). */
  shots?: LoadedSpecs['shots'];
  /** Measured only: figma-fixes.json laid on the measure (LoadedSpecs.fixes), and the measure the sets came from. */
  fixes?: LoadedSpecs['fixes'];
  measure?: LoadedSpecs['measure'];
  /** The specs the pull drew, for the gap cases after Check fidelity. */
  specs?: LoadedSpecs['specs'] | undefined;
  /** Also build the sets code added ("Include components" in the footer): on by default on a first pull. Updates are always offered. */
  includeComponents: boolean;
  componentsReport?: ComponentApplyReport | undefined;
  /** "Review updates": what an update changes in each generated set that changed in code. */
  reviews: ComponentReview[];
  /** This person's change still open for review (the last send): the kept edits it holds are "in review", not "to send". */
  sentPr?: PullRequest | undefined;
  /** Published code images (Check fidelity's), read once when an update is to review: the "After" of a preview. */
  refs?: FigmaReferenceManifest | undefined;
  /** "Review updates": per set node id, the default variant in Figma now and the incoming version (in code). */
  previews: Record<string, UpdatePreview>;
  /** Thumbnails (base64 PNG) per set node id, before and after its update. */
  before: Record<string, string>;
  after: Record<string, string>;
  /** Component ids updated one by one (or by "Update all"), with their review, kept across re-checks. */
  done: Map<string, ComponentReview>;
  /** Sets pushed from Figma whose library branch is still open: said under the components, never overwritten silently. */
  inReview: { name: string; number: number; url: string; status: FigmaPushStatus }[];
  /** "Check fidelity": running (with its progress line), its outcome, or why it failed. Nothing is written. */
  /** `copied`: the report JSON was copied for a developer ("Copy the report"). */
  /** `gaps`: per set that differs, what the code draws that Figma does not (measured only), for Claude or a developer. */
  /** `built`: per set, what read-built gave (the gap cases' input, sent with Fix with Claude). `fix`: Fix with Claude's state. */
  fidelity?:
    | {
        running?: string | undefined;
        outcome?: FidelityOutcome | undefined;
        error?: string | undefined;
        copied?: boolean | undefined;
        gaps?: GapCase[] | undefined;
        gapsCopied?: boolean | undefined;
        built?: Record<string, Record<string, GapBuiltVariant>> | undefined;
        /** `refused`: Bridge would not start a run (Claude not connected for the team, the hourly limit): its sentence. */
        /** `connect`: the first time in this file, how to add Bridge to the team's Claude. `asked`: Claude is open with it. */
        fix?: { component: string; status: 'connect' | 'writing' | 'asked' | 'error'; error?: string | undefined; copied?: boolean | undefined; prefilled?: boolean | undefined } | undefined;
        /** "Copy for your developer" copied, by component (or "references"): the button says Copied. */
        handedOff?: Set<string> | undefined;
      }
    | undefined;
}

/** Thumbnail width in the review, CSS pixels (two side by side in the 480px plugin). */
const THUMB_W = 196;

interface PushState {
  analysis: Analysis;
  snapshot: FigmaSnapshot;
  choices: Map<string, ConflictChoice>;
  confirmed: RenameSuggestion[];
  dismissed: Set<string>;
  proposal: PushProposal;
  title: string;
  /** "Description": the pull request's "What changed and why" and every request's summary. */
  description: string;
  openPr: PullRequest | undefined;
  appendToOpen: boolean;
  /** Slugs of new brand candidates the designer chose to create in this pull request (opt-in, see planBrands). */
  includeBrands: Set<string>;
  /** Changes list: every variable edit and component change, and the keys the designer unchecked. */
  items: PublishItem[];
  unchecked: Set<string>;
  /** Token ids marked "Experimental" in this file. */
  experimental: Set<string>;
  result?: PublishResult | undefined;
  /** Component changes: requests (GitHub issues), separate from the variables pull request. */
  components?: ComponentScan | undefined;
  componentsError?: ComponentsReadProblem | undefined;
  fileKey?: string | undefined;
  /** Where each component change goes (review): an exact token change, a branch Claude AI drafts, or fix in Figma. */
  pushes: ComponentPush[];
  form?: RequestForm | undefined;
  /**
   * Sent from this screen: requests (issues), suggestions and library branches, one status line each. `target` is how
   * Studio opens it; `build` is set when a developer builds it with Claude (the line offers the message for them).
   */
  sent: SentLine[];
  /** Who wrote the Description: the plugin's draft (kept in sync with the checked changes), Claude, or the designer. */
  descriptionSource: TextSource;
  /** Who wrote the pull request title (Claude fills it only when the designer has not typed one). */
  titleSource: TextSource;
  assist: AssistState;
  /** Where the push goes: for review (default) or to an exploration. */
  destination: Destination;
  /** Running explorations, loaded when the designer picks "Try in an exploration". */
  explorations?: ExplorationChoice[] | undefined;
  explorationsError?: string | undefined;
  loadingExplorations?: boolean | undefined;
  /** The exploration to send to: its branch, or "new" to start one. */
  exploreTarget: string;
  /**
   * Where each item of a push to the library went (docs/BUILD-REQUESTS.md): shipped, waiting for a developer, or a
   * build request. Set by a send for review in direct mode (publish's outcomes).
   */
  routed?: RoutedItem[] | undefined;
  /** The shipped pull requests: on their way, in the library, or a failed check; polled while the screen is open. */
  ship?: { statuses: Map<number, ShipStatus>; poller?: ShipPoller | undefined; timedOut?: boolean | undefined } | undefined;
  newExploration: { name: string; purpose: string };
  /** The exploration the last push went to (result screen). */
  sentTo?: ExplorationChoice | undefined;
  /** Its test build: the install command from the pull request's preview comment, or still building. */
  tryIt?: ExplorationTryIt | undefined;
  /** Its previews as Vercel reports them (real URLs, build state), read with the command. */
  previews?: BranchPreview[] | undefined;
  tryItError?: string | undefined;
  checkingTryIt?: boolean | undefined;
  /** Reads the test build every 15 seconds for up to 10 minutes while the result screen is open. */
  tryItPoller?: TestBuildPoller | undefined;
  /** The poller stopped after 10 minutes with something still building: "Check again" starts it over. */
  tryItTimedOut?: boolean | undefined;
  /** "Share with a developer" copied the message (the button says so). */
  shared?: boolean | undefined;
  /**
   * Change lines and request titles Claude wrote, by component node id, with the changes they describe (a new scan
   * may change them).
   */
  lines: Map<string, { line: string; title?: string | undefined; key: string }>;
}

/** One thing sent from the Push screen, as its status line shows it. */
interface SentLine {
  component: string;
  number: number;
  url: string;
  /** What it became, in designer words ("request sent"). */
  what: string;
  target: StudioTarget;
  build?: BuildItem | undefined;
  /** "Copy message for a developer" copied it (the button says so). */
  copied?: boolean | undefined;
}

/** Where the text of a field comes from. Only "draft" text is rewritten by the plugin. */
type TextSource = 'draft' | 'claude' | 'user';

/** "Draft with my Claude" and "Draft with Claude (API key)" under a field. */
interface AssistState {
  message?: { kind: 'ok' | 'error'; text: string } | undefined;
  /** "Draft with my Claude": the pending drafts file on the requests branch and its polling. */
  mine?: MineState | undefined;
  /** Claude's text for fields the designer edited while waiting: offered, never written over their text. */
  offer?: { title?: string | undefined; summary?: string | undefined } | undefined;
}

interface MineState {
  status: 'starting' | 'waiting' | 'timeout' | 'drafted' | 'error';
  sessionId?: string | undefined;
  poller?: DraftPoller | undefined;
  /** Fields the designer typed in after the request: Claude's text is offered for them, not filled. */
  edited: Partial<Record<DraftField, boolean>>;
  error?: string | undefined;
  /** The error is the token's missing permission: the block offers "Edit token on GitHub". */
  permission?: boolean | undefined;
  copied?: boolean | undefined;
}

/** The inline request form: one detected change, a new component candidate, or a manual request ("manual"). */
interface RequestForm {
  key: string;
  item?: ComponentChangeItem | undefined;
  draft: RequestDraft;
  attach: boolean;
  error?: string | undefined;
  titleSource: TextSource;
  summarySource: TextSource;
  assist: AssistState;
  /** Where the request goes: '' for review (the default), or an exploration's branch the designer picked here. */
  target: string;
  /** The designer chose the component: the selection no longer changes it (REQ-3). */
  componentPicked?: boolean | undefined;
}

interface State {
  tab: Tab;
  init?: InitPayload | undefined;
  busy?: string | undefined;
  /** While a long build runs: "Stop" in the action bar calls it. */
  cancel?: (() => void) | undefined;
  /** `problem`: the failure was about the token (rejected, or a missing permission named with its GitHub link). */
  /** `offline`: no network. One sentence and one retry; it retries by itself when the connection is back. */
  error?: { message: string; detail?: string | undefined; retry?: (() => void) | undefined; problem?: TokenProblem | undefined; offline?: boolean | undefined } | undefined;
  pull?: PullState | undefined;
  push?: PushState | undefined;
  settingsDraft: RepoSettings;
  /** "changes" of the repo's bridge.config.json, read once for the Push intro before the first scan. */
  mode?: ChangesMode | undefined;
  tokenDraft: string;
  /** Which setup snippet was just copied in Settings. */
  claudeCopied?: string | undefined;
  /** `field`: the error belongs to that field and shows under it (the cause and the fix, next to what to change). */
  settingsMessage?: { kind: 'ok' | 'error'; text: string; field?: SettingsField | undefined } | undefined;
  /** The saved token can read but not write what this repo needs: the token card says "Read only", not "Connected". */
  tokenReadOnly?: boolean | undefined;
  expanded: Set<string>;
  /** Current Figma selection, for "Attach the current selection". */
  selection: Selection;
  /** Just connected (a sign-in or a saved token): Pull says "Connected to …" once, then never again. */
  justConnected?: string | undefined;
  /** "Sign in with Bridge": waiting for the designer in Studio (with the page to reopen), or why it stopped. */
  link?: { status: 'waiting'; url: string; poller: BridgeSignInPoller } | { status: 'error'; message: string } | undefined;
}

type SettingsField = 'repo' | 'branch' | 'tokensPath' | 'token';

/** A settings problem that belongs to one field: shown under it, not in a callout far from it. */
class FieldError extends Error {
  constructor(
    readonly field: SettingsField,
    message: string,
  ) {
    super(message);
  }
}

/** GitHub's 404 on the repository: it does not exist, or this sign-in cannot see it. Cause and fix in one sentence. */
const repoNotFound = (repo: string) => `Bridge can't find ${repo}. Check the name, or ask an admin of the design system to give you access.`;

interface ActionBar {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  hint?: string | undefined;
  secondary?: { label: string; onClick: () => void } | undefined;
  /** A choice that changes what the primary action does, next to it (proximity): "Include components (62)". */
  toggle?: { label: string; checked: boolean; focusId: string; onChange: (checked: boolean) => void } | undefined;
}

const state: State = { tab: 'pull', settingsDraft: { repo: '', branch: '', tokensPath: '' }, tokenDraft: '', expanded: new Set(), selection: null };
let client: GitHubClient | undefined;
const app = document.getElementById('app')!;

onSelection((selection) => {
  state.selection = selection;
  // Only the request form shows the selection: re-render it, never the whole screen while typing.
  const el = document.getElementById('attach-hint');
  if (el) el.textContent = attachHint();
  const box = document.getElementById('attach-box') as HTMLInputElement | null;
  if (box && state.push?.form?.key === 'manual') box.disabled = !selection;
  // A manual request follows the selected component until the designer picks one (REQ-3).
  const f = state.push?.form;
  const picked = f && !f.item && !f.componentPicked ? componentOfSelection(state.push?.components?.coded ?? []) : undefined;
  if (f && picked) {
    f.draft.component = picked;
    const select = document.querySelector<HTMLSelectElement>('[data-focus-id="req-component"]');
    if (select) select.value = picked;
  }
  refreshRequestAssist();
});

// Back online: what failed offline runs again by itself (the callout promised it).
window.addEventListener('online', () => {
  if (!state.error?.offline) return;
  const retry = state.error.retry;
  state.error = undefined;
  if (retry) retry();
  else render();
});

onProgress((message) => {
  if (!state.busy) return;
  state.busy = message;
  const el = document.getElementById('busy-text');
  if (el) el.textContent = message;
});

// ---------------------------------------------------------------------------------------------
// Helpers

/** The file is connected: a design system (repository) picked for this file, and a token on this computer. */
const connected = () => !!state.init?.hasToken && !!state.init.settings.repo;

function getClient(): GitHubClient {
  const init = state.init!;
  if (!init.settings.repo) throw new Error('Connect a design system in Settings first.');
  if (!init.token) throw new Error('Add a GitHub token in Settings to connect.');
  client ??= new GitHubClient(init.settings.repo, init.token);
  return client;
}

async function run(label: string, task: () => Promise<void>, retry?: () => void): Promise<void> {
  if (state.busy) return;
  state.busy = label;
  state.error = undefined;
  render();
  try {
    await task();
  } catch (err) {
    const problem = noteTokenProblem(err);
    const f = friendlyError(err);
    state.error = { message: problem?.text ?? f.text, detail: problem ? undefined : f.detail, retry, problem, offline: isOffline(err) };
  } finally {
    state.busy = undefined;
    render();
  }
}

/**
 * A 401 means GitHub no longer accepts the saved token: record it (kept on this computer until a new token is saved),
 * so Settings says "Stopped working" and Pull and Push show one callout instead of their own errors.
 */
function noteTokenProblem(err: unknown): TokenProblem | undefined {
  const problem = tokenProblem(err);
  if (problem?.kind === 'rejected') setTokenState('rejected');
  return problem;
}

function setTokenState(next: 'ok' | 'rejected'): void {
  const init = state.init;
  if (!init?.hasToken || init.tokenState === next) return;
  init.tokenState = next;
  void request('token-state', { state: next }).catch(() => undefined);
}

const tokenRejected = () => state.init?.tokenState === 'rejected';

/** An error shown inside a screen (components, explorations, previews): none when the token callout already says it. */
function inlineError(err: unknown): string | undefined {
  return noteTokenProblem(err)?.kind === 'rejected' ? undefined : errorText(err);
}

/** A failed component read: none when the token callout already says it, else what happened and what to do. */
function componentsErrorOf(err: unknown, flow: 'pull' | 'push'): ComponentsReadProblem | undefined {
  return noteTokenProblem(err)?.kind === 'rejected' ? undefined : componentsReadProblem(err, flow);
}

/** The callout for a failed component read: the sentence, then the technical error folded under "Details". */
function componentsErrorCallout(p: ComponentsReadProblem): HTMLElement {
  return h(
    'div',
    { class: 'callout warn' },
    h('div', { class: 'callout-title' }, icon('alert'), p.title),
    h('p', null, p.text),
    p.detail ? h('details', { class: 'notes command' }, h('summary', null, 'Details'), h('pre', { class: 'mono-area', tabindex: '0', 'aria-label': 'Error details' }, p.detail)) : null,
  );
}

/** Settings, with the token field open and focused: "Replace token". */
function replaceToken(): void {
  state.tab = 'settings';
  state.error = undefined;
  state.settingsMessage = undefined;
  state.expanded.add('token-replace');
  render();
  (document.querySelector('[data-focus-id="token-input"]') as HTMLInputElement | null)?.focus();
}

const openTokenSettings = () => void request('open-url', { url: TOKEN_SETTINGS_URL });

/** The one callout every GitHub screen shows while the saved token is rejected. */
function tokenRejectedCallout(): HTMLElement {
  return h(
    'div',
    { class: 'callout warn', role: 'alert' },
    h('div', { class: 'callout-title' }, icon('alert'), TOKEN_REJECTED_CALLOUT),
    h('p', null, TOKEN_REJECTED_DETAIL),
    h(
      'div',
      { class: 'inline-actions' },
      state.init?.tokenSource === 'bridge'
        ? h('button', { class: 'btn', 'data-focus-id': 'sign-in-again', onClick: () => { state.tab = 'settings'; signInWithBridge(); } }, 'Sign in again')
        : h('button', { class: 'btn', 'data-focus-id': 'token-replace-go', onClick: replaceToken }, 'Replace token'),
    ),
  );
}

/**
 * "Sign in with Bridge": a one-time code from Bridge, Studio opened with it in the browser, then a poll every few
 * seconds until the designer picked their team there (api/plugin-link). The token never shows.
 */
function signInWithBridge(): void {
  if (state.link?.status === 'waiting') state.link.poller.stop();
  state.link = undefined;
  void run('Opening Studio in your browser', async () => {
    const start = await startBridgeSignIn((url, init) => fetch(url, init), STUDIO_ORIGIN);
    await request('open-url', { url: start.url });
    const poller = new BridgeSignInPoller((url, init) => fetch(url, init), STUDIO_ORIGIN, start, (p) => void finishSignIn(p)).start();
    state.link = { status: 'waiting', url: start.url, poller };
  });
}

function cancelSignIn(): void {
  if (state.link?.status === 'waiting') state.link.poller.stop();
  state.link = undefined;
  render();
}

/** The designer picked their team in Studio: the token is saved on this computer, the repository with the file. */
async function finishSignIn(p: LinkPoll): Promise<void> {
  if (p.status !== 'approved') {
    state.link = { status: 'error', message: p.status === 'expired' ? p.message : SIGN_IN_WORDS.expired };
    render();
    return;
  }
  state.link = undefined;
  await run('Connecting', async () => {
    // The Bridge sign-in replaces any token pasted before: there is one token on this computer, never two.
    await request('save-token', { token: p.token, source: 'bridge', ...(p.login ? { account: p.login } : {}) });
    const settings = state.init!.settings;
    await request('save-settings', { settings: { ...settings, repo: p.repo, branch: p.defaultBranch ?? settings.branch } });
    await loadInit();
    client = undefined;
    state.pull = undefined;
    state.push = undefined;
    state.tokenReadOnly = false;
    state.justConnected = p.name ?? p.repo;
    // Connected: straight to what the designer came for.
    state.tab = 'pull';
    void request('notify', { message: SIGN_IN_WORDS.connected(p.name ?? p.repo) });
  });
}

/** Not connected: one action, Sign in with Bridge. The repository field and a pasted token are for developers. */
function signInView(): View {
  const l = state.link;
  return {
    body: [
      intro({ title: 'Connect your design system', text: SIGN_IN_WORDS.lede, art: 'guide', moment: 'welcome' }),
      l?.status === 'waiting'
        ? h(
            'div',
            { class: 'callout', role: 'status' },
            h('p', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), SIGN_IN_WORDS.waiting),
            h(
              'div',
              { class: 'inline-actions' },
              h('button', { class: 'btn', 'data-focus-id': 'sign-in-reopen', onClick: () => void request('open-url', { url: l.url }) }, icon('external'), SIGN_IN_WORDS.reopen),
              h('button', { class: 'btn ghost', 'data-focus-id': 'sign-in-cancel', onClick: cancelSignIn }, SIGN_IN_WORDS.cancel),
            ),
          )
        : null,
      l?.status === 'error' ? h('div', { class: 'callout warn', role: 'alert' }, h('div', { class: 'callout-title' }, icon('alert'), l.message)) : null,
      h(
        'p',
        { class: 'muted' },
        h('button', { class: 'link', 'data-focus-id': 'token-connect', onClick: () => { state.expanded.add('token-connect'); render(); } }, 'For developers: connect with a token'),
      ),
    ],
    bar: l?.status === 'waiting' ? undefined : { label: SIGN_IN_WORDS.action, onClick: signInWithBridge },
  };
}

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : '');
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/** figma-fixes.json in the pull's For developers: what each fix did, or why the file was not used. */
const fixesRows = (fixes: LoadedSpecs['fixes']): [string, string | undefined][] =>
  !fixes
    ? []
    : fixes.problems?.length
      ? [['figma-fixes.json', `Not used, fix it in the repo: ${fixes.problems.join('; ')}`]]
      : [['figma-fixes.json', fixes.lines.length ? fixes.lines.join('\n') : 'No fix']];
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));
const modeLabel = (mode: string) => (mode === SINGLE_MODE ? 'Value' : modeDisplayName(mode));

/** Context to resolve a token's value in one mode of its tier (other axes at their default). */
function ctxFor(t: LogicalToken, mode: string): ResolveContext {
  const head = (state.push?.analysis ?? state.pull?.analysis)?.head;
  return head ? contextFor(head, t.tier, mode) : { brand: mode, theme: mode, density: mode };
}

/** Index used to resolve aliases of Figma-side tokens: Git tokens overlaid with Figma's. */
function figmaIndex(a: Analysis): PathIndex {
  const idx = new Map(a.head.byPath);
  for (const t of a.figmaTokens) idx.set(t.path, t);
  return idx;
}

function swatch(index: PathIndex, t: LogicalToken | undefined, mode: string): Child {
  if (!t || t.type !== 'color') return null;
  const r = resolve(index, t.path, ctxFor(t, mode));
  const c = r.value === undefined ? undefined : parseColor(r.value);
  if (!c) return h('span', { class: 'swatch missing', title: 'This alias does not resolve' });
  const css = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
  return h('span', { class: 'swatch', title: rgbaToHex(c) }, h('span', { style: { background: css } }));
}

function valueParts(index: PathIndex, t: LogicalToken | undefined, mode: string): { name: string; resolved?: string | undefined } {
  if (!t) return { name: 'none' };
  const v = t.values[mode];
  if (v === undefined) return { name: 'none' };
  if (!isAlias(v)) return { name: formatValue(t.type, v) };
  const r = resolve(index, t.path, ctxFor(t, mode));
  return { name: formatValue(t.type, v), resolved: r.value === undefined ? 'does not resolve' : formatValue(t.type, r.value) };
}

/** Token paths break after a dot, a slash or a comma ("font.weight." / "semibold"), never inside a segment. */
function breakable(text: string): Child[] {
  const parts = text.split(/(?<=[./,])/);
  return parts.flatMap((part, i) => (i < parts.length - 1 ? [part, h('wbr')] : [part]));
}

function valueChip(index: PathIndex, t: LogicalToken | undefined, mode: string, dim = false): HTMLElement {
  const p = valueParts(index, t, mode);
  // Colors show their swatch (hex on hover); other aliases show what they resolve to.
  const showResolved = p.resolved && (t?.type !== 'color' || p.resolved === 'does not resolve');
  return h(
    'span',
    { class: `value${dim ? ' before' : ''}` },
    swatch(index, t, mode),
    h('span', { class: 'value-name' }, breakable(p.name)),
    showResolved ? h('span', { class: 'value-resolved' }, p.resolved) : null,
  );
}

function modesFor(a: Analysis, t: LogicalToken): string[] {
  return modesOf(a.head.layout, t.tier);
}

interface RowSides {
  before: LogicalToken | undefined;
  after: LogicalToken | undefined;
  beforeIndex: PathIndex;
  afterIndex: PathIndex;
}

const KIND_LABEL: Record<string, string> = { added: 'New', changed: 'Edited', renamed: 'Renamed', removed: 'Deleted', restored: 'Recreated', replaced: 'From code' };

function diffRow(a: Analysis, kind: string, sides: RowSides, extra?: Child, edge?: { lead?: Child; tail?: Child }): HTMLElement {
  const t = (sides.after ?? sides.before)!;
  const renamed = !!sides.before && !!sides.after && sides.before.path !== sides.after.path;
  const lines: Child[] = [];
  for (const mode of modesFor(a, t)) {
    const b = valueParts(sides.beforeIndex, sides.before, mode);
    const n = valueParts(sides.afterIndex, sides.after, mode);
    const same = b.name === n.name && b.resolved === n.resolved;
    if (same && kind === 'renamed') continue;
    if (same && kind === 'changed') continue;
    lines.push(
      h(
        'div',
        { class: 'mode-line' },
        h('span', { class: 'mode-name' }, modeLabel(mode)),
        h(
          'span',
          { class: 'change' },
          sides.before ? valueChip(sides.beforeIndex, sides.before, mode, !!sides.after) : null,
          sides.before && sides.after ? icon('arrow') : null,
          sides.after ? valueChip(sides.afterIndex, sides.after, mode) : null,
        ),
      ),
    );
  }
  if (sides.before && sides.after && (sides.before.description ?? '') !== (sides.after.description ?? '')) {
    lines.push(
      h('div', { class: 'mode-line' }, h('span', { class: 'mode-name' }, 'Note'), h('span', { class: 'note' }, sides.after.description || 'Description removed')),
    );
  }
  return h(
    'li',
    { class: 'row' },
    h(
      'div',
      { class: 'row-head' },
      edge?.lead,
      h('span', { class: `kind ${kind}` }, KIND_LABEL[kind] ?? kind),
      renamed
        ? h('span', { class: 'path' }, h('span', { class: 'path-old' }, breakable(sides.before!.path)), icon('arrow'), h('span', null, breakable(sides.after!.path)))
        : h('span', { class: 'path' }, breakable(t.path)),
      edge?.tail,
    ),
    lines,
    extra,
  );
}

function rowList(key: string, rows: HTMLElement[], limit = PAGE): HTMLElement {
  const all = state.expanded.has(key);
  const shown = all ? rows : rows.slice(0, limit);
  return h(
    'div',
    null,
    h('ul', { class: 'rows' }, shown),
    rows.length > shown.length
      ? h('button', { class: 'btn ghost more', onClick: () => { state.expanded.add(key); render(); } }, `Show all ${rows.length}`)
      : null,
  );
}

/** One group of the Pull screen: title and count with its action on the same line, one sentence, then its rows. */
function group(title: string, count: number, action: Child, lede: Child, content: Child): HTMLElement {
  return h(
    'section',
    { class: 'group' },
    h('div', { class: 'group-head' }, h('h2', null, title, h('span', { class: 'group-n' }, String(count))), action),
    h('p', { class: 'lede' }, lede),
    content,
  );
}

function issueList(kind: 'error' | 'warn', title: string, issues: Issue[]): Child {
  if (!issues.length) return null;
  return h(
    'div',
    { class: `callout ${kind}`, role: kind === 'error' ? 'alert' : undefined },
    h('div', { class: 'callout-title' }, icon('alert'), title),
    h('ul', null, issues.slice(0, 40).map((i) => h('li', null, i.message))),
    issues.length > 40 ? h('p', null, `And ${issues.length - 40} more.`) : null,
  );
}

/** Lines shown before "Show all": a shared-color edit can break a hundred pairs, the callout stays a few lines. */
const PROBLEMS_SHOWN = 3;

/**
 * Problems from the checks, in designer words: one line per kind with its count, the first few shown, then "Show all".
 * The exact messages (token paths, contrast.checks.json) are folded under "For developers".
 */
function problemList(kind: 'error' | 'warn', title: string, issues: readonly Issue[], key: string, more: { actions?: Partial<Record<IssueCode, Child>>; details?: Child } = {}): Child {
  if (!issues.length) return null;
  const lines = blockerLines(issues);
  const all = state.expanded.has(key);
  const shown = all ? lines : lines.slice(0, PROBLEMS_SHOWN);
  return h(
    'div',
    { class: `callout ${kind}`, role: kind === 'error' ? 'alert' : undefined },
    h('div', { class: 'callout-title' }, icon('alert'), title),
    // A line, then what the designer can do about it, right under it (proximity).
    h('ul', null, shown.map((l) => h('li', null, l.text, more.actions?.[l.code] ? h('div', { class: 'inline-actions' }, more.actions[l.code]) : null))),
    more.details ?? null,
    lines.length > shown.length ? h('button', { class: 'btn ghost more', 'data-focus-id': `${key}-all`, onClick: () => { state.expanded.add(key); render(); } }, `Show all ${lines.length}`) : null,
    h(
      'details',
      { class: 'notes dev-details' },
      h('summary', null, 'For developers'),
      h('ul', { class: 'mono-list' }, issues.slice(0, 40).map((i) => h('li', null, i.message))),
      issues.length > 40 ? h('p', { class: 'muted' }, `And ${issues.length - 40} more.`) : null,
    ),
  );
}

function conflictBlock(a: Analysis, e: DiffEntry, choices: Map<string, ConflictChoice>, edge?: { lead?: Child; tail?: Child }): HTMLElement {
  const choice = choices.get(e.id);
  const fi = figmaIndex(a);
  const side = (which: ConflictChoice, label: string, t: LogicalToken | undefined, index: PathIndex) =>
    h(
      'label',
      { class: `choice${choice === which ? ' selected' : ''}` },
      h(
        'span',
        { class: 'choice-head' },
        h('input', {
          type: 'radio',
          name: `c-${e.id}`,
          checked: choice === which,
          onChange: () => {
            choices.set(e.id, which);
            refreshProposals();
          },
        }),
        label,
      ),
      t
        ? modesFor(a, t).map((m) => h('span', { class: 'choice-line' }, h('span', { class: 'mode-name' }, modeLabel(m)), valueChip(index, t, m)))
        : h('span', { class: 'muted' }, 'Deleted'),
      t && t.path !== e.path ? h('span', { class: 'muted' }, `Named ${t.path}`) : null,
    );
  return h(
    'li',
    { class: 'conflict' },
    h('div', { class: 'row-head' }, edge?.lead, h('span', { class: 'kind conflict' }, 'Conflict'), h('span', { class: 'path' }, e.path), edge?.tail),
    h('div', { class: 'choices', role: 'radiogroup', 'aria-label': `Version to keep for ${e.path}` }, side('figma', 'Keep Figma', e.figma, fi), side('main', 'Use code', e.head, a.head.byPath)),
  );
}

function conflictSection(a: Analysis, choices: Map<string, ConflictChoice>, edge?: (e: DiffEntry) => { lead?: Child; tail?: Child }): Child {
  const list = a.diff.conflicts;
  if (!list.length) return null;
  const open = list.filter((c) => !choices.has(c.id)).length;
  return h(
    'section',
    null,
    h('h2', null, `Conflicts (${list.length})`),
    h('p', { class: 'lede' }, 'Edited in Figma and in the design system since your last pull. Pick the version to keep. Nothing is overwritten until you choose.'),
    list.length > 1
      ? h(
          'div',
          { class: 'inline-actions' },
          h('button', { class: 'btn ghost', onClick: () => { list.forEach((e) => choices.set(e.id, 'figma')); refreshProposals(); } }, 'Keep Figma for all'),
          h('button', { class: 'btn ghost', onClick: () => { list.forEach((e) => choices.set(e.id, 'main')); refreshProposals(); } }, 'Use code for all'),
          open ? h('span', { class: 'muted' }, `${open} left to decide`) : null,
        )
      : null,
    h('ul', { class: 'rows' }, list.map((e) => conflictBlock(a, e, choices, edge?.(e)))),
  );
}

function refreshProposals(): void {
  if (state.pull) state.pull.proposal = buildPull(state.pull.analysis, state.pull.choices, { overwrite: state.pull.overwrite });
  if (state.push) {
    state.push.proposal = buildPush(state.push.analysis, state.push.choices, state.push.includeBrands, heldTokenIds(state.push.items, state.push.unchecked));
    if (state.push.descriptionSource === 'draft') state.push.description = pushDraft(state.push);
  }
  render();
}

/** What stays in code by design (brand x theme overrides): not something the designer acts on, so not shown. */
const isCodeOnlyNote = (w: string) => w.includes('stay code-only');

/** Notes the designer may act on. What stays in code by design (code-only tokens, overrides, undrawn parts) is not shown. */
function notes(a: Analysis): Child {
  const shown = a.warnings.filter((w) => !isCodeOnlyNote(w));
  if (!shown.length) return null;
  return h('details', { class: 'notes' }, h('summary', null, plural(shown.length, 'note')), h('ul', null, shown.map((w) => h('li', null, w))));
}


// ---------------------------------------------------------------------------------------------
// Actions

async function loadInit(): Promise<void> {
  state.init = await request('init', {});
  state.settingsDraft = { ...state.init.settings };
  client = undefined;
}

/** Reads main and the file into a pull preview. `prev` carries what the designer already did on this screen. */
async function loadPull(prev?: PullState): Promise<PullState> {
  const snapshot = await request('snapshot', {});
  const analysis = await analyze(getClient(), state.init!.settings, state.init!.sync, snapshot);
  const choices = new Map<string, ConflictChoice>();
  // Components are a separate step: a problem reading them never blocks the variables.
  let components: ComponentPullPlan | undefined;
  let componentsError: ComponentsReadProblem | undefined;
  let reviews: ComponentReview[] = [];
  let inReview: PullState['inReview'] = [];
  let measured: MeasuredOverlayReport | undefined;
  let measuredOnly: MeasuredOnlyReport | undefined;
  let shots: LoadedSpecs['shots'];
  let fixes: LoadedSpecs['fixes'];
  let measure: LoadedSpecs['measure'];
  let specs: LoadedSpecs['specs'] | undefined;
  const before: Record<string, string> = { ...(prev?.before ?? {}) };
  try {
    const loaded = await specSource(state.init!.settings.specSource).load(getClient(), analysis.headFiles.treeSha, analysis.headFiles.config, analysis.head);
    measured = loaded?.measured;
    measuredOnly = loaded?.measuredOnly;
    shots = loaded?.shots;
    fixes = loaded?.fixes;
    measure = loaded?.measure;
    specs = loaded?.specs;
    if (loaded) {
      const generated = await request('scan-generated', {});
      // Sets pushed from Figma: where their library branch stands decides whether the pull rebuilds them from code.
      const numbers = pushedNumbers(generated);
      const statuses = numbers.length ? await figmaPushStatusesOnGitHub(getClient(), numbers) : new Map<number, FigmaPushStatus>();
      inReview = pushedInReview(generated, statuses);
      components = buildComponentPlan(loaded.specs, loaded.path, generated, analysis.head, { pushed: statuses });
    }
    const updated = components?.components.filter((c) => c.status === 'updated' && c.nodeId) ?? [];
    if (components && updated.length) {
      // Review updates: the sets as they are now, compared with what the update builds, and their thumbnails.
      // Only the sets to update: reading every component of a big file takes minutes.
      const scanned = await request('scan-components', { nodeIds: updated.map((c) => c.nodeId!) });
      reviews = reviewUpdates(components, new Map<string, ComponentSignature>(scanned.components.map((c) => [c.nodeId, c.signature])));
      const missing = updated.map((c) => c.nodeId!).filter((id) => !before[id]);
      if (missing.length) Object.assign(before, await request('thumbnails', { nodeIds: missing, width: THUMB_W }).catch(() => ({})));
    }
  } catch (err) {
    componentsError = componentsErrorOf(err, 'pull');
  }
  const refs = reviews.length ? await loadReferenceManifest(getClient()).catch(() => undefined) : undefined;
  const lastBranch = state.init!.sync.lastPrBranch;
  const sentPr = lastBranch ? await getClient().findOpenPullRequest(lastBranch).catch(() => undefined) : undefined;
  return {
    analysis,
    choices,
    overwrite: false,
    ...(sentPr ? { sentPr } : {}),
    ...(refs ? { refs } : {}),
    previews: prev?.previews ?? {},
    proposal: buildPull(analysis, choices),
    components,
    componentsError,
    // A first pull brings the whole library, as enabling a Figma library does; later pulls offer new sets opt-in.
    includeComponents: prev?.includeComponents ?? (!!components?.components.length && components.components.every((c) => c.status === 'new')),
    reviews,
    inReview,
    ...(measured ? { measured } : {}),
    ...(measuredOnly ? { measuredOnly } : {}),
    ...(shots ? { shots } : {}),
    ...(fixes ? { fixes } : {}),
    ...(measure ? { measure } : {}),
    ...(specs ? { specs } : {}),
    before,
    after: prev?.after ?? {},
    done: prev?.done ?? new Map(),
  };
}

function checkPull(): void {
  state.justConnected = undefined;
  void run(
    'Reading the design system and your variables',
    async () => {
      let p = await loadPull();
      // The design system moved on but nothing in this file would change: it is up to date. The new base is recorded
      // quietly instead of asking for an Update that writes nothing ("66 new changes" next to "Nothing changes").
      const updates = (p.components?.components ?? []).some((c) => c.status === 'updated');
      if (variablesUpToDate(p) && commitsBehind(p.analysis) > 0 && !updates && !componentsToBuild(p).length) {
        await request('apply-pull', { plan: p.proposal.plan });
        await loadInit();
        p = { ...p, analysis: { ...p.analysis, baseSha: p.analysis.headSha } };
      }
      state.pull = p;
      state.expanded.clear();
      void loadPreviews(p);
    },
    checkPull,
  );
}

/** Component sets "Update all" builds: every updated set not updated yet, and new ones when opted in. */
function componentsToBuild(p: PullState): PlannedComponent[] {
  return (p.components?.components ?? []).filter((c) => (c.status === 'updated' && !p.done.has(c.componentId)) || (c.status === 'new' && p.includeComponents));
}

/**
 * After a pull: components now render with main's values, so refresh their baselines (pending changes are kept). The
 * sets just built already carry theirs. Without a variable change nothing else renders differently, so only the
 * components with no baseline yet are read: reading every component of a big file takes minutes.
 */
async function refreshBaselines(p: PullState, pulled: { variables: boolean; built: readonly string[] }): Promise<void> {
  try {
    const scanned = await request('scan-components', { skip: [...pulled.built], withoutBaseline: !pulled.variables });
    const coded = await loadCodedComponents(getClient(), p.analysis.headFiles.treeSha, p.analysis.headFiles.config);
    const items = pullBaselines(scanned.components, coded);
    if (items.length) await request('save-signatures', { items: items.map((x) => ({ nodeId: x.nodeId, signature: JSON.stringify(x.signature) })) });
  } catch {
    /* the pull itself succeeded; baselines are taken again on the next scan */
  }
}

/** Builds components, then takes the "after" thumbnails of the updated ones and moves their review to `done`. */
async function buildComponents(p: PullState, list: PlannedComponent[]): Promise<ComponentApplyReport> {
  state.cancel = () => {
    state.cancel = undefined;
    state.busy = 'Stopping after the component in progress';
    render();
    void request('cancel-components', {});
  };
  render();
  let report: ComponentApplyReport;
  try {
    report = await request('apply-components', { plan: { ...p.components!, components: list } });
  } finally {
    state.cancel = undefined;
  }
  const updated = list.filter((c) => c.status === 'updated' && c.nodeId);
  if (updated.length) Object.assign(p.after, await request('thumbnails', { nodeIds: updated.map((c) => c.nodeId!), width: THUMB_W }).catch(() => ({})));
  for (const c of updated) {
    const review = p.reviews.find((r) => r.componentId === c.componentId);
    if (review) p.done.set(c.componentId, review);
  }
  return report;
}

/**
 * "Update" on one component (Figma lets you take updates one by one). Variables stay all-or-nothing: when main has
 * variable changes, they are applied first, so the component binds to the variables it expects.
 */
function updateComponent(componentId: string): void {
  const p = state.pull;
  if (!p?.components) return;
  const comp = p.components.components.find((c) => c.componentId === componentId);
  if (!comp) return;
  void run(
    `Updating ${comp.name}`,
    async () => {
      const withVariables = !variablesUpToDate(p);
      if (withVariables) {
        const report = await request('apply-pull', { plan: p.proposal.plan });
        if (report.errors.length) throw new Error(`Variables were written with problems, so ${comp.name} was not updated: ${report.errors[0]}`);
      }
      const report = await buildComponents(p, onlyComponent(p.components!, componentId).components);
      await refreshBaselines(p, { variables: withVariables, built: report.nodeIds });
      if (withVariables) await loadInit();
      // Re-read main and the file: the updated set is now up to date; what is left stays to review.
      const next = await loadPull(p);
      if (report.problems.length) next.componentsReport = undefined;
      state.pull = next;
      void loadPreviews(next);
      const notBuilt = report.failed?.[0] ?? report.partial?.[0];
      if (notBuilt) state.error = { message: `${comp.name} was not fully updated: ${notBuilt.reason}. Nothing half built was left.`, retry: () => updateComponent(componentId) };
      else if (report.problems.length) state.error = { message: `${comp.name} updated, with problems: ${report.problems.slice(0, 3).join('; ')}` };
      void request('notify', { message: `${comp.name} updated${withVariables ? ', with the latest variables' : ''}` });
    },
    () => updateComponent(componentId),
  );
}

/** Variables match main: nothing to write for them (components may still be pending). */
function variablesUpToDate(p: PullState): boolean {
  const a = p.analysis;
  return !a.diff.remote.length && !a.diff.conflicts.length && !p.proposal.restored.length && !!a.baseSha;
}

function applyPull(): void {
  const p = state.pull;
  if (!p) return;
  const build = componentsToBuild(p);
  void run(
    variablesUpToDate(p) && build.length ? 'Building components' : 'Writing variables',
    async () => {
      const variables = !variablesUpToDate(p);
      if (variables || !build.length) p.report = await request('apply-pull', { plan: p.proposal.plan });
      // Components after the variables, so every binding finds its variable.
      if (build.length) p.componentsReport = await buildComponents(p, build);
      const report = p.report;
      await refreshBaselines(p, { variables, built: p.componentsReport?.nodeIds ?? [] });
      await loadInit();
      state.push = undefined;
      const cr = p.componentsReport;
      const parts = [report && report.created + report.updated ? `${report.created} variables created, ${report.updated} updated` : '', cr ? componentReportView(cr).headline.replace(/\.$/, '') : ''].filter(Boolean);
      void request('notify', { message: `Figma updated: ${parts.join(', ') || 'nothing changed in Figma'}.` });
    },
    applyPull,
  );
}

/**
 * "Try again" after a pull that left components out (Figma refused some, or Stop): reads main and the file again and
 * builds what is still missing. Sets already built are unchanged now, so it goes on from where the pull stopped.
 */
function retryComponents(): void {
  const prev = state.pull;
  if (!prev) return;
  void run(
    'Building the components left',
    async () => {
      const next = await loadPull({ ...prev, includeComponents: true });
      const build = componentsToBuild(next);
      if (build.length) next.componentsReport = await buildComponents(next, build);
      next.report = prev.report;
      await refreshBaselines(next, { variables: false, built: next.componentsReport?.nodeIds ?? [] });
      state.pull = next;
      const cr = next.componentsReport;
      void request('notify', { message: cr ? componentReportView(cr).headline : 'Every component is built.' });
    },
    retryComponents,
  );
}

function scanPush(keep?: PushState, then?: () => void): void {
  // A fresh scan starts over: the previous Push description and request form stop waiting for Claude.
  if (!keep && state.push) {
    state.push.tryItPoller?.stop();
    state.push.ship?.poller?.stop();
    cancelMine(state.push.assist, false);
    if (state.push.form) cancelMine(state.push.form.assist, false);
  }
  void run(
    'Comparing your variables with the design system',
    async () => {
      const snapshot = await request('snapshot', {});
      const c = getClient();
      const confirmed = keep?.confirmed ?? [];
      const analysis = await analyze(c, state.init!.settings, state.init!.sync, snapshot, confirmed);
      const choices = keep?.choices ?? new Map<string, ConflictChoice>();
      const lastBranch = state.init!.sync.lastPrBranch;
      const openPr = lastBranch ? await c.findOpenPullRequest(lastBranch).catch(() => undefined) : undefined;
      const includeBrands = keep?.includeBrands ?? new Set<string>();
      const experimental = experimentalTokenIds(analysis, snapshot);
      let components: ComponentScan | undefined;
      let componentsError: ComponentsReadProblem | undefined;
      let fileKey: string | undefined;
      let pushes: ComponentPush[] = [];
      try {
        const scanned = await request('scan-components', {});
        fileKey = scanned.fileKey;
        components = classifyComponents(scanned.components, await loadCodedComponents(c, analysis.headFiles.treeSha, analysis.headFiles.config));
        const coded = components.coded;
        // Where each change goes: the same signatures Pull compares, read the other way (component-push.ts).
        pushes = componentPushes([...components.changed, ...components.candidates], {
          head: analysis.head,
          files: analysis.headFiles,
          pairs: analysis.pairs,
          scanned: scanned.components,
          coded,
          fileKey,
          text: (item) => ({ title: titleOf(keep, item), summary: suggestSummary(item), line: lineOf(keep, item) }),
        });
        // Coded components seen for the first time: take their baseline silently (nothing to send).
        if (components.adopt.length) await request('save-signatures', { items: components.adopt.map((x) => ({ nodeId: x.nodeId, signature: JSON.stringify(x.signature) })) });
      } catch (err) {
        componentsError = componentsErrorOf(err, 'push');
      }
      const items = publishItems(analysis, experimental, (components?.changed ?? []).filter((x) => sendable(pushes, x)));
      // A new scan starts like Figma's publish dialog: everything checked but experimental items. A re-scan from this
      // screen (a confirmed rename, a new mark) keeps what the designer unchecked.
      // Suggest mode has no explorations (they are branches): every push goes for review as a suggestion.
      const destination = changesModeOf(analysis) === 'suggest' ? 'review' : (keep?.destination ?? 'review');
      const unchecked = keep ? new Set([...keep.unchecked].filter((k) => items.some((i) => i.key === k))) : defaultUnchecked(items, destination);
      if (keep && destination === 'review') for (const i of items) if (i.experimental && !keep.items.some((x) => x.key === i.key && x.experimental)) unchecked.add(i.key);
      // A change that showed up with this re-scan starts like on a first scan (an optional part already covers it).
      if (keep) for (const i of items) if (i.suggestSkip && !keep.items.some((x) => x.key === i.key)) unchecked.add(i.key);
      state.push = {
        analysis,
        snapshot,
        choices,
        confirmed,
        dismissed: keep?.dismissed ?? new Set(),
        proposal: buildPush(analysis, choices, includeBrands, heldTokenIds(items, unchecked)),
        includeBrands,
        items,
        unchecked,
        experimental,
        title: keep?.title ?? '',
        description: keep?.description ?? '',
        descriptionSource: keep?.descriptionSource ?? 'draft',
        titleSource: keep?.titleSource ?? 'draft',
        assist: keep?.assist ?? {},
        lines: keep?.lines ?? new Map(),
        destination,
        explorations: keep?.explorations,
        exploreTarget: keep?.exploreTarget ?? '',
        newExploration: keep?.newExploration ?? { name: '', purpose: '' },
        openPr,
        appendToOpen: keep?.appendToOpen ?? !!openPr,
        components,
        componentsError,
        fileKey,
        pushes,
        sent: keep?.sent ?? [],
      };
      if (state.push.descriptionSource === 'draft') state.push.description = pushDraft(state.push);
      state.expanded.clear();
      then?.();
    },
    () => scanPush(keep, then),
  );
}

/** The exploration a push to an exploration goes to, or undefined while none is picked. */
const pickedExploration = (r: PushState) => r.explorations?.find((e) => e.branch === r.exploreTarget);

/** Why "Send to exploration" cannot go yet: no exploration picked, or the new one needs a name and a purpose. */
function explorationBlocker(r: PushState): string | undefined {
  if (r.destination !== 'exploration') return undefined;
  if (r.loadingExplorations) return 'Loading explorations';
  if (r.exploreTarget === 'new') return newExplorationProblems(r.newExploration.name, r.newExploration.purpose).length ? 'Add a name and what to learn' : undefined;
  return pickedExploration(r) ? undefined : 'Pick an exploration';
}

/** "To the library" or "Try in an exploration": experimental items follow the destination's default. */
function setDestination(r: PushState, d: Destination): void {
  if (r.destination === d) return;
  r.destination = d;
  applyDestination(r.items, r.unchecked, d);
  if (d === 'exploration' && !r.explorations && !r.loadingExplorations) void loadExplorations(r);
  refreshProposals();
}

/** Running explorations for the select, without blocking the screen (a small status in the field). */
async function loadExplorations(r: PushState): Promise<void> {
  r.loadingExplorations = true;
  r.explorationsError = undefined;
  render();
  try {
    r.explorations = await runningExplorations(getClient(), r.analysis.headFiles.config, state.init!.settings.branch);
    // A new exploration by default: picking a running one (maybe someone else's) is a choice, never one click away (EXP-2).
    if (!r.exploreTarget || (r.exploreTarget !== 'new' && !pickedExploration(r))) r.exploreTarget = r.sentTo?.branch ?? 'new';
  } catch (err) {
    r.explorationsError = inlineError(err);
    r.exploreTarget = 'new';
  } finally {
    r.loadingExplorations = false;
    render();
  }
}

/** The bar's primary action: for review (a pull request and requests), or to the exploration picked. */
function submitPush(): void {
  const r = state.push;
  if (!r) return;
  const withPr = Object.keys(r.proposal.files).length + r.proposal.brandFiles.length > 0;
  const toExploration = r.destination === 'exploration';
  const mode = modeOf(r);
  void run(
    toExploration ? (r.exploreTarget === 'new' ? 'Starting the exploration' : 'Sending to the exploration') : mode === 'suggest' ? 'Sending the suggestion' : withPr ? (r.appendToOpen && r.openPr ? 'Adding to this change' : 'Sending for review') : 'Sending the requests',
    async () => {
      let exploration: ExplorationChoice | undefined;
      if (toExploration) {
        exploration = pickedExploration(r);
        if (r.exploreTarget === 'new') {
          exploration = await startExploration(getClient(), r.analysis.headFiles.config, state.init!.settings.branch, r.newExploration);
          r.explorations = [exploration, ...(r.explorations ?? [])];
          r.exploreTarget = exploration.branch;
          r.newExploration = { name: '', purpose: '' };
          state.busy = 'Sending to the exploration';
          render();
        }
        if (!exploration) throw new Error('Pick an exploration, or start a new one.');
      }
      const result = await publish(getClient(), {
        analysis: r.analysis,
        proposal: r.proposal,
        components: sendableChanged(r),
        pushes: r.pushes,
        unchecked: r.unchecked,
        description: r.description,
        descriptionIsDraft: r.descriptionSource === 'draft',
        lines: new Map((r.components?.changed ?? []).flatMap((c) => { const l = claudeLine(r, c); return l ? [[c.nodeId, l] as [string, string]] : []; })),
        titles: new Map((r.components?.changed ?? []).flatMap((c) => { const t = claudeTitle(r, c); return t ? [[c.nodeId, t] as [string, string]] : []; })),
        title: r.title,
        fileName: state.init!.fileName,
        fileKey: r.fileKey,
        appendTo: !toExploration && mode === 'direct' && r.appendToOpen ? r.openPr : undefined,
        mode,
        exploration: exploration ? targetOf(exploration) : undefined,
        coded: r.components?.coded ?? [],
        image: async (nodeId) => (await request('export-image', { nodeId }).catch(() => null))?.base64,
      });
      r.result = result;
      r.sentTo = exploration;
      r.routed = !exploration && result.outcomes.length ? routedItems(result.outcomes) : undefined;
      if (r.routed) startShipPolling(r, (n) => libraryArrivalOnGitHub(getClient(), n), figmaShipper(state.init!.token ?? '', state.init!.settings.repo));
      r.tryIt = undefined;
      r.previews = undefined;
      r.shared = false;
      if (exploration) startTryItPolling(r);
      cancelMine(r.assist, false);
      // What was sent exists now; local bookkeeping failures must not hide that.
      try {
        const tags = result.pr?.tags ?? result.tags ?? [];
        if (tags.length) await request('tag-variables', { tags });
        // "Add to open pull request" follows review pull requests only; an exploration is picked in its own select.
        if (result.pr && !exploration) await request('save-sync', { sync: { lastPrBranch: result.pr.branch, lastPrUrl: result.pr.pr.url } });
        // A request is the new reference for its component: the next scan compares against what was asked for.
        for (const x of result.requests) await request('rebaseline', { nodeId: x.nodeId }).catch(() => undefined);
        for (const x of result.requests) r.sent.unshift({ component: x.component, number: x.number, url: x.url, what: 'request sent', target: 'request' });
        // An exact token change written on the exploration is the new reference too.
        for (const x of result.explorationTokens ?? []) await request('rebaseline', { nodeId: x.nodeId }).catch(() => undefined);
        // A library branch from Figma: the set remembers it, so a pull rebuilds it from the reviewed code once it ships.
        for (const x of result.branches) await afterBranch(r, x);
        // A component change sent as a suggestion: its new baseline, and the issue in the "sent" list.
        for (const x of result.suggestions) {
          if (x.nodeId) await request('rebaseline', { nodeId: x.nodeId }).catch(() => undefined);
          r.sent.unshift({ component: x.component ?? x.title ?? 'Variables', number: x.number, url: x.url, what: 'suggestion sent', target: 'suggestion' });
        }
        await loadInit();
      } catch (err) {
        state.error = { message: 'Sent. Bridge could not save the links in this file, so the next scan may list these changes again.', detail: errorText(err) };
      }
      const parts = exploration
        ? [`Sent to ${exploration.name}`]
        : mode === 'suggest'
          ? [result.suggestions.length ? sentTitle(result, mode) : '', result.requests.length ? `${plural(result.requests.length, 'request')} sent` : ''].filter(Boolean)
          : [result.pr ? (result.pr.appended ? 'Added to this change' : 'Sent for review') : '', result.requests.length ? `${plural(result.requests.length, 'request')} sent` : '', result.branches.length ? `${plural(result.branches.length, 'component')} sent` : ''].filter(Boolean);
      void request('notify', { message: parts.join(', ') });
    },
    submitPush,
  );
}

/** Marks items "Experimental" (or clears the mark) on the variables or component sets, then re-scans keeping choices. */
function markExperimental(r: PushState, item: PublishItem, value: boolean): void {
  void run(
    value ? 'Marking as exploration only' : 'Removing exploration only',
    async () => {
      const targets = item.kind === 'variable' ? variableIdsOf(r.analysis, item.id).map((id) => ({ kind: 'variable' as const, id })) : [{ kind: 'component' as const, id: item.id }];
      await request('set-experimental', { targets, value });
      // Marking unchecks it for review, like Figma's "Hide when publishing", and checks it for an exploration (what it is
      // for); removing the mark leaves the choice to the designer.
      if (value) (r.destination === 'review' ? r.unchecked.add(item.key) : r.unchecked.delete(item.key));
      if (item.kind === 'variable') (value ? r.experimental.add(item.id) : r.experimental.delete(item.id));
      item.experimental = value;
      const comp = r.components?.changed.find((c) => c.nodeId === item.id);
      if (comp) comp.experimental = value || undefined;
      r.proposal = buildPush(r.analysis, r.choices, r.includeBrands, heldTokenIds(r.items, r.unchecked));
    },
    () => markExperimental(r, item, value),
  );
}

/** How the push of this scan reaches the code: bridge.config.json "changes" (default suggest). */
const modeOf = (r: PushState): ChangesMode => changesModeOf(r.analysis);

/** "changes" in the repo's bridge.config.json at `branch` (no config: direct, the plugin's behaviour without one). */
let modeLoading = false;
/** The repo's changes mode for screens shown before a scan: read once, then kept (Settings refreshes it). */
function knownMode(): ChangesMode | undefined {
  if (state.push) return modeOf(state.push);
  if (state.mode || modeLoading || !connected()) return state.mode;
  modeLoading = true;
  void repoChangesMode(getClient(), state.init!.settings.branch)
    .then((m) => {
      state.mode = m;
      render();
    })
    .catch(() => undefined)
    .finally(() => (modeLoading = false));
  return undefined;
}

async function repoChangesMode(gh: GitHubClient, branch: string): Promise<ChangesMode> {
  const text = await gh.getFileText('bridge.config.json', branch).catch(() => undefined);
  if (!text) return 'direct';
  try {
    return changesMode(loadConfig(text));
  } catch {
    return 'direct';
  }
}

function saveSettings(): void {
  const draft = state.settingsDraft;
  state.settingsMessage = undefined;
  void run('Checking access to the repository', async () => {
    try {
      if (!draft.repo.trim()) throw new FieldError('repo', 'Paste the GitHub repository of your design system, for example acme/design-system.');
      // A pasted GitHub link works too: stored as owner/name.
      let parsed: ReturnType<typeof parseRepo>;
      try {
        parsed = parseRepo(draft.repo);
      } catch {
        throw new FieldError('repo', 'Write the repository as owner/name, for example acme/design-system, or paste its GitHub link.');
      }
      draft.repo = `${parsed.owner}/${parsed.name}`;
      if (!draft.branch.trim()) throw new FieldError('branch', 'Enter a base branch, for example main.');
      if (!draft.tokensPath.trim()) throw new FieldError('tokensPath', 'Enter the folder that holds the *.tokens.json files, for example packages/tokens/src.');
      const newToken = state.tokenDraft.trim();
      const token = newToken || state.init?.token;
      let message = 'Settings saved. Add a token to connect.';
      if (token) {
        const gh = new GitHubClient(draft.repo, token);
        const info = await gh.getRepo().catch((err: unknown) => {
          // A token just pasted that GitHub refuses never worked; the saved one stopped working.
          if (tokenProblem(err)?.kind === 'rejected') {
            if (newToken) throw new FieldError('token', NEW_TOKEN_REFUSED);
            setTokenState('rejected');
            state.expanded.add('token-replace');
            throw new FieldError('token', `${TOKEN_REJECTED_DETAIL} Paste a new token to replace it.`);
          }
          if ((err as { status?: unknown }).status === 404) throw new FieldError('repo', repoNotFound(draft.repo));
          throw err;
        });
        if (!(await gh.getBranchSha(draft.branch.trim()))) throw new FieldError('branch', `There is no "${draft.branch.trim()}" branch in ${info.fullName}. Check the name, for example main.`);
        // What the token may write, probed without writing (the user's role on the repo says nothing about a
        // fine-grained token). Suggestions need Issues only; direct mode needs Contents and Pull requests too.
        // Refused before saving: the token that works stays.
        const mode = await repoChangesMode(gh, draft.branch.trim());
        state.mode = mode;
        const probed = await gh.writeAccess(draft.branch.trim()).catch(() => undefined);
        const push = info.permissions?.push !== false;
        const can = probed ?? { contents: push, pullRequests: push, issues: true };
        const missing = [
          mode === 'direct' && !can.contents ? '"Contents"' : '',
          mode === 'direct' && !can.pullRequests ? '"Pull requests"' : '',
          !can.issues ? '"Issues"' : '',
        ].filter(Boolean);
        // The saved token falls short: its card says so. A new token that falls short is refused and changes nothing;
        // one that writes replaces the saved token.
        if (!newToken) state.tokenReadOnly = missing.length > 0;
        else if (!missing.length) state.tokenReadOnly = false;
        if (missing.length) {
          const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0];
          throw new FieldError('token', `This token can read ${info.fullName} but cannot ${mode === 'direct' ? 'send changes to it' : 'open suggestions on it'}. Give it ${list} set to "Read and write" on GitHub, then paste it again.`);
        }
        // Read-only on code is enough when the repo takes suggestions (issues only).
        const readOnly = mode === 'suggest' && !can.contents;
        // A developer's own choice: the plugin does not offer them Sign in with Bridge again.
        if (newToken) await request('save-token', { token: newToken, source: 'developer' });
        else setTokenState('ok');
        message = `Connected to ${info.fullName}.${newToken ? ' The token is saved on this computer only.' : ''}${readOnly ? ' This token sends suggestions only. Screenshots and drafting with your Claude plan need "Contents: Read and write".' : ''}`;
      }
      state.tokenDraft = '';
      state.expanded.delete('repo-edit');
      state.expanded.delete('token-replace');
      await request('save-settings', { settings: draft });
      const wasConnected = connected();
      await loadInit();
      state.pull = undefined;
      state.push = undefined;
      // A first connection lands on Pull, where the next step is; a change to a connected file stays in Settings.
      if (!wasConnected && connected()) {
        state.justConnected = draft.repo;
        state.tab = 'pull';
      } else state.settingsMessage = { kind: 'ok', text: message };
    } catch (err) {
      // Nothing was saved: the connected design system, its results on Pull and Push, and the header stay as they were.
      state.settingsMessage = err instanceof FieldError ? { kind: 'error', text: err.message, field: err.field } : { kind: 'error', text: errorText(err) };
    }
  });
}

function removeToken(): void {
  void run('Removing the token', async () => {
    await request('clear-token', {});
    state.expanded.delete('token-replace');
    await loadInit();
    state.pull = undefined;
    state.push = undefined;
    state.settingsMessage = { kind: 'ok', text: 'Signed out on this computer.' };
  });
}

// ---------------------------------------------------------------------------------------------
// Writing help: the plugin's own draft (always), "Draft with my Claude" (the designer's Claude app with the Bridge MCP,
// any Claude plan, no key), "Draft with Claude" (only with an API key in Settings, billed to the designer's Anthropic account).

/** Images larger than this (base64 characters) are not sent to Claude: the API refuses images over 5 MB. */
const CLAUDE_IMAGE_MAX = 6_500_000;

interface AssistTarget {
  /** Prefix of the focus ids of this block. */
  id: string;
  /** What Claude gets, without images (synchronous: the clipboard needs the click's user activation). */
  input: () => ClaudeDraftInput;
  /** Before and after images for "Draft with Claude"; empty when there are none. */
  images?: (() => Promise<Pick<ClaudeDraftInput, 'before' | 'after' | 'lineImages'>>) | undefined;
  apply: (d: ClaudeDraft) => void;
  /** Fields the designer typed before asking: Claude's text for them is offered, never written over theirs. */
  typed?: (() => Partial<Record<DraftField, boolean>>) | undefined;
  /** Why there is nothing for Claude to draft from yet (an empty manual request); undefined when there is. */
  empty?: (() => string | undefined) | undefined;
  /** The same target as the screen is now (a re-scan rebuilds the push state), or undefined once it is gone. */
  current: () => AssistTarget | undefined;
}

/** Checked variable edits, in the order of the Changes list. */
function checkedEntries(r: PushState): DiffEntry[] {
  return r.analysis.diff.local.filter((e) => isChecked(r.unchecked, { key: variableKey(e.id) }));
}

function checkedComponents(r: PushState): ComponentChangeItem[] {
  return sendableChanged(r).filter((c) => isChecked(r.unchecked, { key: componentKey(c.nodeId) }));
}

/** The route of a component change (undefined: not routed, it goes as a request). */
const pushOf = (r: Pick<PushState, 'pushes'>, nodeId: string) => r.pushes.find((p) => p.nodeId === nodeId);

/** A change Push can send: not one to fix in Figma first, not a token change the contrast gate holds back. */
const sendable = (pushes: ComponentPush[], item: Pick<ComponentChangeItem, 'nodeId'>) => {
  const p = pushes.find((x) => x.nodeId === item.nodeId);
  return !p || (p.plan.route !== 'manual' && !p.blocked);
};

const sendableChanged = (r: PushState) => (r.components?.changed ?? []).filter((c) => sendable(r.pushes, c));

/** The deterministic Description: what the checked edits do, which components get a request. */
function pushDraft(r: PushState): string {
  return draftPushDescription(checkedEntries(r), checkedComponents(r));
}

const changesKey = (item: Pick<ComponentChangeItem, 'changes'>) => JSON.stringify(item.changes);

/** Claude's line for a component change while it still describes the same changes, else the drafted one. */
function claudeLine(r: PushState | undefined, item: ComponentChangeItem): string | undefined {
  const x = r?.lines.get(item.nodeId);
  return x && x.key === changesKey(item) ? x.line || undefined : undefined;
}

/** Claude's request title for a component change while it still describes the same changes. */
function claudeTitle(r: PushState | undefined, item: ComponentChangeItem): string | undefined {
  const x = r?.lines.get(item.nodeId);
  return x && x.key === changesKey(item) ? x.title || undefined : undefined;
}

/** The title a component change's request gets: Claude's, or the drafted one. */
const titleOf = (r: PushState | undefined, item: ComponentChangeItem) => claudeTitle(r, item) || suggestTitle(item);

/** The one sentence a change row and its request open with. */
const lineOf = (r: PushState | undefined, item: ComponentChangeItem) => claudeLine(r, item) || suggestLine(item);

/** Claude's lines and request titles for the items it answered for (unknown ids are ignored). */
function keepLines(r: PushState, items: ComponentChangeItem[], lines: ClaudeDraft['lines']): void {
  for (const l of lines ?? []) {
    const item = items.find((c) => c.nodeId === l.id);
    if (item && (l.line || l.title)) r.lines.set(item.nodeId, { line: l.line, ...(l.title ? { title: l.title } : {}), key: changesKey(item) });
  }
}

/** The change lines Claude writes for these components: id, facts, the drafted line and the drafted request title. */
const draftLines = (r: PushState, items: ComponentChangeItem[]) => items.map((c) => ({ id: c.nodeId, component: c.component, kind: c.kind, changes: c.changes, line: lineOf(r, c), title: titleOf(r, c) }));

/** Push images per component (at most 4, the first ones), so Claude writes each line from what changed on screen. */
const LINE_IMAGES = 4;

function pushAssist(r: PushState): AssistTarget {
  return {
    id: 'push',
    typed: () => ({ title: r.titleSource === 'user' && !!r.title.trim(), summary: r.descriptionSource === 'user' && !!r.description.trim() }),
    input: () => ({
      target: 'push',
      changes: pushChangeRows(checkedEntries(r)),
      components: [...new Set(checkedComponents(r).map((c) => c.component))],
      draft: { title: r.title || (r.proposal.changes.length ? defaultTitle(r.proposal.changes) : ''), summary: pushDraft(r) },
      notes: r.descriptionSource === 'user' ? r.description : undefined,
      lines: draftLines(r, checkedComponents(r)),
    }),
    images: async () => {
      // Each checked component change (the first few), before and after, so Claude sees what changed on screen.
      const lineImages: NonNullable<ClaudeDraftInput['lineImages']> = [];
      for (const c of checkedComponents(r).slice(0, LINE_IMAGES)) {
        const after = await request('export-image', { nodeId: c.nodeId }).catch(() => null);
        const before = await request('baseline-image', { nodeId: c.nodeId }).catch(() => null);
        lineImages.push({
          id: c.nodeId,
          ...(after?.base64 && after.base64.length < CLAUDE_IMAGE_MAX ? { after: after.base64 } : {}),
          ...(before && before.length < CLAUDE_IMAGE_MAX ? { before } : {}),
        });
      }
      return lineImages.length ? { lineImages } : {};
    },
    current: () => (state.push && state.push.assist === r.assist ? pushAssist(state.push) : undefined),
    apply: (d) => {
      if (d.summary) {
        r.description = d.summary;
        r.descriptionSource = 'claude';
      }
      if (d.title && r.titleSource !== 'user') {
        r.title = d.title;
        r.titleSource = 'claude';
      }
      keepLines(r, checkedComponents(r), d.lines);
    },
  };
}

function requestAssist(f: RequestForm): AssistTarget {
  const d = f.draft;
  return {
    id: 'req',
    typed: () => ({ title: f.titleSource === 'user' && !!d.title.trim(), summary: f.summarySource === 'user' && !!d.summary.trim() }),
    // A request the scan did not detect, with no words and no selection: Claude would only invent (ASSIST-1).
    empty: () => (!f.item && !d.title.trim() && !d.summary.trim() && !(f.attach && state.selection) ? 'Write a few words or attach a selection: Claude drafts from them.' : undefined),
    input: () => ({
      target: 'request',
      component: d.component,
      kind: d.kind,
      changes: d.changes,
      draft: f.item ? { title: suggestTitle(f.item), summary: suggestSummary(f.item) } : undefined,
      notes: [f.titleSource === 'user' && d.title.trim() ? `Title: ${d.title.trim()}` : '', f.summarySource === 'user' ? d.summary.trim() : ''].filter(Boolean).join('\n') || undefined,
      lines: f.item && state.push ? draftLines(state.push, [f.item]) : undefined,
    }),
    images: async () => {
      const nodeId = f.item?.nodeId;
      const after = nodeId ? await request('export-image', { nodeId }).catch(() => null) : f.attach && state.selection ? await request('export-image', {}).catch(() => null) : null;
      const before = nodeId ? await request('baseline-image', { nodeId }).catch(() => null) : null;
      return {
        ...(after?.base64 && after.base64.length < CLAUDE_IMAGE_MAX ? { after: after.base64 } : {}),
        ...(before && before.length < CLAUDE_IMAGE_MAX ? { before } : {}),
      };
    },
    current: () => (state.push?.form && state.push.form.assist === f.assist ? requestAssist(state.push.form) : undefined),
    apply: (x) => {
      if (x.title) {
        d.title = x.title;
        f.titleSource = 'claude';
      }
      if (x.summary) {
        d.summary = x.summary;
        f.summarySource = 'claude';
      }
      if (f.item && state.push) {
        keepLines(state.push, [f.item], x.lines);
        d.line = lineOf(state.push, f.item);
      }
      f.error = undefined;
    },
  };
}

/** Copies text from the plugin iframe: a hidden textarea and execCommand (navigator.clipboard is often blocked there). */
async function copyText(text: string): Promise<boolean> {
  const back = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  back?.focus();
  if (ok) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}



/** What "Draft with my Claude" sends: the push's variable edits go in their own table. */
function toMyClaudeTarget(input: ClaudeDraftInput): MyClaudeTarget {
  const push = input.target === 'push';
  return {
    scope: input.target,
    component: input.component,
    kind: input.kind,
    changes: push ? [] : input.changes,
    variables: push ? input.changes.map((c) => ({ path: c.field, before: c.before, after: c.after })) : undefined,
    components: input.components,
    notes: input.notes,
    draft: input.draft ?? { title: '', summary: '' },
    images: { before: input.before, after: input.after },
    lines: input.lines,
    lineImages: input.lineImages,
  };
}

const mineActive = (a: AssistState) => a.mine?.status === 'starting' || a.mine?.status === 'waiting' || a.mine?.status === 'timeout';

/** Typing in a field while the designer's Claude drafts: its answer for that field is offered, not filled. */
function noteEdit(a: AssistState, field: DraftField): void {
  if (mineActive(a)) a.mine!.edited[field] = true;
}

/** "Draft with my Claude": upload the images, write the pending drafts file, then poll it until Claude answers. */
function startMine(a: AssistState, t: AssistTarget): void {
  if (state.busy || mineActive(a)) return;
  const previous = a.mine?.sessionId;
  // What the designer typed before asking stays theirs: Claude's text for it is offered (ASSIST-2).
  a.mine = { status: 'starting', edited: { ...(t.typed?.() ?? {}) } };
  a.offer = undefined;
  a.message = undefined;
  render();
  void (async () => {
    let gh: GitHubClient;
    try {
      gh = getClient();
      if (previous) void finishMyClaudeDrafts(gh, previous);
      // Claude's drafts go through a file in the repository: say what is missing before anything is written or waited for.
      const missing = await myClaudeAccess(gh);
      if (missing) {
        a.mine = { status: 'error', edited: {}, error: missing, permission: true };
        render();
        return;
      }
      const input = { ...t.input(), ...(t.images ? await t.images() : {}) };
      const session = await startMyClaudeDrafts(gh, { targets: [toMyClaudeTarget(input)], baseBranch: state.init!.settings.branch });
      const mine = a.mine;
      if (!mine || mine.status !== 'starting') {
        // Cancelled while the file was being written.
        void finishMyClaudeDrafts(gh, session.sessionId);
        return;
      }
      mine.sessionId = session.sessionId;
      mine.status = 'waiting';
      mine.poller = new DraftPoller({
        client: gh,
        sessionId: session.sessionId,
        onResults: (results) => receiveMine(a, t, results[0]!),
        onTimeout: () => {
          if (a.mine === mine) mine.status = 'timeout';
          render();
        },
        onGone: () => {
          if (a.mine === mine) a.mine = undefined;
          render();
        },
      });
      mine.poller.start();
    } catch (err) {
      const message = inlineError(err);
      const permission = tokenProblem(err)?.kind === 'missing-permission';
      a.mine = message === undefined ? undefined : { status: 'error', edited: {}, error: permission ? MY_CLAUDE_NEEDS_WRITE : message, permission };
    }
    render();
  })();
}

/** Claude answered: fill the fields the designer did not touch since, offer the rest. */
function receiveMine(a: AssistState, t: AssistTarget, result: Pick<ClaudeDraft, 'title' | 'summary' | 'lines'>): void {
  const mine = a.mine;
  if (!mine) return;
  const target = t.current();
  const { fill, offer } = planFill(result, mine.edited);
  mine.status = 'drafted';
  mine.poller = undefined;
  // Change lines are Claude's alone (nobody types them here): they always fill.
  if (target) target.apply({ title: fill.title ?? '', summary: fill.summary ?? '', lines: result.lines });
  a.offer = offer.title || offer.summary ? offer : undefined;
  // One status line under the field ("Drafted by Claude, review before sending") says the rest.
  a.message = a.offer ? { kind: 'ok', text: 'Claude answered. You edited a field meanwhile, so your text stays: use Claude\'s draft below if you prefer it.' } : undefined;
  render();
}

function useOffer(a: AssistState, t: AssistTarget): void {
  if (!a.offer) return;
  t.apply({ title: a.offer.title ?? '', summary: a.offer.summary ?? '' });
  a.offer = undefined;
  a.message = undefined;
  render();
}

/** "Check again" after the 10 minute timeout: one read now, then polling again. */
function checkMineAgain(a: AssistState): void {
  const mine = a.mine;
  if (!mine?.poller) return;
  mine.status = 'waiting';
  mine.poller.start();
  void mine.poller.check();
  render();
}

/** Stops waiting and deletes the pending file (best effort, in the background). */
function cancelMine(a: AssistState, rerender = true): void {
  const mine = a.mine;
  mine?.poller?.stop();
  a.mine = undefined;
  a.offer = undefined;
  if (mine?.sessionId && client) void finishMyClaudeDrafts(client, mine.sessionId);
  if (rerender) render();
}

async function copyPhrase(a: AssistState): Promise<void> {
  const ok = await copyText(DRAFT_PHRASE);
  if (a.mine) a.mine.copied = ok;
  render();
}

/** The status block under the buttons while the designer's own Claude drafts. */
function mineView(a: AssistState, t: AssistTarget): Child {
  const mine = a.mine;
  if (!mine || mine.status === 'drafted') return null;
  if (mine.status === 'error') {
    if (mine.permission) {
      return h(
        'div',
        { class: 'mine', role: 'alert' },
        h('p', { class: 'form-error' }, icon('alert'), mine.error ?? MY_CLAUDE_NEEDS_WRITE),
        h('div', { class: 'inline-actions' }, h('button', { class: 'btn', onClick: openTokenSettings }, icon('external'), 'Edit token on GitHub'), h('button', { class: 'btn ghost', onClick: () => cancelMine(a) }, 'Close')),
      );
    }
    return h('p', { class: 'form-error', role: 'alert' }, icon('alert'), `Could not hand the drafts to Claude: ${mine.error ?? 'try again.'}`);
  }
  if (mine.status === 'starting') {
    return h('div', { class: 'mine', role: 'status' }, h('div', { class: 'mine-head' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('b', null, 'Getting the drafts ready for Claude')));
  }
  const timeout = mine.status === 'timeout';
  return h(
    'div',
    { class: 'mine', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'mine-head' }, timeout ? icon('info') : h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('b', null, timeout ? 'Your Claude did not answer' : 'Waiting for Claude')),
    h('p', null, timeout ? 'The plugin draft is still here: edit it, or say this in Claude, then check again:' : 'In Claude, with Bridge connected (Settings), say:'),
    h(
      'div',
      { class: 'phrase' },
      h('code', null, DRAFT_PHRASE),
      h('button', { class: 'btn ghost', 'data-focus-id': `${t.id}-mine-copy`, onClick: () => void copyPhrase(a) }, icon(mine.copied ? 'check' : 'copy'), mine.copied ? 'Copied' : 'Copy'),
    ),
    h('small', null, timeout ? 'Stopped checking after 10 minutes. Your fields stay as they are.' : 'Checking every 5 seconds while this plugin is open. Keep editing: Claude never writes over what you type.'),
    h(
      'div',
      { class: 'inline-actions' },
      timeout ? h('button', { class: 'btn', 'data-focus-id': `${t.id}-mine-again`, onClick: () => checkMineAgain(a) }, icon('refresh'), 'Check again') : null,
      h('button', { class: 'btn ghost', 'data-focus-id': `${t.id}-mine-cancel`, onClick: () => cancelMine(a) }, 'Cancel'),
      h('button', { class: 'btn ghost', onClick: () => { state.tab = 'settings'; state.expanded.add('mcp-setup'); render(); } }, 'How to connect'),
    ),
  );
}

/** Claude's text for a field the designer edited while waiting. */
function offerView(a: AssistState, t: AssistTarget): Child {
  const o = a.offer;
  if (!o) return null;
  return h(
    'div',
    { class: 'mine offer' },
    o.title ? h('p', null, h('b', null, 'Title: '), o.title) : null,
    o.summary ? h('p', null, h('b', null, 'Summary: '), o.summary) : null,
    h(
      'div',
      { class: 'inline-actions' },
      h('button', { class: 'btn', 'data-focus-id': `${t.id}-use-offer`, onClick: () => useOffer(a, t) }, "Use Claude's draft"),
      h('button', { class: 'btn ghost', onClick: () => { a.offer = undefined; a.message = undefined; render(); } }, 'Keep mine'),
    ),
  );
}

/**
 * "Draft with Claude": a ghost text action on the label line of the field it fills (proximity), right-aligned. Without
 * an API key it starts the designer's own Claude (MCP) directly; with one it opens a small menu of the two ways. Hidden
 * while the designer's Claude drafts or its text is offered: the status block under the field holds the actions then.
 */
/**
 * "Draft with Claude": one button, no choice of ways for the designer. With an API key a developer saved (Settings, For
 * developers), Claude drafts in one click; otherwise the designer's own Claude plan does (Draft with my Claude).
 */
function assistAction(a: AssistState, t: AssistTarget): Child {
  if (mineActive(a) || a.offer) return null;
  return h(
    'div',
    { class: 'assist-action' },
    h(
      'button',
      {
        type: 'button',
        class: 'btn ghost',
        'data-focus-id': `${t.id}-assist`,
        disabled: !!state.busy || !!t.empty?.(),
        title: t.empty?.(),
        onClick: () => startMine(a, t),
      },
      'Draft with Claude',
    ),
  );
}

/** Under the field: waiting for the designer's Claude, Claude's text offered for an edited field, or an error. */
/** Why the drafting help is unavailable (nothing to draft from), while no draft is under way or offered. */
const emptyWhy = (a: AssistState, t: AssistTarget) => (!mineActive(a) && !a.offer && !a.message ? t.empty?.() : undefined);

/**
 * The request form updates in place while the designer types or attaches a selection: the drafting help becomes
 * available (or not) without a render that would take the focus away.
 */
function refreshRequestAssist(): void {
  const f = state.push?.form;
  if (!f) return;
  const t = requestAssist(f);
  const empty = t.empty?.();
  const button = document.querySelector<HTMLButtonElement>(`[data-focus-id="${t.id}-assist"]`);
  if (button) {
    button.disabled = !!state.busy || !!empty;
    if (empty) button.title = empty;
    else button.removeAttribute('title');
  }
  const why = document.getElementById(`${t.id}-why`);
  if (why) {
    const text = emptyWhy(f.assist, t);
    why.textContent = text ?? '';
    why.hidden = !text;
  }
}

/** Under the label line of a field with "Draft with Claude": why it is unavailable. Refreshed in place as the designer types. */
function assistWhy(a: AssistState, t: AssistTarget): Child {
  if (!t.empty) return null;
  const why = emptyWhy(a, t);
  return h('small', { class: 'muted assist-why', id: `${t.id}-why`, hidden: !why }, why ?? '');
}

function assistStatus(a: AssistState, t: AssistTarget): Child {
  const parts = [
    mineView(a, t),
    offerView(a, t),
    a.message ? h('p', { class: a.message.kind === 'error' ? 'form-error' : 'assist-note', role: a.message.kind === 'error' ? 'alert' : 'status' }, a.message.kind === 'error' ? icon('alert') : icon('check'), a.message.text) : null,
  ].filter(Boolean);
  return parts.length ? h('div', { class: 'assist' }, parts) : null;
}

/** A field label with the action that fills the field on the same line, right-aligned. */
function fieldHead(forId: string, label: string, action: Child): HTMLElement {
  return h('div', { class: 'field-head' }, h('label', { for: forId }, label), action);
}

/** "Drafted by Claude, review before sending" under a field Claude filled; removed as soon as the designer types. */
function draftedNote(id: string, source: TextSource): Child {
  return source === 'claude' ? h('small', { class: 'drafted', id: `${id}-drafted` }, icon('info'), DRAFTED_NOTE) : null;
}

const clearDrafted = (id: string) => document.getElementById(`${id}-drafted`)?.remove();


// ---------------------------------------------------------------------------------------------
// Views

interface View {
  body: Child;
  bar?: ActionBar | undefined;
}

/** A Field Guide line drawing (static markup from illustrations.ts). Decorative. */
function ill(name: IllustrationName): HTMLElement {
  const art = ILLUSTRATIONS[name];
  const el = h('span', { class: 'ill', 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="${art.viewBox}" fill="none" focusable="false">${art.svg}</svg>`;
  return el;
}

/** The screen's one Harbor zone: a Fraunces headline, one sentence, an optional meta line, a drawing. */
function intro(o: { title: string; text?: string; meta?: Child; art?: IllustrationName; moment?: object | string | undefined }): HTMLElement {
  return h(
    'section',
    { class: `zone intro${o.art ? ' with-art' : ''}` },
    h('div', { class: 'intro-text' }, h('h2', { class: 'headline' }, o.title), o.text ? h('p', null, o.text) : null, o.meta ? h('p', { class: 'muted' }, o.meta) : null),
    o.art ? (o.moment ? moment(ill(o.art), o.moment) : ill(o.art)) : null,
  );
}

// ---------------------------------------------------------------------------------------------
// Moments: when a designer finishes something that matters (welcome, first pull, sent for review, every component
// matches), the Field Guide drawing assembles itself once, piece by piece. Only the drawing moves (opacity and
// transform, WAAPI): the text and the actions are there and usable from the first frame, the layout never shifts, and
// nothing plays while a pull or a check runs (moments are on result screens only). Reduced motion: the drawing is
// simply there. Re-renders during the moment pick it up where it is (same start time), so it plays once, never loops.

/** One moment, start to end: the pieces land over this time (DS motion: duration.400 per piece, easing expo-out). */
const MOMENT_MS = 900;
const PIECE_MS = 400;
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** When each moment started, by what it celebrates (a result object, or a key such as "welcome"). */
const momentStarts = new Map<object | string, number>();
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function moment<T extends HTMLElement>(el: T, key: object | string): T {
  // Errors stay calm: no moment on a screen that also says something went wrong.
  if (reducedMotion() || typeof el.animate !== 'function' || state.error) return el;
  const now = performance.now();
  if (!momentStarts.has(key)) momentStarts.set(key, now);
  const elapsed = now - momentStarts.get(key)!;
  if (elapsed >= MOMENT_MS) return el;
  const pieces = [...el.querySelectorAll<SVGElement>('svg > *')];
  const step = pieces.length > 1 ? (MOMENT_MS - PIECE_MS) / (pieces.length - 1) : 0;
  pieces.forEach((piece, i) => {
    // A piece placed with its own transform attribute only fades: a CSS transform would replace it.
    const frames = piece.hasAttribute('transform') ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }];
    const a = piece.animate(frames, { duration: PIECE_MS, delay: i * step, easing: EXPO_OUT, fill: 'backwards' });
    a.currentTime = elapsed;
  });
  return el;
}

/** The Bridge mark (arch, deck, three posts, Harbor water), small, next to a line. Decorative. */
function bridgeMark(): HTMLElement {
  const art = ILLUSTRATIONS.logo;
  const el = h('span', { class: 'mark', 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="${art.viewBox}" fill="none" focusable="false">${art.svg}</svg>`;
  return el;
}

/** What happens next, as numbered steps under the intro of an idle screen. Explains; asks for nothing. */
function steps(items: [string, string][]): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'How it works'),
    h('ol', { class: 'steps' }, items.map(([t, d], i) => h('li', null, h('span', { class: 'step-n', 'aria-hidden': 'true' }, String(i + 1)), h('div', null, h('b', null, t), h('p', { class: 'muted' }, d))))),
  );
}

/**
 * Repository, branch and commit, for whoever needs them: folded under "For developers", never in a designer's
 * sentence. Rows without a value are left out.
 */
/** "Measured: 18 of 72 variants matched a story (54 use component-specs.json)", for the pull's developer rows. */
function measuredLine(m: MeasuredOverlayReport | undefined): string | undefined {
  if (!m) return undefined;
  return `Measured: ${m.matched} of ${m.variants} variants matched a story${m.unmatched ? ` (${m.unmatched} use component-specs.json)` : ''}, ${m.fields} values from the measure${m.keptTokens ? `, ${m.keptTokens} tokens kept (same value measured)` : ''}${m.literals ? `, ${m.literals} values no token gives` : ''}${m.conflicts ? `, ${m.conflicts} tokens that disagree (kept, to check)` : ''}`;
}

function forDevelopers(rows: [string, string | undefined][]): Child {
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  if (!shown.length) return null;
  return h(
    'details',
    { class: 'notes dev-details' },
    h('summary', null, 'For developers'),
    h('dl', { class: 'dev-list' }, shown.map(([k, v]) => [h('dt', null, k), h('dd', { class: 'mono' }, breakable(v))])),
  );
}

/** Repository and branch of the connected design system, the first rows of every "For developers". */
const repoRows = (): [string, string | undefined][] => [
  ['Repository', state.init?.settings.repo],
  ['Branch', state.init?.settings.branch],
];

function needSetup(): View {
  return {
    body: intro({ title: 'Connect your design system', text: "Bridge brings your design system's tokens and components into Figma, and sends your edits back to it. Pick the design system this file uses.", art: 'guide', moment: 'welcome' }),
    // No sign-in yet: the one action is to sign in, right here. A design system without a token goes to Settings.
    bar: state.init?.hasToken
      ? { label: 'Connect your design system', onClick: () => { state.tab = 'settings'; state.expanded.add('repo-edit'); render(); } }
      : { label: SIGN_IN_WORDS.action, onClick: () => { state.tab = 'settings'; signInWithBridge(); } },
  };
}

function viewPull(): View {
  const init = state.init!;
  if (!connected()) return needSetup();
  const p = state.pull;
  if (!p) {
    return {
      body: [intro({
        title: init.sync.baseSha ? 'Get the latest design system' : 'Get your design system',
        text: 'See every change before anything is written. Your own edits are kept, nothing is deleted.',
        // "Connected" is said once, here, right after connecting.
        meta: state.justConnected
          ? `Connected to ${state.justConnected}.`
          : init.sync.baseSha
            ? init.sync.lastPullAt ? `Last updated in this file on ${when(init.sync.lastPullAt)}.` : undefined
            : 'First time in this file: Bridge adds its variables and components.',
        art: 'tokens',
      }), claudeRunsGroup(), howUpdatesWork(!!init.sync.baseSha), compareBlock(), forDevelopers([...repoRows(), ['Last pulled commit', short(init.sync.baseSha)]])],
      // Pull is getting updates: its one action. Comparing with code is its own block, with its own button.
      bar: { label: 'Check for updates', onClick: checkPull },
    };
  }
  const a = p.analysis;
  const prop = p.proposal;
  const fi = figmaIndex(a);
  const remote = a.diff.remote;
  const upToDate = variablesUpToDate(p);
  const pending = componentsToBuild(p);
  const withComponents = pending.length > 0;

  if (p.report || p.componentsReport) {
    const r = p.report;
    const cr = p.componentsReport;
    const problems = [...(r?.errors ?? []), ...(cr?.problems ?? [])];
    const view = cr ? componentReportView(cr) : undefined;
    const text = [
      r ? `${[r.created ? `${plural(r.created, 'variable')} created` : '', r.updated ? `${plural(r.updated, 'variable')} updated` : '', r.orphaned ? `${r.orphaned} flagged as orphan` : ''].filter(Boolean).join(', ') || 'Variables already matched'}.` : '',
      // Everything new and built in one place (a first pull): one sentence, not "All 62 built. 62 created".
      // One sentence per pull: what was built or updated, and where. Never "built" then "1 updated" for the same set.
      cr && view
        ? view.retry
          ? view.headline
          : cr.created || cr.updated
            ? `${[cr.created ? plural(cr.created, cr.updated ? 'new component' : 'component') : '', cr.updated ? `${plural(cr.updated, 'component')} updated` : ''].filter(Boolean).join(' and ')}${cr.created && !cr.updated ? ' added' : ''} ${cr.elsewhere ? 'where they are kept in this file' : `on the ${cr.page} page`}.${cr.orphaned ? ` ${plural(cr.orphaned, 'variant')} no longer in code ${cr.orphaned === 1 ? 'is' : 'are'} marked "[orphan]".` : ''}`
            : view.headline
        : '',
      prop.kept.length ? `${plural(prop.kept.length, 'Figma edit')} kept: send them from Push.` : '',
    ].filter(Boolean);
    const left = view?.retry ?? false;
    // Variables are written first, then the components: until they are built, the file is not up to date yet.
    const building = !cr && !!state.busy;
    // The first pull of this file, done: the designer's next step, in one sentence (orientation, no dead end).
    const firstDone = !p.analysis.baseSha && !problems.length && !left && !building && !view?.stopped;
    if (firstDone) text.push('To change something, edit it in Figma, then send it from Push.');
    return {
      body: [
        intro({
          title: view?.stopped ? 'Pull stopped' : left ? 'Some components were not built' : problems.length ? 'Pulled, with problems' : building ? 'Variables are in, building components' : firstDone ? 'Your design system is in Figma' : 'Figma is up to date',
          text: text.join(' '),
          meta: undefined,
          // The first pull, done: the bridge builds itself, plank by plank (one per component row it brought).
          art: problems.length ? 'fix' : firstDone && cr?.created ? 'components' : 'tokens',
          moment: firstDone ? p : undefined,
        }),
        view && left
          ? h(
              'div',
              { class: 'callout warn', role: 'status' },
              h('div', { class: 'callout-title' }, icon('alert'), view.stopped ? 'Not built yet' : 'Not built'),
              view.stopped ? h('p', null, view.stopped) : null,
              view.notBuilt ? h('p', null, view.notBuilt) : null,
              view.partial.length ? h('ul', null, view.partial.map((x) => h('li', null, x))) : null,
              h('p', null, 'Try again builds what is missing. Sets already built are kept as they are.'),
            )
          : null,
        cr?.interactionsNote ? h('div', { class: 'callout warn' }, h('div', { class: 'callout-title' }, icon('alert'), 'Interactions not added'), h('p', null, cr.interactionsNote)) : null,
        cr?.fontNote ? h('div', { class: 'callout warn' }, h('div', { class: 'callout-title' }, icon('alert'), 'Font replaced'), h('p', null, cr.fontNote)) : null,
        p.done.size ? reviewGroup(p, [...p.done.values()], 'Updated components') : null,
        r ? forDevelopers([['Themes', r.layout === 'single-collection' ? 'Modes of the Semantic collection' : 'One Semantic collection per theme (this file allows one mode per collection)']]) : null,
        problems.length
          ? h(
              'section',
              { class: 'group' },
              h('div', { class: 'group-head' }, h('h2', null, 'Problems', h('span', { class: 'group-n' }, String(problems.length)))),
              h('p', { class: 'lede' }, 'Nothing else was skipped. Fix these in code or pull again.'),
              rowList('pull-errors', problems.map((e) => h('li', { class: 'row' }, h('p', null, e))), 5),
            )
          : null,
      ],
      bar: left
        ? { label: 'Try again', onClick: retryComponents, secondary: { label: 'Check again', onClick: checkPull } }
        : prop.kept.length
          ? { label: 'Check again', onClick: checkPull, secondary: { label: 'Send my edits', onClick: () => { state.tab = 'push'; scanPush(); } } }
          : hasBuiltSets(p) && !problems.length
            // Components were just built: the next thing to do is see whether they look like the code (no dead end).
            ? { label: 'Compare with code', onClick: () => void checkFidelityAnywhere() }
            : { label: 'Check again', onClick: checkPull },
    };
  }

  const counts: Record<string, number> = {};
  remote.forEach((e) => (counts[e.remote!.kind] = (counts[e.remote!.kind] ?? 0) + 1));
  const summary = [
    // Always with their noun: "1 edited token", never "1 edited".
    counts.added ? plural(counts.added, 'new token') : '',
    counts.changed ? plural(counts.changed, 'edited token') : '',
    counts.renamed ? plural(counts.renamed, 'renamed token') : '',
    counts.removed ? plural(counts.removed, 'deleted token') : '',
  ].filter(Boolean);

  // Summary first: one sentence for the whole screen, then one line of where it comes from.
  const status = [
    summary.length ? `${summary.join(', ')} in the design system` : '',
    a.diff.conflicts.length ? plural(a.diff.conflicts.length, 'conflict') : '',
    prop.restored.length ? (p.overwrite ? `${prop.restored.length} replaced with the design system's version` : `${prop.restored.length} to recreate`) : '',
    prop.kept.length ? `${plural(prop.kept.length, 'Figma edit')} kept` : '',
    pending.length ? `${plural(pending.length, 'component')} to ${pending.every((c) => c.status === 'updated') ? 'update' : 'build'}` : '',
  ].filter(Boolean);
  // Commits on main since the last pull. Even when none of them changes a variable, the file is not up to date yet.
  const behind = commitsBehind(a);
  const catchUp = upToDate && behind > 0;
  const headline = pullHeadline({ baseSha: a.baseSha, variablesUpToDate: upToDate, behind, status });
  const lastPulled = a.baseSha && init.sync.lastPullAt ? `Last updated in this file on ${when(init.sync.lastPullAt)}` : '';
  const freshCount = (p.components?.components ?? []).filter((c) => c.status === 'new').length;
  const meta = !a.baseSha
    ? `${plural(prop.plan.variables.length, 'variable')}${freshCount ? ` and ${plural(freshCount, 'component')}` : ''} from the design system. Nothing is written until you apply.`
    : catchUp
      ? [lastPulled, 'Your variables already match the design system: update to catch up with its latest changes.'].filter(Boolean).join('. ')
      : [lastPulled, behind ? `${plural(behind, 'new change')} in the design system` : ''].filter(Boolean).join(' · ');
  // A comparison with the code, running or done: it leads the screen. With nothing else to update, its result is the
  // headline (never "Up to date" above differences); its progress and its rows come right under the zone.
  const fid = p.fidelity && (p.fidelity.running || p.fidelity.outcome || p.fidelity.error) ? p.fidelity : undefined;
  const quiet = upToDate && !withComponents && !behind;
  const body: Child[] = [
    fid && quiet
      ? h('section', { class: 'zone' }, h('h2', { class: 'headline' }, fidelityHeadline(fid)), lastPulled ? h('p', { class: 'muted' }, lastPulled) : null)
      : h('section', { class: 'zone' }, h('h2', { class: 'headline' }, headline), meta ? h('p', { class: 'muted' }, meta) : null),
    // Claude's runs show on their rows once compared; before that, as their own group.
    fid ? fidelityGroup(p) : claudeRunsGroup(),
  ];

  if (remote.length) {
    const rows = rowList('pull-remote', remote.map((e) => diffRow(a, e.remote!.kind, { before: e.figma ?? e.base, after: e.head, beforeIndex: fi, afterIndex: a.head.byPath })));
    body.push(
      group(
        'Changes in the design system',
        remote.length,
        null,
        counts.removed ? 'Tokens deleted in the design system stay in Figma with an "[orphan]" note, so nothing in your designs breaks.' : 'Written to Figma when you apply.',
        // A first pull is every variable, all new: the headline says it, the list is there on demand.
        a.baseSha ? rows : h('details', { class: 'notes' }, h('summary', null, `See the ${plural(remote.length, 'variable')}`), rows),
      ),
    );
  }
  body.push(conflictSection(a, p.choices));
  if (prop.restored.length) {
    body.push(
      group(
        p.overwrite ? "Replaced with the design system's version" : 'To recreate',
        prop.restored.length,
        p.overwrite ? h('button', { class: 'btn ghost', onClick: () => { p.overwrite = false; refreshProposals(); } }, 'Keep my edits') : null,
        p.overwrite ? "The design system's version wins over your Figma edits. Variables that exist only in Figma stay." : 'Deleted in Figma, but other tokens still point to them.',
        rowList('pull-restored', prop.restored.map((e) => diffRow(a, p.overwrite ? 'replaced' : 'restored', { before: e.figma, after: e.head, beforeIndex: fi, afterIndex: a.head.byPath })), 5),
      ),
    );
  }
  if (prop.kept.length) {
    // Edits already sent for review are not "to send": say where they are, with the way to follow them.
    const sentUrl = p.sentPr?.url;
    const studio = p.sentPr ? studioChangeUrl(init.settings.repo, 'pr', p.sentPr.number) : undefined;
    body.push(
      group(
        sentUrl ? 'Your Figma edits, in review' : 'Your Figma edits, kept',
        prop.kept.length,
        sentUrl
          ? h('button', { class: 'btn ghost', onClick: () => void request('open-url', { url: studio ?? sentUrl }) }, studio ? 'See it in Studio' : 'Open on GitHub')
          : prop.kept.some((e) => e.head)
            ? h('button', { class: 'btn ghost', onClick: () => { p.overwrite = true; refreshProposals(); } }, "Use the design system's version")
            : null,
        sentUrl ? 'Sent for review. They stay here until the change is in the design system; anything you edit after it goes with your next send.' : 'Not in the design system yet. Send them from Push.',
        rowList('pull-kept', prop.kept.map((e) => diffRow(a, e.local!.kind, { before: e.base, after: e.figma, beforeIndex: a.base?.byPath ?? a.head.byPath, afterIndex: fi })), 5),
      ),
    );
  }
  body.push(componentsGroup(p));
  if (!fid) body.push(fidelityGroup(p));
  if (prop.skipped.length) body.push(issueList('warn', 'Not written', prop.skipped.map((s) => ({ code: 'file-problem', severity: 'warning', message: `${s.path}: ${s.reason}` }))));
  body.push(notes(a));
  // Repository, commits, spec source and collections: last, folded, for whoever needs them (never above the changes).
  body.push(forDevelopers([...repoRows(), ['Last pulled commit', short(a.baseSha)], ['Latest commit', short(a.headSha)], ['Collections', andList(pullCollections(prop.plan))], ['Spec source', p.measuredOnly ? `Measured only: ${p.measuredOnly.sets} sets, ${p.measuredOnly.variants} variants from ${p.measuredOnly.stories} stories` : measuredLine(p.measured)], ...fixesRows(p.fixes)]));

  const open = prop.unresolvedConflicts.length;
  // New sets from code: the choice sits next to the action it changes (on by default on a first pull).
  const freshSets = (p.components?.components ?? []).filter((c) => c.status === 'new').length;
  const toggle = freshSets
    ? { label: `Include components (${freshSets})`, checked: p.includeComponents, focusId: 'pull-components', onChange: (v: boolean) => { p.includeComponents = v; render(); } }
    : undefined;
  // While the comparison runs, nothing competes with it: no "Check again" until it is done.
  if (fid?.running) return { body, bar: undefined };
  return {
    body,
    bar: upToDate && !withComponents && !behind
      ? { label: 'Check again', onClick: checkPull, toggle }
      : catchUp && !withComponents
        ? { label: 'Update', onClick: applyPull, hint: 'Nothing changes in Figma', secondary: { label: 'Check again', onClick: checkPull }, toggle }
        : {
          toggle,
          label: pending.some((c) => c.status === 'updated') ? 'Update all' : 'Apply to Figma',
          onClick: applyPull,
          disabled: open > 0,
          // With the components choice in the bar, the counts stay in the list headings: the bar has no room for both.
          hint: open
            ? `Decide ${plural(open, 'conflict')} first`
            : toggle
              ? undefined
              : [upToDate ? '' : `${plural(prop.plan.variables.length, 'variable')}${prop.plan.orphans.length ? `, ${prop.plan.orphans.length} orphaned` : ''}`, withComponents ? plural(pending.length, 'component') : ''].filter(Boolean).join(' and '),
          secondary: { label: 'Check again', onClick: checkPull },
        },
  };
}

/** Before and after thumbnails side by side; "after" exists once the set is updated. */
/**
 * Before and after, side by side; "Enlarge" shows them one above the other at the panel's width, big enough to see a
 * padding change. Before an update, "After" says what will change (the update builds it; nothing is drawn yet).
 */
function thumbs(p: PullState, nodeId: string, name: string, changes: { field: string; before?: string | undefined; after?: string | undefined }[] = []): HTMLElement {
  const key = `thumbs-${nodeId}`;
  const big = state.expanded.has(key);
  const coming = changes.slice(0, 3).map((c) => `${c.field.replace(/ \(.*\)$/, '')}: ${c.before ?? 'none'} to ${c.after ?? 'none'}`);
  const img = (b64: string | undefined, label: string, empty: Child) =>
    h(
      'figure',
      { class: 'thumb' },
      b64 ? h('img', { src: `data:image/png;base64,${b64}`, alt: `${name}, ${label.toLowerCase()}` }) : h('div', { class: 'thumb-empty' }, empty),
      h('figcaption', null, label),
    );
  const pending = coming.length
    ? h('div', { class: 'thumb-coming' }, h('b', null, 'What changes'), h('ul', null, coming.map((c) => h('li', null, c))), changes.length > 3 ? h('small', null, `And ${changes.length - 3} more below`) : null)
    : 'Shown once updated';
  // Before an update: the default variant in Figma now, next to the incoming version (the code's image, or drawn by
  // Bridge). Without either, today's set thumbnail and the list of what changes.
  const pv = !p.after[nodeId] && changes.length ? p.previews[nodeId] : undefined;
  if (pv && (pv.after || pv.state === 'loading' || pv.state === 'waiting')) {
    return h(
      'div',
      { class: 'thumbs-wrap', 'data-preview': pv.source, ...(pv.state === 'waiting' ? { 'data-draw': nodeId } : {}), ...(pv.ms ? { title: `Drawn by Bridge in ${pv.ms} ms` } : {}) },
      h(
        'div',
        { class: big ? 'thumbs one' : 'thumbs' },
        img(pv.before ?? p.before[nodeId], PREVIEW_WORDS.before, 'No preview'),
        img(pv.after, pv.source === 'bridge' ? PREVIEW_WORDS.afterBridge : PREVIEW_WORDS.afterCode, pv.state !== 'done' ? h('span', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), PREVIEW_WORDS.loading) : pending),
      ),
      pv.after ? h('small', null, PREVIEW_WORDS.close) : null,
      pv.after
        ? h('button', { class: 'btn ghost', 'data-focus-id': key, 'aria-pressed': big ? 'true' : 'false', onClick: () => { big ? state.expanded.delete(key) : state.expanded.add(key); render(); } }, big ? 'Show side by side' : 'Enlarge')
        : null,
    );
  }
  return h(
    'div',
    { class: 'thumbs-wrap' },
    h('div', { class: big ? 'thumbs one' : 'thumbs' }, img(p.before[nodeId], 'Before', 'No preview'), img(p.after[nodeId], 'After', pending)),
    p.before[nodeId] || p.after[nodeId]
      ? h('button', { class: 'btn ghost', 'data-focus-id': key, 'aria-pressed': big ? 'true' : 'false', onClick: () => { big ? state.expanded.delete(key) : state.expanded.add(key); render(); } }, big ? 'Show side by side' : 'Enlarge')
      : null,
  );
}

/**
 * The previews of the sets to review, one at a time: the default variant exported from Figma ("Before: in Figma now")
 * and, when there is one of the incoming version, its code image ("After: in code"). Read only.
 */
async function loadPreviews(p: PullState): Promise<void> {
  for (const r of p.reviews) {
    if (p.previews[r.nodeId] || p.done.has(r.componentId)) continue;
    const planned = p.components?.components.find((c) => c.componentId === r.componentId);
    const key = planned && previewKey(planned);
    if (!planned || !key) continue;
    const source = codeImageSource(planned, key, p.refs, p.shots, state.init!.settings.branch);
    if (!source) {
      // No image of the code: Bridge draws the incoming version itself, off-canvas, once the row scrolls into view.
      p.previews[r.nodeId] = { key, source: 'bridge', state: 'waiting' };
      continue;
    }
    p.previews[r.nodeId] = { key, source: 'code', state: 'loading' };
    if (state.pull === p) render();
    const [before, after] = await Promise.all([
      request('fidelity-export', { nodeId: r.nodeId, keys: [key], scale: p.refs?.scale ?? 2 }).then((x) => x[key]).catch(() => undefined),
      getClient().getFileBase64(source.path, source.ref).then((x) => x?.base64).catch(() => undefined),
    ]);
    p.previews[r.nodeId] = { key, before, after, source: after ? 'code' : 'none', state: 'done' };
    if (state.pull === p) render();
  }
}

/** Drawings by Bridge, one at a time, in the order their rows came into view. */
const drawQueue: { p: PullState; nodeId: string }[] = [];
let drawing = false;

async function drawNext(): Promise<void> {
  if (drawing) return;
  const next = drawQueue.shift();
  if (!next) return;
  drawing = true;
  const { p, nodeId } = next;
  try {
    const pv = p.previews[nodeId];
    const r = p.reviews.find((x) => x.nodeId === nodeId);
    const planned = r && p.components?.components.find((c) => c.componentId === r.componentId);
    if (!pv || pv.state !== 'waiting' || !planned || state.pull !== p) return;
    p.previews[nodeId] = { ...pv, state: 'loading' };
    render();
    const before = await request('fidelity-export', { nodeId, keys: [pv.key], scale: 2 }).then((x) => x[pv.key]).catch(() => undefined);
    // Capped: past it, the list of changes says what the update does (the drawing still cleans up behind it).
    const drawn = await Promise.race([
      request('render-incoming', { component: planned, icons: p.components?.icons, key: pv.key, scale: 2 }).catch(() => null),
      new Promise<null>((done) => setTimeout(() => done(null), RENDER_CAP_MS)),
    ]);
    p.previews[nodeId] = drawn ? { key: pv.key, before, after: drawn.base64, source: 'bridge', state: 'done', ms: drawn.ms } : { key: pv.key, source: 'none', state: 'done' };
    if (state.pull === p) render();
  } finally {
    drawing = false;
    void drawNext();
  }
}

/** Rows waiting for a drawing: drawn as they scroll into view (all at once where the browser cannot tell). */
let drawObserver: IntersectionObserver | undefined;
function watchDrawings(): void {
  const p = state.pull;
  if (!p) return;
  const waiting = [...document.querySelectorAll<HTMLElement>('[data-draw]')];
  if (!waiting.length) return;
  const enqueue = (nodeId: string) => {
    if (!drawQueue.some((x) => x.nodeId === nodeId)) drawQueue.push({ p, nodeId });
    void drawNext();
  };
  if (typeof IntersectionObserver !== 'function') {
    waiting.forEach((el) => enqueue(el.dataset.draw!));
    return;
  }
  drawObserver?.disconnect();
  drawObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) enqueue((e.target as HTMLElement).dataset.draw!);
  });
  waiting.forEach((el) => drawObserver!.observe(el));
}

/** Figma's "Review updates": one card per changed set, before and after, what changes, and "Update" on its own. */
function reviewGroup(p: PullState, reviews: ComponentReview[], title = 'Component updates'): HTMLElement {
  const rows = reviews.map((r) => {
    const done = p.done.has(r.componentId);
    const variants = [r.addedVariants.length ? `${r.addedVariants.length} new ${r.addedVariants.length === 1 ? 'variant' : 'variants'}` : '', r.removedVariants.length ? `${r.removedVariants.length} removed in code` : ''].filter(Boolean).join(', ');
    return h(
      'li',
      { class: 'row review' },
      h(
        'div',
        { class: 'row-head' },
        h('span', { class: 'comp-name' }, r.name),
        variants ? h('span', { class: 'muted' }, variants) : null,
        interactionsLabel(p.components?.components.find((c) => c.componentId === r.componentId)),
        p.components?.components.find((c) => c.componentId === r.componentId)?.drafted ? h('span', { class: 'muted' }, 'Drafted, check it') : null,
        done
          ? h('span', { class: 'kind added row-end' }, 'Updated')
          : h('button', { class: 'btn row-end', 'data-focus-id': `update-${r.componentId}`, disabled: !!state.busy || p.proposal.unresolvedConflicts.length > 0, onClick: () => updateComponent(r.componentId) }, 'Update'),
      ),
      thumbs(p, r.nodeId, r.name, done ? [] : r.changes),
      changeTable(r.changes, ['What', 'In Figma', 'From code']),
    );
  });
  return group(
    title,
    reviews.length,
    null,
    title === 'Component updates' ? 'Changed in code since your last pull. Update one at a time, or all of them with Update all. Instances keep their overrides.' : 'Updated in place: same layers, so instances keep their overrides.',
    rowList(`review-${title}`, rows, 10),
  );
}

/** Pull preview: updates to review for the generated sets, new sets opt-in, and what cannot be bound. */
function componentsGroup(p: PullState): Child {
  if (p.componentsError) return componentsErrorCallout(p.componentsError);
  const plan = p.components;
  if (!plan) return null;
  const reviews = [...p.reviews.filter((r) => !p.done.has(r.componentId)), ...p.done.values()];
  const fresh = plan.components.filter((c) => c.status === 'new');
  const upToDate = plan.components.filter((c) => c.status === 'unchanged' && !p.done.has(c.componentId));
  const out: Child[] = [];
  if (reviews.length) out.push(reviewGroup(p, reviews));
  if (p.inReview.length) {
    out.push(
      h(
        'p',
        { class: 'muted' },
        `Sent from Figma, still in review: ${p.inReview.map((x) => `${x.name} (${x.status.label.charAt(0).toLowerCase()}${x.status.label.slice(1)})`).join(', ')}. Once it ships, Update rebuilds it from the reviewed code.`,
      ),
    );
  }
  // Honest coverage: how many coded components are in Figma, and why the others are not (folded under the count).
  const cov = coverageView(plan);
  out.push(
    group(
      fresh.length ? 'New components' : 'Components',
      // One count on the screen, the sets built (the footer's "Include components" uses it too).
      fresh.length ? fresh.length : plan.components.length,
      null,
      // One count and one noun ("components", the sets Figma shows): lists are counted, the names on demand.
      fresh.length
        ? `${plural(fresh.length, 'component')} to add, on a "Components" page, using these variables.`
        : reviews.length
          ? `${plural(reviews.length, 'component')} changed in code${upToDate.length ? `, ${upToDate.length} up to date` : ''}.`
          : `${plural(plan.components.length, 'component')}, all up to date with the code.`,
      [
        cov.missing.length
          ? h('details', { class: 'notes' }, h('summary', null, `${plural(cov.missing.length, 'component')} from the code ${cov.missing.length === 1 ? 'is' : 'are'} not in Figma yet`), h('ul', null, cov.missing.map((m) => h('li', null, m.name))))
          : null,
        // How each set was made (drafted with Claude, layout helpers), motion Figma cannot play, unreadable specs.
        cov.drafted.length || cov.layout.length || plan.components.some((c) => c.motionNotes?.length) || plan.skipped?.length
          ? h(
              'details',
              { class: 'notes dev-details' },
              h('summary', null, 'For developers'),
              coverageDetails({ ...cov, missing: [] }),
              motionDetails(plan),
              plan.skipped?.length
                ? h(
                    'details',
                    { class: 'notes' },
                    h('summary', null, `${plural(plan.skipped.length, 'component')} in component-specs.json cannot be read, the others are pulled`),
                    h('ul', null, plan.skipped.map((x) => h('li', null, `${x.name}: ${x.reason}.`))),
                  )
                : null,
            )
          : null,
        fresh.length
          ? foldOnFirstPull(p, `See the ${plural(fresh.length, 'component')}`, rowList(
              'pull-components',
              fresh.map((c) =>
                h(
                  'li',
                  { class: 'row' },
                  h(
                    'div',
                    { class: 'row-head' },
                    h('span', { class: 'kind added' }, 'New'),
                    h('span', { class: 'comp-name' }, c.name),
                    h('span', { class: 'muted' }, plural(c.variants.length, 'variant')),
                    c.interactions?.length ? h('span', { class: 'muted' }, `Interactions: ${c.interactions.length}`) : null,
                    c.drafted ? h('span', { class: 'kind row-end', title: 'Drafted with Claude: Bridge cannot read this component on its own. Compare with code checks it against the code.' }, draftedSetNote(c.drafted)) : null,
                  ),
                ),
              ),
              10,
            ))
          : null,
      ],
    ),
  );
  return out;
}

/** A first pull brings everything, all new: the headline says it, the list is there on demand (as for variables). */
function foldOnFirstPull(p: PullState, summary: string, content: HTMLElement): HTMLElement {
  return p.analysis.baseSha ? content : h('details', { class: 'notes' }, h('summary', null, summary), content);
}

/**
 * "Check fidelity" from anywhere on Pull (the idle screen, the end of a pull): reads the design system again, quietly,
 * then compares. The designer lands on the comparison, scrolled into view, without reviewing updates first.
 */
async function checkFidelityAnywhere(): Promise<void> {
  const prev = state.pull;
  await run('Reading the design system', async () => {
    state.pull = await loadPull(prev);
  });
  const p = state.pull;
  if (!p || state.error || p === prev) return;
  const shown = checkFidelity(p);
  document.querySelector('[data-focus-id="check-fidelity"]')?.closest('section')?.scrollIntoView({ block: 'start' });
  await shown;
}

/** The file has component sets Bridge built from code: there is something to compare. */
const hasBuiltSets = (p: PullState | undefined) => !!p?.componentsReport?.nodeIds.length || (p?.components?.components ?? []).some((c) => c.status !== 'new');

/** What Compare with code does, in one sentence (no "fidelity", no Claude: Claude comes in on a difference). */
const COMPARE_LEDE = 'Do the components in this file still look like the code? Bridge compares each one with how it renders in code.';

/** Check, Review, Apply: open for a first pull, one line to unfold for someone who has pulled before. */
function howUpdatesWork(returning: boolean): HTMLElement {
  const card = steps([
    ['Check', "Bridge reads the design system's tokens and components."],
    ['Review', 'Every new, edited or deleted token is listed with its value. Nothing is written yet.'],
    ['Apply', 'Figma variables are created or updated, and components are built from the code. Your own edits stay until you send them from Push.'],
  ]);
  return returning ? h('details', { class: 'notes', 'data-how': 'updates' }, h('summary', null, 'How updates work'), card) : card;
}

/** The last Compare with code of this file, as the Pull screen says it: "8 differ, 24 match · compared today at 14:50". */
function lastCompareLine(raw: string | undefined): { line: string; differs: number } | undefined {
  try {
    const x = raw ? (JSON.parse(raw) as { differs: number; matches: number; notChecked: number; at: string }) : undefined;
    if (!x) return undefined;
    const at = new Date(x.at);
    const today = at.toDateString() === new Date().toDateString();
    const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const counts = [x.differs ? `${x.differs} differ` : '', x.matches ? `${x.matches} match` : '', x.notChecked ? `${x.notChecked} not compared` : ''].filter(Boolean).join(', ');
    return { line: `${counts || 'Nothing compared'} · compared ${today ? `today at ${time}` : at.toLocaleDateString([], { dateStyle: 'medium' })}`, differs: x.differs };
  } catch {
    return undefined;
  }
}

/**
 * Compare with code, its own block on Pull, below getting updates: one sentence, the last result, one button. Only once
 * the file was pulled (before that there is nothing in Figma to compare). It runs with the progress row of the result.
 */
function compareBlock(): Child {
  const init = state.init!;
  if (!init.sync.baseSha) return null;
  const last = lastCompareLine(init.sync.lastCompare);
  return h(
    'section',
    { class: 'group', 'data-block': 'compare' },
    h(
      'div',
      { class: 'group-head' },
      h('h2', null, 'Compare with code'),
      h('button', { class: 'btn', 'data-focus-id': 'compare-idle', disabled: !!state.busy, onClick: () => void checkFidelityAnywhere() }, last?.differs ? 'See the differences' : last ? 'Compare again' : 'Compare with code'),
    ),
    h('p', { class: 'lede' }, COMPARE_LEDE),
    last ? h('p', { class: 'muted' }, last.line) : null,
  );
}

/** "Compare with code": exports each generated set's variants and compares them with the code images. Read only. */
async function checkFidelity(p: PullState): Promise<void> {
  if (p.fidelity?.running) return;
  p.fidelity = { running: p.shots ? 'Reading the renders of the stories' : 'Reading the images of the code' };
  render();
  try {
    const outcome = await runFidelityCheck({
      client: getClient(),
      sets: await request('scan-generated', {}),
      exportVariants: (nodeId, keys, scale) => request('fidelity-export', { nodeId, keys, scale }),
      decode: decodePng,
      encode: encodePng,
      progress: (m) => {
        if (p.fidelity) p.fidelity.running = m;
        render();
      },
      ...(state.init?.fileName ? { fileName: state.init.fileName } : {}),
      // Measured only with screenshots: each set against the renders of the stories it was built from.
      ...(p.shots
        ? {
            reference: {
              manifest: p.shots.manifest,
              image: async (file: string) => (await getClient().getFileBase64(p.shots!.dir ? `${p.shots!.dir}/${file}` : file, state.init!.settings.branch))?.base64,
            },
          }
        : {}),
    });
    const built: Record<string, Record<string, GapBuiltVariant>> = {};
    // Kept with the file: the Pull screen says the last result ("8 differ, 24 match · compared today at 14:50").
    if (outcome.kind === 'done') {
      const lastCompare = JSON.stringify({ ...outcome.report.summary, at: new Date().toISOString() });
      state.init!.sync = { ...state.init!.sync, lastCompare };
      void request('save-sync', { sync: { lastCompare } }).catch(() => undefined);
    }
    p.fidelity = { outcome, ...(outcome.kind === 'done' && p.measure ? { gaps: await gapCases(p, outcome.items, built), built } : {}) };
  } catch (err) {
    p.fidelity = { error: inlineError(err) ?? 'Could not compare with the code.' };
  }
  render();
}

/**
 * The gap case of each set that differs (measured only): the variants, what the code draws that Figma does not and
 * where, read from the built layers. A set whose layers cannot be read still gets one, from the values alone.
 */
async function gapCases(p: PullState, items: Extract<FidelityOutcome, { kind: 'done' }>['items'], builtBySet: Record<string, Record<string, GapBuiltVariant>> = {}): Promise<GapCase[]> {
  const out: GapCase[] = [];
  for (const it of items) {
    if (it.result.status !== 'differs' || !p.measure) continue;
    const keys = it.result.variants.filter((v) => v.status === 'differs').map((v) => v.key);
    const built = await request('read-built', { nodeId: it.nodeId, keys }).catch(() => undefined);
    if (built) builtBySet[it.name] = built;
    const shots = Object.fromEntries(Object.entries(p.shots?.manifest.components[it.name]?.variants ?? {}).flatMap(([k, e]) => ('file' in e ? [[k, { file: e.file }]] : [])));
    out.push(
      buildGapCase({
        component: it.name,
        measured: p.measure as MeasuredSpecsFile,
        spec: p.specs?.components.find((c) => c.name === it.name),
        fidelity: it.result,
        shots,
        ...(built ? { built } : {}),
        figmaRenders: Object.fromEntries(keys.map((k) => [k, it.nodeId])),
      }),
    );
  }
  return out;
}

/**
 * "Ask Claude to fix it" on a set that differs, with the team's own Claude (Bridge is a connector in it; no API key
 * anywhere). The check goes to figma-fidelity.json on the requests branch (Claude reads it through Bridge), then Claude
 * opens with the request ("Fix TextInput in Figma with Bridge"): written for the designer when claude.ai can prefill,
 * else copied to paste. The row then waits for Claude's fix, which Bridge finds on GitHub (watchFixes). The first time
 * in a file, one sentence says Bridge must be in the team's Claude, with How to connect.
 */
async function fixWithClaude(p: PullState, component: string, connected = !!state.init?.sync.claudeConnector): Promise<void> {
  const f = p.fidelity;
  if (!f || f.outcome?.kind !== 'done' || f.fix?.status === 'writing') return;
  if (!connected) {
    f.fix = { component, status: 'connect' };
    render();
    return;
  }
  f.fix = { component, status: 'writing' };
  render();
  try {
    const run: FigmaFidelityRun = {
      version: 1,
      report: f.outcome.report,
      ...(f.built ? { built: f.built } : {}),
      figmaRenders: Object.fromEntries(f.outcome.items.filter((it) => it.result.status === 'differs').map((it) => [it.name, Object.fromEntries(it.result.variants.map((v) => [v.key, it.nodeId]))])),
      ...(p.measure?.measuredAt ? { measuredAt: p.measure.measuredAt } : {}),
    };
    await writeFidelityRun(getClient(), run, state.init!.settings.branch);
    const open = claudeUrl(component);
    // Copied either way: the prefilled message is there, and the clipboard has it if the box comes up empty.
    await copyText(askText(component));
    void request('open-url', { url: open.url });
    markAsked(component);
    f.fix = { component, status: 'asked', prefilled: open.prefilled };
  } catch (err) {
    f.fix = { component, status: 'error', error: inlineError(err) ?? 'Bridge could not save the request. Check your connection, then try again.' };
  }
  render();
}

/** Bridge is in the team's Claude (someone said so once): kept with the file, the first-time sentence goes. */
function markConnector(): void {
  state.init!.sync = { ...state.init!.sync, claudeConnector: 'yes' };
  void request('save-sync', { sync: { claudeConnector: 'yes' } }).catch(() => undefined);
}

/** The components asked about, kept with the file so the watch resumes when the plugin opens again. */
function markAsked(component: string): void {
  const asked = { ...parseAsked(state.init!.sync.claudeAsked), [component]: new Date().toISOString() };
  saveAsked(asked);
  watchFixes();
}

function saveAsked(asked: Asked): void {
  const claudeAsked = JSON.stringify(asked);
  state.init!.sync = { ...state.init!.sync, claudeAsked };
  void request('save-sync', { sync: { claudeAsked } }).catch(() => undefined);
}

/** Claude's fixes found on GitHub, by component: the draft pull request to review. */
const claudeFixes = new Map<string, Pick<PullRequestSummary, 'number' | 'url' | 'draft'>>();
/** What Claude is doing, by component: the real steps Bridge records (when the Bridge site can say; else the PR watch). */
const claudeSessions = new Map<string, FixSession>();
let fixWatch: ReturnType<typeof setTimeout> | undefined;
let fixLooking = false;

/** Asked, not finished (no fix found, Claude has not stopped), and not too old. */
function waitingFor(): string[] {
  const now = Date.now();
  return Object.entries(parseAsked(state.init?.sync.claudeAsked))
    .filter(([c, at]) => !claudeFixes.has(c) && claudeSessions.get(c)?.state !== 'stopped' && claudeSessions.get(c)?.state !== 'ready' && now - Date.parse(at) < ASK_TTL_MS)
    .map(([c]) => c);
}

/**
 * Looks for Claude's fixes, gently (one request every 20 s, one at a time), while something is asked and not found,
 * with the Bridge sign-in. Started when the plugin opens with asks pending, and after each ask.
 */
function watchFixes(): void {
  if (fixWatch || fixLooking || !connected() || !Object.keys(parseAsked(state.init?.sync.claudeAsked)).length) return;
  const look = async () => {
    fixWatch = undefined;
    fixLooking = true;
    try {
      // The steps first, one component at a time (the Bridge site records them from Claude's calls to Bridge); then
      // GitHub for the fix itself, which also covers a site that cannot say yet.
      let changed = false;
      for (const component of waitingFor()) {
        const s = await readFixSession((url, init) => fetch(url, init), STUDIO_ORIGIN, state.init!.token ?? '', state.init!.settings.repo, component);
        if (s && JSON.stringify(s) !== JSON.stringify(claudeSessions.get(component))) {
          claudeSessions.set(component, s);
          changed = true;
        }
      }
      if (waitingFor().length) {
        const prs = await getClient().listPullRequests('open');
        const prefix = (state.pull?.analysis ?? state.push?.analysis)?.headFiles.config?.governance.branchPrefix;
        for (const component of Object.keys(parseAsked(state.init?.sync.claudeAsked))) {
          const pr = findFix(prs, component, prefix);
          if (pr && claudeFixes.get(component)?.number !== pr.number) {
            claudeFixes.set(component, pr);
            changed = true;
          }
        }
      }
      // A working row shows its elapsed time: refreshed with each look.
      if (changed || [...claudeSessions.values()].some((x) => x.state === 'working')) render();
    } catch {
      /* offline a moment: the next look tries again */
    } finally {
      fixLooking = false;
    }
    if (waitingFor().length) {
      fixWatch = setTimeout(() => void look(), WATCH_MS);
      // Never keeps a process alive by itself (tests run this UI in Node); a no-op in the plugin's browser window.
      (fixWatch as unknown as { unref?: () => void }).unref?.();
    }
  };
  void look();
}

/**
 * Where Claude's fix for a component stands, on its row. The head in one line ("Waiting for Claude", "Claude is
 * working on IconButton · 4 min, round 2 of up to 3", "Claude's fix is ready", "Claude stopped: …", "Claude went
 * quiet"); the steps below it, newest last, folded unless the designer opens them; the end's action.
 */
function claudePanel(component: string): Child {
  const pr = claudeFixes.get(component);
  const session = claudeSessions.get(component);
  const askedAt = parseAsked(state.init?.sync.claudeAsked)[component];
  if (!pr && !session && !waitingFor().includes(component)) return null;
  const head = pr ? { kind: 'ready' as const, text: CONNECTOR_WORDS.ready } : sessionHead(session, component);
  if (!pr && !askedAt && head.kind === 'waiting') return null;
  const key = `claude-steps-${component}`;
  const steps = session?.steps ?? [];
  const reviewPr = pr ?? (session?.pr ? { number: session.pr.number, url: session.pr.url } : undefined);
  const studio = reviewPr ? (studioChangeUrl(state.init!.settings.repo, 'pr', reviewPr.number) ?? reviewPr.url) : undefined;
  const developer = fixRequestForDeveloper(component, state.init?.settings.repo ?? '');
  return h(
    'div',
    { class: 'callout claude-run', role: 'status', 'data-claude': head.kind },
    h(
      'div',
      { class: 'callout-title' },
      head.kind === 'working' || head.kind === 'waiting' ? h('span', { class: 'activity', 'aria-hidden': 'true' }) : icon(head.kind === 'ready' ? 'check' : 'alert'),
      h('span', { 'data-head': '' }, head.text),
    ),
    steps.length
      ? h(
          'details',
          {
            class: 'notes',
            open: state.expanded.has(key),
            onToggle: (e: Event) => ((e.target as HTMLDetailsElement).open ? state.expanded.add(key) : state.expanded.delete(key)),
          },
          h('summary', null, `What Claude did (${steps.length})`),
          h(
            'ol',
            { class: 'claude-steps' },
            steps.map((st) =>
              h(
                'li',
                { 'data-step': st.status },
                st.status === 'current' ? h('span', { class: 'activity', 'aria-hidden': 'true' }) : icon(st.status === 'done' ? 'check' : 'alert'),
                st.label,
              ),
            ),
          ),
        )
      : null,
    head.kind === 'ready' && studio
      ? [
          h('div', { class: 'inline-actions' }, h('button', { class: 'btn', 'data-focus-id': `see-fix-${component}`, onClick: () => void request('open-url', { url: studio }) }, icon('external'), CONNECTOR_WORDS.see)),
          h('p', { class: 'muted' }, CONNECTOR_WORDS.next),
        ]
      : null,
    head.kind === 'waiting' || head.kind === 'quiet'
      ? h('div', { class: 'inline-actions' }, h('button', { class: 'btn ghost', 'data-focus-id': `reopen-claude-${component}`, onClick: () => { void copyText(askText(component)); void request('open-url', { url: claudeUrl(component).url }); } }, icon('external'), 'Open Claude again'))
      : null,
    head.kind === 'stopped' || head.kind === 'quiet'
      ? h('div', { class: 'inline-actions' }, h('button', { class: 'btn ghost', 'data-focus-id': `stop-copy-${component}`, onClick: () => void copyText(developer).then((ok) => { if (ok) state.expanded.add(`copied-${component}`); render(); }) }, icon(state.expanded.has(`copied-${component}`) ? 'check' : 'copy'), state.expanded.has(`copied-${component}`) ? 'Copied' : 'Copy for your developer'))
      : null,
  );
}

/** Claude's fixes on the Pull screen when no comparison shows them on their rows: waited for, or ready to review. */
function claudeRunsGroup(): Child {
  const names = [...new Set([...claudeFixes.keys(), ...claudeSessions.keys(), ...waitingFor()])];
  if (!names.length) return null;
  return group(
    "Claude's fixes",
    names.length,
    null,
    'Your team\'s Claude works on these. Nothing changes in this file until a fix is approved.',
    h('ul', { class: 'rows' }, names.map((n) => h('li', { class: 'row review' }, h('div', { class: 'row-head' }, h('span', { class: 'comp-name' }, n)), claudePanel(n)))),
  );
}

/**
 * Under a set that differs, after "Ask Claude to fix it": the first time, how to add Bridge to the team's Claude; then
 * what to do in Claude (the request is written or copied). "Copy for your developer" stays as the fallback.
 */
function fixPanel(p: PullState, component: string): Child {
  const fix = p.fidelity?.fix;
  if (!fix || fix.component !== component) return null;
  if (fix.status === 'writing') return h('p', { class: 'muted loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Getting the request ready');
  if (fix.status === 'error') return h('div', { class: 'callout warn', role: 'alert' }, h('div', { class: 'callout-title' }, icon('alert'), 'Could not ask Claude'), h('p', null, fix.error));
  const text = fixRequestForDeveloper(component, state.init?.settings.repo ?? '');
  const copyForDeveloper = h('button', { class: 'btn ghost', 'data-focus-id': `fix-copy-${component}`, onClick: () => void copyText(text).then((ok) => { if (p.fidelity?.fix && ok) p.fidelity.fix.copied = true; render(); }) }, icon(fix.copied ? 'check' : 'copy'), fix.copied ? 'Copied' : 'Copy for your developer');
  if (fix.status === 'connect') {
    const team = studioTeamUrl(state.init!.settings.repo);
    return h(
      'div',
      { class: 'callout', role: 'status', 'data-claude': 'connect' },
      h('p', null, CONNECTOR_WORDS.firstTime),
      h(
        'div',
        { class: 'inline-actions' },
        team ? h('button', { class: 'btn', 'data-focus-id': `connect-${component}`, onClick: () => void request('open-url', { url: `${team}settings/#claude` }) }, icon('external'), CONNECTOR_WORDS.howToConnect) : null,
        h('button', { class: 'btn ghost', 'data-focus-id': `connected-${component}`, onClick: () => { markConnector(); void fixWithClaude(p, component, true); } }, CONNECTOR_WORDS.connected),
        copyForDeveloper,
      ),
    );
  }
  // Asked: what to do in Claude, then the row waits for the fix (claudePanel).
  return h(
    'div',
    { class: 'callout', role: 'status', 'data-claude': 'asked' },
    h('p', null, fix.prefilled ? CONNECTOR_WORDS.prefilled : CONNECTOR_WORDS.pasted),
    fix.prefilled ? h('small', null, CONNECTOR_WORDS.emptyHint) : null,
    h(
      'div',
      { class: 'inline-actions' },
      fix.prefilled ? null : h('button', { class: 'btn', 'data-focus-id': `open-claude-${component}`, onClick: () => void request('open-url', { url: CLAUDE_NEW_CHAT }) }, icon('external'), CONNECTOR_WORDS.openClaude),
      copyForDeveloper,
    ),
  );
}

/** "Copy for your developer": the text is copied, never shown; the button says Copied once it is. */
function handoffButton(p: PullState, key: string, text: string): HTMLElement {
  const copied = !!p.fidelity?.handedOff?.has(key);
  return h(
    'button',
    {
      class: 'btn',
      'data-focus-id': `handoff-${key}`,
      onClick: () =>
        void copyText(text).then((ok) => {
          if (ok && p.fidelity) (p.fidelity.handedOff ??= new Set()).add(key);
          render();
        }),
    },
    icon(copied ? 'check' : 'copy'),
    copied ? 'Copied' : 'Copy for your developer',
  );
}

/** Figma, code and differences side by side for the variant that differs most. */
function fidelityThumbs(name: string, images: { key: string; figma: string; code: string; diff: string }): HTMLElement {
  const fig = (src: string, label: string) => h('figure', { class: 'thumb' }, h('img', { src, alt: `${name} ${images.key}, ${label.toLowerCase()}` }), h('figcaption', null, label));
  return h(
    'div',
    { class: 'thumbs three' },
    fig(`data:image/png;base64,${images.figma}`, 'In Figma'),
    fig(`data:image/png;base64,${images.code}`, 'In code'),
    fig(images.diff, 'Differences'),
  );
}

/** Pull, after components: does each generated set look like the code? */
function fidelityGroup(p: PullState): Child {
  const generated = (p.components?.components ?? []).filter((c) => c.status !== 'new');
  const f = p.fidelity;
  // Asked for (running or answered): it always shows, even with nothing in this file to compare yet.
  if (!generated.length && !f?.running && !f?.outcome && !f?.error) return null;
  const outcome = f?.outcome;
  const action = h(
    'button',
    { class: 'btn ghost', 'data-focus-id': 'check-fidelity', disabled: !!f?.running || !!state.busy, onClick: () => void checkFidelity(p) },
    outcome || f?.error ? 'Compare again' : 'Compare with code',
  );
  let lede: Child = COMPARE_LEDE;
  let content: Child = null;
  if (f?.running) {
    lede = h('span', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), f.running);
  }
  else if (f?.error) content = h('div', { class: 'callout warn' }, h('div', { class: 'callout-title' }, icon('alert'), 'Could not compare'), h('p', null, f.error));
  else if (outcome?.kind === 'no-references') {
    lede = NO_REFERENCES_HANDOFF_TEXT;
    content = h('div', { class: 'inline-actions' }, handoffButton(p, 'references', referencesRequestForDeveloper(state.init?.settings.repo ?? '')));
  }
  else if (outcome?.kind === 'no-sets') lede = 'No component set from code in this file yet. Pull components first.';
  else if (outcome?.kind === 'done') {
    // Every component compared matches the code: the Bridge mark lands next to the sentence, once.
    const allMatch = outcome.report.summary.differs === 0 && outcome.report.summary.matches > 0;
    lede = allMatch
      ? h('span', { class: 'all-match' }, moment(bridgeMark(), outcome.report), outcome.report.summary.matches === 1 ? 'It matches the code.' : `All ${outcome.report.summary.matches} match the code.`)
      : fidelitySummary(outcome.report);
    const order = { differs: 0, matches: 1, 'not-checked': 2 } as const;
    // Not compared: one folded line with each reason, after the rows a designer can act on (FID-2).
    const notCompared = outcome.items.filter((it) => it.result.status === 'not-checked');
    const rows = [...outcome.items]
      .filter((it) => it.result.status !== 'not-checked')
      .sort((a, b) => order[a.result.status] - order[b.result.status])
      .map((it) => {
        const r = it.result;
        const kind =
          r.status === 'differs' ? h('span', { class: 'kind removed row-end' }, 'Differs') : r.status === 'matches' ? h('span', { class: 'kind added row-end' }, 'Matches') : h('span', { class: 'kind row-end' }, 'Not compared');
        const others = r.variants.filter((v) => v.status !== 'matches');
        // Where the difference comes from, in one sentence (the gap case's summary): it replaces the pixel figures,
        // which stay one click away under the variants.
        const gap = r.status === 'differs' ? f?.gaps?.find((g) => g.component === it.name)?.summary : undefined;
        // Asked (now or before: the watch resumes), or Claude's fix found: the row shows that, not the button again.
        const claude = r.status === 'differs' ? claudePanel(it.name) : null;
        const asked = (f?.fix?.component === it.name && f.fix.status !== 'error' && f.fix.status !== 'connect') || !!claude;
        return h(
          'li',
          { class: 'row review' },
          h('div', { class: 'row-head' }, h('span', { class: 'comp-name' }, it.name), kind),
          gap ? h('p', null, gap) : h('p', { class: r.status === 'differs' ? '' : 'muted' }, r.status === 'differs' ? differsSentence(r) : fidelityComponentLine(r)),
          r.status === 'differs' && p.measure && !asked
            ? h('div', { class: 'inline-actions' }, h('button', { class: 'btn', 'data-focus-id': `fix-${it.name}`, disabled: f?.fix?.status === 'writing' || !!state.busy, onClick: () => void fixWithClaude(p, it.name) }, 'Ask Claude to fix it'))
            : null,
          // Claude cannot help without a measure of the stories: the designer still has one thing to do (no dead end).
          r.status === 'differs' && !p.measure
            ? h('div', { class: 'handoff' }, h('p', { class: 'muted' }, DIFFERS_HANDOFF_TEXT), h('div', { class: 'inline-actions' }, handoffButton(p, it.name, differsRequestForDeveloper(r, state.init?.settings.repo ?? '', fidelityVerdict))))
            : null,
          r.status === 'differs' ? fixPanel(p, it.name) : null,
          claude,
          // The three images on demand: the list stays a list to scan (FID-5).
          r.status === 'differs' && it.images
            ? h('details', { class: 'notes' }, h('summary', null, `See the most different: ${it.images.key}`), fidelityThumbs(it.name, it.images))
            : null,
          others.length && r.status !== 'not-checked'
            ? h(
                'details',
                { class: 'notes' },
                h('summary', null, [r.differing ? `${plural(r.differing, 'variant')} ${r.differing === 1 ? 'differs' : 'differ'}` : '', r.skipped ? `${r.skipped} not compared` : ''].filter(Boolean).join(', ')),
                h('ul', null, others.map((v) => h('li', null, `${v.key}: ${fidelityVerdict(v)}`))),
              )
            : null,
        );
      });
    // For developers triaging the differences: every component and variant as JSON, without the images.
    const report = outcome.report;
    content = [
      rowList('fidelity', rows, 10),
      notCompared.length
        ? h(
            'details',
            { class: 'notes' },
            h('summary', null, `${plural(notCompared.length, 'component')} not compared`),
            h('p', { class: 'muted' }, 'Nothing to fix in Figma for these: code has no image to compare them with yet.'),
            h('ul', null, notCompared.map((it) => h('li', null, `${it.name}: ${fidelityComponentLine(it.result)}`))),
          )
        : null,
      h(
        'details',
        { class: 'notes dev-details' },
        h('summary', null, 'Fidelity report, for developers'),
        h('p', { class: 'muted' }, 'Every component and variant as JSON: how many pixels differ, and both sizes.'),
        h('button', { class: 'btn', 'data-focus-id': 'fidelity-copy', onClick: () => void copyText(JSON.stringify(report, null, 2)).then((ok) => { f!.copied = ok; render(); }) }, icon(f?.copied ? 'check' : 'copy'), f?.copied ? 'Copied' : 'Copy the report'),
        f?.gaps?.length
          ? h(
              'button',
              { class: 'btn', 'data-focus-id': 'fidelity-copy-gaps', onClick: () => void copyText(JSON.stringify(f.gaps, null, 2)).then((ok) => { f!.gapsCopied = ok; render(); }) },
              icon(f.gapsCopied ? 'check' : 'copy'),
              f.gapsCopied ? 'Copied' : `Copy ${f.gaps.length === 1 ? 'the gap case' : 'the gap cases'}`,
            )
          : null,
      ),
    ];
  }
  return group('Compare with code', generated.length, action, lede, content);
}

/** The components not in Figma, each with its reason, and the layout helpers, folded under the count. */
/** "Interactions: N" for a set that has prototype interactions. */
function interactionsLabel(c: PlannedComponent | undefined): Child {
  return c?.interactions?.length ? h('span', { class: 'muted' }, `Interactions: ${c.interactions.length}`) : null;
}

/** The motion Figma plays differently or cannot play, per set, folded: hover, press and click are wired, the rest is listed. */
function motionDetails(plan: ComponentPullPlan): Child {
  const sets = plan.components.filter((c) => c.motionNotes?.length);
  if (!sets.length) return null;
  const wired = plan.components.filter((c) => c.interactions?.length).length;
  return h(
    'details',
    { class: 'notes candidates' },
    h('summary', { 'data-focus-id': 'motion-notes' }, `Motion: ${plural(wired, 'set')} with prototype interactions, ${plural(sets.length, 'set')} with motion Figma cannot play`),
    h(
      'ul',
      { class: 'rows' },
      sets.map((c) => h('li', { class: 'row' }, h('div', { class: 'row-head' }, h('span', { class: 'comp-name' }, c.name), interactionsLabel(c)), h('p', { class: 'muted' }, c.motionNotes!.join('. ')))),
    ),
    h('p', { class: 'muted' }, 'In code, reduced motion turns these animations off. Figma has no equivalent, so each set says it in its description.'),
  );
}

function coverageDetails(cov: CoverageView): Child {
  if (!cov.missing.length && !cov.layout.length && !cov.drafted.length) return null;
  const summary = cov.missing.length ? `${plural(cov.missing.length, 'component')} not in Figma yet` : cov.drafted.length ? `${plural(cov.drafted.length, 'component')} drafted with Claude, check ${cov.drafted.length === 1 ? 'it' : 'them'}` : 'Layout helpers';
  const rows = [...cov.missing, ...cov.drafted];
  return h(
    'details',
    { class: 'notes candidates' },
    h('summary', { 'data-focus-id': 'coverage-missing' }, summary),
    rows.length
      ? h('ul', { class: 'rows' }, rows.map((m) => h('li', { class: 'row' }, h('div', { class: 'row-head' }, h('span', { class: 'comp-name' }, m.name), h('span', { class: 'muted' }, m.reason)))))
      : null,
    cov.layout.length ? h('p', { class: 'muted' }, `${plural(cov.layout.length, 'layout helper')} with no Figma counterpart, use auto layout: ${cov.layout.join(', ')}.`) : null,
  );
}

/** "New brand detected" card: a Brand mode with no file in Git, offered as a new brand (opt-in). */
function newBrandCard(r: PushState, b: PushBrand): HTMLElement {
  const c = b.candidate;
  const plan = b.plan;
  const failing = plan?.contrast.failing ?? [];
  const errors = plan?.issues.filter((i) => i.level === 'error') ?? [];
  const id = `brand-${c.slug}`;
  const result = !plan
    ? null
    : errors.length
      ? h('p', { class: 'brand-result fail' }, icon('alert'), `${plural(errors.length, 'problem')} to fix: ${errors[0]!.message}`)
      : failing.length
        ? h(
            'div',
            { class: 'brand-result fail' },
            h('p', null, icon('alert'), `${plural(failing.length, 'pair')} fail${failing.length === 1 ? 's' : ''}`),
            h(
              'ul',
              null,
              failing.slice(0, 3).map((x) => h('li', null, `${x.fg.replace(/^color\./, '')} on ${x.bg.replace(/^color\./, '')}, ${/theme=([^,]+)/.exec(x.modes)?.[1] ?? ''}: ${x.ratio ?? 'n/a'}:1, needs ${x.min}:1`)),
            ),
          )
        : h('p', { class: 'brand-result ok' }, icon('check'), `All ${plan.contrast.checks} contrast checks pass`);
  return h(
    'section',
    { class: 'brand-card' },
    h('h2', null, `New brand detected: ${c.name}`),
    h('p', { class: 'lede' }, `Mode ${c.name} in the Brand collection has no brand file in Git.`),
    c.blocked
      ? h('p', { class: 'muted' }, c.blocked)
      : [
          h(
            'label',
            { class: 'check' },
            h('input', {
              type: 'checkbox',
              id,
              'data-focus-id': id,
              checked: b.included,
              onChange: (e: Event) => {
                if ((e.target as HTMLInputElement).checked) r.includeBrands.add(c.slug);
                else r.includeBrands.delete(c.slug);
                refreshProposals();
              },
            }),
            'Create it in this change',
          ),
          b.included && plan ? h('p', { class: 'muted' }, `Adds ${plan.files.filter((f) => f.action === 'create' && f.path.endsWith('.tokens.json')).map((f) => f.path.split('/').slice(-2).join('/')).join(', ')} and lists ${c.slug} in bridge.config.json. Tier 3: a design owner and a tech owner approve.`) : null,
          b.included ? result : null,
        ],
  );
}

// ---------------------------------------------------------------------------------------------
// Components: requests (GitHub issues), never a pull request from Figma

const kindName = (k: RequestKind) => REQUEST_KINDS.find((x) => x.value === k)?.label ?? 'Other';

function attachHint(): string {
  const f = state.push?.form;
  const sel = state.selection;
  if (f?.item) return sel ? `Attaches ${sel.name} if it is a variant of ${f.item.figmaName}, otherwise the whole component.` : `Nothing selected: attaches the whole component. Select a variant to attach only it.`;
  return sel ? `Attaches ${sel.name}.` : 'Select a layer in Figma to attach it.';
}

/** The coded component of the selected set Bridge built, for a manual request (REQ-3). */
const componentOfSelection = (coded: readonly string[]) => (state.selection?.generated ? componentOfSet(state.selection.generated.componentId, coded) : undefined);

function openForm(r: PushState, item: ComponentChangeItem | undefined): void {
  if (r.form) cancelMine(r.form.assist, false);
  const coded = r.components?.coded ?? [];
  const draft: RequestDraft = item
    ? { component: item.component, kind: item.kind, title: titleOf(r, item), summary: suggestSummary(item), line: lineOf(r, item), changes: item.changes, nodeId: item.nodeId, nodeName: item.figmaName }
    : { component: componentOfSelection(coded) ?? coded[0] ?? '', kind: 'visual', title: '', summary: '', changes: [], nodeId: state.selection?.nodeId, nodeName: state.selection?.name };
  r.form = { key: item?.nodeId ?? 'manual', item, draft, attach: item ? true : !!state.selection, titleSource: item && claudeTitle(r, item) ? 'claude' : 'draft', summarySource: 'draft', assist: {}, target: '' };
  // "Where it goes" lists the running explorations: load them even when nothing was sent to one yet.
  if (modeOf(r) !== 'suggest' && !r.explorations && !r.loadingExplorations) void loadExplorations(r);
  void request('selection', {}).then((sel) => {
    state.selection = sel;
    const f = r.form;
    const picked = f && !f.item && !f.componentPicked ? componentOfSelection(coded) : undefined;
    if (f && picked) f.draft.component = picked;
    render();
  });
  render();
}

/**
 * What code draws for this variant now: its image from the Figma references (Check fidelity reads the same ones), as a
 * GitHub link. Undefined when none is published for it; a request never waits on it.
 */
async function codeImageOf(g: { componentId: string; variant: string }): Promise<string | undefined> {
  const manifest = await loadReferenceManifest(getClient()).catch(() => undefined);
  const ref = manifest?.components[g.componentId]?.variants[g.variant];
  if (!ref || !('file' in ref)) return undefined;
  const { owner, name } = parseRepo(state.init!.settings.repo);
  return `https://github.com/${owner}/${name}/blob/${FIGMA_REFERENCES_BRANCH}/${FIGMA_REFERENCES_DIR}/${ref.file}?raw=true`;
}

function sendRequest(r: PushState): void {
  const f = r.form;
  if (!f) return;
  const d = f.draft;
  f.error = !d.component.trim() ? 'Pick the component this request is about.' : !d.title.trim() ? 'Add a title.' : !d.summary.trim() ? 'Add a summary: say what should change and why.' : undefined;
  if (f.error) {
    render();
    document.getElementById(d.summary.trim() ? 'req-title' : 'req-summary')?.focus();
    return;
  }
  void run(
    'Sending the request',
    async () => {
      const a = r.analysis;
      const images: string[] = [];
      if (f.attach) {
        const img = await request('export-image', { nodeId: f.item?.nodeId });
        if (img) images.push(img.base64);
      }
      // Manual requests point at the selection they attach, when there is one.
      const sel = !f.item && f.attach ? state.selection : null;
      const draft = sel ? { ...d, nodeId: sel.nodeId, nodeName: sel.name } : f.item ? d : { ...d, nodeId: undefined, nodeName: undefined };
      const coded = (r.components?.coded ?? []).includes(d.component.trim());
      // A variant Bridge built from code: its code image is the "before" next to the export (REQ-2).
      const before = images.length && sel?.generated ? await codeImageOf(sel.generated) : undefined;
      // Sent on its own while the destination is an exploration: the request is built there too.
      // Built in an exploration only when the designer picked it in the form; the push's destination never carries over.
      const exploration = f.target ? requestTargets(r).find((e) => e.branch === f.target) : undefined;
      const res = await sendComponentRequest(getClient(), {
        request: { ...toRequest(draft, { fileKey: r.fileKey }), ...(exploration ? { exploration: exploration.branch } : {}) },
        images,
        ...(before ? { before: [before] } : {}),
        baseBranch: state.init!.settings.branch,
        config: a.headFiles.config,
        coded,
        imagesNeedWrite: modeOf(r) === 'suggest',
      });
      if (res.imagesSkipped) state.error = { message: IMAGES_NEED_WRITE };
      r.sent.unshift({ component: d.component.trim(), number: res.issue.number, url: res.issue.url, what: 'request sent', target: 'request' });
      // Sent: the pending drafts file for the designer's Claude is done.
      cancelMine(f.assist, false);
      r.form = undefined;
      // The request is the new reference: the next scan compares against what was just asked for.
      if (f.item) {
        const done = f.item.nodeId;
        if (r.components) {
          r.components.changed = r.components.changed.filter((x) => x.nodeId !== done);
          r.components.candidates = r.components.candidates.filter((x) => x.nodeId !== done);
        }
        await request('rebaseline', { nodeId: done }).catch(() => undefined);
      }
      void request('notify', { message: `Request sent for ${d.component.trim()}` });
    },
    () => sendRequest(r),
  );
}

/** A value written as a sentence ("As in the baseline") reads in the text face; token and variant values in mono. */
const isProse = (v: string) => /^[A-Z][a-z]+ [a-z]+ /.test(v);

/** The detail of a change row: one font size, token and variant values in Plex Mono at that same size. */
/**
 * A change row's label with its variants the short way, the full names folded: "Padding in danger solid sm, info
 * solid sm" rather than twenty lines of "Appearance=solid, Size=sm, Tone=danger; ..." (UPD-3).
 */
function whatOf(field: string): Child {
  const m = /^(.*?) \((.*=.*)\)$/.exec(field);
  if (!m) return field;
  const list = m[2]!.split('; ');
  const short = shortVariants(m[2]!);
  if (list.length <= 2) return `${m[1]} in ${short}`;
  return h('details', { class: 'notes' }, h('summary', null, `${m[1]} in ${plural(list.length, 'variant')}`), h('p', { class: 'muted' }, short));
}

function changeTable(changes: { field: string; before?: string | undefined; after?: string | undefined }[], head: [string, string, string] = ['What', 'Now', 'Requested']): Child {
  if (!changes.length) return null;
  const val = (v: string, cls: string) => h('td', { class: `${cls}${isProse(v) ? '' : ' mono'}` }, ...(isProse(v) ? [v] : breakable(v)));
  return h(
    'table',
    { class: 'changes' },
    h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))),
    h('tbody', null, changes.map((c) => h('tr', null, h('td', { class: 'what' }, whatOf(c.field)), val(c.before || 'none', 'before'), val(c.after || 'removed', 'after')))),
  );
}

/** One concrete change of a component (a variant axis, a prop, a token binding) as label, before and after chips. */
interface ChipLine {
  label: string;
  where?: string | undefined;
  before: string[];
  after: string[];
}

/**
 * The concrete changes of a component row, the way variable rows show values: "Tone  primary, secondary -> + danger",
 * "Fill  color.bg.default -> color.bg.raised". Visual and structure changes have none: their sentence and the attached
 * image say it, and the full table goes into the GitHub issue.
 */
function chipLines(changes: { field: string; before?: string | undefined; after?: string | undefined }[]): ChipLine[] {
  const out: ChipLine[] = [];
  const list = (v: string | undefined) => (v ?? '').split(', ').map((x) => x.trim()).filter(Boolean);
  for (const c of changes) {
    let m: RegExpExecArray | null;
    if ((m = /^Variant (.+)$/.exec(c.field))) {
      const before = list(c.before);
      const after = list(c.after);
      const added = after.filter((x) => !before.includes(x)).map((x) => `+ ${x}`);
      const removed = before.filter((x) => !after.includes(x)).map((x) => `\u2212 ${x}`);
      out.push({ label: m[1]!, before: before.length ? [before.join(', ')] : [], after: before.length ? [...added, ...removed] : [after.join(', ')] });
    } else if (c.field === 'Variants') {
      const gone = (c.before ?? '').split('; ').filter(Boolean).map(shortVariant);
      const born = (c.after ?? '').split('; ').filter(Boolean).map(shortVariant);
      out.push({ label: 'Variants', before: gone, after: born.length ? born.map((x) => `+ ${x}`) : ['removed'] });
    } else if ((m = /^Prop (.+)$/.exec(c.field))) {
      out.push({ label: m[1]!, before: c.before ? [c.before] : [], after: c.after ? [c.after] : ['removed'] });
    } else if (/^(Look of |Swapped instance|New layer |Removed layer |Moved layer )/.test(c.field)) {
      continue;
    } else {
      m = /^(.*?)(?: \((.*)\))?$/.exec(c.field)!;
      out.push({ label: m[1]!, ...(m[2] ? { where: shortVariants(m[2]) } : {}), before: c.before ? [c.before] : [], after: [c.after || 'none'] });
    }
  }
  return out;
}

const CHIP_LINES = 4;

/**
 * The body of a component change row: one sentence of what changed (Claude's line, or the drafted one), an optional
 * note, then only for concrete changes a compact before and after with value chips. No table here: a change reads once.
 */
function changeSummary(line: string, changes: { field: string; before?: string | undefined; after?: string | undefined }[], note?: Child): Child[] {
  const chips = chipLines(changes);
  const chip = (text: string, dim: boolean) => h('span', { class: `value${dim ? ' before' : ''}` }, h('span', { class: 'value-name' }, text));
  return [
    line ? h('p', { class: 'row-line' }, line) : null,
    note ?? null,
    chips.length
      ? h(
          'div',
          { class: 'chip-lines' },
          chips.slice(0, CHIP_LINES).map((x) =>
            h(
              'div',
              { class: 'chip-line' },
              h('span', { class: 'mode-name' }, x.label, x.where ? h('small', null, ` ${x.where}`) : null),
              h('span', { class: 'change' }, x.before.map((b) => chip(b, true)), x.before.length && x.after.length ? icon('arrow') : null, x.after.map((a) => chip(a, false))),
            ),
          ),
          chips.length > CHIP_LINES ? h('small', { class: 'muted' }, `${plural(chips.length - CHIP_LINES, 'more change')} in the request`) : null,
        )
      : null,
  ];
}

/** Explorations a request can go into: the one just sent to and the one picked for the push first, then the others. */
function requestTargets(r: PushState): ExplorationChoice[] {
  if (modeOf(r) === 'suggest') return [];
  const out: ExplorationChoice[] = [];
  for (const e of [r.sentTo, pickedExploration(r), ...(r.explorations ?? [])]) if (e && !out.some((x) => x.branch === e.branch)) out.push(e);
  return out;
}

/** "Where it goes": to developers unless the designer picks an exploration here (never inherited from the last push). */
function requestDestination(r: PushState, f: RequestForm): Child {
  const targets = requestTargets(r);
  if (!targets.length) return null;
  return h(
    'label',
    { class: 'field' },
    h('span', null, 'Where it goes'),
    h(
      'select',
      { 'data-focus-id': 'req-target', onChange: (e: Event) => (f.target = (e.target as HTMLSelectElement).value) },
      h('option', { value: '', selected: !f.target }, 'To developers (a request they pick up)'),
      targets.map((e) => h('option', { value: e.branch, selected: f.target === e.branch }, `Into ${e.name} (exploration)`)),
    ),
  );
}

function requestFormView(r: PushState, f: RequestForm): HTMLElement {
  const d = f.draft;
  const coded = r.components?.coded ?? [];
  const manual = !f.item;
  return h(
    'div',
    { class: 'req-form', role: 'group', 'aria-label': 'Request' },
    manual
      ? h(
          'label',
          { class: 'field' },
          h('span', null, 'Component'),
          coded.length
            ? h(
                'select',
                {
                  'data-focus-id': 'req-component',
                  onChange: (e: Event) => {
                    d.component = (e.target as HTMLSelectElement).value;
                    f.componentPicked = true;
                  },
                },
                coded.map((c) => h('option', { value: c, selected: c === d.component }, c)),
              )
            : h('input', { type: 'text', value: d.component, placeholder: 'Button', onInput: (e: Event) => (d.component = (e.target as HTMLInputElement).value) }),
        )
      : null,
    h(
      'label',
      { class: 'field' },
      h('span', null, 'Kind'),
      h(
        'select',
        { 'data-focus-id': 'req-kind', onChange: (e: Event) => (d.kind = (e.target as HTMLSelectElement).value as RequestKind) },
        REQUEST_KINDS.filter((k) => manual ? k.value !== 'new-component' : true).map((k) => h('option', { value: k.value, selected: k.value === d.kind }, k.label)),
      ),
      h('small', null, REQUEST_KINDS.find((k) => k.value === d.kind)?.hint ?? ''),
    ),
    h(
      'div',
      { class: 'field' },
      // "Draft with Claude" fills the title and the summary: it sits on the label line of the first of the two.
      fieldHead('req-title', 'Title', assistAction(f.assist, requestAssist(f))),
      // Why the drafting help is unavailable, right under it (ASSIST-7), not under the summary.
      assistWhy(f.assist, requestAssist(f)),
      h('input', {
        type: 'text',
        id: 'req-title',
        'data-focus-id': 'req-title',
        value: d.title,
        maxlength: '100',
        placeholder: 'Add a danger ghost variant',
        onInput: (e: Event) => {
          d.title = (e.target as HTMLInputElement).value;
          f.titleSource = 'user';
          noteEdit(f.assist, 'title');
          if (f.summarySource !== 'claude') clearDrafted('req-drafted');
          refreshRequestAssist();
        },
      }),
    ),
    h(
      'div',
      { class: 'field' },
      fieldHead('req-summary', 'Summary', null),
      h(
        'textarea',
        {
          id: 'req-summary',
          'data-focus-id': 'req-summary',
          rows: '3',
          required: true,
          'aria-invalid': f.error && !d.summary.trim() ? 'true' : undefined,
          placeholder: manual ? 'What should change, and why. The diff cannot see this one, so be specific.' : 'Why this change, and where it is used',
          onInput: (e: Event) => {
            d.summary = (e.target as HTMLTextAreaElement).value;
            f.summarySource = 'user';
            noteEdit(f.assist, 'summary');
            if (f.titleSource !== 'claude') clearDrafted('req-drafted');
            refreshRequestAssist();
          },
        },
        d.summary,
      ),
      // One status line for the pair, under the last field Claude fills.
      draftedNote('req-drafted', f.titleSource === 'claude' || f.summarySource === 'claude' ? 'claude' : 'user'),
    ),
    assistStatus(f.assist, requestAssist(f)),
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        id: 'attach-box',
        checked: f.attach,
        disabled: manual && !state.selection,
        onChange: (e: Event) => {
          f.attach = (e.target as HTMLInputElement).checked;
          refreshRequestAssist();
        },
      }),
      manual ? 'Attach the current selection' : 'Attach the selected variant',
    ),
    h('small', { id: 'attach-hint', class: 'attach-hint' }, attachHint()),
    f.error ? h('p', { class: 'form-error', role: 'alert' }, icon('alert'), f.error) : null,
    requestDestination(r, f),
    h(
      'div',
      { class: 'inline-actions' },
      h('button', { class: 'btn primary', disabled: !!state.busy, onClick: () => sendRequest(r) }, modeOf(r) === 'suggest' ? sendLabel('suggest') : f.target ? 'Send to the exploration' : 'Send to developers'),
      h('button', { class: 'btn ghost', onClick: () => { cancelMine(f.assist, false); r.form = undefined; render(); } }, 'Cancel'),
    ),
  );
}

/**
^ * "Icon end already does this: turn on Show icon end": an optional part of the component already draws
 * what was added. Neutral, on the row it is about; the item starts unchecked and "Keep it as a request" checks it.
 * Bridge never changes the designer's file for it.
 */
function equivalentHint(r: PushState, item: ComponentChangeItem): Child {
  if (!item.equivalent) return null;
  const key = componentKey(item.nodeId);
  const checked = isChecked(r.unchecked, { key });
  return h(
    'div',
    { class: 'row-hint', role: 'note' },
    icon('info'),
    h('span', null, item.equivalent),
    checked
      ? null
      : h('button', { class: 'btn ghost', 'data-focus-id': `keep-${item.nodeId}`, onClick: () => { r.unchecked.delete(key); refreshProposals(); } }, 'Keep it as a request'),
  );
}

function componentRow(r: PushState, item: ComponentChangeItem, action: string, edge?: { lead?: Child; tail?: Child }): HTMLElement {
  const open = r.form?.key === item.nodeId;
  return h(
    'li',
    { class: 'row' },
    // Title row: what (the component) and the kind of change; then one sentence; the detail on demand.
    h(
      'div',
      { class: 'row-head' },
      edge?.lead,
      h('span', { class: 'comp-name' }, item.component),
      item.figmaName !== item.component ? h('span', { class: 'muted' }, item.figmaName) : null,
      // Once routed, the route tag (or the Fix in Figma first group) says where it goes: no second kind tag that can
      // disagree with it, like "Token change" on a change that needs code (PUSH-1).
      routed(r) && pushOf(r, item.nodeId) ? null : h('span', { class: `kind ${item.kind === 'new-component' ? 'added' : ''}` }, kindName(item.kind)),
      routeTag(r, item),
      // The row's own send is a quiet ghost button: the bar keeps the one primary action of the screen.
      edge ? edge.tail : open ? null : h('button', { class: 'btn ghost row-action', 'data-focus-id': `req-${item.nodeId}`, 'aria-label': `${sendsToBranch(r, item) ? sendLabel(modeOf(r)) : action}: ${item.component}`, onClick: () => (sendsToBranch(r, item) ? sendCandidate(r, item) : openForm(r, item)) }, sendsToBranch(r, item) ? sendLabel(modeOf(r)) : action),
    ),
    changeSummary(lineOf(r, item), item.changes, equivalentHint(r, item)),
    routeNote(r, item),
    open ? requestFormView(r, r.form!) : null,
  );
}

/** For review, component changes go to a library branch (component-push.ts); to an exploration, they stay requests. */
const routed = (r: PushState) => r.destination === 'review';

/** A new component drawn in Figma, sent for review: its library branch carries the spec, a developer builds it with Claude. */
const sendsToBranch = (r: PushState, item: ComponentChangeItem) => routed(r) && item.kind === 'new-component' && pushOf(r, item.nodeId)?.plan.route === 'claude-draft';

/** "Exact token change", "A developer builds it" or "Fix in Figma": where the change goes, in a neutral tag. */
function routeTag(r: PushState, item: ComponentChangeItem): Child {
  const p = pushOf(r, item.nodeId);
  // Under "Fix in Figma first" the group title says where it stands.
  // A new component's own send action says where it goes.
  if (!p || !routed(r) || (p.plan.route === 'manual' && !p.blocked) || sendsToBranch(r, item)) return null;
  return h('span', { class: 'tag', title: p.plan.said }, p.blocked ? 'Held back' : ROUTE_TAG[p.plan.route]);
}

/** Under a component row: the one sentence of what sending does, and what Bridge cannot read, each with what to do. */
function routeNote(r: PushState, item: ComponentChangeItem): Child {
  const p = pushOf(r, item.nodeId);
  if (!p || !routed(r)) return null;
  const issues = p.plan.issues;
  return [
    p.plan.route === 'manual' && !p.blocked ? null : h('p', { class: 'muted route-note' }, p.blocked ?? librarySaid(r, p)),
    issues.length ? h('ul', { class: 'route-issues' }, issues.map((i) => h('li', null, ...rawSwatches(i), h('span', null, i.what), ' ', h('span', { class: 'muted' }, i.todo), rawBind(r, item, i)))) : null,
  ];
}

/** The colors set by hand, as swatches before the sentence that names them. */
const rawSwatches = (i: PushIssue): Child[] =>
  (i.raw?.values ?? []).filter((v) => v.value.startsWith('#')).map((v) => h('span', { class: 'swatch inline', title: v.value }, h('span', { style: { background: v.value } })));

/** One click binds the variable that already holds the value set by hand (the first of each value), then scans again. */
function rawBind(r: PushState, item: ComponentChangeItem, i: PushIssue): Child {
  const raw = i.raw;
  const offers = raw?.values.flatMap((v) => (v.matches?.[0] ? [{ value: v.value, variable: v.matches[0] }] : [])) ?? [];
  if (!raw || !offers.length) return null;
  return h(
    'div',
    { class: 'inline-actions' },
    offers.map((o) =>
      h(
        'button',
        {
          class: 'btn',
          disabled: !!state.busy,
          onClick: () =>
            // The scan runs once the bind is done: run() takes one task at a time.
            void run(`Binding ${o.variable}`, async () => {
              const { bound } = await request('bind-raw', { nodeId: item.nodeId, variants: raw.variants, kind: raw.kind, value: o.value, variable: o.variable });
              if (!bound) throw new Error(`Nothing was bound: ${o.variable} or the ${raw.kind} of ${o.value} is gone. Scan again.`);
            }).then(() => {
              if (!state.error) scanPush(r);
            }),
        },
        `Bind to ${o.variable}`,
      ),
    ),
  );
}

/**
 * Where a component change goes, for a push to the library (docs/BUILD-REQUESTS.md): an exact token swap ships once the
 * checks pass, code needed becomes a build request. Suggest mode keeps core's sentence (the DS lead decides first).
 */
function librarySaid(r: PushState, p: ComponentPush): string {
  if (modeOf(r) === 'suggest') return p.plan.said;
  if (p.plan.route === 'token-change') {
    const n = p.plan.edits.length;
    return `Exact, no AI: ${n === 1 ? `${p.plan.edits[0]!.path} points` : `${n} tokens point`} to the new variable${n === 1 ? '' : 's'}. Checked for contrast, then it ships once the checks pass.`;
  }
  if (p.plan.route === 'claude-draft') return 'Developers get a build request with its spec, build it, then it ships.';
  return p.plan.said;
}

/** After a library branch opens: the set remembers it (pull rebuilds it once it ships), its new baseline, a status line. */
async function afterBranch(r: PushState, x: SentComponentPush): Promise<void> {
  // Needs code: nothing builds it on its own, the line offers the message for a developer.
  const build = x.route === 'claude-draft' ? { component: x.component, number: x.number, url: x.url, suggested: x.suggested } : undefined;
  if (x.suggested) {
    // A suggestion has no library branch to follow yet: only the new baseline and the "sent" line.
    await request('rebaseline', { nodeId: x.nodeId }).catch(() => undefined);
    r.sent.unshift({ component: x.component, number: x.number, url: x.url, what: 'suggestion sent', target: 'suggestion', build });
    return;
  }
  await request('mark-pushed', { nodeId: x.nodeId, mark: JSON.stringify({ number: x.number, url: x.url, route: x.route, at: new Date().toISOString() }) }).catch(() => undefined);
  await request('rebaseline', { nodeId: x.nodeId }).catch(() => undefined);
  r.sent.unshift({ component: x.component, number: x.number, url: x.url, what: x.route === 'token-change' ? 'exact token change sent to the library' : 'build request sent to developers', target: 'pr', build });
}

/** The row send on a new component: its library branch with the spec and a screenshot, for a developer to build with Claude. */
function sendCandidate(r: PushState, item: ComponentChangeItem): void {
  const push = pushOf(r, item.nodeId);
  if (!push) return;
  void run(
    `Sending ${item.component}`,
    async () => {
      const draft: RequestDraft = { component: item.component, kind: item.kind, title: titleOf(r, item), summary: r.descriptionSource === 'user' && r.description.trim() ? r.description : suggestSummary(item), line: lineOf(r, item), changes: item.changes, nodeId: item.nodeId, nodeName: item.figmaName };
      const x = await sendComponentPush(getClient(), { analysis: r.analysis, fileKey: r.fileKey, mode: modeOf(r), image: async (nodeId) => (await request('export-image', { nodeId }).catch(() => null))?.base64 }, push, draft);
      await afterBranch(r, x);
      if (r.components) r.components.candidates = r.components.candidates.filter((c) => c.nodeId !== item.nodeId);
      if (x.imagesSkipped) state.error = { message: IMAGES_NEED_WRITE };
      void request('notify', { message: x.suggested ? 'Suggestion sent to your DS lead' : `${item.component} sent for review: a developer builds it with Claude` });
    },
    () => sendCandidate(r, item),
  );
}

// ---------------------------------------------------------------------------------------------
// Push: the Changes list, like Figma's Publish library dialog

const itemOf = (r: PushState, key: string) => r.items.find((i) => i.key === key);

/** The checkbox at the start of a change row: checked items are sent, unchecked ones stay in Figma. */
function selectBox(r: PushState, item: PublishItem | undefined, name: string): Child {
  if (!item) return null;
  return h('input', {
    type: 'checkbox',
    class: 'select',
    'data-focus-id': `sel-${item.key}`,
    'aria-label': `Include ${name}`,
    checked: isChecked(r.unchecked, item),
    onChange: (e: Event) => {
      if ((e.target as HTMLInputElement).checked) r.unchecked.delete(item.key);
      else r.unchecked.add(item.key);
      refreshProposals();
    },
  });
}

/**
 * Neutral tag plus the row menu. "Exploration only" (the experimental mark, like Figma's "Hide when publishing") is a
 * checkable item with one line that says what it does; "Edit the request" opens the request form of a component.
 */
function rowTail(r: PushState, item: PublishItem | undefined, name: string, extra: { label: string; onClick: () => void }[] = []): Child {
  if (!item) return null;
  const close = (e: Event) => (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  return [
    item.experimental ? h('span', { class: 'tag', title: 'Never sent for review. Goes to explorations only.' }, 'Exploration only') : null,
    h(
      'details',
      {
        class: 'row-menu',
        // Opening moves focus into the menu; arrows, Home and End move in it; Escape closes it back on its button.
        onToggle: (e: Event) => {
          const d = e.currentTarget as HTMLDetailsElement;
          if (d.open) focusFirstItem(d.querySelector('[role="menu"]'));
        },
        onKeyDown: (e: KeyboardEvent) => {
          const d = e.currentTarget as HTMLDetailsElement;
          if (!d.open) return;
          menuKeys(() => {
            d.removeAttribute('open');
            d.querySelector<HTMLElement>('summary')?.focus();
          })(e);
        },
      },
      h('summary', { class: 'btn ghost icon-only', 'data-focus-id': `menu-${item.key}`, 'aria-label': `More actions for ${name}`, 'aria-haspopup': 'menu', title: 'More actions' }, icon('more')),
      h(
        'div',
        { class: 'menu', role: 'menu' },
        h(
          'button',
          { class: 'menu-item two-line', role: 'menuitemcheckbox', 'aria-checked': item.experimental ? 'true' : 'false', onClick: (e: Event) => { close(e); markExperimental(r, item, !item.experimental); } },
          h('span', { class: 'menu-check', 'aria-hidden': 'true' }, item.experimental ? icon('check') : null),
          h('span', { class: 'menu-text' }, h('span', null, 'Exploration only'), h('small', null, 'Never sent for review. Goes to explorations only.')),
        ),
        extra.map((x) => h('button', { class: 'menu-item', role: 'menuitem', onClick: (e: Event) => { close(e); x.onClick(); } }, h('span', { class: 'menu-check', 'aria-hidden': 'true' }), x.label)),
      ),
    ),
  ];
}

/** One group of the Changes list: a select-all checkbox with the group name and count, one sentence, the rows. */
function changeGroup(r: PushState, kind: 'variable' | 'component', title: string, lede: string, rows: HTMLElement[], key: string): Child {
  const st = groupState(r.items, r.unchecked, kind);
  if (st === 'empty') return null;
  const n = r.items.filter((i) => i.kind === kind).length;
  const on = r.items.filter((i) => i.kind === kind && isChecked(r.unchecked, i)).length;
  const box = h('input', {
    type: 'checkbox',
    'data-focus-id': `all-${kind}`,
    checked: st === 'all',
    onChange: (e: Event) => {
      setGroup(r.items, r.unchecked, kind, (e.target as HTMLInputElement).checked);
      refreshProposals();
    },
  }) as HTMLInputElement;
  box.indeterminate = st === 'some';
  const heading = h('h2', null, title, h('span', { class: 'group-n' }, on === n ? String(n) : `${on} of ${n}`));
  return h(
    'section',
    { class: 'group' },
    // "Select all" only means something from 2 items: a lone item keeps its own checkbox, the group shows none.
    h('div', { class: 'group-head' }, n > 1 ? h('label', { class: 'check group-check' }, box, heading) : heading),
    h('p', { class: 'lede' }, lede),
    rowList(key, rows, kind === 'component' ? 20 : PAGE),
  );
}

/**
 * What the designer can do about a contrast blocker, next to it: see the edit that causes it, or leave it out of this
 * send (the others still go). The edits are the checked variable edits that move a failing pair.
 */
function contrastActions(r: PushState): Child {
  const after = r.proposal.validation.contrastAfter;
  const before = r.proposal.validation.contrastBefore;
  const causes = r.analysis.diff.local.filter((e) => {
    const item = itemOf(r, variableKey(e.id));
    return item && isChecked(r.unchecked, item) && affectedContrast({ current: e.head, target: e.figma }, before, after).some((x) => x.after?.level === 'fail');
  });
  if (!causes.length) return null;
  const keys = causes.map((e) => variableKey(e.id));
  const one = causes.length === 1;
  return [
    h('button', {
      class: 'btn',
      'data-focus-id': 'contrast-show',
      onClick: () => {
        const row = document.querySelector<HTMLElement>(`[data-row-key="${keys[0]}"]`);
        row?.scrollIntoView({ block: 'center' });
        row?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
      },
    }, one ? 'Show the edit' : `Show the ${causes.length} edits`),
    h('button', {
      class: 'btn ghost',
      'data-focus-id': 'contrast-leave-out',
      onClick: () => {
        keys.forEach((k) => r.unchecked.add(k));
        refreshProposals();
      },
    }, one ? 'Leave it out of this send' : 'Leave them out of this send'),
  ];
}

function variablesGroup(r: PushState): Child {
  const a = r.analysis;
  const fi = figmaIndex(a);
  const rows = a.diff.local.map((e) => {
    const item = itemOf(r, variableKey(e.id));
    const name = (e.figma ?? e.head ?? e.base)?.path ?? e.path;
    // Contrast is said in one place, the blocker (or the folded pairs): never again as chips under the row.
    const row = diffRow(a, e.local!.kind, { before: e.head ?? e.base, after: e.figma, beforeIndex: a.head.byPath, afterIndex: fi }, null, {
      lead: selectBox(r, item, name),
      tail: rowTail(r, item, name),
    });
    if (item) row.setAttribute('data-row-key', item.key);
    return row;
  });
  if (!rows.length) return null;
  const lede = r.destination === 'exploration' ? 'Checked edits go into the exploration. Unchecked ones stay in Figma.' : modeOf(r) === 'suggest' ? 'Checked edits go together for review. Unchecked ones stay in Figma for later.' : 'Checked edits go to the library together. Unchecked ones stay in Figma for later.';
  return changeGroup(r, 'variable', 'Variables', lede, rows, 'push-local');
}

function componentChangesGroup(r: PushState): Child {
  const changed = sendableChanged(r);
  if (!changed.length) return null;
  const rows = changed.map((item) => {
    const pi = itemOf(r, componentKey(item.nodeId));
    return componentRow(r, item, '', {
      lead: selectBox(r, pi, item.component),
      tail: r.form?.key === item.nodeId ? null : rowTail(r, pi, item.component, [{ label: routed(r) ? 'Send as a request instead' : 'Edit the request', onClick: () => openForm(r, item) }]),
    });
  });
  // Suggest mode: nothing ships before the DS lead approves (SUG-3).
  const lede = !routed(r)
    ? 'Exact token changes go into the exploration. The others wait for code: a developer builds them there with Claude.'
    : modeOf(r) === 'suggest'
      ? 'Each change goes to your DS lead as a suggestion. Once approved, a developer applies the token swaps and builds what needs code.'
      : 'Token swaps ship as exact token changes once the checks pass. New variants, properties and layers go to developers as a build request with their spec.';
  return changeGroup(r, 'component', 'Components', lede, rows, 'push-components');
}

/** Changes Bridge cannot send as they are: each says what to do in Figma. Never sent, never dropped. */
function fixInFigmaGroup(r: PushState): Child {
  const held = (r.components?.changed ?? []).filter((c) => !sendable(r.pushes, c));
  if (!held.length) return null;
  return h(
    'section',
    { class: 'group' },
    h('div', { class: 'group-head' }, h('h2', null, 'Fix in Figma first', h('span', { class: 'group-n' }, String(held.length)))),
    h('p', { class: 'lede' }, 'Bridge cannot send these as they are. Each one says what to do, then scan again.'),
    h(
      'ul',
      { class: 'rows' },
      held.map((item) => componentRow(r, item, 'Send as a request instead', { tail: r.form?.key === item.nodeId ? null : h('button', { class: 'btn ghost row-action', 'data-focus-id': `req-${item.nodeId}`, onClick: () => openForm(r, item) }, 'Send as a request instead') })),
    ),
  );
}

/** What the component scan says besides the changes: read errors, Figma-only changes, components not in code yet. */
function componentNotes(r: PushState): Child[] {
  const scan = r.components;
  const candidates = scan?.candidates ?? [];
  const out: Child[] = [];
  if (r.componentsError) out.push(componentsErrorCallout(r.componentsError));
  if (scan?.figmaOnly.length) out.push(h('p', { class: 'muted' }, `Layers or auto layout changed in ${scan.figmaOnly.join(', ')}, with the same props, variants, tokens and look. That stays in Figma.`));
  if (scan?.explained.length) out.push(h('p', { class: 'muted' }, `${scan.explained.join(', ')} look${scan.explained.length === 1 ? 's' : ''} different because of variable edits. Those go with the variables, not in a request.`));
  if (candidates.length) {
    out.push(
      h(
        'details',
        { class: 'notes candidates', open: candidates.some((c) => r.form?.key === c.nodeId) },
        h('summary', null, `Not in the design system yet (${candidates.length})`),
        h('p', { class: 'muted' }, `Components in this file with no folder in ${scan?.coded.length ? 'the code' : 'code'}. Nothing is sent unless you ask for it.${routed(r) ? ' Sent for review, a developer builds each one from what you send.' : ''}`),
        h('ul', { class: 'rows' }, candidates.map((item) => componentRow(r, item, 'Request as new component'))),
      ),
    );
  }
  return out;
}

/** Sent from this screen, one status line each: "See it in Studio" first, GitHub behind it, and the developer message. */
function sentNotes(r: PushState): Child[] {
  const repo = state.init!.settings.repo;
  return r.sent.map((s) => {
    const studio = studioChangeUrl(repo, s.target, s.number);
    return h(
      'div',
      { class: 'callout ok', role: 'status' },
      h('div', { class: 'callout-title' }, icon('check'), `${s.component}: ${s.what}`),
      h(
        'div',
        { class: 'inline-actions' },
        studio ? h('button', { class: 'btn', onClick: () => void request('open-url', { url: studio }) }, icon('external'), 'See it in Studio') : null,
        h('button', { class: 'btn ghost', onClick: () => void request('open-url', { url: s.url }) }, 'Open on GitHub'),
        s.build
          ? h('button', { class: 'btn ghost', onClick: () => void copyText(developerMessage(repo, [s.build!])).then((ok) => { s.copied = ok; render(); }) }, icon(s.copied ? 'check' : 'copy'), s.copied ? 'Message copied' : 'Copy message for a developer')
          : null,
      ),
    );
  });
}

/**
 * The quiet way to a request the scan cannot see, at the very bottom: muted text and one link action (secondary,
 * figure and ground). Once opened, the manual request form takes its place in its own region, with its own primary.
 */
function requestLine(r: PushState | undefined): HTMLElement {
  if (r?.form?.key === 'manual') {
    return h(
      'section',
      { class: 'manual-request', 'aria-label': 'Request a component change' },
      h('h2', null, 'Request a component change'),
      h('p', { class: 'lede' }, 'For what the scan cannot see: behavior, a bug, an idea.'),
      requestFormView(r, r.form),
    );
  }
  return h(
    'p',
    { class: 'request-line' },
    h('span', { class: 'muted' }, 'Something the scan cannot see?'),
    ' ',
    h('button', { class: 'link', 'data-focus-id': 'req-manual', onClick: () => (r ? openForm(r, undefined) : scanPush(undefined, () => state.push && openForm(state.push, undefined))) }, 'Request a component change'),
  );
}

/**
 * Where the push goes, the main decision at the top of the Changes: a segmented control, one line under the chosen
 * option, and for an exploration which one (or a new one). No branch or pull request words: designers pick a place.
 */
function destinationControl(r: PushState): HTMLElement {
  const option = (d: Destination, label: string) =>
    h(
      'label',
      { class: `segment${r.destination === d ? ' selected' : ''}` },
      h('input', { type: 'radio', name: 'destination', value: d, 'data-focus-id': `dest-${d}`, checked: r.destination === d, onChange: () => setDestination(r, d) }),
      h('span', null, label),
    );
  const exploring = r.destination === 'exploration';
  const list = r.explorations ?? [];
  const picked = pickedExploration(r);
  return h(
    'section',
    { class: 'destination' },
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Where your changes go' }, option('review', 'To the library'), option('exploration', 'Try in an exploration')),
    h('p', { class: 'muted' }, exploring ? 'Try it in its previews, and see before and after in Studio. It never reaches the product as is.' : 'Token values ship once the checks pass. Renames, removals and what needs code go to developers.'),
    exploring
      ? h(
          'div',
          { class: 'destination-fields' },
          h(
            'label',
            { class: 'field' },
            h('span', null, 'Exploration'),
            h(
              'select',
              {
                'data-focus-id': 'explore-target',
                disabled: !!r.loadingExplorations,
                onChange: (e: Event) => {
                  r.exploreTarget = (e.target as HTMLSelectElement).value;
                  render();
                },
              },
              r.loadingExplorations ? h('option', { value: '' }, 'Loading explorations') : null,
              list.map((x) => h('option', { value: x.branch, selected: r.exploreTarget === x.branch }, x.name)),
              h('option', { value: 'new', selected: r.exploreTarget === 'new' }, 'New exploration'),
            ),
            r.explorationsError ? h('small', { class: 'form-error' }, `Could not list the explorations: ${r.explorationsError}`) : picked?.purpose ? h('small', null, picked.purpose) : null,
          ),
          r.exploreTarget === 'new'
            ? [
                h(
                  'label',
                  { class: 'field' },
                  h('span', null, 'Name'),
                  h('input', { type: 'text', 'data-focus-id': 'explore-name', value: r.newExploration.name, maxlength: '60', placeholder: 'Pill buttons', onInput: (e: Event) => { r.newExploration.name = (e.target as HTMLInputElement).value; refreshBar(); } }),
                ),
                h(
                  'label',
                  { class: 'field' },
                  h('span', null, 'What do you want to learn?'),
                  h('input', { type: 'text', 'data-focus-id': 'explore-purpose', value: r.newExploration.purpose, placeholder: 'Do rounder buttons feel friendlier in checkout?', onInput: (e: Event) => { r.newExploration.purpose = (e.target as HTMLInputElement).value; refreshBar(); } }),
                ),
              ]
            : null,
        )
      : null,
  );
}

/** Re-renders the bar only (typing in a field must not rebuild the screen under the caret). */
function refreshBar(): void {
  const view = state.tab === 'push' ? viewPush() : undefined;
  const bar = document.querySelector('.bar');
  const next = actionBar(view?.bar) as HTMLElement | null;
  if (bar && next) bar.replaceWith(next);
}

/** True while the exploration result screen of this push is on screen. */
const tryItOpen = (r: PushState) => state.tab === 'push' && state.push === r && !!r.result && !!r.sentTo;

/**
 * Starts reading the exploration's test build: the command from the preview comment the workflow posts (never a
 * guessed one) and the preview URLs Vercel reports. One read now, then every 15 seconds for up to 10 minutes while
 * the result screen is open, until everything is ready. Each read updates the screen in place.
 */
function startTryItPolling(r: PushState): void {
  const e = r.sentTo;
  if (!e) return;
  r.tryItPoller?.stop();
  r.tryItTimedOut = false;
  const poller = new TestBuildPoller({
    read: () => explorationTestBuild(getClient(), r.analysis.headFiles.config, e),
    isOpen: () => tryItOpen(r),
    onUpdate: (t) => {
      if (state.push !== r) return poller.stop();
      r.tryIt = t.tryIt;
      r.previews = t.previews;
      r.tryItError = undefined;
      refreshTryIt(r);
    },
    onError: (message, err) => {
      if (state.push !== r) return poller.stop();
      if (noteTokenProblem(err)?.kind === 'rejected') {
        poller.stop();
        render();
        return;
      }
      r.tryItError = message;
      refreshTryIt(r);
    },
    onTimeout: () => {
      r.tryItTimedOut = true;
      refreshTryIt(r);
    },
  });
  r.tryItPoller = poller;
  poller.start();
  void checkTryIt(r);
}

/** "Check again": one read now, and polling starts over (another 10 minutes) when something is still building. */
async function checkTryIt(r: PushState): Promise<void> {
  const poller = r.tryItPoller;
  if (!r.sentTo || !poller || r.checkingTryIt) return;
  r.checkingTryIt = true;
  r.tryItTimedOut = false;
  if (!poller.active) poller.start();
  refreshTryIt(r);
  const settled = await poller.check();
  r.checkingTryIt = false;
  if (settled) poller.stop();
  refreshTryIt(r);
}

/**
 * Updates the result screen in place: only the regions whose content changed (`data-region`, `data-sig`) are
 * replaced, so nothing flickers, an open "Show the command" stays open and keyboard focus stays where it was.
 */
function refreshTryIt(r: PushState): void {
  if (!tryItOpen(r)) return;
  const main = document.querySelector('main');
  const view = viewPush();
  const next = h('div', null, view.body);
  const fresh = [...next.querySelectorAll<HTMLElement>('[data-region]')];
  const old = main ? [...main.querySelectorAll<HTMLElement>('[data-region]')] : [];
  // A region appeared or went away: the layout changed, render once.
  if (!main || fresh.length !== old.length || fresh.some((el, i) => el.dataset.region !== old[i]!.dataset.region)) return render();
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.matches?.(':focus-visible') ? active.dataset?.focusId : undefined;
  fresh.forEach((el, i) => {
    const cur = old[i]!;
    if (cur.dataset.sig === el.dataset.sig) return;
    const wasOpen = cur.querySelector('details')?.open ?? (cur instanceof HTMLDetailsElement && cur.open);
    cur.replaceWith(el);
    const details = el instanceof HTMLDetailsElement ? el : el.querySelector('details');
    if (wasOpen && details) details.open = true;
  });
  const bar = document.querySelector('.bar');
  const nextBar = actionBar(view.bar) as HTMLElement | null;
  if (bar && nextBar && bar.outerHTML !== nextBar.outerHTML) bar.replaceWith(nextBar);
  if (focusId && document.activeElement !== document.querySelector(`[data-focus-id="${focusId}"]`)) (document.querySelector(`[data-focus-id="${focusId}"]`) as HTMLElement | null)?.focus();
}

/** The hint under a preview: what it shows, or where its build stands. */
function linkHint(l: { hint: string; url: string | null; state: string }): string {
  // A build that failed before it had a URL (a rate limit) would otherwise wait forever.
  if (l.state === 'failed') return l.url ? 'This deploy failed, the change in Studio says why' : 'This preview did not build. The change in Studio says why';
  if (!l.url) return 'Link not ready yet';
  if (l.state === 'building') return 'Rebuilding with your edits';
  return l.hint;
}

/**
 * Result of a push to an exploration, for designers: what was sent (the zone), where to try it (previews, the product
 * first, with the URLs Vercel reports), and one way to hand it to a developer (a ready message with the command that
 * works). The command itself stays collapsed.
 */
function explorationResult(r: PushState, e: ExplorationChoice, res: PublishResult): Child[] {
  const vars = res.pr && !res.exploration?.unchanged ? plural(r.proposal.changes.length || 1, 'variable edit') : '';
  const text = [
    vars ? `${vars} added to the exploration.` : res.exploration?.unchanged ? 'The exploration already had these variable edits.' : '',
    res.explorationTokens?.length ? `${plural(res.explorationTokens.length, 'token change')} ${res.explorationTokens.length === 1 ? 'is' : 'are'} in it.` : '',
    res.requests.length ? `${plural(res.requests.length, 'change')} ${res.requests.length === 1 ? 'waits' : 'wait'} for code: a developer builds ${res.requests.length === 1 ? 'it' : 'them'} with Claude, then ${res.requests.length === 1 ? 'it shows' : 'they show'} in Studio.` : '',
    'It never reaches the product as is.',
  ].filter(Boolean);
  const links = tryItLinks(e, r.previews);
  const t = r.tryIt;
  const polling = !!r.tryItPoller?.active;
  const statusText = r.checkingTryIt && !t
    ? null
    : r.tryItError
      ? `Could not check the test build: ${r.tryItError}`
      : !t || t.state === 'building'
        ? r.tryItTimedOut
          ? 'Still being prepared after 10 minutes.'
          : polling
            ? 'The test build is being prepared, a few minutes. Checking every 15 seconds.'
            : 'The test build is being prepared, a few minutes.'
        : t.state === 'failed'
          ? 'The test build did not finish. The change in Studio says why.'
          : null;
  const status = statusText === null && r.checkingTryIt && !t
    ? h('p', { class: 'row-hint', 'data-region': 'tryit-status', 'data-sig': 'checking' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, 'Checking the test build'))
    : statusText !== null
      ? statusLine(statusText, r)
      : h('p', { class: 'lede', 'data-region': 'tryit-status', 'data-sig': 'ready' }, 'A developer installs it in a staging version of your product. The message has the command, the previews and the link.');
  // Nothing online reported: explorations are not deployed, a developer opens it on their machine (Share with a developer).
  // Vercel reports a deploy within a minute or two, the test build takes a few: "no preview" only once that one settled.
  const local = triedLocally(r.previews) && (!!r.tryItTimedOut || (!!t && t.state !== 'building'));
  const linksSig = JSON.stringify([local, links.map((l) => [l.app, l.url, l.state])]);
  return [
    intro({ title: `Sent to ${e.name}`, text: text.join(' '), art: 'review' }),
    forDevelopers([...repoRows(), ['Exploration branch', e.branch], ['Pull request', e.url]]),
    h(
      'section',
      { class: 'try', 'data-region': 'tryit-links', 'data-sig': linksSig },
      h('h2', null, 'Try it'),
      h(
        'p',
        { class: 'lede' },
        local
          ? // Not deployed: Studio shows the screenshots of what changes (Visual impact runs when tokens change on the branch).
            res.explorationTokens?.length || vars
            ? 'No preview online for this exploration. Studio shows screenshots of what changes in a few minutes; to click through it, Share with a developer: they open it on their computer.'
            : 'Nothing to see yet: the changes wait for code. Once a developer builds them, Studio shows the screenshots.'
          : 'Previews rebuild from the exploration in a few minutes. Studio shows before and after next to them.',
      ),
      local
        ? null
        : links.length
        ? h(
            'ul',
            { class: 'rows' },
            links.map((l) =>
              h(
                'li',
                { class: 'row' },
                h(
                  'div',
                  { class: 'row-head' },
                  h('span', { class: 'row-label' }, h('span', null, l.label), h('small', null, linkHint(l))),
                  l.url
                    ? h('button', { class: 'btn ghost row-action', 'data-focus-id': `tryit-open-${l.app}`, 'aria-label': `Open ${l.label} preview`, title: l.url, onClick: () => void request('open-url', { url: l.url! }) }, icon('external'), 'Open')
                    : l.state === 'failed'
                      ? null
                      : h('span', { class: 'spinner row-wait', role: 'img', 'aria-label': `Waiting for the ${l.label} link` }),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Previews are not set up for this repository yet. A developer can add them in bridge.config.json.'),
    ),
    h(
      'section',
      { class: 'share' },
      h('h2', null, 'Test build for your product'),
      status,
      h(
        'button',
        { class: 'btn share-action', 'data-focus-id': 'share-dev', onClick: () => void copyText(shareMessage(e, r.tryIt, r.previews)).then((ok) => { r.shared = ok; render(); }) },
        icon(r.shared ? 'check' : 'copy'),
        r.shared ? 'Message copied' : 'Share with a developer',
      ),
      // Always a region (empty until the command is ready), so the update that brings the command stays in place.
      h(
        'div',
        { class: 'command-slot', 'data-region': 'tryit-command', 'data-sig': t?.state === 'ready' ? t.command : '' },
        t?.state === 'ready' ? h('details', { class: 'notes command' }, h('summary', null, 'Show the command'), h('pre', { class: 'mono-area', tabindex: '0', 'aria-label': 'Install command' }, t.command)) : null,
      ),
    ),
  ];
}

/**
 * "A developer builds it with Claude": nothing acts on a component that needs code on its own yet (the
 * waiting-for-claude label is kept for that later), so the result says who does it and hands the designer the
 * message for them, with the links and how to build it.
 */
function buildMessage(r: PushState, items: BuildItem[]): HTMLElement {
  const repo = state.init!.settings.repo;
  const message = developerMessage(repo, items);
  return h(
    'section',
    { class: 'share' },
    h('h2', null, 'A developer builds it with Claude'),
    h('p', { class: 'lede' }, `${items.length === 1 ? `${items[0]!.component} needs` : `${plural(items.length, 'component')} need`} code. Send this message to a developer: it has the links and how to build it.`),
    h(
      'button',
      { class: 'btn share-action', 'data-focus-id': 'build-copy', onClick: () => void copyText(message).then((ok) => { r.shared = ok; render(); }) },
      icon(r.shared ? 'check' : 'copy'),
      r.shared ? 'Message copied' : 'Copy message for a developer',
    ),
    h('details', { class: 'notes command' }, h('summary', null, 'Show the message'), h('pre', { class: 'mono-area', tabindex: '0', 'aria-label': 'Message for a developer' }, message)),
  );
}

/** A status sentence with "Check again" on the same line. */
/**
 * After a push to the library: token values on their way (then in the library), renames and removals waiting for a
 * developer, build requests sent to developers. One group per route, the same row for each item, its link on the row.
 */
function libraryResult(r: PushState, items: RoutedItem[]): Child[] {
  const statuses = r.ship?.statuses ?? new Map<number, ShipStatus>();
  // The send succeeded: the headline says so and never changes (B2). Where each token change stands (on its way, in
  // the library, or "a developer adds it" when Bridge cannot ship it by itself) is a calm line on its own row. Token
  // values Bridge still has to arm are token values from the start, not "waiting for a developer".
  const g = groupRoutes(items.map((i) => (i.route === 'waiting-for-developer' && i.waitingFor === 'not-armed' ? { ...i, route: 'shipped' as const } : i)));
  const notShipped = g.shipped.filter((i) => statuses.get(i.number)?.key === 'waiting');
  const sent = [g.shipped.length ? plural(g.shipped.length, 'token change') : '', g.waiting.length ? plural(g.waiting.length, 'rename or removal', 'renames or removals') : '', g.builds.length ? plural(g.builds.length, 'component', 'components') + ' for developers to build' : ''].filter(Boolean);
  const row = (i: RoutedItem, hint: string, spin = false) =>
    h(
      'li',
      { class: 'row' },
      h(
        'div',
        { class: 'row-head' },
        h('span', { class: 'row-label' }, h('span', { class: i.kind === 'token' ? 'mono' : '' }, i.label), h('small', null, hint)),
        spin ? h('span', { class: 'spinner row-wait', role: 'img', 'aria-label': `${i.label}: on its way` }) : null,
      ),
    );
  const group = (title: string, lede: string, rows: Child[]) => h('section', null, h('h2', null, title), h('p', { class: 'lede' }, lede), h('ul', { class: 'rows' }, rows));
  return [
    intro({ title: sentTitle({ suggestions: [] }, 'direct'), text: `${andList(sent)} sent. Follow ${sent.length === 1 && !g.shipped.length && !g.builds.length ? 'it' : 'them'} in Studio.`, art: 'review', moment: !r.result?.failed.length ? r.result : undefined }),
    g.shipped.length
      ? group(
          'Token values',
          notShipped.length
            ? `Bridge could not add ${notShipped.length === g.shipped.length ? (g.shipped.length === 1 ? 'it' : 'them') : plural(notShipped.length, 'of them', 'of them')} to the library by itself, so a developer does. Nothing to do on your side.`
            : r.ship?.timedOut
              ? 'Still on its way after 15 minutes. A developer can see which check is still running.'
              : 'Checked for contrast and tests, then added to the library on its own. No second review: it was approved in Figma.',
          g.shipped.map((i) => {
            const s = statuses.get(i.number);
            return row(i, s?.key === 'waiting' ? (s.reason ?? 'A developer adds it to the library') : shipStateLabel(s), !!s && !s.final && s.key !== 'waiting');
          }),
        )
      : null,
    g.waiting.length ? group('Renames and removals', waitingLede(g.waiting), g.waiting.map((i) => row(i, 'A developer checks it, then it ships'))) : null,
    g.builds.length ? group('For developers to build', 'Each one has the Figma link, before and after and what to build.', g.builds.map((i) => row(i, 'Requested'))) : null,
  ];
}

/**
 * Asks Bridge to ship the token pull requests (values only), then reads where each stands (on its way, in the
 * library) while the result screen is open.
 */
function startShipPolling(r: PushState, poll: ShipPoll, arm: (n: number) => Promise<ArmAnswer>): void {
  const numbers = shippedNumbers(groupRoutes(r.routed ?? []));
  const arming = toArm(r.routed ?? []);
  r.ship?.poller?.stop();
  r.ship = { statuses: new Map() };
  if (!numbers.length && !arming.length) return;
  const ship = r.ship;
  ship.poller = new ShipPoller({
    poll,
    numbers,
    arming,
    arm,
    onUpdate: (statuses) => {
      ship.statuses = statuses;
      if (state.push === r) render();
    },
    onTimeout: () => {
      ship.timedOut = true;
      if (state.push === r) render();
    },
  });
  ship.poller.start();
  void ship.poller.check();
}

function statusLine(text: string, r: PushState): HTMLElement {
  return h(
    'p',
    { class: 'row-hint', role: 'status', 'data-region': 'tryit-status', 'data-sig': `${text}|${r.checkingTryIt ? 1 : 0}` },
    h('span', null, text),
    h('button', { class: 'btn ghost', 'data-focus-id': 'tryit-check', disabled: !!r.checkingTryIt, onClick: () => void checkTryIt(r) }, icon('refresh'), r.checkingTryIt ? 'Checking' : 'Check again'),
  );
}

function viewPush(): View {
  const init = state.init!;
  if (!connected()) return needSetup();
  const r = state.push;
  if (!r) {
    return {
      body: [
        intro({
          title: 'Send your edits',
          // Worded for the repo's mode: a suggestion repo has no explorations to promise (SUG-2).
          text: knownMode() === 'suggest'
            ? 'Variable edits and component changes go to your DS lead as suggestions. Nothing reaches the product until it is approved.'
            : 'Variable edits and component changes go to the library, or into an exploration to try them first.',
          art: 'paint',
        }),
        steps([
          ['Edit in Figma', 'Change the design system\'s variables, or a component: a variant, a property, a part, the color or size it uses.'],
          ['Review the changes', 'Every change is listed and checked. Uncheck what is not ready.'],
          knownMode() === 'suggest'
            ? ['Send', 'Send suggestion: your DS lead approves it, then a developer applies it.']
            : ['Send', 'Send for review: your team checks it, and what needs code goes to a developer.'],
        ]),
        requestLine(undefined),
      ],
      bar: { label: 'Scan for changes', onClick: () => scanPush() },
    };
  }
  const a = r.analysis;
  const prop = r.proposal;

  if (r.result) {
    const res = r.result;
    const pr = res.pr;
    // A rejected token shows as the one token callout; a missing permission names it, with the token page one click away.
    if (res.failed.some((f) => f.problem === 'rejected')) setTokenState('rejected');
    const shown = res.failed.filter((f) => f.problem !== 'rejected');
    const failed = shown.length ? issueList('error', 'Not sent', shown.map((f) => ({ code: 'file-problem', severity: 'error', message: `${f.component}: ${f.error}` }))) : null;
    if (failed && shown.some((f) => f.problem === 'missing-permission')) {
      (failed as HTMLElement).append(h('div', { class: 'inline-actions' }, h('button', { class: 'btn', onClick: openTokenSettings }, icon('external'), 'Edit token on GitHub')));
    }
    // After a send, one primary: the change in Studio for this team. GitHub is one step behind it; scanning again is a
    // quiet line in the body.
    const scanAgain = h('p', null, h('span', { class: 'muted' }, 'Edited more in Figma?'), ' ', h('button', { class: 'link', 'data-focus-id': 'scan-again', onClick: () => scanPush() }, 'Scan again'));
    const resultBar = (links: { studio?: string | undefined; github?: string | undefined }): ActionBar => {
      const github = links.github ? { label: 'Open on GitHub', onClick: () => void request('open-url', { url: links.github! }) } : undefined;
      if (links.studio) return { label: 'See it in Studio', onClick: () => void request('open-url', { url: links.studio! }), secondary: github };
      return github ? { ...github, secondary: { label: 'Scan again', onClick: () => scanPush() } } : { label: 'Scan again', onClick: () => scanPush() };
    };
    if (r.routed) return { body: [...libraryResult(r, r.routed), failed, requestLine(r), scanAgain], bar: r.form ? undefined : resultBar(sentLinks(init.settings.repo, res)) };
    if (r.sentTo) {
      const e = r.sentTo;
      return {
        body: [...explorationResult(r, e, res), failed, requestLine(r), scanAgain],
        bar: r.form ? undefined : resultBar(sentLinks(init.settings.repo, res, e)),
      };
    }
    const mode = modeOf(r);
    const text = [
      ...suggestionLines(res),
      // Edits added to an open change (no new outcome to route): what happens next follows core's rule for a push from
      // Figma (TV-1: values ship once the checks pass; a rename or removal waits for a developer OK).
      pr ? `${pr.appended ? 'Added to this change' : 'Variable edits sent'}. ${figmaPushNextLine((r.proposal?.changes ?? []).map((c) => ({ kind: !c.target ? 'removed' : !c.current ? 'added' : c.target.path !== c.current.path ? 'renamed' : 'changed' })))}` : '',
      res.requests.length ? `${plural(res.requests.length, 'request')} sent for ${res.requests.map((x) => x.component).join(', ')}.` : '',
      ...res.branches.filter((x) => !x.suggested).map((x) => (x.route === 'token-change' ? `${x.component}: an exact token change, checked for contrast.` : `${x.component}: a developer builds it with Claude. Send them the message below.`)),
      res.held.length ? `Not sent, fix in Figma first: ${res.held.map((x) => x.component).join(', ')}.` : '',
      prop.held.length ? `${plural(prop.held.length, 'unchecked variable edit')} stay${prop.held.length === 1 ? 's' : ''} in Figma.` : '',
    ].filter(Boolean);
    // Components that need code: nothing builds them on its own, so the designer hands the developer a message.
    const builds: BuildItem[] = res.branches.filter((x) => x.route === 'claude-draft').map((x) => ({ component: x.component, number: x.number, url: x.url, suggested: x.suggested }));
    const images = res.imagesSkipped ? h('div', { class: 'callout warn', role: 'status' }, h('div', { class: 'callout-title' }, icon('alert'), 'Screenshots not attached'), h('p', null, IMAGES_NEED_WRITE)) : null;
    if (images && mode === 'suggest') (images as HTMLElement).append(h('div', { class: 'inline-actions' }, h('button', { class: 'btn', onClick: openTokenSettings }, icon('external'), 'Edit token on GitHub')));
    return {
      body: [
        intro({ title: sentTitle(res, mode), text: text.join(' '), art: 'review', moment: res.failed.length ? undefined : res }),
        forDevelopers([...repoRows(), ['Branch', pr?.branch], ['Pull request', pr?.pr.url], ['Suggestion', res.suggestions[0]?.url]]),
        builds.length ? buildMessage(r, builds) : null,
        images,
        failed,
        requestLine(r),
        scanAgain,
      ],
      bar: r.form ? undefined : resultBar(sentLinks(init.settings.repo, res)),
    };
  }

  const exploring = r.destination === 'exploration';
  const suggestions = a.suggestions.filter((s) => !r.dismissed.has(s.figmaId));
  const compChanges = r.components?.changed ?? [];
  const nothing = !a.diff.local.length && !a.diff.conflicts.length && !a.newBrands.length && !compChanges.length;
  const before = prop.validation.contrastBefore;
  const after = prop.validation.contrastAfter;
  const beforeByKey = new Map(before.map((x) => [pairKey(x), x]));
  // Failures first, then the biggest moves.
  const delta = (x: ContrastResult) => Math.abs((x.ratio ?? 0) - (beforeByKey.get(pairKey(x))?.ratio ?? 0));
  const changedContrast = after
    .filter((x) => beforeByKey.get(pairKey(x))?.ratio !== x.ratio)
    .sort((x, y) => Number(y.level === 'fail') - Number(x.level === 'fail') || delta(y) - delta(x));
  const contrastKey = 'push-contrast';
  const contrastShown = state.expanded.has(contrastKey) ? changedContrast : changedContrast.slice(0, 8);
  const checked = r.items.filter((i) => isChecked(r.unchecked, i));
  const checkedVars = checked.filter((i) => i.kind === 'variable').length;
  const checkedComps = checked.filter((i) => i.kind === 'component').length;
  // In an exploration, exact token changes are committed there: only the others become requests.
  const checkedTokens = checked.filter((i) => i.kind === 'component' && pushOf(r, i.id)?.plan.route === 'token-change' && !pushOf(r, i.id)?.blocked).length;
  const newBrands = prop.brands.filter((b) => b.plan).length;
  const prFiles = Object.keys(prop.files).length + prop.brandFiles.length;

  const body: Child[] = [];
  // What stops the send, said once at the top (orientation): never "ready to send" above a problem to fix.
  const blocking = prFiles ? prop.validation.blocking : [];
  // Counted by kind, as the callout says them ("1 problem": 107 color pairs too low in contrast).
  const blockingKinds = blockerLines(blocking).length;
  if (!nothing) {
    // Summary first: what goes and whether contrast holds, in the screen's one Harbor zone.
    const fails = changedContrast.filter((x) => x.level === 'fail').length;
    const n = r.items.length;
    body.push(
      h(
        'section',
        { class: 'zone' },
        // Nothing sendable: a new brand alone, or only changes to fix in Figma first (never "a new brand" then).
        h('h2', { class: 'headline' }, blockingKinds ? `${plural(blockingKinds, 'problem')} to fix before sending` : n ? `${plural(n, 'change')} ready to send` : newBrands ? 'A new brand to propose' : 'Nothing to send yet'),
        h(
          'p',
          { class: 'muted' },
          blockingKinds
            ? `Fix ${blockingKinds === 1 ? 'it' : 'them'} in Figma, then scan again.${n > 1 ? ' Or uncheck what is not ready and send the rest.' : ''}`
            : !n && !newBrands
            ? 'Fix the changes below in Figma, then scan again.'
            : fails
            ? `${plural(fails, 'contrast pair')} fail${fails === 1 ? 's' : ''}. Fix ${fails === 1 ? 'it' : 'them'} or uncheck the edit before sending.`
            : changedContrast.length
              ? `All ${plural(changedContrast.length, 'contrast pair')} the checked edits move still pass.`
              : exploring
                ? 'Nothing reaches the product as is.'
                : modeOf(r) === 'suggest'
                  ? 'Nothing reaches the product until owners approve.'
                  // What happens after the send is said once, under the destination: here, only what to do.
                  : 'Check the changes below, then send them for review.',
        ),
      ),
    );
  }
  // Filled once the contrast pairs are known (below): the failing pairs fold into this one callout.
  const blockingAt = body.push(null) - 1;
  body.push(...sentNotes(r));
  if (suggestions.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, 'Renamed?'),
        h('p', { class: 'lede' }, 'These look like renames (same type and value). Confirm so reviewers see a rename instead of a delete and an add.'),
        h(
          'ul',
          { class: 'rows' },
          suggestions.map((s) =>
            h(
              'li',
              { class: 'row' },
              h('div', { class: 'row-head' }, h('span', { class: 'path' }, h('span', { class: 'path-old' }, s.fromPath), icon('arrow'), s.toPath)),
              h(
                'div',
                { class: 'inline-actions' },
                h('button', { class: 'btn', onClick: () => scanPush({ ...r, confirmed: [...r.confirmed, s] }) }, 'It is a rename'),
                h('button', { class: 'btn ghost', onClick: () => { r.dismissed.add(s.figmaId); render(); } }, 'Different tokens'),
              ),
            ),
          ),
        ),
      ),
    );
  }
  if (nothing) {
    body.push(h('div', { class: 'empty' }, h('h2', null, 'Nothing to send'), h('p', null, 'Your variables and components match the design system.')));
  }
  for (const b of prop.brands) body.push(newBrandCard(r, b));
  if (r.items.length) {
    body.push(h('h2', { class: 'section-title' }, 'Changes'));
    body.push(
      modeOf(r) === 'suggest'
        ? h('p', { class: 'muted' }, 'Sent as a suggestion: your DS lead reviews it, then a developer applies it. Nothing reaches the code before that.')
        : destinationControl(r),
    );
  }
  body.push(variablesGroup(r));
  body.push(
    conflictSection(a, r.choices, (e) => {
      const item = itemOf(r, variableKey(e.id));
      return { lead: selectBox(r, item, e.path), tail: rowTail(r, item, e.path) };
    }),
  );
  body.push(componentChangesGroup(r));
  body.push(fixInFigmaGroup(r));
  body.push(...componentNotes(r));
  if (a.diff.remote.length) {
    body.push(h('p', { class: 'muted' }, `${plural(a.diff.remote.length, 'token')} changed in the design system since your last pull. Your edits leave them as they are; pull to see them here.`));
  }
  let contrastInBlocker: Child = null;
  if (changedContrast.length) {
    // One place: failing pairs fold inside the blocker; when every pair passes, one folded line.
    const failing = changedContrast.some((x) => x.level === 'fail');
    const contrastBody: Child[] = [
        h('p', { class: 'lede' }, 'Color pairs your design system checks whose ratio moves with the checked edits, in every brand and theme.'),
        h(
          'table',
          { class: 'contrast' },
          h('thead', null, h('tr', null, h('th', null, 'Pair'), h('th', null, 'Brand and theme'), h('th', { class: 'num' }, 'Before'), h('th', { class: 'num' }, 'After'), h('th', null, 'WCAG'))),
          h(
            'tbody',
            null,
            contrastShown.map((x) =>
              h(
                'tr',
                null,
                h('td', { class: 'pair' }, breakable(x.pair.foreground.replace(/^color\./, '')), ' on ', breakable(x.pair.background.replace(/^color\./, ''))),
                h('td', null, contextLabel(x)),
                h('td', { class: 'num' }, String(beforeByKey.get(pairKey(x))?.ratio ?? 'n/a')),
                h('td', { class: 'num' }, String(x.ratio ?? 'n/a')),
                h('td', null, h('span', { class: `pill ${x.level}`, title: `Needs ${x.pair.min}:1` }, h('strong', null, x.level === 'fail' ? 'Fails' : (x.level ?? 'n/a')))),
              ),
            ),
          ),
        ),
        changedContrast.length > contrastShown.length
          ? h('button', { class: 'btn ghost more', onClick: () => { state.expanded.add(contrastKey); render(); } }, `Show all ${changedContrast.length} pairs`)
          : null,
    ];
    if (failing && blocking.some((i) => i.code === 'contrast')) contrastInBlocker = h('details', { class: 'notes' }, h('summary', { 'data-focus-id': 'contrast-pairs' }, `See the ${plural(changedContrast.filter((x) => x.level === 'fail').length, 'color pair')}`), contrastBody);
    else body.push(h('details', { class: 'notes' }, h('summary', { 'data-focus-id': 'contrast-pairs' }, `Contrast: ${plural(changedContrast.length, 'pair')} checked, ${failing ? 'some fail' : 'all pass'}`), contrastBody));
  }
  body[blockingAt] = problemList('error', 'Fix before sending', blocking, 'push-blocking', { actions: { contrast: contrastActions(r) }, details: contrastInBlocker });
  body.push(problemList('warn', 'Worth a look (not blocking)', prop.validation.warnings, 'push-warnings'));
  if (!nothing) {
    // The message is its own section after a divider: the words that go with everything sent, not a row detail.
    body.push(
      h(
        'section',
        { class: 'message' },
        h(
          'div',
          { class: 'field' },
          h('div', { class: 'field-head' }, h('h2', null, h('label', { for: 'push-description' }, 'Message to the team')), assistAction(r.assist, pushAssist(r))),
          h('p', { class: 'lede' }, exploring ? 'Goes with the exploration and every request. Your words for the team.' : 'Goes with everything you send. Your words for the reviewers.'),
          h('textarea', {
            id: 'push-description',
            rows: '3',
            'data-focus-id': 'push-description',
            placeholder: 'What changed and why it matters.',
            onInput: (e: Event) => {
              r.description = (e.target as HTMLTextAreaElement).value;
              r.descriptionSource = 'user';
              noteEdit(r.assist, 'summary');
              clearDrafted('push-description');
            },
          }, r.description),
          r.descriptionSource === 'draft' && r.description ? h('small', null, 'Drafted from the checked changes. Add why it matters.') : null,
          draftedNote('push-description', r.descriptionSource),
        ),
        assistStatus(r.assist, pushAssist(r)),
        !exploring && prFiles && r.openPr && modeOf(r) === 'direct'
          ? h(
              'label',
              { class: 'check' },
              h('input', { type: 'checkbox', checked: r.appendToOpen, onChange: (e: Event) => { r.appendToOpen = (e.target as HTMLInputElement).checked; render(); } }),
              `Add to this change: ${r.openPr.title.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')}`,
            )
          : null,
        // An exploration's title is generated (it only names the change on the exploration): nothing to fill in.
        prFiles && !exploring
          ? h(
              'details',
              { class: 'notes', open: r.titleSource === 'claude' },
              h('summary', null, modeOf(r) === 'suggest' ? 'Suggestion title' : 'Title'),
              h('input', {
                type: 'text',
                'aria-label': modeOf(r) === 'suggest' ? 'Suggestion title' : 'Title',
                value: r.title,
                placeholder: prop.changes.length ? defaultTitle(prop.changes) : prop.brands.find((b) => b.plan)?.plan?.title ?? '',
                maxlength: '120',
                onInput: (e: Event) => {
                  r.title = (e.target as HTMLInputElement).value;
                  r.titleSource = 'user';
                  noteEdit(r.assist, 'title');
                },
              }),
            )
          : null,
        // What the push sends is summed up once, in the bar ("2 variables, 1 request"); this only says how it goes.
        // Direct mode: what happens after the send is said once, under the destination ("Token values ship once the
        // checks pass"), never contradicted here.
        prFiles && (exploring || modeOf(r) === 'suggest')
          ? h('p', { class: 'muted' }, exploring ? 'Owners review it only if the exploration is promoted.' : 'Token changes need two approvals on the suggestion: a design owner and a tech owner.')
          : null,
      ),
    );
  }
  body.push(requestLine(r));
  body.push(notes(a));

  // A request form is open: its "Send request" is the one primary action on screen, the bar steps aside.
  if (r.form) return { body };
  const blocked = prFiles ? prop.validation.blocking.length : 0;
  const open = prop.unresolvedConflicts.length;
  const none = !prFiles && !checkedComps;
  const onlyExploration = none && !exploring && modeOf(r) !== 'suggest' && r.items.length > 0 && r.items.every((i) => i.experimental);
  const waiting = explorationBlocker(r);
  const hint = open
    ? `Decide ${plural(open, 'conflict')} first`
    : blocked
      ? `Fix ${plural(blockingKinds, 'problem')} first`
      : none
        ? onlyExploration
          ? 'Marked exploration only: try them in an exploration'
          : 'Nothing checked'
        : waiting
          ? waiting
          : [checkedVars ? plural(checkedVars, 'variable') : '', newBrands ? plural(newBrands, 'new brand') : '', ...(exploring
            ? [checkedTokens ? plural(checkedTokens, 'token change') : '', checkedComps - checkedTokens ? plural(checkedComps - checkedTokens, 'request') : '']
            : [checkedComps ? plural(checkedComps, 'component') : ''])].filter(Boolean).join(', ');
  return {
    body,
    bar: nothing
      ? { label: 'Scan again', onClick: () => scanPush(r) }
      : {
          label: exploring ? 'Send to exploration' : sendLabel(modeOf(r)),
          onClick: submitPush,
          disabled: !!open || !!blocked || none || !!waiting,
          hint,
          // Everything is marked exploration only: the way forward is one click, not a dead button (PUSH-6).
          secondary: onlyExploration ? { label: 'Try in an exploration', onClick: () => setDestination(r, 'exploration') } : { label: 'Scan again', onClick: () => scanPush(r) },
        },
  };
}

/**
 * Connected: one card, the design system by its name and how this computer is connected, with its few actions. The
 * repository, the branch and the token are for developers, folded and read-only (Edit opens the full form). A token
 * pasted before Sign in with Bridge existed (no developer chose it) is offered the switch: one primary action.
 */
function connectedView(): View {
  const init = state.init!;
  const bridge = init.tokenSource === 'bridge';
  const legacy = !init.tokenSource;
  const rejected = init.tokenState === 'rejected';
  const team = studioTeamUrl(init.settings.repo);
  const line = rejected
    ? bridge
      ? 'The sign-in expired. Sign in again: it takes a click.'
      : 'This computer can no longer reach the design system.'
    : bridge
      ? `Connected with Bridge${init.tokenAccount ? ` as ${init.tokenAccount}` : ''}`
      : 'Connected on this computer';
  const msg = state.settingsMessage;
  return {
    body: [
      h(
        'section',
        { class: 'card', 'data-connection': bridge ? 'bridge' : legacy ? 'legacy' : 'developer' },
        h(
          'div',
          { class: 'token-row' },
          h('span', { class: 'opt-text' }, h('span', { class: 'opt-title' }, designSystemName()), h('small', null, line)),
          rejected ? h('span', { class: 'opt-status warn' }, icon('alert'), 'Signed out') : h('span', { class: 'opt-status ok' }, icon('check'), 'Connected'),
        ),
        legacy && !rejected ? h('p', { class: 'lede' }, "Connect through your team's Bridge account. No token to manage.") : null,
        h(
          'div',
          { class: 'inline-actions' },
          team ? h('button', { class: 'btn ghost', 'data-focus-id': 'open-studio', onClick: () => void request('open-url', { url: team }) }, icon('external'), 'Open in Studio') : null,
          bridge ? h('button', { class: 'btn ghost', 'data-focus-id': 'switch-ds', onClick: signInWithBridge }, 'Switch design system') : null,
          h('button', { class: 'btn ghost danger', 'data-focus-id': 'sign-out', onClick: removeToken }, 'Sign out'),
        ),
      ),
      msg ? h('div', { class: `callout ${msg.kind === 'ok' ? 'ok' : 'error'}`, role: msg.kind === 'error' ? 'alert' : 'status' }, h('div', { class: 'callout-title' }, icon(msg.kind === 'ok' ? 'check' : 'alert'), msg.text)) : null,
      // For developers: what the connection is made of, read-only, and the developer's ways to change it.
      h(
        'details',
        { class: 'notes dev-details' },
        h('summary', null, 'For developers'),
        h(
          'dl',
          { class: 'dev-list' },
          ([
            ['Repository', init.settings.repo],
            ['Branch', init.settings.branch],
            ['Tokens folder', init.settings.tokensPath],
            ['Spec source', init.settings.specSource === 'measured' ? 'Static, with measured values' : init.settings.specSource === 'measured-only' ? 'Measured in Storybook only' : 'Static'],
            ['GitHub token', bridge ? 'From the Bridge sign-in, on this computer only' : 'Pasted, on this computer only'],
          ] as [string, string][]).map(([k, v]) => [h('dt', null, k), h('dd', { class: 'mono' }, breakable(v))]),
        ),
        h(
          'div',
          { class: 'inline-actions' },
          h('button', { class: 'btn ghost', 'data-focus-id': 'repo-edit', onClick: () => { state.expanded.add('repo-edit'); render(); } }, 'Edit the connection'),
          bridge ? null : h('button', { class: 'btn ghost', 'data-focus-id': 'token-replace', onClick: replaceToken }, 'Replace token'),
        ),
      ),
      claudeCard(),
    ],
    bar: rejected
      ? { label: bridge || legacy ? SIGN_IN_WORDS.action : 'Replace token', onClick: bridge || legacy ? signInWithBridge : replaceToken }
      : legacy
        ? { label: SIGN_IN_WORDS.action, onClick: signInWithBridge }
        : undefined,
  };
}

function viewSettings(): View {
  // Not connected: Sign in with Bridge, unless a developer chose to connect with a token.
  if (state.link || (!state.init!.hasToken && !state.expanded.has('token-connect'))) return signInView();
  // Connected: one card. The full form only for a developer who asked for it (Edit the connection, Replace token).
  if (connected() && !state.expanded.has('repo-edit') && !state.expanded.has('token-replace')) return connectedView();
  const d = state.settingsDraft;
  const init = state.init!;
  // Not connected yet (no design system for this file, or no token): the fields show; connected, one row and Edit.
  const editingRepo = !init.hasToken || !init.settings.repo || state.expanded.has('repo-edit');
  const rejected = init.tokenState === 'rejected';
  const bridgeSignIn = init.tokenSource === 'bridge';
  // The token field shows without a token, or after "Replace token".
  const tokenField = !init.hasToken || state.expanded.has('token-replace');
  const fieldError = (key: SettingsField) => (state.settingsMessage?.kind === 'error' && state.settingsMessage.field === key ? state.settingsMessage.text : undefined);
  // A save that failed leaves nothing checked: no "Connected" next to the error it just gave.
  const unsure = state.settingsMessage?.kind === 'error';
  const field = (label: string, key: 'repo' | 'branch' | 'tokensPath', hint: string, placeholder: string) => {
    const error = fieldError(key);
    return h(
      'label',
      { class: 'field' },
      h('span', null, label),
      h('input', { type: 'text', value: d[key], placeholder, spellcheck: 'false', autocomplete: 'off', 'aria-invalid': error ? 'true' : undefined, 'data-focus-id': `field-${key}`, onInput: (e: Event) => (d[key] = (e.target as HTMLInputElement).value) }),
      error ? h('small', { class: 'form-error', role: 'alert' }, icon('alert'), error) : h('small', null, hint),
    );
  };
  return {
    body: [
      connected() ? null : intro({ title: 'Connect your design system', text: 'Which design system does this file use? Paste its GitHub repository, then a token. Nothing is written until you send your edits.', art: 'guide', moment: 'welcome' }),
      // Connected: the design system is a state (one row, Edit). The fields show to set it up or after Edit. Branch and
      // tokens folder are for developers: folded, with defaults that work (the design system's config decides).
      editingRepo
        ? h(
            'section',
            { class: 'card' },
            h('h2', null, 'Design system'),
            field('GitHub repository', 'repo', 'The repository that holds your design system, as in its GitHub address.', 'owner/name or a GitHub link'),
            h(
              'details',
              { class: 'notes dev-details', open: !!fieldError('branch') || !!fieldError('tokensPath') },
              h('summary', null, 'For developers'),
              field('Base branch', 'branch', 'Updates read from it; changes sent for review target it.', 'main'),
              field('Tokens folder', 'tokensPath', "Used when the design system has no bridge.config.json to say where its tokens are.", 'tokens'),
              h(
                'label',
                { class: 'field' },
                h('span', null, 'Spec source'),
                h(
                  'select',
                  { onChange: (e: Event) => (d.specSource = (e.target as HTMLSelectElement).value as NonNullable<RepoSettings['specSource']>) },
                  h('option', { value: 'static', selected: !d.specSource || d.specSource === 'static' }, 'component-specs.json (static)'),
                  h('option', { value: 'measured', selected: d.specSource === 'measured' }, 'Static, with measured values'),
                  h('option', { value: 'measured-only', selected: d.specSource === 'measured-only' }, 'Measured in Storybook only'),
                ),
                h('small', null, `Measured comes from ${MEASURED_SPECS_FILE} (bridge specs --measure --variants). "Measured only" builds every set from the stories, for a design system without component-specs.json.`),
              ),
            ),
            init.settings.repo
              ? h('div', { class: 'inline-actions' }, h('button', { class: 'btn ghost', onClick: () => { state.expanded.delete('repo-edit'); state.settingsDraft = { ...init.settings }; render(); } }, 'Cancel'))
              : null,
          )
        : h(
            'section',
            { class: 'card' },
            h(
              'div',
              { class: 'token-row' },
              h('span', { class: 'opt-text' }, h('span', { class: 'opt-title' }, 'Design system'), h('small', { class: 'mono-line' }, init.settings.repo)),
              unsure ? null : h('span', { class: 'opt-status ok' }, icon('check'), 'Connected'),
            ),
            forDevelopers([['Branch', init.settings.branch], ['Tokens folder', init.settings.tokensPath], ['Spec source', init.settings.specSource === 'measured' ? 'Static, with measured values' : init.settings.specSource === 'measured-only' ? 'Measured in Storybook only' : undefined]]),
            h('div', { class: 'inline-actions' }, h('button', { class: 'btn ghost', 'data-focus-id': 'repo-edit', onClick: () => { state.expanded.add('repo-edit'); render(); } }, 'Edit')),
          ),
      // A saved token is a state, not a question: one row with "Connected" (or "Stopped working") and its actions.
      // "Replace token" opens the field below it; saving replaces the token and clears the state.
      init.hasToken
        ? h(
            'section',
            { class: 'card' },
            h(
              'div',
              { class: 'token-row' },
              h(
                'span',
                { class: 'opt-text' },
                h('span', { class: 'opt-title' }, bridgeSignIn ? 'Signed in with Bridge' : 'GitHub token'),
                h('small', null, rejected ? (bridgeSignIn ? 'The sign-in expired. Sign in again: it takes a click.' : TOKEN_REJECTED_DETAIL) : 'Saved on this computer, never in the file.'),
              ),
              rejected
                ? h('span', { class: 'opt-status warn' }, icon('alert'), 'Stopped working')
                : state.tokenReadOnly
                  ? h('span', { class: 'opt-status warn', title: 'It can read the design system but not send changes. Replace it with a token that has "Read and write".' }, icon('alert'), 'Read only')
                  : unsure
                    ? null
                    : h('span', { class: 'opt-status ok' }, icon('check'), 'Connected'),
            ),
            tokenError() && !tokenField ? h('p', { class: 'form-error', role: 'alert' }, icon('alert'), tokenError()) : null,
            tokenField
              ? tokenInput('New fine-grained token', 'Replaces the saved one when you save. Stays on this computer, never in the file.')
              : null,
            h(
              'div',
              { class: 'inline-actions' },
              tokenField
                ? h('button', { class: 'btn ghost', onClick: () => { state.expanded.delete('token-replace'); state.tokenDraft = ''; render(); } }, 'Cancel')
                : bridgeSignIn
                  ? h('button', { class: rejected ? 'btn' : 'btn ghost', 'data-focus-id': 'sign-in-again', onClick: signInWithBridge }, 'Sign in again')
                  : h('button', { class: rejected ? 'btn' : 'btn ghost', 'data-focus-id': 'token-replace', onClick: replaceToken }, 'Replace token'),
              tokenField ? h('button', { class: 'btn ghost', onClick: () => void request('open-url', { url: 'https://github.com/settings/personal-access-tokens/new' }) }, 'Create one on GitHub') : null,
              h('button', { class: 'btn ghost danger', onClick: removeToken }, bridgeSignIn ? 'Sign out' : 'Remove token'),
            ),
          )
        : h(
            'section',
            { class: 'card' },
            h('div', { class: 'group-head' }, h('h2', null, 'GitHub token'), h('button', { class: 'btn ghost', onClick: () => void request('open-url', { url: 'https://github.com/settings/personal-access-tokens/new' }) }, 'Create one on GitHub')),
            h('p', { class: 'lede' }, "Bridge uses it to read your design system and send your edits. Your design system's owner can give you one."),
            tokenInput('Token', 'Stays on this computer, never in the file, never shown again.'),
            // The permissions are for whoever creates the token: folded.
            h('details', { class: 'notes dev-details' }, h('summary', null, 'Creating the token yourself?'), h('p', { class: 'muted' }, tokenHelp(state.push ? changesModeOf(state.push.analysis) : undefined))),
          ),
      state.settingsMessage && !state.settingsMessage.field
        ? h(
            'div',
            { class: `callout ${state.settingsMessage.kind === 'ok' ? 'ok' : 'error'}`, role: state.settingsMessage.kind === 'error' ? 'alert' : 'status' },
            h('div', { class: 'callout-title' }, icon(state.settingsMessage.kind === 'ok' ? 'check' : 'alert'), state.settingsMessage.text),
          )
        : null,
      // Optional writing help: offered once the design system is connected, never on the first screen.
      connected() ? claudeCard() : null,
    ],
    // Nothing to save while everything is connected: the bar shows when there is something to set up or change.
    bar: editingRepo || tokenField ? { label: tokenField && init.hasToken && !editingRepo ? 'Replace and check access' : 'Save and check access', onClick: saveSettings } : undefined,
  };
}

function tokenInput(label: string, hint: string): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, label),
    h('input', {
      type: 'password',
      value: state.tokenDraft,
      autocomplete: 'off',
      spellcheck: 'false',
      'data-focus-id': 'token-input',
      placeholder: 'github_pat_...',
      onInput: (e: Event) => (state.tokenDraft = (e.target as HTMLInputElement).value),
      'aria-invalid': tokenError() ? 'true' : undefined,
    }),
    tokenError() ? h('small', { class: 'form-error', role: 'alert' }, icon('alert'), tokenError()) : h('small', null, hint),
  );
}

/** The last save's error about the token, shown under the token field. */
const tokenError = () => (state.settingsMessage?.kind === 'error' && state.settingsMessage.field === 'token' ? state.settingsMessage.text : undefined);

/** A setup snippet: `text` on screen, `copy` on the clipboard (the same text with the saved token in place). */
function snippet(id: string, label: string, text: string, copy = text): HTMLElement {
  const copied = state.claudeCopied === id;
  return h(
    'div',
    { class: 'snippet' },
    h('div', { class: 'snippet-head' }, h('span', null, label), h('button', { class: 'btn ghost', 'data-focus-id': `copy-${id}`, onClick: () => void copyText(copy).then((ok) => { state.claudeCopied = ok ? id : undefined; render(); }) }, icon(copied ? 'check' : 'copy'), copied ? 'Copied' : 'Copy')),
    h('pre', { class: 'mono-area', tabindex: '0', 'aria-label': label }, text),
  );
}

/**
 * Settings, Claude: your team's own Claude, with Bridge added as a connector (no API key anywhere). One sentence, and
 * how to connect it in Studio. The designer's Claude app route for drafts ("Draft with my Claude") keeps its setup,
 * folded for developers.
 */
function claudeCard(): HTMLElement {
  const repo = state.init!.settings.repo;
  const team = studioTeamUrl(repo);
  const hasToken = !!state.init!.hasToken;
  // On screen the token is a placeholder; Copy puts the saved one in (it is never shown, so nobody has to find it).
  const mcp = mcpSnippets(repo);
  const filled = mcpSnippets(repo, state.init!.token);
  return h(
    'section',
    { class: 'card', 'data-card': 'claude' },
    h('div', { class: 'group-head' }, h('h2', null, 'Claude'), team ? h('button', { class: 'btn ghost', 'data-focus-id': 'claude-connect', onClick: () => void request('open-url', { url: `${team}settings/#claude` }) }, icon('external'), CONNECTOR_WORDS.howToConnect) : null),
    h('p', { class: 'lede' }, "Your team's Claude, with Bridge added once: it drafts what you send and fixes components that differ from the code. You review everything first."),
    h(
      'details',
      {
        class: 'notes dev-details',
        open: state.expanded.has('claude-dev'),
        onToggle: (e: Event) => {
          const open = (e.target as HTMLDetailsElement).open;
          open ? state.expanded.add('claude-dev') : state.expanded.delete('claude-dev');
        },
      },
      h('summary', { 'data-focus-id': 'claude-dev' }, 'For developers: Claude Code or the Claude app on this computer'),
      h(
        'ol',
        { class: 'setup-steps' },
        h(
          'li',
          null,
          hasToken
            ? 'Add Bridge to Claude, once. Copy fills in the GitHub token saved in this plugin; it stays on this computer.'
            : 'Connect the design system first: Copy then fills in its token. Then add Bridge to Claude, once.',
          snippet('code', 'Claude Code, in a terminal', mcp.code, filled.code),
          h('details', { class: 'notes' }, h('summary', null, 'Using the Claude app instead'), snippet('desktop', 'In claude_desktop_config.json', mcp.desktop, filled.desktop)),
        ),
        h('li', null, `Then click "Draft with Claude" and say "${DRAFT_PHRASE}" to Claude.`),
      ),
    ),
  );
}

/**
 * The design system's one name: its bridge.config.json "name", kept with the file once read (so it does not change
 * between the first frame and the first scan), else the repository's name until the config is read.
 */
function designSystemName(): string {
  const init = state.init;
  const config = (state.push?.analysis ?? state.pull?.analysis)?.headFiles.config;
  if (init && config?.name && config.name !== init.settings.name) {
    init.settings = { ...init.settings, name: config.name };
    state.settingsDraft = { ...state.settingsDraft, name: config.name };
    void request('save-settings', { settings: init.settings }).catch(() => undefined);
  }
  return init?.settings.name || config?.name || init?.settings.repo.split('/').pop() || '';
}

function actionBar(bar: ActionBar | undefined): Child {
  if (!bar && !state.busy) return null;
  // Fitts: a lone action takes the whole bar; with a secondary or a status it stays on the right.
  const lone = !!bar && !bar.secondary && !bar.hint && !bar.toggle && !state.busy;
  return h(
    'div',
    { class: lone ? 'bar lone' : 'bar' },
    h(
      'div',
      { class: 'bar-status', 'aria-live': 'polite' },
      state.busy
        ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { id: 'busy-text' }, state.busy)]
        : [
            bar?.toggle
              ? h(
                  'label',
                  { class: 'check' },
                  h('input', { type: 'checkbox', checked: bar.toggle.checked, 'data-focus-id': bar.toggle.focusId, onChange: (e: Event) => bar.toggle!.onChange((e.target as HTMLInputElement).checked) }),
                  bar.toggle.label,
                )
              : null,
            bar?.hint ? h('span', null, bar.hint) : null,
          ],
    ),
    state.busy && state.cancel ? h('button', { class: 'btn', 'data-focus-id': 'stop-build', onClick: state.cancel }, 'Stop') : null,
    bar?.secondary && !state.cancel ? h('button', { class: 'btn', disabled: !!state.busy, onClick: bar.secondary.onClick }, bar.secondary.label) : null,
    bar && !state.cancel ? h('button', { class: 'btn primary', disabled: !!state.busy || !!bar.disabled, onClick: bar.onClick }, bar.label) : null,
  );
}

function render(): void {
  // Keep focus and scroll stable across re-renders.
  const scroller = document.querySelector('main');
  const scrollTop = scroller?.scrollTop ?? 0;
  // Restore focus only when it was keyboard focus: after a mouse click it would draw a ring nobody asked for.
  const active = document.activeElement as HTMLElement | null;
  const focusedId = active?.matches?.(':focus-visible') ? active.dataset?.focusId : undefined;

  if (!state.init) {
    app.replaceChildren(
      h(
        'main',
        null,
        state.error
          ? h(
              'div',
              { class: 'callout error', role: 'alert' },
              h('div', { class: 'callout-title' }, icon('alert'), 'Bridge could not start'),
              h('p', null, state.error.message),
              state.error.detail ? h('details', { class: 'notes command' }, h('summary', null, 'Details'), h('pre', { class: 'mono-area', tabindex: '0', 'aria-label': 'Error details' }, state.error.detail)) : null,
            )
          : h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), 'Loading'),
      ),
    );
    return;
  }
  const pushCount = state.push && !state.push.result ? state.push.analysis.diff.local.length + state.push.analysis.diff.conflicts.length + (state.push.components?.changed.length ?? 0) : 0;
  const view = state.tab === 'pull' ? viewPull() : state.tab === 'push' ? viewPush() : viewSettings();

  const tabs = h(
    'nav',
    { class: 'tabs', role: 'tablist', 'aria-label': 'Bridge' },
    TABS.map((t) =>
      h(
        'button',
        {
          class: 'tab',
          role: 'tab',
          id: `tab-${t.id}`,
          'data-focus-id': `tab-${t.id}`,
          'aria-selected': state.tab === t.id ? 'true' : 'false',
          'aria-controls': 'panel',
          tabindex: state.tab === t.id ? '0' : '-1',
          onClick: () => {
            state.tab = t.id;
            state.error = undefined;
            render();
          },
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = TABS.findIndex((x) => x.id === state.tab);
            state.tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!.id;
            render();
            document.getElementById(`tab-${state.tab}`)?.focus();
          },
        },
        t.label,
        t.id === 'push' && pushCount ? h('span', { class: 'count', 'aria-label': `${pushCount} changes` }, String(pushCount)) : null,
      ),
    ),
    // Which design system this file uses, by its name: never a branch or a repository slug.
    state.init.settings.repo ? h('span', { class: 'repo', title: `Design system: ${designSystemName()}` }, designSystemName()) : null,
  );

  // A rejected token: one callout on Pull and Push whatever failed (Settings shows it on the token row).
  const tokenCallout = tokenRejected() && state.tab !== 'settings' && state.init.hasToken ? tokenRejectedCallout() : null;
  const shownError = state.error && !(tokenCallout && state.error.problem?.kind === 'rejected') && !(state.tab === 'settings' && state.error.problem?.kind === 'rejected') ? state.error : undefined;
  const permission = shownError?.problem?.kind === 'missing-permission';
  const error = shownError
    ? h(
        'div',
        // Offline is not an error of the designer's: a calm, neutral callout.
        { class: shownError.offline ? 'callout' : 'callout error', role: shownError.offline ? 'status' : 'alert' },
        h('div', { class: 'callout-title' }, icon('alert'), shownError.message),
        shownError.detail ? h('details', { class: 'notes command' }, h('summary', null, 'Details'), h('pre', { class: 'mono-area', tabindex: '0', 'aria-label': 'Error details' }, shownError.detail)) : null,
        shownError.retry || permission
          ? h(
              'div',
              { class: 'inline-actions' },
              permission ? h('button', { class: 'btn', onClick: openTokenSettings }, icon('external'), 'Edit token on GitHub') : null,
              shownError.retry ? h('button', { class: permission ? 'btn ghost' : 'btn', onClick: () => { const retry = state.error?.retry; state.error = undefined; retry?.(); } }, icon('refresh'), 'Try again') : null,
            )
          : null,
      )
    : null;

  // Offline: the callout's "Try again" is the one action; the bar's would fail the same way.
  if (shownError?.offline && view.bar) view.bar = { ...view.bar, disabled: true, hint: 'Offline', secondary: undefined, toggle: undefined };
  app.replaceChildren(tabs, h('main', { id: 'panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}`, 'aria-busy': state.busy ? 'true' : 'false' }, tokenCallout, error, view.body), ...([actionBar(view.bar)].filter(Boolean) as Node[]));

  const main = document.querySelector('main');
  if (main) main.scrollTop = scrollTop;
  watchDrawings();
  fitWindow();
  if (focusedId) (document.querySelector(`[data-focus-id="${focusedId}"]`) as HTMLElement | null)?.focus();
}

/** The window Figma opened (manifest default), the most a screen asks for, and the least Figma allows. */
const WINDOW_MAX = 640;
const WINDOW_MIN = 400;
let windowHeight = WINDOW_MAX;
let fitting = 0;

/**
 * A short result leaves no large empty area: the window shrinks to what the screen holds (down to Figma's minimum), and
 * grows back up to the default when a screen needs it. Asked once per frame, and only for a real difference.
 */
function fitWindow(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  cancelAnimationFrame(fitting);
  fitting = requestAnimationFrame(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const tabs = document.querySelector<HTMLElement>('.tabs')?.offsetHeight ?? 0;
    const bar = document.querySelector<HTMLElement>('.bar')?.offsetHeight ?? 0;
    const last = main.lastElementChild as HTMLElement | null;
    const content = last ? last.getBoundingClientRect().bottom - main.getBoundingClientRect().top + main.scrollTop + 16 : 0;
    const want = Math.round(Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, tabs + content + bar)));
    if (!content || Math.abs(want - windowHeight) < 24) return;
    windowHeight = want;
    void request('resize', { width: window.innerWidth || 480, height: want }).catch(() => undefined);
  });
}

/** One call at start (the repository) so a token GitHub stopped accepting shows before the designer tries an action. */
async function checkAccessOnStart(): Promise<void> {
  if (!connected()) return;
  const result = await checkToken(getClient());
  if (!result || result === state.init?.tokenState) return;
  setTokenState(result);
  render();
}

render();
loadInit()
  .then(() => {
    if (!connected()) state.tab = 'settings';
    render();
    void checkAccessOnStart();
    watchFixes();
  })
  .catch((err: unknown) => {
    state.error = { message: 'Close Bridge and open it again. If it keeps happening, report it with the details.', detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
    render();
  });
