// Demo history: fixture entries built backwards from the CURRENT token files, so a revert or a restore
// planned on them runs against the real base branch. For showing the History UI on a repo with little
// history. Every entry is flagged `demo`, has no PR link, and the report says `demo: true`: surfaces show
// it only behind an explicit, labelled toggle and never as real history.

import type { BridgeConfig } from './config';
import { type HistoryEntry, type HistoryReport, buildHistoryEntry, buildReport } from './history';
import { LayeredTokenSet } from './layered';
import { type TokenEdit, applyTokenEdits } from './token-edits';

interface DemoStep {
  pr: number;
  title: string;
  why: string;
  author: string;
  date: string;
  /** The values BEFORE this step; the values after it are whatever the next state holds. */
  before: TokenEdit[];
}

const STEPS: DemoStep[] = [
  { pr: 101, title: 'Darken muted text for small sizes', why: 'Muted captions at 12px read too light on subtle surfaces in usability tests.', author: 'demo-designer', date: '2026-07-08T09:30:00Z', before: [{ op: 'set', path: 'color.text.muted', file: 'semantic/light.tokens.json', value: '{palette.neutral.500}' }] },
  { pr: 102, title: 'Rounder buttons', why: 'Buttons move to the control radius so they match inputs and selects.', author: 'demo-engineer', date: '2026-07-21T14:10:00Z', before: [{ op: 'set', path: 'button.radius', file: 'components/button.tokens.json', value: '{radius.inset}' }] },
  { pr: 104, title: 'Clarify the alert radius description', why: 'The description now says why alerts use the container radius.', author: 'demo-engineer', date: '2026-08-19T08:00:00Z', before: [{ op: 'set', path: 'alert.radius', file: 'components/feedback.tokens.json', description: 'Alert corner radius.' }] },
  { pr: 106, title: 'Muted text one step lighter', why: 'Muted text competed with body text in dense tables; one step lighter still passes 4.5:1.', author: 'demo-designer', date: '2026-09-30T16:45:00Z', before: [{ op: 'set', path: 'color.text.muted', file: 'semantic/light.tokens.json', value: '{palette.neutral.700}' }] },
];

export const DEMO_RELEASES = [
  { version: '1.1.0', date: '2026-07-25T12:00:00Z' },
  { version: '1.2.0', date: '2026-08-25T12:00:00Z' },
];

/** Demo history over the current files. Steps whose tokens this repo does not have are left out. */
export function demoHistory(config: BridgeConfig, current: Map<string, string>): HistoryReport {
  const states: Map<string, string>[] = [current];
  const kept: DemoStep[] = [];
  for (const step of [...STEPS].reverse()) {
    try {
      const prev = applyTokenEdits(new LayeredTokenSet(config, states[0]!), step.before).files;
      states.unshift(prev);
      kept.unshift(step);
    } catch {
      /* this repo has no such token: skip the step */
    }
  }
  const entries: HistoryEntry[] = [];
  kept.forEach((step, i) => {
    const e = buildHistoryEntry({
      config,
      commit: { sha: `demo${String(step.pr).padStart(36, '0')}`, parents: [`demo${String(step.pr - 1).padStart(36, '0')}`], date: step.date, author: step.author, subject: step.title, body: step.why, pr: { number: step.pr, title: step.title, author: step.author, mergedAt: step.date, body: step.why } },
      before: states[i]!,
      after: states[i + 1]!,
      demo: true,
    });
    if (e) entries.push(e);
  });
  return { ...buildReport({ source: 'demo', label: 'Demo history (fixture data)', ref: 'demo', entries, releases: DEMO_RELEASES, truncated: false }), demo: true };
}
