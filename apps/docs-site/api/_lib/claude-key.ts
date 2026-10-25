// A team's own Claude: the Anthropic API key a team admin connects in Studio Settings, so Bridge can run the Figma fix
// loop for that team (api/claude, docs/FIGMA-FIXES.md "Claude runs it for the team"). The key is the team's: its usage
// is billed to the team's Anthropic account, never to Bridge.
//
// Rules, all enforced here:
//   - Stored server side only, encrypted at rest with AES-256-GCM under a key derived (HKDF-SHA256) from the
//     BRIDGE_SECRETS_KEY env var. The team's repository is the additional data, so a stored key never decrypts for
//     another team.
//   - Never returned to any client: `publicConnection` gives who added it and when, nothing of the key.
//   - Never logged: nothing in this file (or api/claude) writes to the console, and no error message carries it.
//
// Keys (Upstash Redis, the same database as members and invites; repository lower case):
//   bridge:claude:key:<owner/repo>   { v: 1, iv, tag, ct, addedBy, at }  no expiry; Disconnect deletes it
//
// BRIDGE_SECRETS_KEY: 32 random bytes or more, base64 (`openssl rand -base64 32`). Without it (or shorter), connecting
// answers "not set up on this site yet" and nothing is stored. Changing it makes every stored key unreadable: teams
// connect again (the run then says Claude is not connected).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Redis } from './redis.js';

const ALGO = 'aes-256-gcm';
const INFO = 'bridge claude api key v1';
const MIN_SECRET_BYTES = 32;

export const claudeKeyKey = (repo: string) => `bridge:claude:key:${repo.trim().toLowerCase()}`;

/** What is stored per team: the encrypted key, and who added it when (a display name, no email). */
export interface StoredClaudeKey {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
  addedBy: string;
  at: string;
}

/** What any member may read about the connection. Nothing of the key. */
export interface ClaudeConnection {
  connected: boolean;
  addedBy?: string;
  at?: string;
}

/** The encryption key from BRIDGE_SECRETS_KEY (base64, 32 bytes or more), or null when it is not set up. */
export function secretsKey(raw: string | undefined): Buffer | null {
  const t = raw?.trim();
  if (!t) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(t, 'base64');
  } catch {
    return null;
  }
  if (bytes.length < MIN_SECRET_BYTES) return null;
  return Buffer.from(hkdfSync('sha256', bytes, Buffer.from('bridge'), Buffer.from(INFO), 32));
}

const aad = (repo: string) => Buffer.from(`claude-key:${repo.trim().toLowerCase()}`);

export function sealKey(apiKey: string, repo: string, key: Buffer, random: (n: number) => Uint8Array = (n) => randomBytes(n)): Pick<StoredClaudeKey, 'iv' | 'tag' | 'ct'> {
  const iv = Buffer.from(random(12));
  const c = createCipheriv(ALGO, key, iv);
  c.setAAD(aad(repo));
  const ct = Buffer.concat([c.update(apiKey, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

/** The key in clear, or null when it does not decrypt (another secret, another team, a tampered record). */
export function openKey(s: Pick<StoredClaudeKey, 'iv' | 'tag' | 'ct'>, repo: string, key: Buffer): string | null {
  try {
    const d = createDecipheriv(ALGO, key, Buffer.from(s.iv, 'base64'));
    d.setAAD(aad(repo));
    d.setAuthTag(Buffer.from(s.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(s.ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** An Anthropic API key as the Claude Console gives it. Anything else is refused before any call. */
export const API_KEY = /^sk-ant-[A-Za-z0-9_-]{16,256}$/;

function parseStored(raw: unknown): StoredClaudeKey | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as StoredClaudeKey;
    return v && v.v === 1 && typeof v.iv === 'string' && typeof v.tag === 'string' && typeof v.ct === 'string' && typeof v.addedBy === 'string' && typeof v.at === 'string' ? v : null;
  } catch {
    return null;
  }
}

export interface ClaudeKeyStore {
  /** Who connected it and when, for any member. */
  connection(repo: string): Promise<ClaudeConnection>;
  /** The key in clear, for a run on the server only. Null when none is connected or it no longer decrypts. */
  reveal(repo: string): Promise<string | null>;
  connect(repo: string, apiKey: string, addedBy: string, now: number): Promise<ClaudeConnection>;
  disconnect(repo: string): Promise<void>;
}

export function claudeKeyStore(redis: Redis, key: Buffer, random?: (n: number) => Uint8Array): ClaudeKeyStore {
  const read = async (repo: string) => parseStored(await redis.cmd('GET', claudeKeyKey(repo)));
  return {
    async connection(repo) {
      return publicConnection(await read(repo));
    },
    async reveal(repo) {
      const s = await read(repo);
      return s ? openKey(s, repo, key) : null;
    },
    async connect(repo, apiKey, addedBy, now) {
      const s: StoredClaudeKey = { v: 1, ...sealKey(apiKey, repo, key, random), addedBy, at: new Date(now).toISOString() };
      await redis.cmd('SET', claudeKeyKey(repo), JSON.stringify(s));
      return publicConnection(s);
    },
    async disconnect(repo) {
      await redis.cmd('DEL', claudeKeyKey(repo));
    },
  };
}

/** Who added it and when; never a byte of the key. */
export function publicConnection(s: StoredClaudeKey | null): ClaudeConnection {
  return s ? { connected: true, addedBy: s.addedBy, at: s.at } : { connected: false };
}
