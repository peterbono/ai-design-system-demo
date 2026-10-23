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
/** Shortest stretch of work between two turns given to Figma (ms). */
const SLICE_MS = 30;
/** Longest stretch: the file never stays busy longer than this while it is shown. */
const MAX_SLICE_MS = 1000;
/**
 * A timer turn that takes longer than this means Figma throttles timers: the file is not shown (about a second, up
 * to a minute). A busy file that is shown takes a few hundred milliseconds a turn.
 */
const THROTTLED_MS = 800;
let lastYield = 0;
/** Work until the next turn: four times what the last turn cost, so waiting stays near a fifth of the time. */
let slice = SLICE_MS;
/** Figma does not show the file: turns go through the UI, which timers would make a minute long. */
let hidden = false;
let uiSaidHidden = false;
/** When to try a timer turn again while the UI does not say the page is hidden (it may not know). */
let probeAt = 0;

/**
 * Yields to Figma when the current slice of work is used up. Cheap to call in any loop.
 *
 * A turn is not free: Figma lays out, draws and saves what changed. On a big file it took about 150 ms a turn, so
 * turns every 30 ms of work spent 70% of a pull waiting; the slice now grows to four times the last turn's cost (at
 * most a second), and the same build ran 2.5 times faster.
 *
 * In a hidden window or behind a locked screen Figma throttles timers (a turn then took up to a minute). A timer
 * turn that slow switches to turns through the UI (messages are not throttled), until the UI says the page is shown
 * again; if it never says, a timer turn is tried again after nine times the slow one.
 */
export async function breathe(): Promise<void> {
  if (Date.now() - lastYield < slice) return;
  const before = Date.now();
  if (hidden) {
    const reply = uiTurn();
    if (reply) {
      const nowHidden = await reply;
      // Shown again (the UI saw it hidden before), or time to try a timer: back to timer turns.
      if (!nowHidden && (uiSaidHidden || Date.now() >= probeAt)) hidden = false;
      uiSaidHidden = nowHidden;
      lastYield = Date.now();
      slice = sliceAfter(lastYield - before);
      return;
    }
    hidden = false;
  }
  await tick();
  const turn = Date.now() - before;
  lastYield = Date.now();
  if (turn > THROTTLED_MS) {
    hidden = true;
    probeAt = lastYield + turn * 9;
    slice = SLICE_MS;
  } else slice = sliceAfter(turn);
}

const sliceAfter = (turn: number) => Math.min(MAX_SLICE_MS, Math.max(SLICE_MS, turn * 4));

/** A new piece of long work: slices start short and whether Figma shows the file is measured again. */
export function resetTurns(): void {
  lastYield = Date.now();
  slice = SLICE_MS;
  hidden = false;
  uiSaidHidden = false;
}
