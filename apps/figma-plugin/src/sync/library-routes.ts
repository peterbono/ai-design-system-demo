// Where a push from Figma main lands once the library takes it directly (docs/BUILD-REQUESTS.md): token values ship
// after the checks, renames and removals wait for a developer, structure becomes a build request for developers.
// Plugin-side adapter until the core contract lands: the result screens read only these types, and the mapping to the
// core functions happens in one place (toRoutedItems, shipPoll).

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Where one sent item went. */
export type PublishRoute = 'shipped' | 'waiting-for-developer' | 'build-request';

export interface RoutedItem {
  /** The token path or the component name, as the designer reads it. */
  label: string;
  kind: 'token' | 'component';
  route: PublishRoute;
  /** The pull request (shipped, waiting) or the build request issue. */
  number: number;
  url: string;
}

/** A shipped pull request: auto-merge armed (on its way), merged (in the library), or a check that failed. */
export type ShipState = 'on-its-way' | 'in-the-library' | 'checks-failed';

export interface ShipStatus {
  state: ShipState;
  /** For checks-failed: the check, as GitHub names it. */
  why?: string | undefined;
}

/** Reads where one shipped pull request stands. */
export type ShipPoll = (number: number) => Promise<ShipStatus>;

export interface RouteGroups {
  shipped: RoutedItem[];
  waiting: RoutedItem[];
  builds: RoutedItem[];
}

export function groupRoutes(items: readonly RoutedItem[]): RouteGroups {
  return {
    shipped: items.filter((i) => i.route === 'shipped'),
    waiting: items.filter((i) => i.route === 'waiting-for-developer'),
    builds: items.filter((i) => i.route === 'build-request'),
  };
}

/** The pull requests that ship, once each (several tokens can ship in one). */
export const shippedNumbers = (g: RouteGroups): number[] => [...new Set(g.shipped.map((i) => i.number))];

export function shipStateLabel(s: ShipStatus | undefined): string {
  if (!s || s.state === 'on-its-way') return 'On its way to the library';
  if (s.state === 'in-the-library') return 'In the library';
  return s.why ? `Did not pass the checks: ${s.why}` : 'Did not pass the checks';
}

/** Every shipped pull request settled: merged or failed. Nothing left to poll. */
export const shipSettled = (g: RouteGroups, statuses: ReadonlyMap<number, ShipStatus>): boolean =>
  shippedNumbers(g).every((n) => {
    const s = statuses.get(n)?.state;
    return s === 'in-the-library' || s === 'checks-failed';
  });

/** The headline and one summary sentence per route that has items. */
export function libraryHeadline(g: RouteGroups, statuses: ReadonlyMap<number, ShipStatus>): { title: string; text: string } {
  const numbers = shippedNumbers(g);
  const merged = numbers.filter((n) => statuses.get(n)?.state === 'in-the-library').length;
  const failed = numbers.filter((n) => statuses.get(n)?.state === 'checks-failed').length;
  const tokens = g.shipped.length;
  const sentences: string[] = [];
  if (tokens) {
    const it = tokens === 1 ? 'it' : 'they';
    if (failed) sentences.push(`${plural(tokens, 'token change')}: ${failed === numbers.length ? 'the checks did not pass, nothing reached the library' : 'some checks did not pass'}.`);
    else if (merged === numbers.length) sentences.push(`${plural(tokens, 'token change')} ${tokens === 1 ? 'is' : 'are'} in the library.`);
    else sentences.push(`${plural(tokens, 'token change')} on ${tokens === 1 ? 'its' : 'their'} way: ${it} reach${tokens === 1 ? 'es' : ''} the library once the checks pass.`);
  }
  if (g.waiting.length) sentences.push(`${plural(g.waiting.length, 'rename or removal', 'renames and removals')} wait${g.waiting.length === 1 ? 's' : ''} for a developer's OK.`);
  if (g.builds.length) sentences.push(`${plural(g.builds.length, 'build request')} sent to developers: they pick ${g.builds.length === 1 ? 'it' : 'them'} up, and Studio shows ${g.builds.length === 1 ? 'it' : 'them'} under Being built.`);
  const only = [tokens, g.waiting.length, g.builds.length].filter(Boolean).length === 1;
  const title = only && tokens
    ? failed ? 'Not in the library' : merged === numbers.length ? 'In the library' : 'Sent to the library'
    : only && g.builds.length
      ? 'Build request sent to developers'
      : only && g.waiting.length
        ? 'Waiting for a developer'
        : 'Sent';
  return { title, text: sentences.join(' ') };
}

export const SHIP_POLL_MS = 15_000;
export const SHIP_TIMEOUT_MS = 10 * 60_000;

export interface ShipPollerOptions {
  poll: ShipPoll;
  numbers: number[];
  onUpdate: (statuses: Map<number, ShipStatus>) => void;
  /** 10 minutes with a pull request still on its way. Polling stops; start() polls again. */
  onTimeout: () => void;
  onError?: ((err: unknown) => void) | undefined;
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
}

/** Reads each shipped pull request every 15 seconds, for up to 10 minutes, until all are merged or failed. */
export class ShipPoller {
  readonly statuses = new Map<number, ShipStatus>();
  private handle: unknown;
  private startedAt = 0;
  private running = false;

  constructor(private readonly o: ShipPollerOptions) {}

  get active(): boolean {
    return this.running;
  }

  start(): void {
    this.stop();
    this.running = true;
    this.startedAt = (this.o.now ?? Date.now)();
    this.schedule();
  }

  stop(): void {
    if (this.handle !== undefined) (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.handle);
    this.handle = undefined;
    this.running = false;
  }

  private schedule(): void {
    this.handle = (this.o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)))(() => void this.tick(), this.o.intervalMs ?? SHIP_POLL_MS);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    this.handle = undefined;
    if (await this.check()) return;
    if (!this.running) return;
    if ((this.o.now ?? Date.now)() - this.startedAt >= (this.o.timeoutMs ?? SHIP_TIMEOUT_MS)) {
      this.stop();
      this.o.onTimeout();
      return;
    }
    this.schedule();
  }

  /** Reads the pull requests not settled yet. True when all are settled (polling stops). */
  async check(): Promise<boolean> {
    const open = this.o.numbers.filter((n) => this.statuses.get(n)?.state !== 'in-the-library' && this.statuses.get(n)?.state !== 'checks-failed');
    try {
      for (const n of open) this.statuses.set(n, await this.o.poll(n));
    } catch (err) {
      this.o.onError?.(err);
      return false;
    }
    this.o.onUpdate(new Map(this.statuses));
    const done = this.o.numbers.every((n) => {
      const s = this.statuses.get(n)?.state;
      return s === 'in-the-library' || s === 'checks-failed';
    });
    if (done) this.stop();
    return done;
  }
}
