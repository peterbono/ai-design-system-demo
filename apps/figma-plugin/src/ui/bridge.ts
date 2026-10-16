// UI side of the typed message protocol: request() resolves with the main thread's response.

import { type RequestMap, type RequestType, isProgress, isResponse } from '../shared/messages';

let progressListener: ((message: string) => void) | undefined;
export const onProgress = (fn: (message: string) => void) => (progressListener = fn);

let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

window.addEventListener('message', (event: MessageEvent) => {
  const msg = (event.data as { pluginMessage?: unknown } | undefined)?.pluginMessage;
  if (isProgress(msg)) {
    progressListener?.(msg.message);
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
