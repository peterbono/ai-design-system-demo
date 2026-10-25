// UI side of the typed message protocol: request() resolves with the main thread's response.

import { type RequestMap, type RequestType, type SelectionInfo, isProgress, isResponse } from '../shared/messages';

let progressListener: ((message: string) => void) | undefined;
export const onProgress = (fn: (message: string) => void) => (progressListener = fn);

export type Selection = SelectionInfo | null;
let selectionListener: ((s: Selection) => void) | undefined;
export const onSelection = (fn: (s: Selection) => void) => (selectionListener = fn);

let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

window.addEventListener('message', (event: MessageEvent) => {
  const msg = (event.data as { pluginMessage?: unknown } | undefined)?.pluginMessage;
  if (isProgress(msg)) {
    progressListener?.(msg.message);
    return;
  }
  // A turn the main thread gives Figma through this window during a long build: answered at once, with whether the
  // page is hidden (then Figma throttles the main thread's timers, not messages).
  if (msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'turn') {
    parent.postMessage({ pluginMessage: { kind: 'turn', id: (msg as { id: number }).id, hidden: document.visibilityState === 'hidden' } }, '*');
    return;
  }
  if (msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'selection') {
    selectionListener?.((msg as { selection: Selection }).selection);
    return;
  }
  if (!isResponse(msg)) return;
  const p = pending.get(msg.reqId);
  if (!p) return;
  pending.delete(msg.reqId);
  if (msg.ok) p.resolve(msg.payload);
  else p.reject(new Error(msg.error));
});

export function request<K extends RequestType>(type: K, payload: RequestMap[K]['request']): Promise<RequestMap[K]['response']> {
  const reqId = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
    parent.postMessage({ pluginMessage: { kind: 'request', reqId, type, payload } }, '*');
  });
}
