// bridge fixes check / apply and bridge gap, on a trimmed Carbon measure (core's fixture): files in a temp repo, output
// captured, exit codes.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFixes, runGap } from '../src/fixes.js';
import type { RequestArgs, RequestIO } from '../src/request.js';

const FIXTURE = join(__dirname, '../../core/test/fixtures/gap/carbon-measured.json');

const io = () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const value = { print: (s: string) => void lines.push(s), error: (s: string) => void errors.push(s), env: {}, ghToken: () => undefined, hasClaude: () => false } as RequestIO;
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

const FIXES = {
  version: 1,
  fixes: [
    { id: 'switch-pill', kind: 'part', component: 'Toggle', part: '.cds--toggle__switch', set: { cornerRadius: 'full' }, reason: 'Carbon toggles are pills in every size.', by: 'claude' },
    { id: 'btn-48', kind: 'part', component: 'IconButton', part: 'cds--btn', width: 'fixed', height: 'fixed', reason: 'The icon button is 48 px square around a 16 px icon.' },
    { id: 'old-part', kind: 'part', component: 'Toggle', part: 'cds--gone', hide: true, reason: 'A part an older Carbon drew.' },
  ],
};

function repo(fixes: unknown = FIXES): string {
  const root = mkdtempSync(join(tmpdir(), 'bridge-fixes-'));
  copyFileSync(FIXTURE, join(root, 'measured-specs.json'));
  writeFileSync(join(root, 'figma-fixes.json'), JSON.stringify(fixes));
  return root;
}

describe('bridge fixes', () => {
  it('check: valid file, and what finds nothing in a measure', async () => {
    const root = repo();
    const o = io();
    expect(await runFixes(args('fixes', 'check', '--in', 'measured-specs.json'), root, o.value)).toBe(0);
    expect(o.lines[0]).toBe('figma-fixes.json: 3 fixes, valid.');
    expect(o.text()).toContain('not found  old-part (Toggle, part): no part cds--gone in the stories it names');
  });

  it('check: lists problems and exits 1', async () => {
    const root = repo({ version: 1, fixes: [{ id: 'x', kind: 'status', component: 'Toggle', status: 'matches', reason: 'It looks fine to me.' }] });
    const o = io();
    expect(await runFixes(args('fixes', 'check', '--json'), root, o.value)).toBe(1);
    expect(JSON.parse(o.text())).toMatchObject({ valid: false, problems: ['fix x: status cannot be "matches": only the shot comparison says a component matches'] });
  });

  it('apply: writes the patched measure and one line per fix', async () => {
    const root = repo();
    const o = io();
    expect(await runFixes(args('fixes', 'apply', '--in', 'measured-specs.json', '--out', 'out/measured-specs.fixed.json'), root, o.value)).toBe(0);
    expect(o.lines[0]).toBe('2 of 3 fixes applied, written to out/measured-specs.fixed.json.');
    const out = JSON.parse(readFileSync(join(root, 'out/measured-specs.fixed.json'), 'utf8'));
    expect(out.figmaFixes.applied.map((a: { id: string; result: string }) => `${a.id}:${a.result}`)).toEqual(['switch-pill:applied', 'btn-48:applied', 'old-part:not-found']);
    const btn = out.stories.find((s: { id: string; state?: string; overrides?: unknown }) => s.id === 'components-iconbutton--default' && !s.state && !s.overrides);
    expect(btn.spec.sized['cds--btn']).toEqual({ width: 48, height: 48 });
    // The measure itself is left as measured.
    expect(readFileSync(join(root, 'measured-specs.json'), 'utf8')).toBe(readFileSync(FIXTURE, 'utf8'));
  });

  it('apply: needs --in and another --out', async () => {
    const root = repo();
    await expect(runFixes(args('fixes', 'apply', '--out', 'x.json'), root, io().value)).rejects.toThrow(/needs --in/);
    await expect(runFixes(args('fixes', 'apply', '--in', 'measured-specs.json', '--out', 'measured-specs.json'), root, io().value)).rejects.toThrow(/another file than --in/);
  });
});

describe('bridge gap', () => {
  it('prints the gap case of a component from the fidelity report and the drawn set', async () => {
    const root = repo({ version: 1, fixes: [] });
    const measured = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const s = measured.stories.find((x: { id: string; state?: string; overrides?: unknown }) => x.id === 'components-toggle--default' && !x.state && !x.overrides);
    const values = JSON.parse(JSON.stringify(s.spec.values));
    values['cds--toggle-switch'].cornerRadius = 0;
    const spec = { name: 'Toggle', hash: '', source: [], axes: [], properties: [], parts: s.spec.parts, variants: [{ props: {}, values }], unmapped: [] };
    writeFileSync(join(root, 'specs.json'), JSON.stringify({ version: 1, generated: '', components: [spec] }));
    const size = { figma: { width: 74, height: 58 }, code: { width: 74, height: 58 } };
    writeFileSync(join(root, 'fidelity.json'), JSON.stringify({ version: 1, components: [{ component: 'Toggle', status: 'differs', checked: 1, differing: 1, skipped: 0, variants: [{ key: 'Default', status: 'differs', percent: 3.6, size }] }] }));
    mkdirSync(join(root, 'measured-shots'));
    writeFileSync(join(root, 'measured-shots/manifest.json'), JSON.stringify({ version: 1, components: { Toggle: { variants: { Default: { file: 'components-toggle-default.png', width: 74, height: 58, story: s.id } } } } }));
    const o = io();
    expect(await runGap(args('gap', 'Toggle', '--fidelity', 'fidelity.json', '--specs', 'specs.json'), root, o.value)).toBe(0);
    expect(o.lines[0]).toBe('Toggle differs from the code on 1 of 1 variant. Corner radius 0 in Figma vs full in code (toggle switch).');
    expect(o.text()).toContain('- Default: story components-toggle--default, at rest, shot measured-shots/components-toggle-default.png, 3.6% of pixels');
    expect(o.text()).toContain('  - cds--toggle-switch cornerRadius: expected 12, actual 0 (-12 px)');

    const j = io();
    await runGap(args('gap', 'toggle', '--fidelity', 'fidelity.json', '--specs', 'specs.json', '--json'), root, j.value);
    expect(JSON.parse(j.text())).toMatchObject({ version: 1, component: 'toggle', referee: 'shots', differing: 1 });
  });

  it('applies the team fixes first and names them', async () => {
    const root = repo();
    const o = io();
    expect(await runGap(args('gap', 'IconButton'), root, o.value)).toBe(0);
    expect(o.text()).toContain('Pass --fidelity');
    expect(o.text()).toContain('Fixes applied: btn-48');
  });

  it('says when nothing of the component was measured', async () => {
    const root = repo();
    const o = io();
    expect(await runGap(args('gap', 'Slider'), root, o.value)).toBe(1);
    expect(o.errors[0]).toMatch(/no measured story of Slider/);
  });
});
