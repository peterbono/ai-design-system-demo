// "Sign in with Bridge": the plugin's side of api/plugin-link (apps/docs-site). The plugin asks Bridge for a one-time
// code, opens Studio with it, and polls with its own secret until the designer picked their team there. It receives
// the team's repository and the GitHub sign-in Studio holds, once. The designer never sees or pastes a token.

export interface LinkStart {
  code: string;
  secret: string;
  url: string;
  expiresIn: number;
  interval: number;
}

export interface LinkApproved {
  repo: string;
  name: string | null;
  token: string;
  expiresAt: number | null;
  login: string;
  defaultBranch: string | null;
}

export type LinkPoll = { status: 'pending' } | ({ status: 'approved' } & LinkApproved) | { status: 'expired'; message: string };

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const SIGN_IN_WORDS = {
  action: 'Sign in with Bridge',
  lede: 'Sign in with the Bridge account you already use in Studio, then pick your team. No token to paste.',
  waiting: 'Finish in your browser: pick your team, then come back here.',
  reopen: 'Open the page again',
  cancel: 'Cancel',
  expired: 'The sign-in page expired. Sign in again.',
  unreachable: 'Bridge did not answer. Check your connection, then sign in again.',
  notSetUp: 'Sign in with Bridge is not available yet. A developer can connect with a token under For developers.',
  connected: (team: string) => `Connected to ${team}.`,
} as const;

const post = async (f: Fetch, api: string, body: unknown) => {
  const res = await f(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

export const linkApi = (origin: string) => `${origin}/api/plugin-link`;

/** A code and its secret, and the Studio address to open. Throws a designer sentence when Bridge cannot start one. */
export async function startBridgeSignIn(f: Fetch, origin: string): Promise<LinkStart> {
  let r: Awaited<ReturnType<typeof post>>;
  try {
    r = await post(f, linkApi(origin), { action: 'start' });
  } catch {
    throw new Error(SIGN_IN_WORDS.unreachable);
  }
  if (r.status === 503) throw new Error(SIGN_IN_WORDS.notSetUp);
  const d = r.data;
  if (!r.ok || typeof d.code !== 'string' || typeof d.secret !== 'string' || typeof d.url !== 'string') throw new Error(SIGN_IN_WORDS.unreachable);
  // Only a Studio page of this very site is opened.
  if (!d.url.startsWith(`${origin}/`)) throw new Error(SIGN_IN_WORDS.unreachable);
  return { code: d.code, secret: d.secret, url: d.url, expiresIn: Number(d.expiresIn) || 300, interval: Math.max(2, Number(d.interval) || 3) };
}

/** One poll: still waiting, approved (once), or gone (expired, already used). A network failure throws. */
export async function pollBridgeSignIn(f: Fetch, origin: string, link: Pick<LinkStart, 'code' | 'secret'>): Promise<LinkPoll> {
  const r = await post(f, linkApi(origin), { action: 'poll', code: link.code, secret: link.secret });
  const d = r.data;
  if (r.ok && d.status === 'pending') return { status: 'pending' };
  if (r.ok && d.status === 'approved' && typeof d.repo === 'string' && typeof d.token === 'string') {
    return { status: 'approved', repo: d.repo, token: d.token, name: typeof d.name === 'string' ? d.name : null, expiresAt: typeof d.expiresAt === 'number' ? d.expiresAt : null, login: typeof d.login === 'string' ? d.login : '', defaultBranch: typeof d.defaultBranch === 'string' ? d.defaultBranch : null };
  }
  if (r.status === 410 || r.status === 403 || r.status === 400) return { status: 'expired', message: SIGN_IN_WORDS.expired };
  throw new Error(SIGN_IN_WORDS.unreachable);
}

/**
 * Polls every `interval` seconds until approved, gone, cancelled or past the code's life. A failed poll (offline for a
 * moment) is tried again on the next tick; the code's life still bounds it.
 */
export class BridgeSignInPoller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly f: Fetch,
    private readonly origin: string,
    private readonly link: LinkStart,
    private readonly on: (p: LinkPoll) => void,
    private readonly now: () => number = Date.now,
    private readonly wait: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
  ) {}

  start(): this {
    const until = this.now() + this.link.expiresIn * 1000;
    const tick = async () => {
      if (this.stopped) return;
      if (this.now() > until) return this.finish({ status: 'expired', message: SIGN_IN_WORDS.expired });
      try {
        const p = await pollBridgeSignIn(this.f, this.origin, this.link);
        if (this.stopped) return;
        if (p.status !== 'pending') return this.finish(p);
      } catch {
        /* offline for a moment: the next tick tries again */
      }
      if (!this.stopped) this.timer = this.wait(() => void tick(), this.link.interval * 1000);
    };
    this.timer = this.wait(() => void tick(), this.link.interval * 1000);
    return this;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private finish(p: LinkPoll): void {
    this.stop();
    this.on(p);
  }
}
