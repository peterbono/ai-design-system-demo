import { describe, expect, it } from 'vitest';
import { parseGrant, passOrigin, withReadPass } from './read-pass-link';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const PASS = 'v1.eyJ0IjoiYWNtZS9kcyJ9.c2lnbmF0dXJlLWJ5dGVz';
const grant = { pass: PASS, exp: NOW + 8 * 3600_000, origins: ['https://{branch}.art-print-shop-design.pages.dev', 'https://art-print-shop.pages.dev'] };
const TRY = 'https://explore-add-a-toast-alert.art-print-shop-design.pages.dev/?bridge=4&bridge-repo=art-print-shop-co%2Fart-print-shop-design';

describe('read pass on a toolbar link', () => {
  it('goes in front of the fragment of a toolbar link to a product page the team names, keeping the hash route', () => {
    expect(withReadPass(TRY, grant, NOW)).toBe(`${TRY}#bridge-pass=${PASS}`);
    expect(withReadPass(`${TRY}#/orders?x=1`, grant, NOW)).toBe(`${TRY}#bridge-pass=${PASS}&/orders?x=1`);
  });

  it('never on another link, another host, an expired pass, or twice', () => {
    expect(withReadPass('https://explore-x.art-print-shop-design.pages.dev/', grant, NOW)).toBeNull();
    expect(withReadPass('https://evil.example/?bridge=4', grant, NOW)).toBeNull();
    expect(withReadPass('https://a.b.art-print-shop-design.pages.dev/?bridge=4', grant, NOW)).toBeNull();
    expect(withReadPass('http://explore-x.art-print-shop-design.pages.dev/?bridge=4', grant, NOW)).toBeNull();
    expect(withReadPass('https://u:p@art-print-shop.pages.dev/?bridge=4', grant, NOW)).toBeNull();
    expect(withReadPass('javascript:alert(1)//?bridge=4', grant, NOW)).toBeNull();
    expect(withReadPass(TRY, { ...grant, exp: NOW + 1000 }, NOW)).toBeNull();
    expect(withReadPass(TRY, null, NOW)).toBeNull();
    expect(withReadPass(`${TRY}#bridge-pass=${PASS}`, grant, NOW)).toBeNull();
  });

  it('local product servers only when Studio itself runs locally', () => {
    expect(withReadPass('http://localhost:5180/?bridge=4', grant, NOW)).toBeNull();
    expect(withReadPass('http://localhost:5180/?bridge=4', grant, NOW, true)).toBe(`http://localhost:5180/?bridge=4#bridge-pass=${PASS}`);
    expect(passOrigin('https://art-print-shop.pages.dev', grant.origins)).toBe(true);
  });

  it('reads a grant from the server, or nothing', () => {
    expect(parseGrant({ pass: PASS, exp: 1, origins: ['https://a.example', 3] })).toEqual({ pass: PASS, exp: 1, origins: ['https://a.example'] });
    expect(parseGrant({ pass: null })).toBeNull();
    expect(parseGrant({ pass: 'has spaces in it ok?', exp: 1, origins: [] })).toBeNull();
  });
});
