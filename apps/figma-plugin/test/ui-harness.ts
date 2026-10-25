// Flow tests of the real plugin UI (src/ui/index.ts) in jsdom: a stand-in for the Figma main thread (the requests of
// shared/messages.ts) and for GitHub's REST API, serving this repo's real token files and component specs. A test
// opens the plugin, clicks what a designer clicks and reads what the panel says, through every state change (pull,
// send, settings, fidelity). One plugin per test file: the UI module keeps its state for the life of the process.

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { analyze, buildPull } from '../src/sync/flows';
import { DEFAULT_SETTINGS, type FigmaSnapshot, type InitPayload } from '../src/shared/messages';
import { FakeGitHub } from './fake-github';
import { applyPlanToSnapshot } from './figma-sim';
import { realChecksText, realConfigText, realFiles } from './helpers';

export const REPO = 'acme/acme-design-system';

export interface Answer {
  status: number;
  body: unknown;
}
export type Route = (method: string, path: string, body: any) => Answer | undefined;

export interface Harness {
  /** The panel's visible text (tabs, body, bar), whitespace collapsed. */
  text(): string;
  /** The zone headline of the screen. */
  headline(): string;
  /** The primary button of the action bar, or undefined. */
  primary(): HTMLButtonElement | undefined;
  /** Clicks the button (or tab) with this exact text; throws when there is none or it is disabled. */
  click(label: string): Promise<void>;
  /** Types into the input labelled `label` (its visible label text). */
  type(label: string, value: string): void;
  /** Waits until `fn` is true, or throws with the panel's text after `ms`. */
  until(fn: () => boolean, ms?: number): Promise<void>;
  /** Lets pending work settle: messages, timers, fetches. */
  settle(ms?: number): Promise<void>;
  /** Main-thread requests and REST calls made so far ("save-settings", "POST /repos/.../pulls"). */
  calls: string[];
  /** Change the stand-ins mid-test. */
  main: Record<string, (payload: any) => unknown>;
  routes: Route[];
  data: Awaited<ReturnType<typeof repoData>>;
  document: Document;
}

let cached: Promise<{ files: Record<string, string>; headSha: string; pulled: FigmaSnapshot }> | undefined;

/** The real tokens, config and component specs as a repo, and a Figma file after a first pull of it. */
export function repoData() {
  cached ??= (async () => {
    const files: Record<string, string> = {};
    for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
    files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
    files['bridge.config.json'] = realConfigText();
    files['packages/react/component-specs.json'] = readFileSync('../../packages/react/component-specs.json', 'utf8');
    const gh = new FakeGitHub(files);
    const a = await analyze(gh.client(), DEFAULT_SETTINGS, {}, { fileName: 'Checkout redesign', collections: [], variables: [] });
    const pulled = applyPlanToSnapshot(buildPull(a, new Map()).plan);
    pulled.fileName = 'Checkout redesign';
    return { files, headSha: a.headSha, pulled };
  })();
  return cached;
}

export interface Open {
  /** No repository and no token: a first open. */
  connected?: boolean;
  /** The file was pulled before (sync base = head) and holds the pulled variables. */
  pulled?: boolean;
  /** Edits the snapshot before the plugin reads it. */
  edit?: (s: FigmaSnapshot) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function openPlugin(o: Open = {}): Promise<Harness> {
  const data = await repoData();
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.figma.com/plugin/', pretendToBeVisual: true });
  const w = dom.window as unknown as Window & typeof globalThis;
  const g = globalThis as Record<string, unknown>;
  for (const k of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLDetailsElement', 'HTMLButtonElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MessageEvent', 'CustomEvent', 'getComputedStyle', 'location']) g[k] = (w as unknown as Record<string, unknown>)[k];
  g.parent = w;
  g.addEventListener = w.addEventListener.bind(w);
  g.navigator = { clipboard: { writeText: async () => undefined }, onLine: true };
  const calls: string[] = [];
  const snapshot = structuredClone(o.pulled ? data.pulled : { fileName: 'Checkout redesign', collections: [], variables: [] });
  o.edit?.(snapshot);
  const blobs = Object.fromEntries(Object.entries(data.files).map(([p, t]) => [p, Buffer.from(t, 'utf8').toString('base64')]));
  const paths = Object.keys(blobs);
  let settings = { repo: o.connected === false ? '' : REPO, branch: 'main', tokensPath: 'packages/tokens/src' } as InitPayload['settings'];
  let sync: InitPayload['sync'] = o.pulled ? { baseSha: data.headSha, lastPullAt: '2026-10-24T09:12:00.000Z' } : {};
  let token: string | undefined = o.connected === false ? undefined : 'test-token';
  let generated: unknown[] = [];
  const main: Record<string, (payload: any) => unknown> = {
    init: () => ({ settings, sync, hasToken: !!token, token, tokenState: token ? 'ok' : undefined, fileName: 'Checkout redesign', claude: { hasKey: false, key: undefined, model: 'claude-sonnet-5-5' } }),
    snapshot: () => snapshot,
    'scan-generated': () => generated,
    'apply-pull': () => {
      sync = { baseSha: data.headSha, lastPullAt: '2026-10-25T09:12:00.000Z' };
      return { created: 812, updated: 0, orphaned: 0, layout: 'single-collection', errors: [] };
    },
    'apply-components': (m: { plan: { components: { componentId: string; name: string; hash: string; codeHash: string; variants: { key: string }[] }[] } }) => {
      generated = m.plan.components.map((c, i) => ({ componentId: c.componentId, nodeId: `n${i}`, name: c.name, specHash: c.hash, codeHash: c.codeHash, variants: c.variants.map((v) => v.key) }));
      return { created: generated.length, updated: 0, unchanged: 0, orphaned: 0, page: 'Components', problems: [], nodeIds: generated.map((x) => (x as { nodeId: string }).nodeId), total: generated.length };
    },
    'scan-components': () => ({ components: [] }),
    'save-signatures': () => ({ saved: 0 }),
    thumbnails: () => ({}),
    notify: () => ({}),
    'open-url': () => ({ opened: true }),
    'token-state': (m: { state: string }) => ({ tokenState: m.state }),
    'save-sync': (m: { sync: typeof sync }) => (sync = { ...sync, ...m.sync }),
    'save-settings': (m: { settings: typeof settings }) => (settings = m.settings),
    'save-token': (m: { token: string }) => ((token = m.token), { saved: true }),
    'clear-token': () => ((token = undefined), { cleared: true }),
    'tag-variables': () => ({ tagged: 0 }),
    'mark-pushed': () => ({ saved: true }),
    'set-experimental': () => ({ updated: 0 }),
    resize: () => ({}),
    selection: () => null,
  };
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const routes: Route[] = [];
  let n = 100;
  g.fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const p = u.pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${p}`);
    for (const r of routes) {
      const a = r(method, p, body);
      if (a) return json(a.status, a.body);
    }
    if (method !== 'GET') {
      if (/\/git\/(blobs|trees|commits)$/.test(p)) return json(201, { sha: `w${String(++n).padEnd(39, '0')}` });
      if (/\/git\/refs$/.test(p)) return json(201, { ref: 'refs/heads/x', object: { sha: data.headSha } });
      if (/\/pulls$/.test(p)) return json(201, { number: 555, html_url: `https://github.com/${REPO}/pull/555`, title: 'Tokens from Figma', draft: true, head: { ref: 'bridge/figma-1' }, state: 'open' });
      return json(200, {});
    }
    if (/\/git\/ref\/heads\//.test(p) || /\/git\/refs\/heads\//.test(p)) return json(200, { object: { sha: data.headSha } });
    if (/\/git\/commits\//.test(p)) return json(200, { sha: data.headSha, tree: { sha: 'tree-1' }, parents: [], commit: { message: 'x' } });
    if (/\/git\/trees\//.test(p)) return json(200, { tree: paths.map((path) => ({ path, type: 'blob', sha: `blob:${path}`, mode: '100644' })), truncated: false });
    const blob = /\/git\/blobs\/(.+)$/.exec(p);
    if (blob) return json(200, { content: blobs[decodeURIComponent(blob[1]!).slice(5)], encoding: 'base64' });
    if (/\/compare\//.test(p)) return json(200, { ahead_by: 0, behind_by: 0, total_commits: 0, commits: [], files: [] });
    if (/\/pulls/.test(p) || /\/issues/.test(p)) return json(200, []);
    if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return p.toLowerCase() === `/repos/${REPO}` ? json(200, { full_name: REPO, permissions: { push: true, pull: true }, default_branch: 'main' }) : json(404, { message: 'Not Found' });
    return json(404, { message: 'Not Found' });
  };
  w.addEventListener('message', (e: MessageEvent) => {
    const m = (e.data as { pluginMessage?: { kind?: string; type: string; reqId: number; payload: unknown } } | undefined)?.pluginMessage;
    if (!m || m.kind !== 'request') return;
    calls.push(m.type);
    const f = main[m.type];
    let payload: unknown;
    let error: string | undefined;
    try {
      payload = f ? f(m.payload) : undefined;
      if (!f) error = `not in the harness: ${m.type}`;
    } catch (err) {
      error = String(err);
    }
    setTimeout(() => w.postMessage({ pluginMessage: { kind: 'response', reqId: m.reqId, ok: !error, payload, error } }, '*'), 1);
  });
  // The plugin UI itself, as Figma loads it.
  await import('../src/ui/index');
  const doc = w.document;
  const app = () => doc.getElementById('app')!;
  const text = () => (app().textContent ?? '').replace(/\s+/g, ' ').trim();
  const settle = (ms = 50) => sleep(ms);
  const until = async (fn: () => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error(`timed out; the panel says: ${text().slice(0, 1500)}`);
      await sleep(20);
    }
  };
  const buttons = () => [...app().querySelectorAll<HTMLButtonElement>('button')];
  const h: Harness = {
    text,
    headline: () => (app().querySelector('.headline')?.textContent ?? '').trim(),
    primary: () => app().querySelector<HTMLButtonElement>('.bar .btn.primary') ?? undefined,
    async click(label) {
      await until(() => buttons().some((b) => (b.textContent ?? '').trim() === label && !b.disabled));
      buttons().find((b) => (b.textContent ?? '').trim() === label && !b.disabled)!.click();
      await settle();
    },
    type(label, value) {
      const field = [...app().querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent?.trim() === label);
      const input = field?.querySelector('input, textarea') as HTMLInputElement | null;
      if (!input) throw new Error(`no field ${label}; the panel says: ${text().slice(0, 600)}`);
      input.value = value;
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
    },
    until,
    settle,
    calls,
    main,
    routes,
    data,
    document: doc,
  };
  await until(() => !text().includes('Loading'));
  return h;
}
