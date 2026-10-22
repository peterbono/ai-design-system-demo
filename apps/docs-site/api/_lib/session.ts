// Signed session cookies (api/library-access readers, api/contribute email contributors): the value is
// v1.<base64url claims>.<HMAC-SHA256>, under LIBRARY_SESSION_SECRET, with a purpose in the MAC so a cookie of one
// feature never passes for another. Compared in constant time.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { b64url, fromB64url } from './http.js';

const mac = (secret: string, purpose: string, body: string) => createHmac('sha256', secret).update(`${purpose}:${body}`).digest();

export function signClaims(claims: object, secret: string, purpose: string): string {
  const body = `v1.${b64url(JSON.stringify(claims))}`;
  return `${body}.${b64url(mac(secret, purpose, body))}`;
}

/** The claims when the signature holds and `valid` accepts them, else null. Expiry is the caller's to check. */
export function verifyClaims<T>(value: string, secret: string, purpose: string, valid: (c: any) => boolean): T | null {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return null;
  const want = mac(secret, purpose, `${parts[0]}.${parts[1]}`);
  let got: Buffer;
  try {
    got = fromB64url(parts[2]);
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c: unknown = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    return c && typeof c === 'object' && valid(c) ? (c as T) : null;
  } catch {
    return null;
  }
}

/** The cookie `name` of the request, or null. */
export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const cookieAttrs = (path: string) => `Path=${path}; HttpOnly; Secure; SameSite=Lax`;
