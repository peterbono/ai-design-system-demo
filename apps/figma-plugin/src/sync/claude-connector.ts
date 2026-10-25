// "Ask Claude to fix it", with the team's own Claude: Bridge is a connector in the team's Claude account (no API key
// anywhere). The plugin hands the designer the request ("Fix TextInput in Figma with Bridge"), opens Claude, and
// watches GitHub, with the Bridge sign-in, for Claude's fix: a draft pull request on bridge/figma-fixes-<component>
// labelled figma-fixes (docs/FIGMA-FIXES.md). When it appears, the row says "Claude's fix is ready". Pure: no DOM.

import type { PullRequestSummary } from '@bridge-ds/core';
import { fixPhrase } from './fix-with-claude';

/**
 * A claude.ai address that opens a new chat with the request already written, once Anthropic confirms one exists
 * (for example "https://claude.ai/new?q="). Until then: the request is copied and the designer pastes it.
 */
export const CLAUDE_PREFILL_URL: string | undefined = undefined;
export const CLAUDE_NEW_CHAT = 'https://claude.ai/new';

/** The words the designer types (or finds written) in their Claude. */
export const askText = (component: string) => fixPhrase(component);

/** Where "Ask Claude" sends the designer: a prefilled chat when possible, else a new one (the request is copied). */
export function claudeUrl(component: string): { url: string; prefilled: boolean } {
  return CLAUDE_PREFILL_URL ? { url: `${CLAUDE_PREFILL_URL}${encodeURIComponent(askText(component))}`, prefilled: true } : { url: CLAUDE_NEW_CHAT, prefilled: false };
}

export const CONNECTOR_WORDS = {
  firstTime: "Add Bridge to your team's Claude once, then ask it to fix components.",
  howToConnect: 'How to connect',
  connected: 'Bridge is in our Claude',
  pasted: 'The request is copied. Paste it in Claude.',
  prefilled: 'Claude opened with the request written. Send it.',
  openClaude: 'Open Claude',
  waiting: "Waiting for Claude's fix",
  waitingHint: 'Claude opens its fix for review. Keep working: Bridge watches for it, also after you close the plugin.',
  ready: "Claude's fix is ready",
  see: "See Claude's fix",
  next: 'Once the fix is approved, Check for updates brings it into this file. Then compare with code again.',
} as const;

/** The branch stem Claude's fixes for a component go on (core figmaFixesBranchStem; a number may follow). */
export function fixBranchStem(component: string, branchPrefix = 'bridge/'): string {
  const slug =
    component
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'component';
  return `${branchPrefix}figma-fixes-${slug}`;
}

/** Claude's fix for a component among the open pull requests: labelled figma-fixes, on its branch (or a numbered one). */
export function findFix(prs: readonly Pick<PullRequestSummary, 'headRef' | 'labels' | 'state' | 'number' | 'url' | 'draft'>[], component: string, branchPrefix?: string): Pick<PullRequestSummary, 'number' | 'url' | 'draft'> | undefined {
  const stem = fixBranchStem(component, branchPrefix);
  const onStem = (ref: string) => ref === stem || new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(ref);
  return prs.find((p) => p.state === 'open' && p.labels.includes('figma-fixes') && onStem(p.headRef));
}

/** Components the designer asked Claude about in this file, with when (kept with the file: resumed on reopen). */
export type Asked = Record<string, string>;
export function parseAsked(raw: string | undefined): Asked {
  try {
    const x = raw ? (JSON.parse(raw) as unknown) : {};
    return x && typeof x === 'object' && !Array.isArray(x) ? (Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === 'string')) as Asked) : {};
  } catch {
    return {};
  }
}

/** How often the plugin looks for Claude's fix while it is open: gently, Claude takes minutes. */
export const WATCH_MS = 20_000;
/** An ask older than this without a fix is dropped from the watch (the row offers asking again). */
export const ASK_TTL_MS = 3 * 24 * 60 * 60 * 1000;
