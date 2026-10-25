// Main thread: owns figma.* (variables, storage, plugin data). No network access here; the UI
// iframe does GitHub calls and sends typed requests (src/shared/messages.ts).

import { type RequestMap, type RequestType, type ResponseEnvelope, STUDIO_ORIGIN, isRequest } from '../shared/messages';
import { applyPullPlan } from './apply';
import { applyComponentPlan, renderIncoming, scanGenerated } from './build-components';
import { exportVariants, readBuilt } from './fidelity';
import { clearClaudeKey, readClaudeSettings, saveClaudeSettings } from './claude-settings';
import { baselineImage, bindRaw, exportImage, exportThumbnails, markPushed, rebaseline, renameInBaselines, saveSignatures, scanComponents, selectionInfo, setExperimental } from './components';
import { clearGitHubToken, readGitHubToken, saveGitHubToken, setGitHubTokenState } from './github-token';
import { type SharedStore, saveSettings, sharedSettings, sharedSync, writeSync } from './shared-state';
import { takeSnapshot, writePluginData } from './snapshot';
import { enableUiTurns, isTurnReply, turnReply } from './turns';

const NS = 'dsbridge';
/** Set by "Stop" in the plugin: the component build stops after the set in progress. */
let cancelBuild = false;

figma.showUI(__html__, { width: 480, height: 640, themeColors: true, title: 'Bridge' });
enableUiTurns();

/** The file's shared plugin data (namespace dsbridge), as the store shared-state.ts reads and writes. */
const store: SharedStore = {
  get: (key) => figma.root.getSharedPluginData(NS, key),
  set: (key, value) => figma.root.setSharedPluginData(NS, key, value),
  keys: () => figma.root.getSharedPluginDataKeys(NS),
};

/** The Figma user running the plugin (manifest permission "currentuser"): keys their open change in the file. */
function userId(): string | undefined {
  try {
    return figma.currentUser?.id ?? undefined;
  } catch {
    return undefined;
  }
}

const readShared = () => ({ settings: sharedSettings(store), sync: sharedSync(store, userId()) });

type Handlers = { [K in RequestType]: (payload: RequestMap[K]['request']) => Promise<RequestMap[K]['response']> };

const handlers: Handlers = {
  async init() {
    const { settings, sync } = readShared();
    const { token, tokenState, tokenSource, tokenAccount } = await readGitHubToken();
    return { settings, sync, hasToken: !!token, token, tokenState, ...(tokenSource ? { tokenSource } : {}), ...(tokenAccount ? { tokenAccount } : {}), fileName: figma.root.name, claude: await readClaudeSettings() };
  },
  async 'save-settings'({ settings }) {
    return saveSettings(store, settings);
  },
  async 'save-token'({ token, source, account }) {
    return saveGitHubToken(token, source, account);
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
    writeSync(store, { baseSha: plan.headSha, lastPullAt: new Date().toISOString() }, userId());
    // Renamed in code, renamed here: component baselines follow, so a Push does not read the bindings as edits.
    if (report.renamed?.length) await renameInBaselines(report.renamed);
    return report;
  },
  async 'save-sync'({ sync }) {
    writeSync(store, sync, userId());
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
    if (/^https:\/\/(github\.com|console\.anthropic\.com|claude\.ai)\//.test(url) || url.startsWith(`${STUDIO_ORIGIN}/`)) figma.openExternal(url);
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
  async 'bind-raw'(req) {
    return { bound: await bindRaw(req) };
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
  async 'read-built'({ nodeId, keys }) {
    return readBuilt(nodeId, keys);
  },
  async 'render-incoming'({ component, icons, key, scale }) {
    return renderIncoming(component, { icons }, key, scale);
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
