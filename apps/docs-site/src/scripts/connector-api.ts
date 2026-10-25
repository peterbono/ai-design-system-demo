// The browser side of the hosted Bridge connector's views (api/mcp ?view=): who connected Bridge in Claude for this team,
// removing a connection, and the fix sessions. A GitHub sign-in sends its token; an email member sends the Studio header
// and the session cookie. Every rule is checked by the server.
import { CONTRIBUTE_HEADER } from '../lib/contribute';
import type { Connection } from '../lib/claude-connector';
import { getToken, signedInWithGitHub } from './github-session';

export const CONNECTOR_API = '/api/mcp';

/** The site has no connector (an older deploy, a fork, `astro dev`) or it is not set up. */
export class ConnectorUnavailable extends Error {
  constructor() {
    super('not available');
    this.name = 'ConnectorUnavailable';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: Fetch = (input, init) => fetch(input, init);

/** Tests swap the network. */
export function setConnectorFetch(f: Fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
}

async function call<T>(method: 'GET' | 'POST', query: string, body?: unknown): Promise<T> {
  const token = signedInWithGitHub() ? getToken() : null;
  const headers: Record<string, string> = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { [CONTRIBUTE_HEADER]: '1' }) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(`${CONNECTOR_API}${query}`, { method, headers, credentials: 'same-origin', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const isJson = /json/i.test(res.headers.get('content-type') ?? '');
  if (res.status === 404 || res.status === 405 || !isJson) throw new ConnectorUnavailable();
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 503) throw new ConnectorUnavailable();
  if (!res.ok) throw Object.assign(new Error(typeof data.message === 'string' ? data.message : 'Something went wrong. Try again in a minute.'), { status: res.status });
  return data as T;
}

export async function listConnections(repo: string): Promise<{ connections: Connection[]; canManage: boolean }> {
  const r = await call<{ connections?: Connection[]; canManage?: boolean }>('GET', `?view=connections&repo=${encodeURIComponent(repo)}`);
  return { connections: Array.isArray(r.connections) ? r.connections : [], canManage: r.canManage === true };
}

export async function removeConnection(repo: string, id: string): Promise<void> {
  await call('POST', '?view=disconnect', { repo, id });
}

export async function listFixSessions(repo: string): Promise<unknown[]> {
  const r = await call<{ sessions?: unknown[] }>('GET', `?view=sessions&repo=${encodeURIComponent(repo)}`);
  return Array.isArray(r.sessions) ? r.sessions : [];
}
