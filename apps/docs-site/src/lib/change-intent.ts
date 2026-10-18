// "Change this component" in the Studio Components drawer: the designer drives the change, Claude builds it, a
// developer checks the code. The drawer first asks what she wants to change (three intents), then leads to the flow
// that does it: the component's tokens, an exploration Claude builds from her Figma frame, or a mismatch report. The
// words and the rules live here, pure and tested (change-intent.test.ts); scripts/request-form.ts paints them.
import type { ComponentChangeRequest, RequestKind } from '@bridge-ds/core';
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
    line: 'A new variant, size, state or option, designed in Figma. Claude builds it from your Figma frame in an exploration. You check it in the component sandbox, then send it for review.',
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
 * The form the drawer shows: `explore` (Add a variant or option, Claude builds it), `ask` (the same need sent to a
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
  /** The quiet switch between building it with Claude and asking a developer, keeping what she typed. */
  swap: { to: ChangeFormMode; label: string } | null;
  submit: string;
  busy: string;
  /** The signed-out final action: it opens the GitHub connect dialog. */
  connect: string;
  /** What blocks the submit, per empty field, saying how to fix it. */
  missing: { title: string; summary: string };
}

/** The words of the form in each mode. */
export function changeFormCopy(mode: ChangeFormMode, component: string): ChangeFormCopy {
  const add = { label: 'What to add', placeholder: 'A danger ghost variant' };
  const why = { label: 'What it is for', placeholder: `Where you need it, and how it differs from the ${component} we have.` };
  const missing = { title: 'Say what to add, for example "A danger ghost variant".', summary: 'Say what it is for and where you need it.' };
  if (mode === 'explore')
    return {
      heading: 'Describe the new option',
      title: add,
      summary: why,
      changes: false,
      swap: { to: 'ask', label: 'Ask a developer instead' },
      submit: 'Start exploration',
      busy: 'Starting exploration',
      connect: 'Connect GitHub to start',
      missing,
    };
  if (mode === 'ask')
    return {
      heading: 'Ask a developer',
      title: add,
      summary: why,
      changes: false,
      swap: { to: 'explore', label: 'Let Claude build it instead' },
      submit: 'Send to a developer',
      busy: 'Sending',
      connect: 'Connect GitHub to send',
      missing,
    };
  return {
    heading: 'Report a mismatch',
    title: { label: 'What looks wrong', placeholder: 'The focus ring is thinner than in Figma' },
    summary: { label: 'Details', placeholder: 'Where you saw it, what Figma shows, and what it does instead.' },
    changes: true,
    swap: null,
    submit: 'Send report',
    busy: 'Sending report',
    connect: 'Connect GitHub to send',
    missing: { title: 'Say what looks wrong, for example "The focus ring is thinner than in Figma".', summary: 'Add the details: where you saw it and what Figma shows.' },
  };
}

/** Problems that block the submit, in the words of the form she sees. Empty when it can be sent. */
export function changeFormProblems(mode: ChangeFormMode, f: { title: string; summary: string }): string[] {
  const { missing } = changeFormCopy(mode, '');
  return [...(f.title.trim() ? [] : [missing.title]), ...(f.summary.trim() ? [] : [missing.summary])];
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

/** What the drawer says once the exploration started: who builds it next, and how to ask Claude. */
export function startedLines(name: string, request: number): { lead: string; next: string } {
  return {
    lead: `${name} is ready to build.`,
    next: `Ask Claude to "build Bridge request #${request}": it reads your request and Figma frame, then works in the exploration. Its sandbox preview appears in a few minutes, then you send it for review.`,
  };
}
