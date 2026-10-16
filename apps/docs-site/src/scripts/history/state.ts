// History data in the browser: one fetch of /history/data.json per page, and the demo toggle. Real and demo
// reports stay separate; the toggle only picks which one a view shows, and every demo view carries a banner.
import { layoutOptions, loadConfig, parseContrastChecks, type BridgeConfig, type ContrastPair, type HistoryReport } from '@bridge-ds/core';
import type { HistoryData } from '../../lib/history';

let data: Promise<HistoryData> | null = null;

export function loadHistoryData(): Promise<HistoryData> {
  data ??= fetch('/history/data.json').then((r) => {
    if (!r.ok) throw new Error(`History data is missing (${r.status}). Rebuild the site.`);
    return r.json() as Promise<HistoryData>;
  });
  return data;
}

export interface Loaded {
  data: HistoryData;
  config: BridgeConfig;
  pairs: ContrastPair[];
  layout: ReturnType<typeof layoutOptions>;
}

let loaded: Promise<Loaded> | null = null;
export function loadHistory(): Promise<Loaded> {
  loaded ??= loadHistoryData().then((d) => {
    const config = loadConfig(d.config);
    return { data: d, config, pairs: parseContrastChecks(d.checks || undefined), layout: layoutOptions(config) };
  });
  return loaded;
}

const KEY = 'bridge.history.demo';
export const DEMO_EVENT = 'bridge:history-demo';

export function demoOn(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemo(on: boolean) {
  try {
    sessionStorage.setItem(KEY, on ? '1' : '');
  } catch {
    /* private mode: the toggle lives for this page */
  }
  document.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: on }));
}

/** The report a view shows: real by default, demo only when the toggle is on. */
export function activeReport(d: HistoryData): { report: HistoryReport | null; demo: boolean } {
  return demoOn() ? { report: d.demo, demo: true } : { report: d.real, demo: false };
}

export const DEMO_BANNER = "Demo data: fixture changes, not this repository's history.";
