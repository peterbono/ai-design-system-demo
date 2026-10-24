// Push, the way Figma publishes a library: one "Changes" list grouped Variables / Components, a checkbox per item (all
// checked by default), a message, and one "Send for review" (or "Send to exploration"). Pure: no DOM, no figma.* (the UI and the main thread
// wire it).
//
// Product rules (plugin README, "Push"):
// - Checked variable edits go into the pull request. Unchecked ones stay in Figma, untouched, for a later push.
// - Checked component changes each become a request (a GitHub issue). Unchecked ones are not sent and keep their
//   baseline, so they show up again on the next scan.
// - Destination: "Send for review" (default) or "Try in an exploration": then variable edits are one commit on the
//   exploration branch and requests are labeled `exploration`, and experimental items start checked.
// - "Experimental" (like Figma's "Hide when publishing") is a durable mark on the variable or the component set
//   (shared plugin data dsbridge / experimental = "true"). Experimental items are listed with a tag and start unchecked
//   on every push; they can still be checked.
// - A component change that only adds a part an optional part already draws (an icon after the label while "Icon end"
//   exists) shows a hint and starts unchecked. The plugin never changes the designer's file for them.
// - The description is the pull request's "What changed and why" and the summary of every request sent with it.

import { createBuildRequestOnGitHub, tokenPublishRoute } from '@bridge-ds/core';
import type { PluginOutcome } from './library-routes';
import { type ChangesMode, type DiffEntry, type GitHubClient, type PullRequest, loadRepoFiles, openComponentPushOnGitHub, planTokenProposal, suggestTokenProposalOnGitHub, writeTokenProposalOnGitHub } from '@bridge-ds/core';
import { type ComponentPush, libraryTokens, pushPairs } from './component-push';
import type { FigmaSnapshot } from '../shared/messages';
import { type ComponentChangeItem, type RequestDraft, suggestLine, suggestSummary, suggestTitle, toRequest } from './components';
import type { VariableTag } from '../shared/messages';
import { type Analysis, type ExplorationTarget, type PushProposal, type PushResult, commitToExploration, openPullRequest, sendSuggestion } from './flows';
import { sendComponentRequest, uploadImages, uploadImagesIfAllowed } from './requests';
import { type TokenProblem, errorText, tokenProblem } from './token-health';

export { EXPERIMENTAL_KEY } from '../shared/messages';

export type PublishKind = 'variable' | 'component';

export interface PublishItem {
  /** "v:<token id>" or "c:<node id>": the selection key. */
  key: string;
  kind: PublishKind;
  /** Token id (variables) or component node id. */
  id: string;
  /** Token path or component name, for lists. */
  label: string;
  experimental: boolean;
  /** Edits on both sides: needs a decision before it can go in the pull request. */
  conflict?: boolean | undefined;
  /** An optional part of the component already does what was added: the hint on the row ("Icon end already does this..."). */
  hint?: string | undefined;
  /** Every change is such an addition: starts unchecked, like an experimental item. */
  suggestSkip?: boolean | undefined;
}

export const variableKey = (tokenId: string) => `v:${tokenId}`;
export const componentKey = (nodeId: string) => `c:${nodeId}`;

/** Token ids with at least one experimental variable (several variables per token in the split layout). */
export function experimentalTokenIds(a: Pick<Analysis, 'figma'>, snapshot: FigmaSnapshot): Set<string> {
  const marked = new Set(snapshot.variables.filter((v) => v.experimental).map((v) => v.id));
  const out = new Set<string>();
  for (const [tokenId, ids] of a.figma.variableIds) if (ids.some((id) => marked.has(id))) out.add(tokenId);
  return out;
}

/** Figma variable ids of a token, to mark them all. */
export const variableIdsOf = (a: Pick<Analysis, 'figma'>, tokenId: string) => a.figma.variableIds.get(tokenId) ?? [];

const pathOf = (e: DiffEntry) => (e.figma ?? e.head ?? e.base)?.path ?? e.path;

/** Everything a push can send, variables first, in the order the diff lists them. */
export function publishItems(a: Pick<Analysis, 'diff'>, experimentalTokens: ReadonlySet<string>, components: ComponentChangeItem[]): PublishItem[] {
  const vars: PublishItem[] = [...a.diff.local, ...a.diff.conflicts].map((e) => ({
    key: variableKey(e.id),
    kind: 'variable',
    id: e.id,
    label: pathOf(e),
    experimental: experimentalTokens.has(e.id),
    ...(a.diff.conflicts.includes(e) ? { conflict: true } : {}),
  }));
  const comps: PublishItem[] = components.map((c) => ({
    key: componentKey(c.nodeId),
    kind: 'component',
    id: c.nodeId,
    label: c.component,
    experimental: !!c.experimental,
    ...(c.equivalent ? { hint: c.equivalent } : {}),
    ...(c.suggestSkip ? { suggestSkip: true } : {}),
  }));
  return [...vars, ...comps];
}

/** Where a push goes: for review (a pull request to the base branch, requests for the team) or to an exploration. */
export type Destination = 'review' | 'exploration';

/**
 * Every push starts with all items checked except the component changes an optional part already covers (the row says
 * which property shows it; checking the item sends the request anyway) and, for review, the experimental ones.
 * Experimental items are what explorations are for: sent to an exploration, they start checked.
 */
export const defaultUnchecked = (items: PublishItem[], destination: Destination = 'review') =>
  new Set(items.filter((i) => (i.experimental && destination === 'review') || i.suggestSkip).map((i) => i.key));

/** Switching the destination resets the experimental items to that destination's default; other choices stay. */
export function applyDestination(items: PublishItem[], unchecked: Set<string>, destination: Destination): void {
  for (const i of items) if (i.experimental) (destination === 'review' ? unchecked.add(i.key) : unchecked.delete(i.key));
}

export const isChecked = (unchecked: ReadonlySet<string>, item: Pick<PublishItem, 'key'>) => !unchecked.has(item.key);

/** Token ids the designer unchecked: kept in Figma, out of the pull request. */
export function heldTokenIds(items: PublishItem[], unchecked: ReadonlySet<string>): Set<string> {
  return new Set(items.filter((i) => i.kind === 'variable' && unchecked.has(i.key)).map((i) => i.id));
}

/** Group checkbox state: all, none or some of the group's items checked. */
export function groupState(items: PublishItem[], unchecked: ReadonlySet<string>, kind: PublishKind): 'all' | 'none' | 'some' | 'empty' {
  const g = items.filter((i) => i.kind === kind);
  if (!g.length) return 'empty';
  const on = g.filter((i) => !unchecked.has(i.key)).length;
  return on === g.length ? 'all' : on === 0 ? 'none' : 'some';
}

/** Checks or unchecks a whole group ("select all" on the group header). */
export function setGroup(items: PublishItem[], unchecked: Set<string>, kind: PublishKind, checked: boolean): void {
  for (const i of items) if (i.kind === kind) (checked ? unchecked.delete(i.key) : unchecked.add(i.key));
}

/** The summary a request gets: the push description, or a factual line when it is empty. */
export function requestSummary(description: string, fileName: string): string {
  return description.trim() || `Changed in Figma${fileName ? ` ("${fileName}")` : ''} and sent for review with Bridge.`;
}

/**
 * One request draft per checked component change, with the push description as its summary. When the description is
 * still the plugin's own draft (`descriptionIsDraft`), each request gets its own drafted summary instead: a line about
 * the variables says nothing about a component. Each request opens with its change line: Claude's (`lines`, by node
 * id) or the drafted one, and is titled with Claude's title for it (`titles`, by node id) or the drafted title.
 */
export function componentDrafts(
  components: ComponentChangeItem[],
  unchecked: ReadonlySet<string>,
  description: string,
  fileName: string,
  descriptionIsDraft = false,
  lines?: ReadonlyMap<string, string>,
  titles?: ReadonlyMap<string, string>,
): RequestDraft[] {
  return components
    .filter((c) => !unchecked.has(componentKey(c.nodeId)))
    .map((c) => ({
      component: c.component,
      kind: c.kind,
      title: titles?.get(c.nodeId) || suggestTitle(c),
      summary: (descriptionIsDraft && suggestSummary(c)) || requestSummary(description, fileName),
      line: lines?.get(c.nodeId) || suggestLine(c),
      changes: c.changes,
      nodeId: c.nodeId,
      nodeName: c.figmaName,
    }));
}

// ---------------------------------------------------------------------------------------------
// Send: the pull request (or the exploration commit) for the checked variables, one request per checked component change

export interface PublishInput {
  analysis: Analysis;
  /** buildPush with the unchecked variables held. */
  proposal: PushProposal;
  /** Component changes the scan found (checked or not). */
  components: ComponentChangeItem[];
  unchecked: ReadonlySet<string>;
  /** "Description": the pull request's "What changed and why" and every request's summary. */
  description: string;
  /** True while the description is the plugin's deterministic draft (nobody typed it). */
  descriptionIsDraft?: boolean | undefined;
  /** Change lines Claude wrote, by component node id; the others get the drafted line. */
  lines?: ReadonlyMap<string, string> | undefined;
  /** Request titles Claude wrote, by component node id; the others get the drafted title. */
  titles?: ReadonlyMap<string, string> | undefined;
  /** Pull request title; empty: the default title from the changes. */
  title: string;
  fileName: string;
  fileKey?: string | undefined;
  appendTo?: PullRequest | undefined;
  /**
   * Send to this exploration instead of for review: variable edits become one commit on its branch (its draft pull
   * request, never a new one to main) and each request is labeled `exploration`, to be implemented on that branch.
   */
  exploration?: ExplorationTarget | undefined;
  /** Coded component names (a request links to the component folder). */
  coded: string[];
  /** PNG (base64) of a component to attach to its request; undefined to attach nothing. */
  image?: ((nodeId: string) => Promise<string | undefined>) | undefined;
  /**
   * The route of each component change (componentPushes). For review, a checked change goes to its library branch: an
   * exact token change or a branch Claude AI drafts; a change to fix in Figma, or a blocked token change, is held.
   * Without it (or to an exploration), each change is a request as before.
   */
  pushes?: ComponentPush[] | undefined;
  /** GitHub login of the designer, for the "From Figma" line. */
  requestedBy?: string | undefined;
  /**
   * How the repo takes changes (changesModeOf: bridge.config.json "changes"). "direct" (the default here, so existing
   * callers keep their behaviour): branches and pull requests. "suggest": the variable edits and every component change
   * are suggestions (issues), never a branch or a pull request; images go to the requests branch only when the token
   * can write contents, else the Figma node links stand in.
   */
  mode?: ChangesMode | undefined;
  now?: Date | undefined;
}

/** A suggestion a push filed (suggest mode): the variable edits, a new brand, or one component change. */
export interface SentSuggestionItem {
  kind: 'variables' | 'brand' | 'token-change' | 'component-spec';
  number: number;
  url: string;
  title?: string | undefined;
  component?: string | undefined;
  nodeId?: string | undefined;
}

/** One component change sent: its library branch (direct), or its suggestion (suggest: `suggested`, no branch). */
export interface SentComponentPush {
  component: string;
  nodeId: string;
  route: 'token-change' | 'claude-draft';
  number: number;
  url: string;
  branch?: string | undefined;
  suggested?: boolean | undefined;
  /** The screenshot was not stored: the token cannot write contents. The Figma node links stand in. */
  imagesSkipped?: boolean | undefined;
  /** Direct mode, code needed: the build request issue developers pick up (Jira mirrors it), linked both ways to the branch. */
  buildRequest?: { number: number; url: string } | undefined;
}

export interface PublishResult {
  pr?: PushResult | undefined;
  /** Sent to an exploration: its branch, and whether its files already held the variable edits. */
  exploration?: { branch: string; pr: PullRequest; unchanged: boolean } | undefined;
  /** Exact token changes written on the exploration branch (they show in its previews), one per component. */
  explorationTokens?: { component: string; nodeId: string }[] | undefined;
  requests: { component: string; nodeId: string; number: number; url: string }[];
  /** Library branches opened from Figma components: exact token changes and branches a developer builds with Claude. */
  branches: (SentComponentPush & { branch: string })[];
  /** Suggest mode: the suggestions filed, the variable edits first. */
  suggestions: SentSuggestionItem[];
  /** Suggest mode: variable tags to store (direct mode has them on `pr`). */
  tags?: VariableTag[] | undefined;
  /** Suggest mode: images were not stored because the token cannot write contents (Figma node links instead). */
  imagesSkipped?: boolean | undefined;
  /** Checked component changes not sent, with why: fix them in Figma first, or a token change that breaks the gate. */
  held: { component: string; nodeId: string; why: string }[];
  /** Requests that failed: the rest was still sent. */
  failed: { component: string; error: string; problem?: TokenProblem['kind'] | undefined }[];
  /**
   * Sent to the library (direct mode, not an exploration): where each token and component went, as core's
   * PublishOutcome (docs/BUILD-REQUESTS.md). Empty otherwise.
   */
  outcomes: PluginOutcome[];
}

/** What a push would send: the files of the pull request (empty when no variable is checked) and the request drafts. */
export function publishPlan(input: Pick<PublishInput, 'proposal' | 'components' | 'unchecked' | 'description' | 'fileName' | 'descriptionIsDraft' | 'lines' | 'titles'>): { prFiles: number; drafts: RequestDraft[] } {
  return {
    prFiles: Object.keys(input.proposal.files).length + input.proposal.brandFiles.length,
    drafts: componentDrafts(input.components, input.unchecked, input.description, input.fileName, input.descriptionIsDraft, input.lines, input.titles),
  };
}

export async function publish(client: GitHubClient, input: PublishInput): Promise<PublishResult> {
  const { prFiles, drafts } = publishPlan(input);
  if (!prFiles && !drafts.length) throw new Error('Nothing is checked. Check a variable or a component to push.');
  const mode = input.mode ?? 'direct';
  if (mode === 'suggest' && input.exploration) throw new Error('This repo takes changes as suggestions, and an exploration is a branch: send it for review as a suggestion instead.');
  const out: PublishResult = { requests: [], branches: [], suggestions: [], held: [], failed: [], outcomes: [], ...(input.exploration ? { exploration: { branch: input.exploration.branch, pr: input.exploration.pr, unchanged: false } } : {}) };
  if (prFiles && input.exploration) {
    const res = await commitToExploration(client, input.analysis, input.proposal, { target: input.exploration, title: input.title, notes: input.description, ...(input.now ? { now: input.now } : {}) });
    out.pr = res;
    out.exploration = { branch: res.branch, pr: res.pr, unchanged: res.unchanged };
  } else if (prFiles && mode === 'suggest') {
    const res = await sendSuggestion(client, input.analysis, input.proposal, { title: input.title, notes: input.description, fileName: input.fileName, fileKey: input.fileKey, suggestedBy: input.requestedBy, now: input.now });
    out.suggestions.push(...res.suggestions.map((x) => ({ kind: x.kind === 'brand' ? ('brand' as const) : ('variables' as const), number: x.number, url: x.url, title: x.title })));
    out.tags = res.tags;
  } else if (prFiles) {
    out.pr = await openPullRequest(client, input.analysis, input.proposal, {
      title: input.title,
      notes: input.description,
      fileName: input.fileName,
      appendTo: input.appendTo,
      ...(input.now ? { now: input.now } : {}),
    });
  }
  for (const d of drafts) {
    const planned = input.pushes?.find((p) => p.nodeId === d.nodeId);
    // An exact token change sent to an exploration is written there (no AI needed), so trying the exploration shows it.
    if (input.exploration && planned && planned.plan.route === 'token-change' && !planned.blocked) {
      try {
        const r = await commitTokenChangeToExploration(client, input.analysis, input.exploration, planned, d);
        if (r.blocked) out.held.push({ component: d.component, nodeId: d.nodeId!, why: r.blocked });
        else (out.explorationTokens ??= []).push({ component: d.component, nodeId: d.nodeId! });
      } catch (err) {
        out.failed.push({ component: d.component, error: errorText(err), problem: tokenProblem(err)?.kind });
      }
      continue;
    }
    const push = !input.exploration ? planned : undefined;
    if (push) {
      if (push.blocked || push.plan.route === 'manual') {
        out.held.push({ component: d.component, nodeId: d.nodeId!, why: push.blocked ?? (push.plan.issues.map((i) => `${i.what} ${i.todo}`).join(' ') || push.plan.said) });
        continue;
      }
      try {
        const sent = await sendComponentPush(client, { ...input, mode }, push, d);
        if (sent.imagesSkipped) out.imagesSkipped = true;
        if (sent.suggested) out.suggestions.push({ kind: sent.route === 'token-change' ? 'token-change' : 'component-spec', number: sent.number, url: sent.url, component: sent.component, nodeId: sent.nodeId });
        else out.branches.push({ ...sent, branch: sent.branch ?? '' });
      } catch (err) {
        out.failed.push({ component: d.component, error: errorText(err), problem: tokenProblem(err)?.kind });
      }
      continue;
    }
    try {
      const img = input.image && d.nodeId ? await input.image(d.nodeId) : undefined;
      const res = await sendComponentRequest(client, {
        request: { ...toRequest(d, { fileKey: input.fileKey }), ...(input.exploration ? { exploration: input.exploration.branch } : {}) },
        images: img ? [img] : [],
        baseBranch: input.analysis.settings.branch,
        config: input.analysis.headFiles.config,
        coded: input.coded.includes(d.component),
        imagesNeedWrite: mode === 'suggest',
        now: input.now,
      });
      if (res.imagesSkipped) out.imagesSkipped = true;
      out.requests.push({ component: d.component, nodeId: d.nodeId!, number: res.issue.number, url: res.issue.url });
    } catch (err) {
      out.failed.push({ component: d.component, error: errorText(err), problem: tokenProblem(err)?.kind });
    }
  }
  if (mode === 'direct' && !input.exploration) out.outcomes = libraryOutcomes(out, input.proposal);
  return out;
}

/** A planned token change, as core's token change kinds: a rename or a removal waits for a developer. */
const changeKind = (c: PushProposal['changes'][number]) => (!c.target ? 'removed' : !c.current ? 'added' : c.target.path !== c.current.path ? 'renamed' : 'changed');

/**
 * Where each sent item went in the library. Bridge cannot arm a merge from the plugin yet (the arm endpoint comes with
 * the server), so token values report waiting-for-developer ("not-armed") until it does; a rename or removal always
 * waits. Components that need code are build requests: a library branch from Figma, or a request issue.
 */
export function libraryOutcomes(out: PublishResult, proposal: PushProposal, armed = false): PluginOutcome[] {
  const outcomes: PluginOutcome[] = [];
  if (out.pr && !out.pr.appended) {
    const ref = { kind: 'pull' as const, number: out.pr.pr.number, url: out.pr.pr.url };
    for (const c of proposal.changes) {
      const kind = changeKind(c);
      const route = tokenPublishRoute([{ kind }], armed);
      const name = (c.target ?? c.current)!.path;
      outcomes.push({ subject: { type: 'token', name }, route, ref, ...(route === 'shipped' ? { armed: true } : { waitingFor: kind === 'renamed' || kind === 'removed' ? 'rename' : 'not-armed' }) });
    }
  }
  for (const b of out.branches) {
    const ref = { kind: 'pull' as const, number: b.number, url: b.url };
    if (b.route === 'token-change') outcomes.push({ subject: { type: 'component', name: b.component }, route: armed ? 'shipped' : 'waiting-for-developer', ref, ...(armed ? { armed: true } : { waitingFor: 'not-armed' as const }) });
    else outcomes.push({ subject: { type: 'component', name: b.component }, route: 'build-request', ref: b.buildRequest ? { kind: 'issue', ...b.buildRequest } : ref });
  }
  for (const r of out.requests) outcomes.push({ subject: { type: 'component', name: r.component }, route: 'build-request', ref: { kind: 'issue', number: r.number, url: r.url } });
  return outcomes;
}

/**
 * An exact token change sent to an exploration: the same plan as for review (contrast gate included), written on the
 * exploration branch as one commit. Planned on the exploration's own tokens, so earlier edits there stay. The commit
 * touches token files, so the exploration's visual impact (Studio) shows the change.
 */
export async function commitTokenChangeToExploration(client: GitHubClient, a: Analysis, target: ExplorationTarget, push: ComponentPush, d: RequestDraft): Promise<{ committed: boolean; blocked?: string }> {
  const tip = await client.getBranchSha(target.branch);
  if (!tip) throw new Error(`The exploration ${target.branch} is gone. Pick another one, or start a new one.`);
  const there = await loadRepoFiles(client, tip, a.settings.tokensPath);
  const lib = libraryTokens({ config: there.config ?? a.headFiles.config, files: there.files });
  if (!lib) throw new Error('This repo has no bridge.config.json, so Bridge cannot write the token change.');
  const p = planTokenProposal({ before: lib.before, pairs: pushPairs(a.head, a.pairs, push.plan.edits), edits: push.plan.edits, title: d.title || `${d.component}: token change from Figma`, summary: d.summary, config: lib.config, tool: 'the Bridge Figma plugin' });
  if (!p) return { committed: false };
  if (p.blocked) return { committed: false, blocked: `${p.blocked}. Fix it in Figma, then send again.` };
  const blobs2: { path: string; sha: string | null }[] = [];
  for (const f of p.files) blobs2.push({ path: f.path, sha: f.content === null ? null : await client.createBlob(f.content) });
  const tree = await client.createTree(await client.getCommitTree(tip), blobs2);
  const commit = await client.createCommit(`${p.title}\n\nExact token change from Figma (${d.component}). Exploration ${target.branch}: not merged as is.`, tree, [tip]);
  await client.updateBranch(target.branch, commit);
  return { committed: true };
}

/**
 * One component change to its library branch, linked to the Figma component: an exact token swap through the shared
 * token proposal write (contrast gate, tier, changeset, label from-figma), or a draft branch carrying the spec with a
 * screenshot, for Claude AI to write the code (label waiting-for-claude until it has).
 * Suggest mode: the same change as a suggestion (a token suggestion, or a component spec suggestion with the Figma
 * node links Claude Code reads the design from). The screenshot still goes to the requests branch when the token can
 * write contents; with a read-only token the node links stand in (`imagesSkipped`).
 */
type SendPushInput = Pick<PublishInput, 'analysis' | 'image' | 'requestedBy' | 'now' | 'fileKey' | 'mode'>;
export async function sendComponentPush(client: GitHubClient, input: SendPushInput & { mode?: 'direct' | undefined }, push: ComponentPush, d: RequestDraft): Promise<SentComponentPush & { branch: string }>;
export async function sendComponentPush(client: GitHubClient, input: SendPushInput, push: ComponentPush, d: RequestDraft): Promise<SentComponentPush>;
export async function sendComponentPush(client: GitHubClient, input: SendPushInput, push: ComponentPush, d: RequestDraft): Promise<SentComponentPush> {
  const mode = input.mode ?? 'direct';
  const a = input.analysis;
  const lib = libraryTokens(a.headFiles);
  const config = a.headFiles.config;
  let diff = { ...push.diff, title: d.title, summary: d.summary, ...(d.line ? { line: d.line } : {}), ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}) };
  let imagesSkipped = false;
  if (push.plan.route === 'claude-draft' && input.image && d.nodeId) {
    const img = await input.image(d.nodeId);
    const up = { component: d.component, images: img ? [img] : [], baseBranch: a.settings.branch, now: input.now };
    let images: string[] = [];
    if (mode === 'suggest') ({ urls: images, skipped: imagesSkipped } = await uploadImagesIfAllowed(client, up));
    else images = img ? await uploadImages(client, up) : [];
    if (images.length) diff = { ...diff, images };
  }
  // The route was planned at scan time with every component of the file (where else each token paints); sending keeps it.
  const r = await openComponentPushOnGitHub(client, {
    diff,
    plan: push.plan,
    base: a.settings.branch,
    branchPrefix: config?.governance.branchPrefix ?? 'bridge/',
    labels: ['source: figma'],
    tool: 'the Bridge Figma plugin',
    mode,
    ...(input.requestedBy ? { suggestedBy: input.requestedBy } : {}),
    writeTokens: async ({ title, summary, bodyExtra, figma }) => {
      if (!lib) throw new Error('This repo has no bridge.config.json, so Bridge cannot write the token change.');
      const p = planTokenProposal({ before: lib.before, pairs: pushPairs(a.head, a.pairs, push.plan.edits), edits: push.plan.edits, title, summary, config: lib.config, tool: 'the Bridge Figma plugin', bodyExtra });
      if (!p) throw new Error('The library already paints it this way: nothing to send.');
      if (mode === 'suggest') {
        const s = await suggestTokenProposalOnGitHub(client, p, { base: a.settings.branch, baseSha: a.headSha, source: 'figma', suggestedBy: input.requestedBy, labelsAfter: ['source: figma'], links: { figma } });
        return { status: 'suggested', number: s.number, url: s.url };
      }
      const opened = await writeTokenProposalOnGitHub(client, p, { base: a.settings.branch, branchPrefix: lib.config.governance.branchPrefix, labels: [], labelsAfter: ['source: figma'], tool: 'the Bridge Figma plugin', draft: false });
      return { number: opened.pr, url: opened.url, branch: opened.branch };
    },
  });
  const skipped = imagesSkipped ? { imagesSkipped: true } : {};
  if (r.suggestion) return { component: d.component, nodeId: d.nodeId!, route: r.suggestion.route, number: r.suggestion.number, url: r.suggestion.url, suggested: true, ...skipped };
  if (!r.link) throw new Error(r.plan.said);
  const buildRequest = mode === 'direct' && r.link.route === 'claude-draft' ? await fileBuildRequest(client, input, d, r.link, diff.images) : undefined;
  return { component: d.component, nodeId: d.nodeId!, route: r.link.route, number: r.link.number, url: r.link.url, branch: r.link.branch, ...skipped, ...(buildRequest ? { buildRequest } : {}) };
}

/**
 * Code needed: the build request issue developers pick up and assign (labels component-change and bridge-build, so
 * Jira mirrors it), pointing at the library branch that carries the spec; the branch's pull request then says
 * "Closes #n", so Being built shows one item (the issue) with the branch as its work in progress.
 */
async function fileBuildRequest(client: GitHubClient, input: SendPushInput, d: RequestDraft, link: { number: number; url: string }, images: string[] | undefined): Promise<{ number: number; url: string }> {
  const { images: _ignored, ...req } = toRequest(d, { fileKey: input.fileKey, requestedBy: input.requestedBy });
  const opts = input.analysis.headFiles.config?.integrations?.requests;
  const issue = await createBuildRequestOnGitHub(
    client,
    { ...req, figma: req.figma ?? {}, ...(images?.length ? { images: { after: images } } : {}), specPath: link.url, source: 'figma' },
    { labels: opts?.labels ?? [], assignees: opts?.assignees ?? [] },
  );
  const pr = await client.getPullRequest(link.number);
  await client.updatePullRequest(link.number, { body: `${pr.body ?? ''}\n\nCloses #${issue.ref.number}` });
  return { number: issue.ref.number, url: issue.ref.url };
}

// ---------------------------------------------------------------------------------------------
// Wording per change mode (bridge.config.json "changes"): one source for the bar, the result and the token help.

/**
 * The one verb for sending, everywhere in the plugin (the bar, a component row, the request form): "Send to the library"
 * when changes go straight to it (docs/BUILD-REQUESTS.md), "Send suggestion" when the DS lead decides first.
 */
export const sendLabel = (mode: ChangesMode) => (mode === 'suggest' ? 'Send suggestion' : 'Send to the library');

/** The result title: "Suggestion sent to your DS lead" (suggest), "Sent to the library" (direct). No issue numbers. */
export function sentTitle(res: Pick<PublishResult, 'suggestions'>, mode: ChangesMode): string {
  if (mode !== 'suggest' || !res.suggestions.length) return 'Sent to the library';
  return res.suggestions.length === 1 ? 'Suggestion sent to your DS lead' : `${res.suggestions.length} suggestions sent to your DS lead`;
}

/** One line per suggestion filed, for the result text. */
export function suggestionLines(res: Pick<PublishResult, 'suggestions'>): string[] {
  return res.suggestions.map((s) =>
    s.kind === 'variables'
      ? 'Variable edits: suggested, checked for contrast.'
      : s.kind === 'brand'
        ? `${s.title ?? 'New brand'}: suggested.`
        : s.kind === 'token-change'
          ? `${s.component}: an exact token change, suggested.`
          : `${s.component}: suggested. Once it is approved, a developer builds it with Claude from the Figma link.`,
  );
}

/** Shown when a read-only token could not store screenshots: the suggestion links the Figma nodes instead. */
export const IMAGES_NEED_WRITE = 'Screenshots need write access: this token cannot write contents, so the suggestion links the Figma nodes instead (Claude reads them from Figma). To attach screenshots too, set "Contents" to "Read and write" on the token.';

/** The token help for the change mode; both when the mode is not known yet (before a scan). Designer words only. */
export function tokenHelp(mode: ChangesMode | undefined): string {
  const suggest = 'To send suggestions: "Issues" set to "Read and write", "Contents" and "Pull requests" set to "Read". Add "Contents: Read and write" to attach screenshots.';
  const direct = 'To send changes for review: "Contents", "Pull requests" and "Issues" set to "Read and write".';
  if (mode === 'suggest') return `A fine-grained token for this repository only. ${suggest}`;
  if (mode === 'direct') return `A fine-grained token for this repository only. ${direct}`;
  return `A fine-grained token for this repository only. ${suggest} ${direct.replace(/^To/, 'If your team sends changes straight to review, to')} Not sure? Ask your design system's owner.`;
}
