// Main thread: owns figma.* (variables, storage, plugin data). No network access here; the UI
// iframe does GitHub calls and sends typed requests (src/shared/messages.ts).

import {
  DEFAULT_SETTINGS,
  type RepoSettings,
  type RequestMap,
  type RequestType,
  type ResponseEnvelope,
  type SyncState,
  isRequest,
  syncResetOnSettings,
} from '../shared/messages';
import { applyPullPlan } from './apply';
import { applyComponentPlan, scanGenerated } from './build-components';
import { exportVariants } from './fidelity';
import { clearClaudeKey, readClaudeSettings, saveClaudeSettings } from './claude-settings';
import { baselineImage, exportImage, exportThumbnails, markPushed, rebaseline, saveSignatures, scanComponents, selectionInfo, setExperimental } from './components';
import { clearGitHubToken, readGitHubToken, saveGitHubToken, setGitHubTokenState } from './github-token';
import { takeSnapshot, writePluginData } from './snapshot';
import { enableUiTurns, isTurnReply, turnReply } from './turns';

const NS = 'dsbridge';
/** Set by "Stop" in the plugin: the component build stops after the set in progress. */
let cancelBuild = false;

figma.showUI(__html__, { width: 480, height: 640, themeColors: true, title: 'DS Bridge' });
enableUiTurns();

function readShared(): { settings: RepoSettings; sync: SyncState } {
  const get = (key: string) => figma.root.getSharedPluginData(NS, key);
  return {
    settings: {
      repo: get('repo') || DEFAULT_SETTINGS.repo,
      branch: get('branch') || DEFAULT_SETTINGS.branch,
      tokensPath: get('tokensPath') || DEFAULT_SETTINGS.tokensPath,
    },
    sync: {
      baseSha: get('baseSha') || undefined,
      lastPullAt: get('lastPullAt') || undefined,
      lastPrBranch: get('lastPrBranch') || undefined,
      lastPrUrl: get('lastPrUrl') || undefined,
    },
  };
}

function writeShared(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) figma.root.setSharedPluginData(NS, key, value);
  }
}

type Handlers = { [K in RequestType]: (payload: RequestMap[K]['request']) => Promise<RequestMap[K]['response']> };

const handlers: Handlers = {
  async init() {
    const { settings, sync } = readShared();
    const { token, tokenState } = await readGitHubToken();
    return { settings, sync, hasToken: !!token, token, tokenState, fileName: figma.root.name, claude: await readClaudeSettings() };
  },
  async 'save-settings'({ settings }) {
    const before = readShared().settings;
    writeShared({ repo: settings.repo.trim(), branch: settings.branch.trim(), tokensPath: settings.tokensPath.trim().replace(/^\/+|\/+$/g, '') });
    writeShared(syncResetOnSettings(before, readShared().settings));
    return readShared().settings;
  },
  async 'save-token'({ token }) {
    return saveGitHubToken(token);
  },
  async 'clear-token'() {
    return clearGitHubToken();
  },
  async 'token-state'({ state }) {
    return setGitHubTokenState(state);
  },
  async 'save-claude'(input) {
    return saveClaudeSettings(input);
  },
  async 'clear-claude-key'() {
    return clearClaudeKey();
  },
  async 'baseline-image'({ nodeId }) {
    return (await baselineImage(nodeId)) ?? null;
  },
  async snapshot() {
    return takeSnapshot();
  },
  async 'apply-pull'({ plan }) {
    const report = await applyPullPlan(plan, (message) => figma.ui.postMessage({ kind: 'progress', message }));
    writeShared({ baseSha: plan.headSha, lastPullAt: new Date().toISOString() });
    return report;
  },
  async 'save-sync'({ sync }) {
    writeShared({ baseSha: sync.baseSha, lastPullAt: sync.lastPullAt, lastPrBranch: sync.lastPrBranch, lastPrUrl: sync.lastPrUrl });
    return readShared().sync;
  },
  async 'tag-variables'({ tags }) {
    let tagged = 0;
    for (const tag of tags) {
      const v = await figma.variables.getVariableByIdAsync(tag.variableId);
      if (!v) continue;
      writePluginData(v, tag.pluginData);
      tagged++;
    }
    return { tagged };
  },
  async 'open-url'({ url }) {
    if (/^https:\/\/(github\.com|console\.anthropic\.com|claude\.ai)\//.test(url)) figma.openExternal(url);
    return { opened: true };
  },
  async notify({ message, error }) {
    figma.notify(message, { error: !!error });
    return { shown: true };
  },
  async resize({ width, height }) {
    figma.ui.resize(Math.max(360, Math.min(900, width)), Math.max(400, Math.min(1000, height)));
    return { resized: true };
  },
  async 'scan-components'(scope) {
    return scanComponents((message) => figma.ui.postMessage({ kind: 'progress', message }), scope);
  },
  async 'save-signatures'({ items }) {
    return { saved: await saveSignatures(items) };
  },
  async 'mark-pushed'({ nodeId, mark }) {
    return { saved: await markPushed(nodeId, mark) };
  },
  async rebaseline({ nodeId }) {
    return { saved: await rebaseline(nodeId) };
  },
  async 'export-image'({ nodeId }) {
    return (await exportImage(nodeId)) ?? null;
  },
  async selection() {
    return selectionInfo() ?? null;
  },
  async 'set-experimental'({ targets, value }) {
    return { updated: await setExperimental(targets, value) };
  },
  async thumbnails({ nodeIds, width }) {
    return exportThumbnails(nodeIds, width);
  },
  async 'scan-generated'() {
    return scanGenerated();
  },
  async 'fidelity-export'({ nodeId, keys, scale }) {
    return exportVariants(nodeId, keys, scale);
  },
  async 'apply-components'({ plan }) {
    cancelBuild = false;
    return applyComponentPlan(plan, (message) => figma.ui.postMessage({ kind: 'progress', message }), { cancelled: () => cancelBuild });
  },
  // Answered while the build runs: the build yields between sets, so this message gets through.
  async 'cancel-components'() {
    cancelBuild = true;
    return { cancelled: true };
  },
};

// The request form shows what "Attach the current selection" would attach.
figma.on('selectionchange', () => figma.ui.postMessage({ kind: 'selection', selection: selectionInfo() ?? null }));

figma.ui.onmessage = async (msg: unknown) => {
  // A turn answered by the UI (a long build gives Figma turns through it when the file is not shown).
  if (isTurnReply(msg)) return turnReply(msg);
  if (!isRequest(msg)) return;
  let response: ResponseEnvelope;
  try {
    const handler = handlers[msg.type] as (p: unknown) => Promise<unknown>;
    if (!handler) throw new Error(`Unknown request ${String(msg.type)}`);
    response = { kind: 'response', reqId: msg.reqId, ok: true, payload: await handler(msg.payload) };
  } catch (err) {
    response = { kind: 'response', reqId: msg.reqId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  figma.ui.postMessage(response);
};
