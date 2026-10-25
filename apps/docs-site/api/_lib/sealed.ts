// Small secrets the server keeps at rest, sealed: AES-256-GCM under a key derived (HKDF-SHA256) from
// LIBRARY_SESSION_SECRET with its own purpose, so no new secret is needed and a sealed value of one feature never opens
// for another. `bound` (a record id) is the additional data: a sealed value moved to another record does not open.
// Node built-ins only. Nothing here logs.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface Sealed {
  iv: string;
  tag: string;
  ct: string;
}

/** The sealing key for one purpose, or null when the session secret is missing or short (32 characters at least). */
export function sealingKey(secret: string | undefined, purpose: string): Buffer | null {
  const s = secret?.trim();
  if (!s || s.length < 32) return null;
  return Buffer.from(hkdfSync('sha256', Buffer.from(s, 'utf8'), Buffer.from('bridge-sealed'), Buffer.from(purpose), 32));
}

export function seal(text: string, key: Buffer, bound: string, random: (n: number) => Uint8Array = (n) => randomBytes(n)): Sealed {
  const iv = Buffer.from(random(12));
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(bound));
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

/** The text, or null when it does not open (another key, another record, tampered). */
export function unseal(s: Sealed, key: Buffer, bound: string): string | null {
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
    d.setAAD(Buffer.from(bound));
    d.setAuthTag(Buffer.from(s.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(s.ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
