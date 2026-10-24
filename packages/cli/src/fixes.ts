// bridge fixes / bridge gap: the correction loop's files on the command line. figma-fixes.json holds the team's
// corrections for components the measure does not draw right (core figma-fixes.ts); `bridge gap` prints what differs for
// one component (core gap-case.ts), the brief Claude writes a fix from. The story shot is the referee: these commands
// never say a component matches, the fidelity check does.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  DEFAULT_FIGMA_FIXES_FILE,
  FigmaFixesError,
  appliedFixLines,
  applyFixes,
  buildGapCase,
  parseFigmaFixes,
  parseMeasuredSpecsFile,
  validateFigmaFixes,
  type ComponentSpec,
  type FidelityComponentResult,
  type FigmaFixesFile,
  type GapBuiltVariant,
  type MeasuredSpecsFile,
} from '@bridge-ds/core';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';
import type { MeasuredShotManifest } from './specs.js';

export const FIXES_HELP = `bridge fixes: corrections for the Figma pull, kept in ${DEFAULT_FIGMA_FIXES_FILE}

Usage:
  bridge fixes check [--fixes ${DEFAULT_FIGMA_FIXES_FILE}] [--in measured-specs.json] [--json]
      Validates the fixes file: version, unique ids, a component and a reason on each fix, known kinds
      (part, axis, story, status) and their fields. With --in, also applies them to that measure and lists
      the fixes that find nothing (the code or the measure moved). Exit 1 when the file is not valid.
  bridge fixes apply --in measured-specs.json --out <file> [--fixes ${DEFAULT_FIGMA_FIXES_FILE}] [--json]
      Writes the measure with the fixes laid on, the input the Figma pull reads, and prints one line per
      fix (applied, not found, already applied). The input file is not changed.

See docs/FIGMA-FIXES.md for each kind, with examples. A fix is reviewed like any change, and the story
shot decides: run Check fidelity in the plugin after the pull.`;

export const GAP_HELP = `bridge gap <component>: what differs between Figma and the code for one component

Usage:
  bridge gap <component> [--in measured-specs.json] [--fidelity fidelity.json] [--specs specs.json]
             [--built built.json] [--shots measured-shots/manifest.json] [--fixes ${DEFAULT_FIGMA_FIXES_FILE}]
             [--no-fixes] [--json]
      --fidelity  the plugin's Check fidelity report (or one component's result): the variants that differ
      --specs     the component specs the pull drew the set from
      --built     what the plugin read back from the layers: variant key -> { values, hidden, boxes }
      --shots     the story shots (default: measured-shots/manifest.json next to --in, when present)
      Fixes in ${DEFAULT_FIGMA_FIXES_FILE} are applied to the measure first (--no-fixes: not).
      Prints one sentence for a designer, then the story, args, state, shot and every difference per
      variant. --json prints the gap case (the brief Claude writes a fix from).`;

const flag = (a: RequestArgs, k: string) => {
  const v = a.flags[k]?.[a.flags[k]!.length - 1];
  return v === 'true' ? undefined : v;
};
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

function readJson(path: string, what: string): unknown {
  if (!existsSync(path)) throw new RequestUsageError(`${what} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new RequestUsageError(`${what} is not JSON (${path}): ${(e as Error).message}`);
  }
}

function readMeasured(path: string): MeasuredSpecsFile {
  try {
    return parseMeasuredSpecsFile(readJson(path, 'Measured specs'));
  } catch (e) {
    if (e instanceof RequestUsageError) throw e;
    throw new RequestUsageError(`${path}: ${(e as Error).message}. Measure again with bridge specs --measure.`);
  }
}

export async function runFixes(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (!sub || sub === 'help' || has(a, 'help')) {
    io.print(FIXES_HELP);
    return sub || has(a, 'help') ? 0 : 2;
  }
  if (sub !== 'check' && sub !== 'apply') throw new RequestUsageError(`Unknown fixes command "${sub}".\n\n${FIXES_HELP}`);
  const fixesPath = resolve(root, flag(a, 'fixes') ?? DEFAULT_FIGMA_FIXES_FILE);
  const data = readJson(fixesPath, 'Fixes file');
  const problems = validateFigmaFixes(data);
  const rel = relative(root, fixesPath) || fixesPath;
  const inPath = flag(a, 'in');

  if (sub === 'check') {
    let lines: string[] = [];
    let applied: ReturnType<typeof applyFixes>['applied'] = [];
    if (!problems.length && inPath) {
      applied = applyFixes(readMeasured(resolve(root, inPath)), data as FigmaFixesFile).applied;
      lines = appliedFixLines(applied);
    }
    if (has(a, 'json')) io.print(JSON.stringify({ file: rel, valid: !problems.length, problems, ...(inPath ? { applied } : {}) }, null, 2));
    else if (problems.length) {
      io.print(`${rel}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
      for (const p of problems) io.print(`  ${p}`);
    } else {
      const n = (data as FigmaFixesFile).fixes.length;
      io.print(`${rel}: ${n} fix${n === 1 ? '' : 'es'}, valid.`);
      for (const l of lines) io.print(`  ${l}`);
    }
    return problems.length ? 1 : 0;
  }

  if (problems.length) {
    io.error(new FigmaFixesError(problems).message);
    return 1;
  }
  if (!inPath) throw new RequestUsageError('bridge fixes apply needs --in measured-specs.json (what bridge specs --measure wrote).');
  const out = flag(a, 'out');
  if (!out) throw new RequestUsageError('bridge fixes apply needs --out <file>: the patched measure the pull reads.');
  const inAbs = resolve(root, inPath);
  const outAbs = resolve(root, out);
  if (outAbs === inAbs) throw new RequestUsageError('--out must be another file than --in: the measure stays as measured, fixes are laid on each time.');
  const { file, applied } = applyFixes(readMeasured(inAbs), parseFigmaFixes(data));
  await mkdir(dirname(outAbs), { recursive: true });
  await writeFile(outAbs, `${JSON.stringify(file, null, 2)}\n`);
  if (has(a, 'json')) io.print(JSON.stringify({ out: relative(root, outAbs), applied }, null, 2));
  else {
    const ok = applied.filter((x) => x.result === 'applied').length;
    io.print(`${ok} of ${applied.length} fixes applied, written to ${relative(root, outAbs)}.`);
    for (const l of appliedFixLines(applied)) io.print(`  ${l}`);
  }
  return 0;
}

const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function runGap(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const component = a._[1];
  if (has(a, 'help') || component === 'help') {
    io.print(GAP_HELP);
    return 0;
  }
  if (!component) throw new RequestUsageError(`bridge gap needs a component name.\n\n${GAP_HELP}`);
  const inAbs = resolve(root, flag(a, 'in') ?? 'measured-specs.json');
  let measured = readMeasured(inAbs);

  // The team's fixes first, so the gap is what is left after them.
  const fixesFlag = flag(a, 'fixes');
  const fixesPath = resolve(root, fixesFlag ?? DEFAULT_FIGMA_FIXES_FILE);
  if (!has(a, 'no-fixes') && (fixesFlag || existsSync(fixesPath))) {
    try {
      measured = applyFixes(measured, parseFigmaFixes(readJson(fixesPath, 'Fixes file'))).file as MeasuredSpecsFile;
    } catch (e) {
      if (e instanceof FigmaFixesError) throw new RequestUsageError(`${e.message}. Run bridge fixes check.`);
      throw e;
    }
  }

  let fidelity: FidelityComponentResult | undefined;
  const fidPath = flag(a, 'fidelity');
  if (fidPath) {
    const raw = readJson(resolve(root, fidPath), 'Fidelity report') as { components?: FidelityComponentResult[] } & Partial<FidelityComponentResult>;
    fidelity = raw.components ? raw.components.find((c) => lc(c.component) === lc(component)) : raw.component && lc(raw.component) === lc(component) ? (raw as FidelityComponentResult) : undefined;
    if (!fidelity) throw new RequestUsageError(`${fidPath} has no result for ${component}.`);
  }
  let spec: ComponentSpec | undefined;
  const specsPath = flag(a, 'specs');
  if (specsPath) {
    const raw = readJson(resolve(root, specsPath), 'Component specs') as { components?: ComponentSpec[] } & Partial<ComponentSpec>;
    spec = raw.components ? raw.components.find((c) => lc(c.name) === lc(component)) : (raw as ComponentSpec);
    if (!spec?.parts) throw new RequestUsageError(`${specsPath} has no set ${component}.`);
  }
  const built = flag(a, 'built') ? (readJson(resolve(root, flag(a, 'built')!), 'Built read-back') as Record<string, GapBuiltVariant>) : undefined;

  const manifestPath = flag(a, 'shots') ? resolve(root, flag(a, 'shots')!) : join(dirname(inAbs), 'measured-shots', 'manifest.json');
  let shots: Record<string, { file: string }> | undefined;
  if (existsSync(manifestPath)) {
    const m = readJson(manifestPath, 'Shot manifest') as MeasuredShotManifest;
    const entry = Object.entries(m.components ?? {}).find(([name]) => lc(name) === lc(component))?.[1];
    // Paths relative to the measure, as MeasuredSpecsStory.shot.file is.
    if (entry) shots = Object.fromEntries(Object.entries(entry.variants).map(([k, v]) => [k, { file: relative(dirname(inAbs), join(dirname(manifestPath), v.file)) }]));
  } else if (flag(a, 'shots')) throw new RequestUsageError(`Shot manifest not found: ${flag(a, 'shots')}`);

  if (!measured.stories.some((s) => lc(s.title.split('/').at(-1)!) === lc(component))) {
    io.error(`bridge: no measured story of ${component} in ${relative(root, inAbs)}. Measure it with bridge specs --measure --only ${component}.`);
    return 1;
  }
  const gap = buildGapCase({ component, measured, spec, fidelity, built, shots });
  if (has(a, 'json')) {
    io.print(JSON.stringify(gap, null, 2));
    return 0;
  }
  io.print(gap.summary);
  if (!fidelity && !spec) io.print('Pass --fidelity (the Check fidelity report) and --specs (the set the pull drew) to see what differs.');
  else io.print(`\n${gap.detail}`);
  if (gap.fixes?.length) io.print(`\nFixes applied: ${gap.fixes.join(', ')}`);
  return 0;
}
