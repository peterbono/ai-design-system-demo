// The browser side of /api/claude (api/claude/index.ts): the team's Claude connection in Settings. A GitHub sign-in
// sends its token (Bearer); an email member sends the Studio header and the session cookie. Every rule is checked by the
// server; nothing here grants anything, and the key the admin pastes goes to this site's server only, once.
import { CONTRIBUTE_HEADER } from '../lib/contribute';
import type { ClaudeConnectionView } from '../lib/claude-connect';
import { getToken, signedInWithGitHub } from './github-session';

export const CLAUDE_API = '/api/claude';

/** The site cannot do this (no server piece, or not set up). */
export class ClaudeUnavailable extends Error {
  constructor() {
    super('not available');
    this.name = 'ClaudeUnavailable';
  }
}

/** The server refused or failed, with a sentence a person can act on. */
export class ClaudeApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ClaudeApiError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: Fetch = (input, init) => fetch(input, init);

/** Tests swap the network. */
export function setClaudeFetch(f: Fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
}

function authHeaders(): Record<string, string> {
  const token = signedInWithGitHub() ? getToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : { [CONTRIBUTE_HEADER]: '1' };
}

export async function claudeCall<T>(method: 'GET' | 'POST', query: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetchImpl(`${CLAUDE_API}${query}`, { method, headers, credentials: 'same-origin', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new ClaudeApiError('Bridge did not answer. Check your connection and try again.', 'network', 0);
  }
  // No function at this address (404, or the static host's HTML page): this site has no such server yet.
  const isJson = /json/i.test(res.headers.get('content-type') ?? '');
  if (res.status === 404 || res.status === 405 || !isJson) throw new ClaudeUnavailable();
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 503 && data.error === 'not_configured') throw new ClaudeUnavailable();
  if (!res.ok) throw new ClaudeApiError(typeof data.message === 'string' && data.message ? data.message : 'Something went wrong. Try again in a minute.', typeof data.error === 'string' ? data.error : 'failed', res.status);
  return data as T;
}

const view = (d: Partial<ClaudeConnectionView>): ClaudeConnectionView => ({
  available: d.available !== false,
  connected: d.connected === true,
  ...(typeof d.addedBy === 'string' ? { addedBy: d.addedBy } : {}),
  ...(typeof d.at === 'string' ? { at: d.at } : {}),
  canManage: d.canManage === true,
});

export async function readClaudeConnection(repo: string): Promise<ClaudeConnectionView> {
  return view(await claudeCall<Partial<ClaudeConnectionView>>('GET', `?repo=${encodeURIComponent(repo)}`));
}

/** An admin connects the team's key. The answer says who and when, never the key. */
export async function connectClaude(repo: string, key: string): Promise<Pick<ClaudeConnectionView, 'connected' | 'addedBy' | 'at'>> {
  const r = await claudeCall<Partial<ClaudeConnectionView>>('POST', '', { action: 'connect', repo, key });
  return { connected: r.connected === true, ...(r.addedBy ? { addedBy: r.addedBy } : {}), ...(r.at ? { at: r.at } : {}) };
}

export async function disconnectClaude(repo: string): Promise<void> {
  await claudeCall('POST', '', { action: 'disconnect', repo });
}

// --- Claude fix runs (Studio, Being built) ---------------------------------------------------------------------

/** The team's runs of the last 7 days, newest first. */
export async function listClaudeRuns(repo: string): Promise<unknown[]> {
  const r = await claudeCall<{ runs?: unknown[] }>('GET', `?repo=${encodeURIComponent(repo)}&runs=1`);
  return Array.isArray(r.runs) ? r.runs : [];
}

/** Moves a run one step on the server (one Claude round at most) and answers where it stands. */
export async function pollClaudeRun(repo: string, id: string): Promise<unknown> {
  const r = await claudeCall<{ run?: unknown }>('GET', `?repo=${encodeURIComponent(repo)}&run=${encodeURIComponent(id)}`);
  return r.run ?? null;
}
