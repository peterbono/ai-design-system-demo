// @vitest-environment jsdom
// raw.githubusercontent.com serves public repositories only: a signed-in reader of a private team repository reads
// its files through the contents API (an email member through this site's proxy), a public one stays on the raw host.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ghGet, rawFileUrl } from './github-session';

const SHA = 'c'.repeat(40);
let calls: string[];
let isPrivate: boolean;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  isPrivate = true;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${url} ${(init?.headers as Record<string, string> | undefined)?.Accept ?? ''}`);
    if (url === 'https://api.github.com/repos/acme/ds') return new Response(JSON.stringify({ full_name: 'acme/ds', private: isPrivate, default_branch: 'main' }));
    if (url.startsWith('https://api.github.com/repos/acme/ds/contents/')) return new Response('{"color":{}}');
    if (url.startsWith('https://raw.githubusercontent.com/')) return isPrivate ? new Response('404: Not Found', { status: 404 }) : new Response('{"color":{}}');
    throw new TypeError(`unexpected fetch ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

const RAW = `https://raw.githubusercontent.com/acme/ds/${SHA}/packages/tokens/src/semantic/light.tokens.json`;

describe('raw files of a team repository', () => {
  it('signed in on a private repository: the contents API with the raw media type, never the raw host', async () => {
    localStorage.setItem('bridge.github.token', 'ghp_test');
    expect(await rawFileUrl(RAW)).toEqual({ url: `https://api.github.com/repos/acme/ds/contents/packages/tokens/src/semantic/light.tokens.json?ref=${SHA}`, accept: 'application/vnd.github.raw' });
    expect((await ghGet<string>(RAW, { raw: true })).data).toBe('{"color":{}}');
    expect(calls.some((c) => c.startsWith('https://raw.githubusercontent.com/'))).toBe(false);
    expect(calls).toContain(`https://api.github.com/repos/acme/ds/contents/packages/tokens/src/semantic/light.tokens.json?ref=${SHA} application/vnd.github.raw`);
  });

  it('a public repository, or a visitor without a session: the raw host, no API read for the file', async () => {
    isPrivate = false;
    localStorage.setItem('bridge.github.token', 'ghp_test');
    expect(await rawFileUrl(RAW)).toEqual({ url: RAW });
    localStorage.clear();
    calls = [];
    expect(await rawFileUrl(RAW)).toEqual({ url: RAW });
    expect(calls).toEqual([]);
  });

  it('a branch name as the ref is passed on encoded once', async () => {
    localStorage.setItem('bridge.github.token', 'ghp_test');
    const r = await rawFileUrl('https://raw.githubusercontent.com/acme/ds/bridge%2Fdarker/docs/a.md');
    expect(r.url).toBe('https://api.github.com/repos/acme/ds/contents/docs/a.md?ref=bridge%2Fdarker');
  });
});

describe('a profile read for an email member', () => {
  it('answers not found without asking GitHub', async () => {
    await expect(ghGet('/users/priya%40acme.com')).rejects.toMatchObject({ status: 404 });
    expect(calls).toEqual([]);
  });
});
