// bridge_whoami ("Who am I in Bridge"): which person this session acts as, their role in the team, how they signed
// in, and what a save means for them, in one line. The hosted connector knows the grant (api/mcp passes `identity`);
// the local server asks GitHub who the token belongs to and reads the role from the repository and the governance.
import type { BridgeContext } from './context.js';

export type WhoAmIRole = 'Admin' | 'Reviewer' | 'Can edit' | 'Reader';

/** What the session is, as the hosted connector knows it (api/mcp builds it from the grant). */
export type WhoAmI = {
  name: string;
  /** GitHub login, for a GitHub sign-in. */
  login?: string | undefined;
  /** Masked email (d***@yopmail.com), for an email sign-in. Never the whole address. */
  email?: string | undefined;
  role: WhoAmIRole;
  via: 'github' | 'email';
  /** The team's display name. */
  team: string;
  /** 'bridge': saves go through Bridge's app as this person; 'own': their own GitHub access; 'none': read only. */
  writes: 'bridge' | 'own' | 'none';
};

/** d***@yopmail.com: the first letter and the domain, never the whole address. */
export function maskEmail(email: string): string {
  const e = email.trim();
  const at = e.lastIndexOf('@');
  if (at < 1) return '***';
  return `${e[0]}***${e.slice(at)}`;
}

/** The one line that says what a save means for this person. */
export function whoamiLine(w: Pick<WhoAmI, 'name' | 'login' | 'writes'>): string {
  if (w.writes === 'bridge') return `Your saves go through Bridge as ${w.name}.`;
  if (w.writes === 'own') return `You write with your own GitHub access${w.login ? ` (@${w.login})` : ''}.`;
  return 'You can read the design system; saving needs a GitHub token with write access.';
}

const ownerLogin = (entry: string) => {
  const e = entry.trim().replace(/^@/, '');
  return e.includes('/') ? null : e.toLowerCase();
};

/** The local session: GitHub says who owns the token, the repository and the governance say the role. */
async function localWhoami(ctx: BridgeContext): Promise<WhoAmI> {
  const { config } = await ctx.config();
  const gh = await ctx.github().catch(() => null);
  const team = gh?.fullName ?? (config.repo ? `${config.repo.owner}/${config.repo.name}` : 'this design system');
  const token = ctx.opts.token;
  if (!token || !gh) return { name: 'Not signed in to GitHub', role: 'Reader', via: 'github', team, writes: 'none' };
  const f = ctx.opts.fetch ?? fetch;
  const api = (ctx.opts.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'bridge-mcp' };
  const get = async (path: string) => {
    const r = await f(`${api}${path}`, { headers }).catch(() => null);
    return r && r.ok ? ((await r.json().catch(() => null)) as Record<string, any> | null) : null;
  };
  const [me, repo] = await Promise.all([get('/user'), get(`/repos/${gh.fullName}`)]);
  const login = typeof me?.login === 'string' ? me.login : undefined;
  const name = typeof me?.name === 'string' && me.name.trim() ? me.name.trim() : (login ?? 'Unknown GitHub account');
  const p = (repo?.permissions ?? {}) as { admin?: boolean; push?: boolean };
  const owners = [...config.governance.owners.design, ...config.governance.owners.tech].map(ownerLogin).filter(Boolean);
  const role: WhoAmIRole = p.admin ? 'Admin' : login && owners.includes(login.toLowerCase()) ? 'Reviewer' : p.push ? 'Can edit' : 'Reader';
  const writes = ctx.canWriteRemote && (p.push || p.admin) ? 'own' : 'none';
  return { name, ...(login ? { login } : {}), role, via: 'github', team, writes };
}

export async function whoami(ctx: BridgeContext): Promise<WhoAmI & { means: string }> {
  const w = (await ctx.opts.identity?.().catch(() => null)) ?? (await localWhoami(ctx));
  return { ...w, means: whoamiLine(w) };
}
