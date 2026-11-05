// One progress bar for every long job of the plugin (Update, Compare with code, Send, Claude fixing a list): what is
// happening in words, a bar with a percentage and the time left when the work can count its items, or a moving bar with
// the words when it cannot. The estimate logic is pure (tested in Node); progressView draws it.

import { h } from './dom';

/** Minutes and seconds in ms. */
const MIN = 60_000;

export interface EstimatorOptions {
  /** Progress steps seen before any time left is shown: one fast or slow item never sets the estimate alone. */
  minSamples?: number | undefined;
  /** Time since the first step before any time left is shown. */
  minElapsedMs?: number | undefined;
}

/**
 * Time left from the observed rate: each step's time per item, smoothed (an exponential average blended with the
 * overall average), shown only after enough steps, and damped so the figure never jumps around: a new estimate moves
 * the shown one part of the way, and it never rises by more than a little at a time.
 */
export class Estimator {
  private first: { t: number; done: number } | undefined;
  private last: { t: number; done: number } | undefined;
  private total = 0;
  private perItem: number | undefined;
  private samples = 0;
  private shown: { t: number; ms: number } | undefined;
  private readonly minSamples: number;
  private readonly minElapsedMs: number;

  constructor(opts: EstimatorOptions = {}) {
    this.minSamples = opts.minSamples ?? 3;
    this.minElapsedMs = opts.minElapsedMs ?? 3000;
  }

  reset(): void {
    this.first = this.last = this.perItem = this.shown = undefined;
    this.total = this.samples = 0;
  }

  /** A progress step: `done` items of `total` at `now`. Another total (a new phase) or fewer done starts over. */
  observe(done: number | undefined, total: number | undefined, now: number): void {
    if (!total || total <= 0 || done === undefined) {
      this.reset();
      return;
    }
    if (total !== this.total || (this.last && done < this.last.done)) this.reset();
    this.total = total;
    if (!this.first || !this.last) {
      this.first = this.last = { t: now, done };
      return;
    }
    if (done <= this.last.done) return;
    const step = (now - this.last.t) / (done - this.last.done);
    this.perItem = this.perItem === undefined ? step : this.perItem + 0.3 * (step - this.perItem);
    this.samples++;
    this.last = { t: now, done };
    const raw = this.raw(now);
    if (raw === undefined) return;
    if (!this.shown) {
      this.shown = { t: now, ms: raw };
      return;
    }
    // Where the shown figure is now, counting down since it was set; the new estimate moves it part of the way.
    const expected = Math.max(0, this.shown.ms - (now - this.shown.t));
    let next = expected + 0.35 * (raw - expected);
    // Never rising by more than a quarter (plus a few seconds) at once: a slow item does not double the time left.
    next = Math.min(next, expected * 1.25 + 5000);
    this.shown = { t: now, ms: Math.max(0, next) };
  }

  /** The undamped estimate at `now`, once enough was seen. */
  private raw(now: number): number | undefined {
    const { first, last, perItem } = this;
    if (!first || !last || perItem === undefined || this.samples < this.minSamples || now - first.t < this.minElapsedMs) return undefined;
    const overall = (last.t - first.t) / Math.max(1, last.done - first.done);
    const per = 0.5 * perItem + 0.5 * overall;
    const left = this.total - last.done;
    if (left <= 0) return 0;
    // The item in progress started at the last step: part of it is already behind.
    return Math.max(per * (left - 1), per * left - (now - last.t));
  }

  /** Time left in ms at `now`, or undefined until enough steps were seen. Counts down between steps, never below 0. */
  remainingMs(now: number): number | undefined {
    if (!this.shown) return undefined;
    return Math.max(0, this.shown.ms - (now - this.shown.t));
  }
}

/**
 * Time left for a list Claude fixes one component at a time: the average time of the components it finished, times
 * the ones left, less what the one in progress already took. Undefined before Claude finished any.
 */
export function batchRemainingMs(finishedSeconds: readonly number[], left: number, currentSeconds = 0): number | undefined {
  const times = finishedSeconds.filter((s) => Number.isFinite(s) && s > 0);
  if (!times.length || left <= 0) return times.length ? 0 : undefined;
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return Math.max(avg * left - currentSeconds, avg * (left - 1), 0) * 1000;
}

/** The time left as a person says it: "less than a minute left", "about 3 min left", "about 1 h 10 min left". */
export function remainingText(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms < MIN) return 'less than a minute left';
  const min = ms / MIN;
  if (min < 10) return `about ${Math.max(1, Math.round(min))} min left`;
  if (min < 55) return `about ${Math.round(min / 5) * 5} min left`;
  const rounded = Math.round(min / 10) * 10;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `about ${hours} h${rest ? ` ${rest} min` : ''} left`;
}

/** Whole percent done, never 100 before the last item. */
export function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.max(0, Math.floor((done / total) * 100)));
}

export interface ProgressInfo {
  /** What is happening, in words ("Building Button, 12 of 62"). */
  label: string;
  /** Items done of total: a bar with a percentage. Without total, the bar moves without one. */
  done?: number | undefined;
  total?: number | undefined;
  /** Time left (Estimator.remainingMs, batchRemainingMs). Undefined: not known yet. */
  remainingMs?: number | undefined;
  /** What the items are, for screen readers ("components", "variants"): "12 of 62 components". */
  unit?: string | undefined;
}

/**
 * The bar: the step's words with the percentage on one line, the bar under them, then the time left. Accessible: the
 * bar is a progressbar named by the words, with its value (and, without a total, what is happening) as text.
 */
export function progressView(p: ProgressInfo, key: string): HTMLElement {
  const determinate = !!p.total && p.total > 0;
  const done = determinate ? Math.max(0, Math.min(p.done ?? 0, p.total!)) : 0;
  const pct = determinate ? percentOf(done, p.total!) : 0;
  const left = determinate ? remainingText(p.remainingMs) : undefined;
  const id = `progress-${key}`;
  const valueText = determinate ? [`${pct}%`, `${done} of ${p.total}${p.unit ? ` ${p.unit}` : ''}`, left].filter(Boolean).join(', ') : p.label;
  return h(
    'div',
    { class: 'progress', 'data-progress': key },
    h('div', { class: 'progress-head' }, h('span', { class: 'progress-label', id }, p.label), determinate ? h('span', { class: 'progress-pct', 'aria-hidden': 'true' }, `${pct}%`) : null),
    h(
      'div',
      {
        class: determinate ? 'progress-track' : 'progress-track indeterminate',
        role: 'progressbar',
        'aria-labelledby': id,
        'aria-valuemin': '0',
        ...(determinate ? { 'aria-valuemax': String(p.total), 'aria-valuenow': String(done) } : {}),
        'aria-valuetext': valueText,
      },
      h('div', { class: 'progress-fill', ...(determinate ? { style: { width: `${pct}%` } } : {}) }),
    ),
    determinate ? h('span', { class: 'progress-eta' }, left ? left[0]!.toUpperCase() + left.slice(1) : 'Working out the time left') : null,
  );
}
