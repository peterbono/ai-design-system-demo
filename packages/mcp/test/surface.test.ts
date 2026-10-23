// The same operations answer Claude (MCP: tool names and arguments) and a person in a terminal (the bridge CLI: commands
// and flags). A sentence that names a tool goes through say() (src/say.ts), so a CLI user is never told to call
// bridge_merge_branch or to pass overrideReason. Exempt: the tool definitions (server.ts), MCP-only flows (drafts.ts,
// the server's --help) and lines under a comment that says "MCP only".
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers.js';
import { addToken, readOnlyPreview, say } from '../src/say.js';

const SRC = join(REPO, 'packages/mcp/src');
const EXEMPT = new Set(['server.ts', 'drafts.ts', 'index.ts', 'say.ts']);

describe('messages per surface', () => {
  it('every sentence that names an MCP tool has a CLI wording (say)', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(SRC).filter((x) => x.endsWith('.ts') && !EXEMPT.has(x))) {
      const lines = readFileSync(join(SRC, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/bridge_[a-z_]+/.test(line) || /^\s*(\/\/|\*|\/\*\*)/.test(line)) return;
        const around = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (!/say\(/.test(around) && !/\/\/ MCP only/.test(around)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('say, addToken and readOnlyPreview speak to each surface', () => {
    expect(say({ surface: 'mcp' }, 'tool', 'command')).toBe('tool');
    expect(say({ surface: 'cli' }, 'tool', 'command')).toBe('command');
    expect(addToken({ surface: 'mcp' })).toMatch(/GITHUB_TOKEN .*Bridge MCP server/);
    expect(addToken({ surface: 'cli' })).toBe('set GITHUB_TOKEN, pass --token <token>, or add --use-gh-auth to use your gh sign-in');
    expect(readOnlyPreview({ surface: 'cli' })).not.toMatch(/MCP|bridge_/);
  });
});
