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

import type { DiffEntry, GitHubClient, PullRequest } from '@bridge-ds/core';
import type { FigmaSnapshot } from '../shared/messages';
import { type ComponentChangeItem, type RequestDraft, suggestLine, suggestSummary, suggestTitle, toRequest } from './components';
import { type Analysis, type ExplorationTarget, type PushProposal, type PushResult, commitToExploration, openPullRequest } from './flows';
import { sendComponentRequest } from './requests';

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
  return description.trim() || `Changed in Figma${fileName ? ` ("${fileName}")` : ''} and sent for review with DS Bridge.`;
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
  now?: Date | undefined;
}

export interface PublishResult {
  pr?: PushResult | undefined;
  /** Sent to an exploration: its branch, and whether its files already held the variable edits. */
  exploration?: { branch: string; pr: PullRequest; unchanged: boolean } | undefined;
  requests: { component: string; nodeId: string; number: number; url: string }[];
  /** Requests that failed: the rest was still sent. */
  failed: { component: string; error: string }[];
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
  const out: PublishResult = { requests: [], failed: [], ...(input.exploration ? { exploration: { branch: input.exploration.branch, pr: input.exploration.pr, unchanged: !prFiles } } : {}) };
  if (prFiles && input.exploration) {
    const res = await commitToExploration(client, input.analysis, input.proposal, { target: input.exploration, title: input.title, notes: input.description, ...(input.now ? { now: input.now } : {}) });
    out.pr = res;
    out.exploration = { branch: res.branch, pr: res.pr, unchanged: res.unchanged };
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
    try {
      const img = input.image && d.nodeId ? await input.image(d.nodeId) : undefined;
      const res = await sendComponentRequest(client, {
        request: { ...toRequest(d, { fileKey: input.fileKey }), ...(input.exploration ? { exploration: input.exploration.branch } : {}) },
        images: img ? [img] : [],
        baseBranch: input.analysis.settings.branch,
        config: input.analysis.headFiles.config,
        coded: input.coded.includes(d.component),
        now: input.now,
      });
      out.requests.push({ component: d.component, nodeId: d.nodeId!, number: res.issue.number, url: res.issue.url });
    } catch (err) {
      out.failed.push({ component: d.component, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
