// "Change this component" in the Studio Components drawer: the designer drives the change, a developer builds it
// with Claude and checks the code. The drawer first asks what she wants to change (three intents), then leads to the
// flow that does it: the component's tokens, an exploration a developer builds from her Figma frame, or a mismatch report. The
// words and the rules live here, pure and tested (change-intent.test.ts); scripts/request-form.ts paints them.
import type { BuildRequestInput, ComponentChangeRequest, RequestKind } from '@bridge-ds/core';
import { ghAction } from './gh-wording';
import { requestFromForm, type RequestForm } from './requests-view';

export type ChangeIntent = 'look' | 'variant' | 'wrong';

export interface IntentOption {
  value: ChangeIntent;
  label: string;
  /** One plain line: what happens when she picks it. */
  line: string;
}

export const CHANGE_INTENTS: IntentOption[] = [
  { value: 'look', label: 'Adjust the look', line: 'Colors, radius, spacing, type. You edit its tokens. The before and after goes to review.' },
  {
    value: 'variant',
    label: 'Add a variant or option',
    line: 'A new variant, size, state or option, designed in Figma. A developer builds it with Claude from your Figma frame, in an exploration. You check it in the component sandbox, then send it for review.',
  },
  { value: 'wrong', label: 'Something looks wrong', line: 'It does not match Figma, or it behaves badly. Report the mismatch with the frame.' },
];

/** The line under "Adjust the look" when the component paints with no token (a layout component). */
export const NO_TOKEN_LINE = 'It paints with no token of its own, so there is nothing to adjust here.';

export const isChangeIntent = (x: unknown): x is ChangeIntent => x === 'look' || x === 'variant' || x === 'wrong';

/** The intent options for one component: "Adjust the look" is off when it has no token to edit. */
export function intentOptions(hasTokens: boolean): (IntentOption & { disabled: boolean })[] {
  return CHANGE_INTENTS.map((o) => (o.value === 'look' && !hasTokens ? { ...o, line: NO_TOKEN_LINE, disabled: true } : { ...o, disabled: false }));
}

/**
 * The form the drawer shows: `explore` (Add a variant or option, a developer builds it with Claude), `ask` (the same need sent to a
 * developer instead) or `mismatch` (Something looks wrong). Null for "Adjust the look": that one is a link to the
 * component's tokens, no form.
 */
export type ChangeFormMode = 'explore' | 'ask' | 'mismatch';

export const formModeFor = (intent: ChangeIntent): ChangeFormMode | null => (intent === 'variant' ? 'explore' : intent === 'wrong' ? 'mismatch' : null);

/** The request kind each form sends (the existing kinds of @bridge-ds/core, so the labels stay `request: <kind>`). */
export const REQUEST_KIND_OF: Record<ChangeFormMode, RequestKind> = { explore: 'new-variant', ask: 'new-variant', mismatch: 'bug' };

export interface ChangeFormCopy {
  heading: string;
  title: { label: string; placeholder: string };
  summary: { label: string; placeholder: string };
  /** The "What, now, in Figma" rows: only a mismatch lists values. */
  changes: boolean;
  /** The Figma frame link and the image: required for an exploration (the developer builds from them), else optional. */
  frame: { required: boolean; link: string; image: string };
  /** The quiet switch between an exploration and a plain request, keeping what she typed. */
  swap: { to: ChangeFormMode; label: string } | null;
  submit: string;
  busy: string;
  /** The signed-out final action: it opens the GitHub connect dialog. */
  connect: string;
  /** What blocks the submit, per empty field, saying how to fix it. */
  missing: { title: string; summary: string; frame: string };
}

/** The words of the form in each mode. */
export function changeFormCopy(mode: ChangeFormMode, component: string, signIn = false): ChangeFormCopy {
  const add = { label: 'What to add', placeholder: 'A danger ghost variant' };
  const why = { label: 'What it is for', placeholder: `Where you need it, and how it differs from the ${component} we have.` };
  const missing = { title: 'Say what to add, for example "A danger ghost variant".', summary: 'Say what it is for and where you need it.', frame: FRAME_MISSING };
  const optional = { required: false, link: 'Figma link (optional)', image: 'Image (optional)' };
  if (mode === 'explore')
    return {
      heading: 'Describe the new option',
      title: add,
      summary: why,
      changes: false,
      frame: { required: true, link: 'Figma link', image: 'Image' },
      swap: { to: 'ask', label: 'Send a plain request instead' },
      submit: 'Start exploration',
      busy: 'Starting exploration',
      connect: ghAction('start', signIn),
      missing,
    };
  if (mode === 'ask')
    return {
      heading: 'Ask a developer',
      title: add,
      summary: why,
      changes: false,
      frame: optional,
      swap: { to: 'explore', label: 'Start an exploration instead' },
      submit: 'Send to a developer',
      busy: 'Sending',
      connect: ghAction('send', signIn),
      missing,
    };
  return {
    heading: 'Report a mismatch',
    title: { label: 'What looks wrong', placeholder: 'The focus ring is thinner than in Figma' },
    summary: { label: 'Details', placeholder: 'Where you saw it, what Figma shows, and what it does instead.' },
    changes: true,
    frame: optional,
    swap: null,
    submit: 'Send report',
    busy: 'Sending report',
    connect: ghAction('send', signIn),
    missing: { title: 'Say what looks wrong, for example "The focus ring is thinner than in Figma".', summary: 'Add the details: where you saw it and what Figma shows.', frame: FRAME_MISSING },
  };
}

/** Said when an exploration has neither a Figma link nor an image. */
export const FRAME_MISSING = 'Add the Figma frame link or an image: the developer builds it from your design.';

/**
 * Problems that block the submit, in the words of the form she sees. Empty when it can be sent. An exploration needs a
 * Figma link or an image (`figma`, `image`): without the design, nobody can build it.
 */
export function changeFormProblems(mode: ChangeFormMode, f: { title: string; summary: string; figma?: string; image?: boolean }): string[] {
  const { missing, frame } = changeFormCopy(mode, '');
  const noFrame = frame.required && !(f.figma ?? '').trim() && !f.image;
  return [...(f.title.trim() ? [] : [missing.title]), ...(f.summary.trim() ? [] : [missing.summary]), ...(noFrame ? [missing.frame] : [])];
}

/** The request a form sends: the existing request shape, with the kind its mode stands for. */
export function changeRequest(component: string, mode: ChangeFormMode, f: Omit<RequestForm, 'kind'>, requestedBy?: string): ComponentChangeRequest {
  const changes = REQUEST_KIND_OF[mode] === 'bug' ? f.changes : [];
  return requestFromForm(component, { ...f, kind: REQUEST_KIND_OF[mode], changes }, requestedBy);
}

/** What the drawer says once the request is sent, in the designer's words. */
export function sentLine(mode: Exclude<ChangeFormMode, 'explore'>, n: number): string {
  return mode === 'mismatch' ? `Report #${n} sent. It closes when the fix ships.` : `Request #${n} sent. It closes when the change ships.`;
}

/** What the drawer says once the exploration started: a developer builds it with Claude, from the message she sends. */
export function startedLines(name: string, request: number): { lead: string; next: string } {
  return {
    lead: `${name} is ready for a developer.`,
    next: `A developer builds request #${request} with Claude, in the exploration. Copy the message below and send it to them. You check the result in the component sandbox, then send it for review.`,
  };
}

/** The label of the copy button under the message, and what it says once copied. */
export const COPY_MESSAGE = { label: 'Copy message', done: 'Message copied', field: 'Message for the developer' } as const;

/**
 * The message a designer sends a developer once the exploration started: what to build, the design (Figma frame,
 * image), where it lives in Studio, and what to say to Claude. Plain text, ready to paste in chat or email.
 */
export function developerMessage(x: { component: string; title: string; request: number; figma?: string | null; image?: string | null; exploration: string; requestUrl?: string | null }): string {
  return [
    `Hi, can you build this ${x.component} change with Claude? ${x.title.trim()}`,
    '',
    ...(x.figma ? [`Figma frame: ${x.figma}`] : []),
    ...(x.image ? [`Image: ${x.image}`] : []),
    ...(x.requestUrl ? [`Request: ${x.requestUrl}`] : []),
    `Exploration in Studio: ${x.exploration}`,
    '',
    `In Claude Code with the Bridge MCP server, say "build Bridge request #${x.request}". Claude reads the request and the design, then works in the exploration. I check it in the sandbox and send it for review.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// "Change this component" on a team (the hosted Components drawer, components/ds/studio/ChangeComponent.tsx). The
// same three paths as Bridge's own drawer, for a team whose developers build from build requests
// (docs/BUILD-REQUESTS.md): "Adjust the look" leads to the team's token editor; "Add a variant or option" (a variant,
// an option or a layout) and "Something looks wrong" each file one build request, the same issue the Figma plugin
// files (@bridge-ds/core composeBuildRequestIssue), so Being built, the CLI and the MCP server read it the same way.

/** The intents on a team: the same three, the second one said for a build request. */
export const TEAM_CHANGE_INTENTS: IntentOption[] = [
  CHANGE_INTENTS[0]!,
  {
    value: 'variant',
    label: 'Add a variant or option',
    line: 'A new variant, size, option or layout, designed in Figma. Your developers build it from your Figma frame, and you follow it in Being built until it is in the library.',
  },
  { value: 'wrong', label: 'Something looks wrong', line: 'It does not match Figma, or it behaves badly. Your developers get the report with the frame and fix it.' },
];

/** The intent options of a team's component: "Adjust the look" is off when it has no token to edit. */
export function teamIntentOptions(hasTokens: boolean): (IntentOption & { disabled: boolean })[] {
  return TEAM_CHANGE_INTENTS.map((o) => (o.value === 'look' && !hasTokens ? { ...o, line: NO_TOKEN_LINE, disabled: true } : { ...o, disabled: false }));
}

/** The form on a team: a structure change or a mismatch report. Null for "Adjust the look" (a link). */
export type BuildFormMode = 'structure' | 'mismatch';

export const buildModeFor = (intent: ChangeIntent): BuildFormMode | null => (intent === 'variant' ? 'structure' : intent === 'wrong' ? 'mismatch' : null);

/** What kind of structure change, in her words, and the build request kind it files. */
export const STRUCTURE_KINDS: { value: 'new-variant' | 'prop-change' | 'structure'; label: string }[] = [
  { value: 'new-variant', label: 'A new variant or size' },
  { value: 'prop-change', label: 'A new or changed option' },
  { value: 'structure', label: 'A layout change' },
];

export type StructureKind = (typeof STRUCTURE_KINDS)[number]['value'];

export const isStructureKind = (x: unknown): x is StructureKind => STRUCTURE_KINDS.some((k) => k.value === x);

/** The kind a mismatch report files: the same as on Bridge's own drawer (REQUEST_KIND_OF.mismatch). */
export const MISMATCH_KIND: RequestKind = REQUEST_KIND_OF.mismatch;

/** Said when a structure change has no Figma link: on a team the frame link is the design. */
export const TEAM_FRAME_MISSING = 'Add the Figma frame link: your developers build it from your design.';

export interface BuildFormCopy {
  heading: string;
  title: { label: string; placeholder: string };
  summary: { label: string; placeholder: string };
  /** The "What differs" rows: only a mismatch lists values. */
  changes: boolean;
  /** The kind picker: only a structure change has one. */
  kind: boolean;
  figma: { required: boolean; label: string };
  submit: string;
  busy: string;
  missing: { title: string; summary: string; figma: string };
}

/** The words of the team form in each mode. */
export function buildFormCopy(mode: BuildFormMode, component: string): BuildFormCopy {
  if (mode === 'structure')
    return {
      heading: 'Describe the change',
      title: { label: 'What to add or change', placeholder: 'A danger ghost variant' },
      summary: { label: 'What it is for', placeholder: `Where you need it, and how it differs from the ${component} we have.` },
      changes: false,
      kind: true,
      figma: { required: true, label: 'Figma link' },
      submit: 'Send to developers',
      busy: 'Sending',
      missing: { title: 'Say what to add or change, for example "A danger ghost variant".', summary: 'Say what it is for and where you need it.', figma: TEAM_FRAME_MISSING },
    };
  const copy = changeFormCopy('mismatch', component);
  return {
    heading: copy.heading,
    title: copy.title,
    summary: copy.summary,
    changes: true,
    kind: false,
    figma: { required: false, label: 'Figma link (optional)' },
    submit: copy.submit,
    busy: copy.busy,
    missing: { title: copy.missing.title, summary: copy.missing.summary, figma: TEAM_FRAME_MISSING },
  };
}

/** Problems that block the send, in the words of the form she sees. Empty when it can be sent. */
export function buildFormProblems(mode: BuildFormMode, f: { title: string; summary: string; figma: string }): string[] {
  const { missing, figma } = buildFormCopy(mode, '');
  const noFrame = figma.required && !f.figma.trim();
  return [...(f.title.trim() ? [] : [missing.title]), ...(f.summary.trim() ? [] : [missing.summary]), ...(noFrame ? [missing.figma] : [])];
}

/** The form a team's drawer reads. `figma` is what `figmaFromLink` made of the link (undefined when empty). */
export interface BuildForm {
  kind: StructureKind;
  title: string;
  summary: string;
  changes: { field: string; before: string; after: string }[];
  figma?: { url: string; fileKey?: string; nodeId?: string } | undefined;
}

/**
 * The build request a team's form files (core BuildRequestInput, source "studio"): a structure change with the kind she
 * picked, or a mismatch report (kind bug) with the rows she filled. `requestedBy` is the GitHub login when there is one;
 * an email member is named by Bridge's server ("Requested by ... through Bridge.").
 */
export function teamBuildRequest(component: string, mode: BuildFormMode, f: BuildForm, requestedBy?: string | null): BuildRequestInput {
  const r = requestFromForm(component, { kind: mode === 'mismatch' ? MISMATCH_KIND : f.kind, title: f.title, summary: f.summary, changes: mode === 'mismatch' ? f.changes : [] });
  return {
    component: r.component,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    ...(r.changes.length ? { changes: r.changes } : {}),
    figma: f.figma ?? {},
    source: 'studio',
    ...(requestedBy ? { requestedBy } : {}),
  };
}

/** What the drawer says once it is sent, and where she follows it. */
export function buildSentLines(mode: BuildFormMode, n: number): { lead: string; next: string; link: string } {
  return mode === 'mismatch'
    ? { lead: `Report #${n} sent to your developers.`, next: 'It reads Shipped in Being built once the fix is in the library.', link: 'Follow it in Being built' }
    : { lead: `Build request #${n} sent to your developers.`, next: 'You follow it in Being built until it is in the library.', link: 'Follow it in Being built' };
}
