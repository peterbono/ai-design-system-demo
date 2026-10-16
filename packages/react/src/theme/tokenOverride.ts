// Staging-only token override: load a design system branch's tokens.css on top of the installed one, so a product
// staging can preview a DS branch without reinstalling. Off by default, allowlisted, and refused in production
// builds unless the app opts in twice (enabled + allowInProduction). See docs/PREVIEWS.md, "Security".

export interface TokenOverrideOptions {
  /** Master switch, default `false`. Wire it to a staging-only env var, never hardcode `true`. */
  enabled?: boolean;
  /**
   * Where override CSS may come from. Each entry is one of:
   *   - an origin: `https://bridge-docs.example.com`
   *   - an origin plus path prefix: `https://cdn.example.com/bridge/`
   *   - a wildcard subdomain of a domain you own: `https://*.preview.example.com`
   * Empty (the default) means nothing is allowed. Never allowlist a shared host like `*.vercel.app`: anyone can
   * deploy there.
   */
  allow?: readonly string[];
  /** Also run when `process.env.NODE_ENV === 'production'`. Default `false`. Staging builds usually need it. */
  allowInProduction?: boolean;
  /** Query parameter that sets the override. Default `bridge-tokens`. `?bridge-tokens=off` clears it. */
  param?: string;
  /** localStorage key that keeps the override across page loads. Default `bridge-tokens`. `null` disables storage. */
  storageKey?: string | null;
}

export const TOKEN_OVERRIDE_DEFAULTS = { param: 'bridge-tokens', storageKey: 'bridge-tokens' } as const;
export const TOKEN_OVERRIDE_ATTR = 'data-bridge-tokens-override';

const CLEAR_VALUES = new Set(['', 'off', 'none', 'clear', 'reset']);
const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

// Module-local declaration: the package does not depend on @types/node, and this does not touch the global one.
declare const process: { env: Record<string, string | undefined> };

function nodeEnv(): string | undefined {
  // Keep the literal `process.env.NODE_ENV`: app bundlers (Vite, webpack, esbuild) replace it at build time.
  // Unbundled in a browser it throws a ReferenceError, which reads as "not production".
  try {
    return process.env.NODE_ENV;
  } catch {
    return undefined;
  }
}

/** True when the options allow an override to run in this build. */
export function isTokenOverrideActive(options: TokenOverrideOptions | undefined, env: string | undefined = nodeEnv()): boolean {
  if (!options?.enabled) return false;
  if (!options.allow?.length) return false;
  if (env === 'production' && !options.allowInProduction) return false;
  return true;
}

interface AllowRule {
  protocol: string;
  /** Exact host, or the parent domain when `wildcard` is set. */
  host: string;
  wildcard: boolean;
  port: string;
  path: string;
}

function parseRule(entry: string): AllowRule | null {
  const m = /^(https?):\/\/(\*\.)?([^/:*]+)(?::(\d+))?(\/[^*]*)?$/i.exec(entry.trim());
  if (!m) return null;
  const host = m[3]!.toLowerCase();
  // A wildcard needs at least a registrable-looking parent (two labels): `*.com` is never valid.
  if (m[2] && !host.includes('.')) return null;
  return { protocol: `${m[1]!.toLowerCase()}:`, host, wildcard: Boolean(m[2]), port: m[4] ?? '', path: m[5] ?? '/' };
}

/**
 * Validates a candidate override URL against the allowlist. Returns the normalized URL, or null when it is not
 * allowed. Rules: http(s) only (plain http only for localhost), no credentials, path ends in `.css`, and the
 * origin (plus path prefix when given) matches an allowlist entry.
 */
export function allowedTokenOverrideUrl(raw: string, allow: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) return null;
  if (url.username || url.password) return null;
  if (!url.pathname.toLowerCase().endsWith('.css')) return null;
  const host = url.hostname.toLowerCase();
  for (const entry of allow) {
    const rule = parseRule(entry);
    if (!rule) continue;
    if (rule.protocol !== url.protocol) continue;
    if (rule.port !== url.port) continue;
    const hostOk = rule.wildcard ? host.endsWith(`.${rule.host}`) : host === rule.host;
    if (!hostOk) continue;
    const prefix = rule.path.endsWith('/') ? rule.path : `${rule.path}/`;
    if (rule.path !== '/' && url.pathname !== rule.path && !url.pathname.startsWith(prefix)) continue;
    return url.href;
  }
  return null;
}

export interface TokenOverrideEnv {
  /** `location.search`, e.g. `?bridge-tokens=https://...`. */
  search: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  env?: string | undefined;
}

export interface TokenOverrideDecision {
  url: string | null;
  /** Why there is no override, or where it came from. For logs and a staging badge. */
  source: 'inactive' | 'param' | 'storage' | 'cleared' | 'rejected' | 'none';
}

/**
 * Pure decision: which override URL applies, given the options, the query string and storage. A valid query
 * parameter wins and is remembered; `?bridge-tokens=off` forgets it; a stored value is re-validated on every load
 * so shrinking the allowlist revokes it.
 */
export function resolveTokenOverride(options: TokenOverrideOptions | undefined, ctx: TokenOverrideEnv): TokenOverrideDecision {
  if (!isTokenOverrideActive(options, 'env' in ctx ? ctx.env : nodeEnv())) return { url: null, source: 'inactive' };
  const allow = options!.allow!;
  const param = options!.param ?? TOKEN_OVERRIDE_DEFAULTS.param;
  const key = options!.storageKey === undefined ? TOKEN_OVERRIDE_DEFAULTS.storageKey : options!.storageKey;
  const storage = key ? ctx.storage ?? null : null;
  const safe = <T,>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };

  const params = new URLSearchParams(ctx.search);
  if (params.has(param)) {
    const value = (params.get(param) ?? '').trim();
    if (CLEAR_VALUES.has(value.toLowerCase())) {
      if (storage) safe(() => storage.removeItem(key!));
      return { url: null, source: 'cleared' };
    }
    const url = allowedTokenOverrideUrl(value, allow);
    if (!url) return { url: null, source: 'rejected' };
    if (storage) safe(() => storage.setItem(key!, url));
    return { url, source: 'param' };
  }

  const stored = storage ? safe(() => storage.getItem(key!)) : null;
  if (stored) {
    const url = allowedTokenOverrideUrl(stored, allow);
    if (url) return { url, source: 'storage' };
    safe(() => storage!.removeItem(key!));
    return { url: null, source: 'rejected' };
  }
  return { url: null, source: 'none' };
}

/**
 * Applies the decision to the document: one `<link rel="stylesheet">` appended to `<head>`, after the installed
 * tokens.css so its rules win. Returns a cleanup that removes it. No-op outside the browser.
 */
export function applyTokenOverride(options: TokenOverrideOptions | undefined): { decision: TokenOverrideDecision; remove: () => void } {
  const noop = () => {};
  if (typeof window === 'undefined' || typeof document === 'undefined') return { decision: { url: null, source: 'inactive' }, remove: noop };
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  const decision = resolveTokenOverride(options, { search: window.location.search, storage, env: nodeEnv() });
  document.querySelectorAll(`link[${TOKEN_OVERRIDE_ATTR}]`).forEach((el) => el.remove());
  if (decision.source === 'rejected') console.warn('[bridge] token override refused: the URL is not on the allowlist.');
  if (!decision.url) {
    document.documentElement.removeAttribute(TOKEN_OVERRIDE_ATTR);
    return { decision, remove: noop };
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = decision.url;
  link.referrerPolicy = 'no-referrer';
  link.setAttribute(TOKEN_OVERRIDE_ATTR, '');
  document.head.appendChild(link);
  document.documentElement.setAttribute(TOKEN_OVERRIDE_ATTR, new URL(decision.url).host);
  console.info(`[bridge] previewing tokens from ${decision.url} (${decision.source}). Add ?${options?.param ?? TOKEN_OVERRIDE_DEFAULTS.param}=off to stop.`);
  return {
    decision,
    remove: () => {
      link.remove();
      document.documentElement.removeAttribute(TOKEN_OVERRIDE_ATTR);
    },
  };
}
