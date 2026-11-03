// The read pass (api/_lib/read-pass.ts): signed, short-lived, one team, the product repositories it names.
import { describe, expect, it } from 'vitest';
import { MAX_READ_PASS_TTL_MS, mintReadPass, passOpens, READ_PASS_TTL_MS, verifyReadPass } from '../../api/_lib/read-pass';
import { signClaims } from '../../api/_lib/session';
import { originAllowed, originTemplatesOf } from '../../api/_lib/team-read';

const SECRET = 's'.repeat(40);
const T0 = Date.parse('2026-11-03T10:00:00Z');
const input = { team: 'The-Bridge-Company/AI-Design-System-Demo', repos: ['the-bridge-company/art-print-shop-design', 'The-Bridge-Company/Art-Print-Shop', 'the-bridge-company/ai-design-system-demo'], member: 'a'.repeat(24) };

describe('read pass', () => {
  it('mints for the product repositories only, lower case, open READ_PASS_TTL_MS', () => {
    const m = mintReadPass(input, SECRET, T0)!;
    expect(m.exp).toBe(T0 + READ_PASS_TTL_MS);
    const c = verifyReadPass(m.pass, SECRET, T0 + 1000)!;
    expect(c.t).toBe('the-bridge-company/ai-design-system-demo');
    expect(c.r).toEqual(['the-bridge-company/art-print-shop-design', 'the-bridge-company/art-print-shop']);
    expect(passOpens(c, 'the-bridge-company/ai-design-system-demo', 'the-bridge-company/art-print-shop-design')).toBe(true);
  });

  it('never mints longer than 12 hours, nor for no product', () => {
    expect(mintReadPass(input, SECRET, T0, 48 * 3600 * 1000)!.exp).toBe(T0 + MAX_READ_PASS_TTL_MS);
    expect(mintReadPass({ ...input, repos: [] }, SECRET, T0)).toBeNull();
  });

  it('expires', () => {
    const { pass } = mintReadPass(input, SECRET, T0)!;
    expect(verifyReadPass(pass, SECRET, T0 + READ_PASS_TTL_MS - 1)).not.toBeNull();
    expect(verifyReadPass(pass, SECRET, T0 + READ_PASS_TTL_MS)).toBeNull();
  });

  it('opens only its team and the repositories it names', () => {
    const c = verifyReadPass(mintReadPass(input, SECRET, T0)!.pass, SECRET, T0);
    expect(passOpens(c, 'acme/acme-flow', 'the-bridge-company/art-print-shop-design')).toBe(false);
    expect(passOpens(c, 'the-bridge-company/ai-design-system-demo', 'the-bridge-company/other')).toBe(false);
    expect(passOpens(c, 'the-bridge-company/ai-design-system-demo', 'the-bridge-company/ai-design-system-demo')).toBe(false);
    expect(passOpens(null, 'the-bridge-company/ai-design-system-demo', 'the-bridge-company/art-print-shop')).toBe(false);
  });

  it('refuses a tampered pass, another secret, another purpose, or claims open too long', () => {
    const { pass } = mintReadPass(input, SECRET, T0)!;
    const [v, body, mac] = pass.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as { r: string[]; exp: number };
    expect(verifyReadPass(`${v}.${Buffer.from(JSON.stringify({ ...claims, r: [...claims.r, 'evil/repo'] })).toString('base64url')}.${mac}`, SECRET, T0)).toBeNull();
    expect(verifyReadPass(pass, 't'.repeat(40), T0)).toBeNull();
    expect(verifyReadPass(signClaims(claims, SECRET, 'bridge-contrib'), SECRET, T0)).toBeNull();
    expect(verifyReadPass(signClaims({ ...claims, exp: claims.exp + 30 * 3600 * 1000 }, SECRET, 'bridge-read-pass'), SECRET, T0)).toBeNull();
    expect(verifyReadPass('x'.repeat(5000), SECRET, T0)).toBeNull();
    expect(verifyReadPass(null, SECRET, T0)).toBeNull();
  });
});

describe('product origins a pass may go to', () => {
  it('names a Cloudflare Pages branch preview (the branch is the whole first label), never a whole shared host', () => {
    const origins = originTemplatesOf({
      products: [
        { design: { preview: 'https://{branch}.art-print-shop-design.pages.dev' }, preview: 'https://{branch}.art-print-shop.pages.dev', production: 'https://art-print-shop.pages.dev' },
        { preview: 'https://{branch}.pages.dev' },
        { preview: 'https://{branch}.vercel.app' },
      ],
    });
    expect(origins).toEqual(['https://art-print-shop.pages.dev', 'https://{branch}.art-print-shop.pages.dev', 'https://{branch}.art-print-shop-design.pages.dev']);
    expect(originAllowed('https://explore-add-a-toast-alert.art-print-shop-design.pages.dev', origins)).toBe(true);
    expect(originAllowed('https://a.b.art-print-shop-design.pages.dev', origins)).toBe(false);
    expect(originAllowed('https://evil.pages.dev', origins)).toBe(false);
  });
});
