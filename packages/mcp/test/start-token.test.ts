// RT-3: the MCP server takes GITHUB_TOKEN or BRIDGE_GITHUB_TOKEN, else the gh sign-in, in the CLI's order, and says
// once at start where the token came from or that it runs without one. The token itself is never in what it says.
import { describe, expect, it } from 'vitest';
import { optionsFromArgv, tokenNote } from '../dist/lib.js';

const SECRET = 'gho_secret123';

describe('the MCP server token at start', () => {
  it('the environment first, BRIDGE_GITHUB_TOKEN before GITHUB_TOKEN; the gh sign-in is not even asked', () => {
    let asked = 0;
    const gh = () => (asked++, SECRET);
    expect(optionsFromArgv([], { GITHUB_TOKEN: 'env1', BRIDGE_GITHUB_TOKEN: 'env2' }, gh)).toMatchObject({ token: 'env2', tokenSource: 'env' });
    expect(optionsFromArgv([], { GITHUB_TOKEN: 'env1' }, gh)).toMatchObject({ token: 'env1', tokenSource: 'env' });
    expect(asked).toBe(0);
    expect(tokenNote('env')).toBeUndefined();
  });

  it('falls back to gh auth token when neither is set, and says so without the token', () => {
    const o = optionsFromArgv(['--repo', 'o/r'], {}, () => SECRET);
    expect(o).toMatchObject({ repo: 'o/r', token: SECRET, tokenSource: 'gh' });
    const note = tokenNote(o.tokenSource)!;
    expect(note).toMatch(/^GitHub token: your gh sign-in \(gh auth token\)/);
    expect(note).not.toContain(SECRET);
  });

  it('without any token: no token option, and one line that says reads are limited and how to fix it', () => {
    const o = optionsFromArgv([], { GITHUB_TOKEN: '' }, () => undefined);
    expect(o.token).toBeUndefined();
    expect(o.tokenSource).toBe('none');
    const note = tokenNote(o.tokenSource)!;
    expect(note).toMatch(/^No GitHub token/);
    expect(note).toContain('60 requests an hour');
    expect(note).toMatch(/Set GITHUB_TOKEN where the server runs, or run gh auth login/);
    expect(note).not.toMatch(/—/);
  });
});
