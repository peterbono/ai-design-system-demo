import { describe, expect, it } from 'vitest';
import { looksLikeAWall, oidcToken } from './private-shots.mjs';

describe('private shots runner', () => {
  it('never keeps a sign-in page', () => {
    expect(looksLikeAWall('https://vercel.com/login?next=x')).toBe(true);
    expect(looksLikeAWall('https://shop.pages.dev/cdn-cgi/access/login')).toBe(true);
    expect(looksLikeAWall('https://explore-team.acme-account-design.pages.dev/team')).toBe(false);
  });

  it('asks GitHub for the token with the bridge-shots audience, and says what the workflow lacks', async () => {
    const seen = [];
    const f = async (url, init) => (seen.push([url, init.headers.authorization]), Response.json({ value: 'jwt' }));
    expect(await oidcToken({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't' }, f)).toBe('jwt');
    expect(seen).toEqual([['https://gh/token?x=1&audience=bridge-shots', 'Bearer t']]);
    await expect(oidcToken({}, f)).rejects.toThrow(/id-token: write/);
  });
});
