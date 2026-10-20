// People in Studio, for designers: a display name instead of "@login", an illustrated face seeded by the login when
// there is no photo, and Claude shown as Claude when an AI agent made the work. Pure helpers; the page side
// (fetching profile names, swapping faces in) lives in scripts/people.ts.

/** A cached profile name: `name` null when the person set none (then the login shows, without the @). */
export interface NameEntry {
  name: string | null;
  at: number;
}

export type NameCache = Record<string, NameEntry>;

/** Profile names stay a week: people rarely rename themselves, and anonymous visitors have 60 GitHub reads an hour. */
export const NAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Logins compare without case and without a leading @. */
export const loginKey = (login: string) => login.trim().replace(/^@/, '').toLowerCase();

/** GitHub bots and apps ("renovate[bot]", "github-actions[bot]"): never looked up, named without the suffix. */
export const isBotLogin = (login: string) => /\[bot\]$/i.test(login.trim());

/** How the agent is named everywhere in Bridge, whatever account opened the work. */
export const AGENT_NAME = 'Claude AI';

/**
 * True when the login is the agent's own account or app: Claude ("claude", "claude[bot]") or the Bridge agent that
 * opens library branches for an exploration ("bridge-agent", "bridge-agent[bot]"). Both show as Claude AI.
 */
export const isClaudeLogin = (login: string) => /^@?(?:claude|bridge-agent)(?:\[bot\])?$/i.test(login.trim());

/** What a designer reads for a login: the profile name when known, else the login without the @ (bots without [bot]). */
export function personName(login: string, cache: NameCache = {}): string {
  const bare = login.trim().replace(/^@/, '');
  if (isClaudeLogin(bare)) return AGENT_NAME;
  const hit = cache[loginKey(bare)]?.name?.trim();
  if (hit) return hit;
  return bare.replace(/\[bot\]$/i, '') || 'Someone';
}

/** Parses the stored cache, dropping anything malformed or older than the TTL. */
export function readNameCache(raw: string | null, now: number): NameCache {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: NameCache = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as Partial<NameEntry> | null;
      if (!e || typeof e.at !== 'number' || now - e.at > NAME_TTL_MS) continue;
      if (e.name !== null && typeof e.name !== 'string') continue;
      out[k] = { name: e.name, at: e.at };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The logins still to look up, at most `budget` of them, in first-seen order. Bots, Claude and cached logins are
 * skipped; so are duplicates. Anonymous visitors get a small budget so names never starve the page's own reads.
 */
export function loginsToFetch(logins: string[], cache: NameCache, budget: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of logins) {
    const k = loginKey(l);
    if (!k || seen.has(k) || cache[k] || isBotLogin(k) || isClaudeLogin(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= budget) break;
  }
  return out;
}

/** Looks budget per page view: signed in, GitHub allows 5,000 reads an hour; anonymous, 60 shared with the page. */
export const nameBudget = (signedIn: boolean) => (signedIn ? 20 : 4);

/**
 * Marks every "@login" written in the text of an HTML string (never inside tags, never an "@org/team" or an email)
 * as a person, so paintPeople can swap in the display name: `<span data-person="ana">@ana</span>`.
 */
export function markLogins(html: string): string {
  return html.replace(/(^|>)([^<]*)/g, (_m, open: string, text: string) =>
    open + text.replace(/(^|[^\w@./-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?)(?![\w/@.-])/g, (_x, pre: string, login: string) => `${pre}<span data-person="${loginKey(login)}">@${login}</span>`),
  );
}

/** "Claude AI, with Ana Lima" when Claude made it from someone's account; "Ana Lima" otherwise. */
export function authorLine(login: string, agent: boolean, cache: NameCache = {}): string {
  const name = personName(login, cache);
  if (!agent) return name;
  return isClaudeLogin(login) ? AGENT_NAME : `${AGENT_NAME}, with ${name}`;
}
