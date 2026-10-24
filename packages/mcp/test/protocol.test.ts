// MCP protocol smoke test: spawn the built server over stdio like Claude Code does, list, call, read.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_DIST, REPO } from './helpers.js';
import pkg from '../package.json' with { type: 'json' };

const TOOLS = [
  'bridge_apply_suggestion',
  'bridge_ask_someone_else',
  'bridge_audit',
  'bridge_back_to_draft',
  'bridge_branch_status',
  'bridge_check_contrast',
  'bridge_close_branch',
  'bridge_close_exploration',
  'bridge_combine_branches',
  'bridge_comment',
  'bridge_create_request',
  'bridge_create_suggestion',
  'bridge_draft_docs',
  'bridge_figma_changes',
  'bridge_figma_coverage',
  'bridge_get_component',
  'bridge_get_config',
  'bridge_get_design_language',
  'bridge_get_figma_change',
  'bridge_get_guidelines',
  'bridge_get_history',
  'bridge_get_request',
  'bridge_get_review',
  'bridge_get_settings',
  'bridge_get_suggestion',
  'bridge_get_token',
  'bridge_get_token_history',
  'bridge_link_suggestion',
  'bridge_list_brands',
  'bridge_list_comments',
  'bridge_list_components',
  'bridge_list_explorations',
  'bridge_list_products',
  'bridge_list_requests',
  'bridge_list_reviews',
  'bridge_list_suggestions',
  'bridge_list_tokens',
  'bridge_mark_figma_change_drafted',
  'bridge_merge_branch',
  'bridge_missing_pieces',
  'bridge_open_library_branch',
  'bridge_pending_drafts',
  'bridge_plan_brand',
  'bridge_plan_revert',
  'bridge_product_branch',
  'bridge_promote_exploration',
  'bridge_propose_brand',
  'bridge_propose_revert',
  'bridge_propose_token_change',
  'bridge_push_figma_component',
  'bridge_reopen_branch',
  'bridge_review_branch',
  'bridge_review_pr',
  'bridge_review_suggestion',
  'bridge_save_docs',
  'bridge_scaffold_component',
  'bridge_search_tokens',
  'bridge_send_for_review',
  'bridge_start_exploration',
  'bridge_switch_to_published',
  'bridge_try_branch',
  'bridge_update_from_main',
  'bridge_use_library_preview',
  'bridge_validate_tokens',
  'bridge_visual_impact',
  'bridge_what_needs_me',
  'bridge_write_drafts',
];

let client: Client;
beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/TOKEN/.test(k))) as Record<string, string>;
  // No token at all: the server falls back to the gh sign-in (RT-3), so it runs with git on its PATH and no gh.
  const bin = mkdtempSync(join(tmpdir(), 'bridge-no-gh-'));
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  env.PATH = bin;
  client = new Client({ name: 'bridge-smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(MCP_DIST, 'index.js'), '--root', REPO], env, stderr: 'ignore' }));
});
afterAll(async () => {
  await client?.close();
});

const text = (r: any) => r.content[0].text as string;

describe('MCP over stdio', () => {
  it('initializes with server info and instructions', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'bridge', version: pkg.version });
    expect(client.getInstructions()).toMatch(/never writes to main/);
    expect(client.getInstructions()).toMatch(/Bridge never writes to the default branch/);
  });

  it('says what it may write in the same words in its instructions and bridge_get_config (no token: read-only on GitHub)', async () => {
    const config = JSON.parse(text(await client.callTool({ name: 'bridge_get_config', arguments: {} })));
    expect(config.write).toMatch(/^Read-only on GitHub: suggestions, requests, reviews, merges and pull requests need GITHUB_TOKEN \(or a gh sign-in when the server starts\)\. Direct changes become local bridge\/\* branches, never pushed\.$/);
    expect(client.getInstructions()).toContain(`Access now: ${config.write}`);
    expect(config.source).toContain(config.write);
  });

  it('lists the 67 tools with JSON schemas and read-only hints', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    const getToken = tools.find((t) => t.name === 'bridge_get_token')!;
    expect(getToken.inputSchema.required).toEqual(['path']);
    expect(getToken.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'bridge_propose_token_change')!.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === 'bridge_list_requests')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'bridge_create_request')!.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === 'bridge_list_explorations')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'bridge_start_exploration')!.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === 'bridge_pending_drafts')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'bridge_write_drafts')!.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === 'bridge_pending_drafts')!.description).toMatch(/before and after images.*no em dash, no invented numbers/);
    expect(Object.keys((tools.find((t) => t.name === 'bridge_propose_token_change')!.inputSchema.properties ?? {}) as object)).toContain('branch');
    for (const t of tools) expect(t.description, t.name).not.toMatch(/\u2014/);
    // Studio parity: reads are read-only, every write is an explicit tool (never a side effect of a read).
    const reads = ['bridge_figma_changes', 'bridge_get_figma_change', 'bridge_product_branch', 'bridge_list_products', 'bridge_what_needs_me', 'bridge_branch_status', 'bridge_list_comments', 'bridge_try_branch', 'bridge_combine_branches', 'bridge_get_settings', 'bridge_figma_coverage'];
    const writes = ['bridge_ask_someone_else', 'bridge_send_for_review', 'bridge_back_to_draft', 'bridge_review_branch', 'bridge_comment', 'bridge_merge_branch', 'bridge_close_branch', 'bridge_reopen_branch', 'bridge_update_from_main', 'bridge_save_docs', 'bridge_promote_exploration', 'bridge_close_exploration', 'bridge_missing_pieces', 'bridge_open_library_branch', 'bridge_use_library_preview', 'bridge_switch_to_published', 'bridge_mark_figma_change_drafted', 'bridge_push_figma_component'];
    for (const n of reads) expect(tools.find((t) => t.name === n)!.annotations?.readOnlyHint, n).toBe(true);
    for (const n of writes) expect(tools.find((t) => t.name === n)!.annotations?.readOnlyHint, n).toBe(false);
    for (const n of ['bridge_propose_token_change', 'bridge_start_exploration', 'bridge_create_request', 'bridge_save_docs']) expect(Object.keys((tools.find((t) => t.name === n)!.inputSchema.properties ?? {}) as object), n).toContain('product');
    expect(tools.find((t) => t.name === 'bridge_merge_branch')!.description).toMatch(/explicitly asked to merge/);
    // Suggestions: reads are read-only, the rest are writes; every tool that changes the code takes "changes".
    for (const n of ['bridge_list_suggestions', 'bridge_get_suggestion']) expect(tools.find((t) => t.name === n)!.annotations?.readOnlyHint, n).toBe(true);
    for (const n of ['bridge_create_suggestion', 'bridge_review_suggestion', 'bridge_apply_suggestion', 'bridge_link_suggestion']) expect(tools.find((t) => t.name === n)!.annotations?.readOnlyHint, n).toBe(false);
    for (const n of ['bridge_propose_token_change', 'bridge_propose_brand', 'bridge_propose_revert', 'bridge_open_library_branch', 'bridge_push_figma_component', 'bridge_save_docs'])
      expect(Object.keys((tools.find((t) => t.name === n)!.inputSchema.properties ?? {}) as object), n).toContain('changes');
    // The issue's "How to apply" names this tool and this phrase.
    expect(tools.find((t) => t.name === 'bridge_apply_suggestion')!.description).toMatch(/Apply Bridge suggestion #42/);
  });

  it('calls bridge_get_token', async () => {
    const r = await client.callTool({ name: 'bridge_get_token', arguments: { path: 'color.text.muted' } });
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(text(r));
    expect(data.cssVar).toBe('--color-text-muted');
    // Values collapse where modes agree, so how many groups depends on the live tokens: check every mode is covered.
    const modes = (data.values as { modes: string[] }[]).flatMap((v) => v.modes);
    const config = JSON.parse(readFileSync(join(REPO, 'bridge.config.json'), 'utf8')) as { modes: Record<string, { values: string[] }> };
    const combos = Object.values(config.modes).reduce((n, m) => n * m.values.length, 1);
    expect(modes.includes('all') || new Set(modes).size === combos).toBe(true);
  });

  it('calls bridge_check_contrast, with and without edits', async () => {
    const all = JSON.parse(text(await client.callTool({ name: 'bridge_check_contrast', arguments: {} })));
    // Every pair in every brand x theme: derived from the live files, so a new brand or pair needs no test edit.
    const config = JSON.parse(readFileSync(join(REPO, 'bridge.config.json'), 'utf8')) as { modes: Record<string, { values: string[] }>; contrast: { path: string } };
    const { pairs } = JSON.parse(readFileSync(join(REPO, config.contrast.path), 'utf8')) as { pairs: unknown[] };
    expect(all.checks).toBe(pairs.length * config.modes.brand!.values.length * config.modes.theme!.values.length);
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
    // Compare with bridge_get_token rather than hard-coded hex values: a designer may change the token.
    const token = JSON.parse(text(await client.callTool({ name: 'bridge_get_token', arguments: { path: 'color.text.muted' } })));
    const valueIn = (combo: string) => (token.values as { value: string; modes: string[] }[]).find((v) => v.modes.includes('all') || v.modes.includes(combo))!.value;
    const light = valueIn('brand=bridge,theme=light,density=comfortable');
    const dark = valueIn('brand=bridge,theme=dark,density=comfortable');
    expect(light).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolved.values['color.text.muted']).toBe(light);
    expect(resolved.overrides['brand=bridge,theme=dark,density=comfortable']?.['color.text.muted']).toBe(dark === light ? undefined : dark);
    const button = JSON.parse((await client.readResource({ uri: 'bridge://components/Button' })).contents[0]!.text as string);
    expect(button.name).toBe('Button');
  });

  it('serves the four prompts; audit embeds token suggestions', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['add-component', 'audit-ui-for-tokens', 'migrate-file-to-ds', 'review-token-pr']);
    // The literals are live values (page background, space 4), so a designer changing them never breaks this test.
    const resolved = JSON.parse((await client.readResource({ uri: 'bridge://tokens/resolved' })).contents[0]!.text as string);
    const canvas = resolved.values['color.bg.default'] as string;
    expect(canvas).toMatch(/^#[0-9a-f]{6}$/i);
    const p = await client.getPrompt({ name: 'audit-ui-for-tokens', arguments: { code: `.card { background: ${canvas}; padding: ${resolved.values['space.4']}; }` } });
    const body = (p.messages[0]!.content as { text: string }).text;
    const findings = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(body)![1]!) as { text: string; suggestions: { cssVar: string; path: string; value: string; exact: boolean }[] }[];
    const color = findings.find((f) => f.text === canvas)!;
    // An exact background token comes first. Several tokens may share the value: any of them is a right answer.
    expect(color.suggestions[0]).toMatchObject({ exact: true, value: canvas });
    expect(color.suggestions[0]!.path).toMatch(/(^|\.)(bg|surface|background|fill)(\.|-|$)/);
    expect(body).toContain(color.suggestions[0]!.cssVar);
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
