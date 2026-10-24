// bridge gaps / bridge fix: Fix with Claude from the terminal, in a temp git repo with a real Carbon measure and the
// plugin's Check fidelity run. The loop runner talks to a fake model client: no API key, no network, no GitHub token
// (the gh stub fails).
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { fixLoop, NO_KEY, runFix, runGaps, type FixModel } from '../src/fix.js';
import type { RequestArgs, RequestIO } from '../src/request.js';
import { BridgeContext } from '@bridge-ds/mcp';

const GAP = join(__dirname, '../../core/test/fixtures/gap');

const io = (env: Record<string, string> = {}) => {
  const lines: string[] = [];
  const errors: string[] = [];
  const value = {
    print: (s: string) => void lines.push(s),
    error: (s: string) => void errors.push(s),
    env,
    ghToken: () => undefined,
    hasClaude: () => false,
    fetch: (() => Promise.reject(new Error('no network in tests'))) as unknown as typeof fetch,
  } as RequestIO;
  return { value, lines, errors, text: () => lines.join('\n') };
};

const args = (...argv: string[]): RequestArgs => {
  const a: RequestArgs = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i]!.startsWith('--')) {
      a._.push(argv[i]!);
      continue;
    }
    const k = argv[i]!.slice(2);
    const v = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
    (a.flags[k] ??= []).push(v);
  }
  return a;
};

const labelFixed = { id: 'textinput-label-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', height: 'fixed', reason: 'Carbon keeps 24 px for the label row; Figma hugged the 16 px label.', by: 'claude' };
const outerFixed = { id: 'textinput-field-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-field-outer-wrapper', height: 'fixed', reason: 'The field and its helper keep their measured height with the 4 px gap.', by: 'claude' };

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'bridge-test-fix-'));
  copyFileSync(join(GAP, 'carbon-measured.json'), join(root, 'measured-specs.json'));
  copyFileSync(join(GAP, 'textinput-fidelity.json'), join(root, 'figma-fidelity.json'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  g('add', '-A');
  g('commit', '-q', '-m', 'measure');
  return root;
}

/** A fake Claude: one scripted reply per round, and the prompts it got. */
function fakeModel(replies: string[]): FixModel & { prompts: string[] } {
  const prompts: string[] = [];
  const fn = (async (prompt: string) => {
    prompts.push(prompt);
    return replies[prompts.length - 1] ?? '[]';
  }) as FixModel & { prompts: string[] };
  fn.prompts = prompts;
  return fn;
}

describe('bridge gaps', () => {
  it('lists the components that differ or cannot be checked', async () => {
    const o = io();
    expect(await runGaps(args('gaps'), repo(), o.value)).toBe(0);
    expect(o.text()).toContain('TextInput: Differs. TextInput differs from its story on 1 of 2 variants');
    expect(o.text()).toContain("IconButton: Can't check.");
    expect(o.text()).toContain('bridge fix TextInput --with-claude');
    expect(o.text()).not.toMatch(/bridge_/);
  });
});

describe('bridge fix', () => {
  it('--case prints the gap and the schema', async () => {
    const o = io();
    expect(await runFix(args('fix', 'TextInput', '--case'), repo(), o.value)).toBe(0);
    expect(o.text()).toContain('8 px missing below the label');
    expect(o.text()).toContain('kind "part"');
    expect(o.text()).not.toMatch(/bridge_/);
  });

  it('--try runs the values referee: exit 0 when closer, 1 otherwise', async () => {
    const root = repo();
    writeFileSync(join(root, 'try.json'), JSON.stringify([labelFixed]));
    writeFileSync(join(root, 'bad.json'), JSON.stringify([{ ...labelFixed, height: 'hug' }]));
    const o = io();
    expect(await runFix(args('fix', 'TextInput', '--try', 'try.json'), root, o.value)).toBe(0);
    expect(o.text()).toMatch(/^Closer to the code on the measured values/);
    expect(o.text()).toContain('was 72, now 80 (-12 px -> -4 px): closer');
    expect(await runFix(args('fix', 'TextInput', '--try', 'bad.json'), root, io().value)).toBe(1);
  });

  it('--propose --dry-run prints the body; without it, a local branch (no token needed, never pushed)', async () => {
    const root = repo();
    writeFileSync(join(root, 'fixes.json'), JSON.stringify({ version: 1, fixes: [labelFixed, outerFixed] }));
    const o = io();
    expect(await runFix(args('fix', 'TextInput', '--propose', 'fixes.json', '--summary', 'TextInput keeps its label row height.', '--dry-run'), root, o.value)).toBe(0);
    expect(o.text()).toContain('## TextInput in Figma, fixed with Claude');
    expect(o.text()).toContain('Drafted by Claude through the bridge CLI (source: cli)');
    const w = io();
    expect(await runFix(args('fix', 'TextInput', '--propose', 'fixes.json', '--summary', 'TextInput keeps its label row height.'), root, w.value)).toBe(0);
    expect(w.text()).toContain('branch: bridge/figma-fixes-text-input');
    await expect(runFix(args('fix', 'TextInput', '--propose', 'fixes.json'), root, io().value)).rejects.toThrow(/needs --summary/);
  });

  it('--with-claude without a key says how to run it from Claude Code with the MCP server', async () => {
    const o = io();
    expect(await runFix(args('fix', 'TextInput', '--with-claude'), repo(), o.value)).toBe(1);
    expect(o.text()).toBe(NO_KEY);
    expect(o.text()).toMatch(/bridge_try_figma_fix/);
  });
});

describe('the loop runner (fake model)', () => {
  it('fixes TextInput in two rounds: the first closer, the second resolved, then proposes', async () => {
    const root = repo();
    const model = fakeModel([`Here are my fixes:\n\`\`\`json\n${JSON.stringify([labelFixed])}\n\`\`\``, JSON.stringify([labelFixed, outerFixed])]);
    const o = io();
    expect(await runFix(args('fix', 'TextInput', '--with-claude', '--dry-run'), root, o.value, model)).toBe(0);
    expect(model.prompts).toHaveLength(2);
    expect(model.prompts[0]).toContain('8 px missing below the label');
    expect(model.prompts[1]).toContain('Round 1: you proposed');
    expect(model.prompts[1]).toContain('(-12 px -> -4 px): closer');
    expect(o.lines[0]).toMatch(/^Round 1: closer\. /);
    expect(o.lines[1]).toMatch(/^Round 2: closer\. Closer to the code on the measured values: 1 of 1 difference resolved/);
    expect(o.text()).toContain('`textinput-field-height` (part)');
  });

  it('retries on invalid replies with the problems, and proposes a status fix when nothing came closer', async () => {
    const root = repo();
    const model = fakeModel(['I am not sure.', JSON.stringify([{ ...labelFixed, height: 'tall' }]), JSON.stringify([{ ...labelFixed, height: 'hug' }])]);
    const ctx = await BridgeContext.create({ root, surface: 'cli' });
    const r = await fixLoop(ctx, { component: 'TextInput', ask: model, dryRun: true });
    expect(r.rounds.map((x) => x.verdict ?? 'no fixes')).toEqual(['no fixes', 'invalid', 'same']);
    expect(model.prompts[1]).toContain('The reply has no JSON');
    expect(model.prompts[2]).toContain('height is hug, fill, fixed or a size in px');
    expect(r.status).toBe('status-proposed');
    expect(r.status === 'status-proposed' && r.proposed).toMatchObject({ status: 'dry-run', fixes: ['textinput-differs'] });
  });
});
