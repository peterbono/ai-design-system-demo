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
} from '../shared/messages';
import { applyPullPlan } from './apply';
import { applyComponentPlan, scanGenerated } from './build-components';
import { exportImage, exportThumbnails, rebaseline, saveSignatures, scanComponents, selectionInfo, setExperimental } from './components';
import { takeSnapshot, writePluginData } from './snapshot';

const NS = 'dsbridge';
const TOKEN_KEY = 'github-token';

figma.showUI(__html__, { width: 480, height: 640, themeColors: true, title: 'DS Bridge' });

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
    const token = (await figma.clientStorage.getAsync(TOKEN_KEY)) as string | undefined;
    return { settings, sync, hasToken: !!token, token: token || undefined, fileName: figma.root.name };
  },
  async 'save-settings'({ settings }) {
    const repoChanged = settings.repo !== readShared().settings.repo || settings.branch !== readShared().settings.branch;
    writeShared({ repo: settings.repo.trim(), branch: settings.branch.trim(), tokensPath: settings.tokensPath.trim().replace(/^\/+|\/+$/g, '') });
    // A different repository or branch means the stored base no longer applies.
    if (repoChanged) writeShared({ baseSha: '', lastPullAt: '', lastPrBranch: '', lastPrUrl: '' });
    return readShared().settings;
  },
  async 'save-token'({ token }) {
    await figma.clientStorage.setAsync(TOKEN_KEY, token.trim());
    return { saved: true };
  },
  async 'clear-token'() {
    await figma.clientStorage.deleteAsync(TOKEN_KEY);
    return { cleared: true };
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
    if (/^https:\/\/github\.com\//.test(url)) figma.openExternal(url);
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
  async 'scan-components'() {
    return scanComponents((message) => figma.ui.postMessage({ kind: 'progress', message }));
  },
  async 'save-signatures'({ items }) {
    return { saved: await saveSignatures(items) };
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
  async 'apply-components'({ plan }) {
    return applyComponentPlan(plan, (message) => figma.ui.postMessage({ kind: 'progress', message }));
  },
};

// The request form shows what "Attach the current selection" would attach.
figma.on('selectionchange', () => figma.ui.postMessage({ kind: 'selection', selection: selectionInfo() ?? null }));

figma.ui.onmessage = async (msg: unknown) => {
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
