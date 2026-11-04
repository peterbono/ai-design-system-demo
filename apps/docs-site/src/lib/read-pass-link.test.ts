import { describe, expect, it } from 'vitest';
import { isToolbarLink, parseGrant, passOrigin, toolbarTakesPass, withReadPass } from './read-pass-link';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const PASS = 'v1.eyJ0IjoiYWNtZS9kcyJ9.c2lnbmF0dXJlLWJ5dGVz';
const grant = { pass: PASS, exp: NOW + 8 * 3600_000, origins: ['https://{branch}.art-print-shop-design.pages.dev', 'https://art-print-shop.pages.dev'] };
const TRY = 'https://explore-add-a-toast-alert.art-print-shop-design.pages.dev/?bridge=4&bridge-repo=the-bridge-company%2Fart-print-shop-design';

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

describe('a toolbar link', () => {
  it('is a product page Studio opens with ?bridge=, nothing else', () => {
    expect(isToolbarLink(TRY)).toBe(true);
    expect(isToolbarLink('https://explore-x.art-print-shop-design.pages.dev/')).toBe(false);
    expect(isToolbarLink('https://u:p@art-print-shop.pages.dev/?bridge=4')).toBe(false);
    expect(isToolbarLink('javascript:alert(1)//?bridge=4')).toBe(false);
    expect(isToolbarLink('not a url')).toBe(false);
  });
});

describe('whether a branch build takes the pass', () => {
  const pkg = (range: unknown, where = 'dependencies') => JSON.stringify({ [where]: { '@bridge-ds/toolbar': range } });

  it('says no for a toolbar older than 0.8.0: it would leave the pass in the hash and the page would render empty', () => {
    // The two explorations of the Art print shop copy started before the copy moved to 0.8.1.
    expect(toolbarTakesPass(pkg('^0.7.0'))).toBe(false);
    expect(toolbarTakesPass(pkg('~0.7.2'))).toBe(false);
    expect(toolbarTakesPass(pkg('0.6.0', 'devDependencies'))).toBe(false);
    expect(toolbarTakesPass(pkg('>=0.6.0 <0.9.0'))).toBe(false);
    expect(toolbarTakesPass(pkg('^0.7.0 || ^0.8.0'))).toBe(false);
  });

  it('says yes from 0.8.0 on', () => {
    expect(toolbarTakesPass(pkg('^0.8.1'))).toBe(true);
    expect(toolbarTakesPass(pkg('0.8.0'))).toBe(true);
    expect(toolbarTakesPass(pkg('^1.0.0'))).toBe(true);
  });

  it('cannot say without a toolbar range it reads: the pass goes on as before', () => {
    expect(toolbarTakesPass(null)).toBeNull();
    expect(toolbarTakesPass('{not json')).toBeNull();
    expect(toolbarTakesPass(JSON.stringify({ dependencies: { react: '^19.0.0' } }))).toBeNull();
    expect(toolbarTakesPass(pkg('workspace:*'))).toBeNull();
    expect(toolbarTakesPass(pkg('latest'))).toBeNull();
  });
});
