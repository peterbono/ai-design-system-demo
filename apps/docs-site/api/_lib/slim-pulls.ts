// A list of pull requests as Studio reads it, without what no page reads. GitHub repeats two full repository objects
// (about 7 KB each) in every pull request of a list, and the links of every person and label: a list of 50 weighs
// 1 MB, too big to keep in Redis (MAX_KEPT_CHARS), so every page paid GitHub for it again. Bodies are the small part
// (a tenth) and are kept whole: exploration blocks, requester lines and every other mark Bridge reads live there.
//
// The server's copy of @bridge-ds/core trimGitHub (activity.ts), which already serves the public demo teams these
// same lists, so every page is known to read them this way. The API does not load core; slim-pulls.test.ts holds the
// two together. Only trimGitHub cuts very long text, this one never does.

/** URL fields a page reads; every other `*_url` and `url` is an API link nothing follows. */
const KEPT_URLS = new Set(['html_url', 'avatar_url']);
const DROPPED = new Set(['_links', 'node_id', 'gravatar_id', 'user_view_type', 'site_admin']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const slimUser = (u: Record<string, unknown>) => ({
  login: u.login,
  ...(u.id !== undefined ? { id: u.id } : {}),
  ...(u.avatar_url ? { avatar_url: u.avatar_url } : {}),
  ...(u.html_url ? { html_url: u.html_url } : {}),
  ...(u.type ? { type: u.type } : {}),
});

const slimRepo = (r: Record<string, unknown>) => ({
  ...(r.id !== undefined ? { id: r.id } : {}),
  name: r.name,
  full_name: r.full_name,
  ...(r.private !== undefined ? { private: r.private } : {}),
  ...(r.fork !== undefined ? { fork: r.fork } : {}),
  ...(r.default_branch ? { default_branch: r.default_branch } : {}),
  ...(isObj(r.owner) ? { owner: slimUser(r.owner) } : {}),
  ...(r.html_url ? { html_url: r.html_url } : {}),
});

function slim(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => slim(v, key));
  if (!isObj(value)) return value;
  if (key === 'repo' && typeof value.full_name === 'string') return slimRepo(value);
  if (typeof value.login === 'string' && ('avatar_url' in value || 'type' in value)) return slimUser(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROPPED.has(k) || ((k === 'url' || k.endsWith('_url')) && !KEPT_URLS.has(k))) continue;
    out[k] = slim(v, k);
  }
  return out;
}

/** The address of a list of pull requests (`rest`: the path segments after /repos/<owner>/<repo>). One pull request stays whole. */
export const isPullList = (rest: readonly string[]): boolean => rest.length === 1 && rest[0] === 'pulls';

/** GitHub's answer to a list of pull requests, slimmed. Anything that is not a JSON list comes back as it is. */
export function slimPullList(body: string): string {
  try {
    const list: unknown = JSON.parse(body);
    return Array.isArray(list) ? JSON.stringify(slim(list)) : body;
  } catch {
    return body;
  }
}
