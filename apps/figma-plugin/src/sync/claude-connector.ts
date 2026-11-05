// "Ask Claude to fix it", with the team's own Claude: Bridge is a connector in the team's Claude account (no API key
// anywhere). The plugin hands the designer the request ("Fix TextInput in Figma with Bridge"), opens Claude, and
// watches GitHub, with the Bridge sign-in, for Claude's fix: a draft pull request on bridge/figma-fixes-<component>
// labelled figma-fixes (docs/FIGMA-FIXES.md). When it appears, the row says "Claude's fix is ready". Pure: no DOM.

import type { PullRequestSummary } from '@bridge-ds/core';
import { FIX_EVERY_PHRASE, fixAllPhrase, fixPhrase } from './fix-with-claude';

/**
 * A claude.ai address that opens a new chat with the request already written, not sent (confirmed 2026-10-25: claude.ai
 * shows a "be careful" notice and the person presses send). The request is also copied, in case the box is empty.
 */
export const CLAUDE_PREFILL_URL: string | undefined = 'https://claude.ai/new?q=';
export const CLAUDE_NEW_CHAT = 'https://claude.ai/new';

/** The words the designer types (or finds written) in their Claude. */
export const askText = (component: string) => fixPhrase(component);

/** Where "Ask Claude" sends the designer: a prefilled chat when possible, else a new one (the request is copied). */
export function claudeUrl(component: string): { url: string; prefilled: boolean } {
  return CLAUDE_PREFILL_URL ? { url: `${CLAUDE_PREFILL_URL}${encodeURIComponent(askText(component))}`, prefilled: true } : { url: CLAUDE_NEW_CHAT, prefilled: false };
}

/** The longest claude.ai address Bridge opens with a request written in it; past it, the request without the names. */
export const PREFILL_MAX_URL = 2000;

/** "Ask Claude to fix all N": the full request, every component named. It is what the designer finds copied. */
export const askAllText = (components: readonly string[]) => fixAllPhrase(components);

/**
 * Where "Ask Claude to fix all N" sends the designer: the full request written in Claude when the address stays short
 * enough, else "Fix every component that differs" (Claude lists them with bridge_figma_gaps). The full request is
 * copied either way.
 */
export function claudeUrlForAll(components: readonly string[]): { url: string; prefilled: boolean } {
  if (!CLAUDE_PREFILL_URL) return { url: CLAUDE_NEW_CHAT, prefilled: false };
  const full = `${CLAUDE_PREFILL_URL}${encodeURIComponent(askAllText(components))}`;
  return { url: full.length <= PREFILL_MAX_URL ? full : `${CLAUDE_PREFILL_URL}${encodeURIComponent(FIX_EVERY_PHRASE)}`, prefilled: true };
}

/** A row Claude can be asked about: it differs, Bridge measured the stories, and it is not asked already (or fixed). */
export const canAskClaude = (row: { differs: boolean; asked: boolean }, measured: boolean) => row.differs && measured && !row.asked;

/** One ask for several rows is worth a button from two on; under that the row's own button is the one action. */
export const FIX_ALL_MIN = 2;

/** The components "Ask Claude to fix all N" asks about, in the list's order: none when fewer than FIX_ALL_MIN. */
export function fixAllEligible(rows: readonly { name: string; differs: boolean; asked: boolean }[], measured: boolean): string[] {
  const names = rows.filter((r) => canAskClaude(r, measured)).map((r) => r.name);
  return names.length >= FIX_ALL_MIN ? names : [];
}

export const CONNECTOR_WORDS = {
  firstTime: "Add Bridge to your team's Claude once, then ask it to fix components.",
  fixAll: (n: number) => `Ask Claude to fix all ${n}`,
  prefilledAll: 'Claude opened with the request written: send it there. Claude fixes them one by one; each row shows its fix when it is ready.',
  howToConnect: 'How to connect',
  connected: 'Bridge is in our Claude',
  pasted: 'The request is copied. Paste it in Claude.',
  prefilled: 'Claude opened with the request written: send it there.',
  emptyHint: 'If the message is empty, paste it: the request is copied.',
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
export function findFix<T extends Pick<PullRequestSummary, 'headRef' | 'labels' | 'state' | 'number' | 'url' | 'draft'>>(prs: readonly T[], component: string, branchPrefix?: string): T | undefined {
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

/** How often the plugin reads Claude's progress while it works (one request at a time): every few seconds. */
export const WATCH_MS = 10_000;
/** An ask older than this without a fix is dropped from the watch (the row offers asking again). */
export const ASK_TTL_MS = 3 * 24 * 60 * 60 * 1000;
