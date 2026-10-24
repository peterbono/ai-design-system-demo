// Where a push from Figma lands in the library (docs/BUILD-REQUESTS.md): token values ship after the checks, a rename
// or a removal waits for a developer, structure becomes a build request. The rules and the GitHub reads are core's
// (PublishOutcome, libraryArrival); this file shapes them for the result screen and polls the shipped pull requests.

import { type LibraryArrivalKey, type PublishOutcome, type PublishRoute, PUBLISH_ROUTE_COPY } from '@bridge-ds/core';
import { type ArmAnswer, CHECKS_PENDING } from './ship';

export type { PublishRoute };

/** Why a token push waits for a developer: a rename or removal, or Bridge could not arm the merge on this repo. */
export type WaitReason = 'rename' | 'not-armed';

/** One sent item on the result screen. */
export interface RoutedItem {
  /** The token path or the component name, as the designer reads it. */
  label: string;
  kind: 'token' | 'component';
  route: PublishRoute;
  /** The pull request (shipped, waiting) or the build request (an issue, or a library branch from Figma). */
  number: number;
  url: string;
  waitingFor?: WaitReason | undefined;
}

/** A publish outcome from core, with why it waits when it does. */
export type PluginOutcome = PublishOutcome & { waitingFor?: WaitReason | undefined };

export const routedItems = (outcomes: readonly PluginOutcome[]): RoutedItem[] =>
  outcomes.map((o) => ({ label: o.subject.name, kind: o.subject.type, route: o.route, number: o.ref.number, url: o.ref.url, ...(o.waitingFor ? { waitingFor: o.waitingFor } : {}) }));

/**
 * Where a token pull request stands: being armed by Bridge (`arming`, the checks still run), waiting for a developer
 * because Bridge said why (`waiting`, with its reason as is), or after arming core's libraryArrival (on its way, in the
 * library, held, not shipped).
 */
export interface ShipStatus {
  key: LibraryArrivalKey | 'arming' | 'waiting';
  label: string;
  final: boolean;
  /** `waiting`: Bridge's sentence, shown as is. */
  reason?: string | undefined;
}

const ARMING: ShipStatus = { key: 'arming', label: 'Getting ready to ship: the checks are running', final: false };
const ARMED: ShipStatus = { key: 'on-its-way', label: PUBLISH_ROUTE_COPY.shipped.label, final: false };
const MERGED: ShipStatus = { key: 'in-the-library', label: 'In the library', final: true };

/** What an /api/ship answer means for the screen, and when to ask again (checks still running). */
export function armStatus(a: ArmAnswer): { status: ShipStatus; retryInMs?: number | undefined } {
  if (a.armed) return { status: a.merged ? MERGED : ARMED };
  if (a.code === CHECKS_PENDING) return { status: ARMING, retryInMs: (a.retryAfter ?? 60) * 1000 };
  return { status: { key: 'waiting', label: 'Waiting for a developer', final: true, reason: a.reason } };
}

/**
 * The items as the screen groups them: a token change Bridge is arming or armed shows with the token values (route
 * shipped); one Bridge would not ship waits for a developer, with Bridge's reason.
 */
export function effectiveItems(items: readonly RoutedItem[], statuses: ReadonlyMap<number, ShipStatus>): RoutedItem[] {
  return items.map((i) => {
    if (i.route !== 'waiting-for-developer' || i.waitingFor !== 'not-armed') return i;
    const s = statuses.get(i.number);
    return s?.key === 'waiting' ? i : { ...i, route: 'shipped' as const };
  });
}

/** The token pull requests to ask Bridge to ship: values only (a rename or removal waits), once each. */
export const toArm = (items: readonly RoutedItem[]): number[] => [...new Set(items.filter((i) => i.route === 'waiting-for-developer' && i.waitingFor === 'not-armed').map((i) => i.number))];

/** Reads where one shipped pull request stands (libraryArrivalOnGitHub). */
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

export const shipStateLabel = (s: ShipStatus | undefined): string => s?.label ?? PUBLISH_ROUTE_COPY.shipped.label;

/** Every shipped pull request is final: in the library, held for a developer, or not shipped. */
export const shipSettled = (g: RouteGroups, statuses: ReadonlyMap<number, ShipStatus>): boolean => shippedNumbers(g).every((n) => !!statuses.get(n)?.final);

/** What the waiting group says: why a developer acts. Bridge's own reasons show on their rows. */
export function waitingLede(items: readonly RoutedItem[]): string {
  const rename = items.some((i) => i.waitingFor === 'rename');
  const notArmed = items.some((i) => i.waitingFor === 'not-armed');
  if (rename && !notArmed) return PUBLISH_ROUTE_COPY['waiting-for-developer'].sentence;
  if (!rename) return 'Bridge could not ship it by itself, so a developer merges it. The row says why.';
  return `${PUBLISH_ROUTE_COPY['waiting-for-developer'].sentence} Bridge could not ship the others by itself; each row says why.`;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** The headline and one summary sentence per route that has items. */
export function libraryHeadline(g: RouteGroups, statuses: ReadonlyMap<number, ShipStatus>): { title: string; text: string } {
  const numbers = shippedNumbers(g);
  const keys = numbers.map((n) => statuses.get(n)?.key ?? 'on-its-way');
  const inLibrary = keys.filter((k) => k === 'in-the-library').length;
  const stopped = keys.filter((k) => k === 'held' || k === 'not-shipped').length;
  const tokens = g.shipped.length;
  const sentences: string[] = [];
  if (tokens) {
    if (stopped) sentences.push(`${plural(tokens, 'token change')}: held for a developer, nothing to do on your side.`);
    else if (inLibrary === numbers.length) sentences.push(`${plural(tokens, 'token change')} ${tokens === 1 ? 'is' : 'are'} in the library. Storybook shows ${tokens === 1 ? 'it' : 'them'} after the next deploy.`);
    else sentences.push(`${plural(tokens, 'token change')} on ${tokens === 1 ? 'its way: it ships by itself' : 'their way: they ship by themselves'} once the automatic checks pass.`);
  }
  if (g.waiting.length) sentences.push(`${plural(g.waiting.length, 'change')} wait${g.waiting.length === 1 ? 's' : ''} for a developer.`);
  if (g.builds.length) sentences.push(`${plural(g.builds.length, 'build request')} sent: developers build ${g.builds.length === 1 ? 'it' : 'them'} from what you sent, follow ${g.builds.length === 1 ? 'it' : 'them'} in Being built.`);
  const only = [tokens, g.waiting.length, g.builds.length].filter(Boolean).length === 1;
  const title = only && tokens
    ? stopped ? 'Held for a developer' : inLibrary === numbers.length ? 'In the library' : 'Sent to the library'
    : only && g.builds.length
      ? g.builds.length === 1 ? 'Build request sent to developers' : 'Build requests sent to developers'
      : only && g.waiting.length
        ? 'Waiting for a developer'
        : 'Sent';
  return { title, text: sentences.join(' ') };
}

/** Core suggests every 20 to 30 seconds; a pull request's checks take minutes. */
export const SHIP_POLL_MS = 20_000;
export const SHIP_TIMEOUT_MS = 15 * 60_000;

export interface ShipPollerOptions {
  poll: ShipPoll;
  /** Pull requests already armed: only their arrival is read. */
  numbers: number[];
  /** Pull requests to ask Bridge to ship first (/api/ship); once armed, their arrival is read too. */
  arming?: number[] | undefined;
  arm?: ((n: number) => Promise<ArmAnswer>) | undefined;
  onUpdate: (statuses: Map<number, ShipStatus>) => void;
  /** 15 minutes with a pull request still on its way. Polling stops; start() polls again. */
  onTimeout: () => void;
  onError?: ((err: unknown) => void) | undefined;
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
}

/**
 * Asks Bridge to ship each token pull request (again when the checks still run), then reads each armed one every 20
 * seconds, for up to 15 minutes, until each one is final.
 */
export class ShipPoller {
  readonly statuses = new Map<number, ShipStatus>();
  private handle: unknown;
  private startedAt = 0;
  private running = false;
  private readonly armAt = new Map<number, number>();
  private readonly all: number[];

  constructor(private readonly o: ShipPollerOptions) {
    this.all = [...new Set([...(o.arming ?? []), ...o.numbers])];
    for (const n of o.arming ?? []) this.statuses.set(n, ARMING);
  }

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

  /** Arms what is due, reads the armed ones not final yet. True when all are final (polling stops). */
  async check(): Promise<boolean> {
    const now = (this.o.now ?? Date.now)();
    try {
      for (const n of this.all) {
        const s = this.statuses.get(n);
        if (s?.final) continue;
        if (s?.key === 'arming' && this.o.arm) {
          if ((this.armAt.get(n) ?? 0) > now) continue;
          // Bridge unreachable or refusing the request (sign-in, site down): a developer merges it, and the row says why.
          const answer = await this.o.arm(n).catch((err: unknown): ArmAnswer => ({ armed: false, route: 'waiting-for-developer', code: 'error', reason: err instanceof Error ? err.message : String(err) }));
          const { status, retryInMs } = armStatus(answer);
          this.statuses.set(n, status);
          if (retryInMs !== undefined) this.armAt.set(n, now + retryInMs);
          continue;
        }
        this.statuses.set(n, await this.o.poll(n));
      }
    } catch (err) {
      this.o.onError?.(err);
      return false;
    }
    this.o.onUpdate(new Map(this.statuses));
    const done = this.all.every((n) => !!this.statuses.get(n)?.final);
    if (done) this.stop();
    return done;
  }
}
