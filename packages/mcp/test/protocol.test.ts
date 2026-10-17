// MCP protocol smoke test: spawn the built server over stdio like Claude Code does, list, call, read.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_DIST, REPO } from './helpers.js';

const TOOLS = [
  'bridge_audit',
  'bridge_check_contrast',
  'bridge_draft_docs',
  'bridge_get_component',
  'bridge_get_config',
  'bridge_get_design_language',
  'bridge_get_guidelines',
  'bridge_get_history',
  'bridge_get_review',
  'bridge_get_token',
  'bridge_get_token_history',
  'bridge_list_brands',
  'bridge_list_components',
  'bridge_list_reviews',
  'bridge_list_tokens',
  'bridge_plan_brand',
  'bridge_plan_revert',
  'bridge_propose_brand',
  'bridge_propose_revert',
  'bridge_propose_token_change',
  'bridge_review_pr',
  'bridge_scaffold_component',
  'bridge_search_tokens',
  'bridge_validate_tokens',
  'bridge_visual_impact',
];

let client: Client;
beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/TOKEN/.test(k))) as Record<string, string>;
  client = new Client({ name: 'bridge-smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(MCP_DIST, 'index.js'), '--root', REPO], env, stderr: 'ignore' }));
});
afterAll(async () => {
  await client?.close();
});

const text = (r: any) => r.content[0].text as string;

describe('MCP over stdio', () => {
  it('initializes with server info and instructions', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'bridge', version: '0.1.0' });
    expect(client.getInstructions()).toMatch(/never writes to main/);
  });

  it('lists the 25 tools with JSON schemas and read-only hints', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    const getToken = tools.find((t) => t.name === 'bridge_get_token')!;
    expect(getToken.inputSchema.required).toEqual(['path']);
    expect(getToken.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'bridge_propose_token_change')!.annotations?.readOnlyHint).toBe(false);
    for (const t of tools) expect(t.description, t.name).not.toMatch(/\u2014/);
  });

  it('calls bridge_get_token', async () => {
    const r = await client.callTool({ name: 'bridge_get_token', arguments: { path: 'color.text.muted' } });
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(text(r));
    expect(data.cssVar).toBe('--color-text-muted');
    expect(data.values).toHaveLength(4);
  });

  it('calls bridge_check_contrast, with and without edits', async () => {
    const all = JSON.parse(text(await client.callTool({ name: 'bridge_check_contrast', arguments: {} })));
    expect(all.checks).toBe(296);
    expect(all.failing).toBe(0);
    const edit = JSON.parse(text(await client.callTool({ name: 'bridge_check_contrast', arguments: { edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.300}', mode: { theme: 'light' } }] } })));
    expect(edit.newFailures.length).toBeGreaterThan(0);
  });

  it('returns tool errors as isError results, not protocol errors', async () => {
    const r = await client.callTool({ name: 'bridge_get_token', arguments: { path: 'color.nope' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/No token/);
  });

  it('serves resources and the component template', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(['bridge://tokens/resolved', 'bridge://design-language', 'bridge://guidelines', 'bridge://components/Button']));
    const resolved = JSON.parse((await client.readResource({ uri: 'bridge://tokens/resolved' })).contents[0]!.text as string);
    expect(resolved.values['color.text.muted']).toBe('#5b6672');
    expect(resolved.overrides['brand=bridge,theme=dark,density=comfortable']['color.text.muted']).toBe('#a0aab5');
    const button = JSON.parse((await client.readResource({ uri: 'bridge://components/Button' })).contents[0]!.text as string);
    expect(button.name).toBe('Button');
  });

  it('serves the four prompts; audit embeds token suggestions', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['add-component', 'audit-ui-for-tokens', 'migrate-file-to-ds', 'review-token-pr']);
    const p = await client.getPrompt({ name: 'audit-ui-for-tokens', arguments: { code: '.card { background: #ffffff; padding: 16px; }' } });
    const body = (p.messages[0]!.content as { text: string }).text;
    expect(body).toContain('var(--color-bg-default)');
    expect(body).toContain('var(--space-4)');
  });

  it('calls bridge_audit on a product folder: adoption, top files, top fixes', async () => {
    const r = await client.callTool({ name: 'bridge_audit', arguments: { path: 'packages/core/test/fixtures/audit/mui-app', limit: 5 } });
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(text(r));
    expect(data.metrics.componentAdoption).toBe(0);
    expect(data.metrics.hardcoded).toBeGreaterThan(10);
    expect(data.components.foreign['@mui/material'].instances).toBeGreaterThan(5);
    expect(data.topFiles.length).toBeLessThanOrEqual(5);
    expect(data.topFixes.some((f: { use: string }) => f.use === 'var(--color-text-default)')).toBe(true);
    expect(data.findings).toBeUndefined();
    const clean = JSON.parse(text(await client.callTool({ name: 'bridge_audit', arguments: { path: 'packages/core/test/fixtures/audit/clean-app' } })));
    expect(clean.metrics).toMatchObject({ tokenAdoption: 100, componentAdoption: 100 });
    const missing = await client.callTool({ name: 'bridge_audit', arguments: { path: 'nope/nothing' } });
    expect(missing.isError).toBe(true);
  });

  it('migrate-file-to-ds embeds the audit of one file with line numbers and DS components', async () => {
    const p = await client.getPrompt({ name: 'migrate-file-to-ds', arguments: { path: 'packages/core/test/fixtures/audit/mui-app/src/App.tsx' } });
    const body = (p.messages[0]!.content as { text: string }).text;
    expect(body).toContain('"use": "var(--color-text-default)"');
    expect(body).toMatch(/"name": "TextField",\s*"kind": "foreign",\s*"library": "@mui\/material",\s*"use": "Input"/);
    expect(body).toContain('bridge_get_component');
    expect(body).not.toMatch(/\u2014/);
  });
});
