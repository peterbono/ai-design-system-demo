// Turns given to Figma during long work (a component build), through the UI: a message round trip with the plugin
// window. Figma throttles timers in a hidden window or behind a locked screen (down to one a minute after a few
// minutes), but not messages. The UI answers each turn with whether its page is hidden.

let seq = 0;
let enabled = false;
const waiting = new Map<number, (hidden: boolean) => void>();

/** The plugin window is open and answers turns (main/index.ts, once the UI is shown). */
export function enableUiTurns(): void {
  enabled = true;
}

/** A turn's answer from the UI (`{ kind: 'turn', id, hidden }`). */
export function isTurnReply(msg: unknown): msg is { kind: 'turn'; id: number; hidden: boolean } {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'turn' && typeof (msg as { id?: unknown }).id === 'number';
}

export function turnReply(msg: { id: number; hidden: boolean }): void {
  const resolve = waiting.get(msg.id);
  if (!resolve) return;
  waiting.delete(msg.id);
  resolve(!!msg.hidden);
}

/** A turn through the UI, resolving with whether the page is hidden; undefined without a plugin window. */
export function uiTurn(): Promise<boolean> | undefined {
  if (!enabled) return undefined;
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    figma.ui.postMessage({ kind: 'turn', id });
  });
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Longest stretch of work before giving Figma a turn (ms): keeps the file responsive on a big design system. */
const SLICE_MS = 30;
/** A timer turn that takes longer than this means Figma throttles timers: the file is not shown. */
const THROTTLED_MS = 100;
let lastYield = 0;
/** Figma does not show the file: turns go through the UI, which timers would make a minute long. */
let hidden = false;
let uiSaidHidden = false;
/** When to try a timer turn again while the UI does not say the page is hidden (it may not know). */
let probeAt = 0;

/**
 * Yields to Figma when the current slice of work is used up. Cheap to call in any loop. A timer turn costs about a
 * frame while Figma shows the file; in a hidden window or behind a locked screen Figma throttles timers (a turn then
 * took up to a minute, and a 25 minute pull ran for over an hour). So a slow timer turn switches to turns through the
 * UI (messages are not throttled), until the UI says the page is shown again; if it never says, a timer turn is tried
 * again after nine times the slow one, so waiting stays a small share.
 */
export async function breathe(): Promise<void> {
  if (Date.now() - lastYield < SLICE_MS) return;
  if (hidden) {
    const reply = uiTurn();
    if (reply) {
      const nowHidden = await reply;
      // Shown again (the UI saw it hidden before), or time to try a timer: back to timer turns.
      if (!nowHidden && (uiSaidHidden || Date.now() >= probeAt)) hidden = false;
      uiSaidHidden = nowHidden;
      lastYield = Date.now();
      return;
    }
    hidden = false;
  }
  const before = Date.now();
  await tick();
  const turn = Date.now() - before;
  lastYield = Date.now();
  if (turn > THROTTLED_MS) {
    hidden = true;
    probeAt = lastYield + turn * 9;
  }
}

/** A new piece of long work: slices start short and whether Figma shows the file is measured again. */
export function resetTurns(): void {
  lastYield = Date.now();
  hidden = false;
  uiSaidHidden = false;
}
