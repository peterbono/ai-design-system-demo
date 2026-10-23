// The README tool table is generated from the server: every registered tool, its title, whether it writes, and the
// first sentence of its description. A tool added, removed or reworded fails this test until the README is
// regenerated: `npm run readme:tools -w @bridge-ds/mcp`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeContext, createServer } from '../src/lib.js';
import { REPO } from './helpers.js';

const README = join(REPO, 'packages/mcp/README.md');
const START = '<!-- tools:start (generated from the server: npm run readme:tools -w @bridge-ds/mcp) -->';
const END = '<!-- tools:end -->';

interface Tool {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  annotations?: { readOnlyHint?: boolean | undefined } | undefined;
}

/** The first sentence: up to the first ". " that is not inside parentheses or backticks. */
export function firstSentence(text: string): string {
  let depth = 0;
  let code = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '`') code = !code;
    else if (!code && c === '(') depth++;
    else if (!code && c === ')') depth = Math.max(0, depth - 1);
    else if (!code && depth === 0 && c === '.' && (i === text.length - 1 || text[i + 1] === ' ')) return text.slice(0, i + 1);
  }
  return text;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function toolsTable(tools: Tool[]): string {
  const rows = [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `| \`${t.name}\` | ${t.annotations?.readOnlyHint ? 'reads' : 'writes'} | ${cell(firstSentence(t.description ?? t.title ?? ''))} |`);
  return [`${tools.length} tools. "writes" tools change files, branches, pull requests or issues; they need a token in remote mode and only run when the person asked.`, '', '| Tool | Access | What it does |', '| --- | --- | --- |', ...rows].join('\n');
}

async function serverTools(): Promise<Tool[]> {
  const ctx = await BridgeContext.create({ root: REPO });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(ctx);
  await server.connect(a);
  const client = new Client({ name: 'readme-test', version: '0.0.0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  await client.close();
  return tools as Tool[];
}

function section(readme: string): { before: string; body: string; after: string } {
  const i = readme.indexOf(START);
  const j = readme.indexOf(END);
  if (i < 0 || j < i) throw new Error(`README.md has no ${START} ... ${END} section.`);
  return { before: readme.slice(0, i + START.length), body: readme.slice(i + START.length, j), after: readme.slice(j) };
}

describe('README tools', () => {
  it('lists every tool the server registers, as the server describes it', async () => {
    const tools = await serverTools();
    const table = toolsTable(tools);
    const readme = readFileSync(README, 'utf8');
    const s = section(readme);
    if (process.env.BRIDGE_UPDATE_README === '1') writeFileSync(README, `${s.before}\n\n${table}\n\n${s.after}`);
    else expect(s.body.trim(), 'README tool table is out of date: npm run readme:tools -w @bridge-ds/mcp').toBe(table);
    for (const t of tools) expect(readme).toContain(`\`${t.name}\``);
  });

  it('cuts a description at its first sentence, not inside parentheses or code', () => {
    expect(firstSentence('Merge it (same gate. Really). Then more.')).toBe('Merge it (same gate. Really).');
    expect(firstSentence('Run `a. b` now. Later.')).toBe('Run `a. b` now.');
    expect(firstSentence('No period')).toBe('No period');
  });
});
