// Applying a suggestion on a local git checkout (Node only): the workspace adapter the planner reads through
// (suggestion-apply.ts), the 3-way merge with `git merge-file`, and the three ways to hand the result over:
//   - branch (default): one commit on a new local branch through plumbing (commitToNewLocalBranch), the working tree,
//     the index and the checked-out branch untouched, nothing pushed;
//   - write: the files written into the working tree, refused when those files have uncommitted changes;
//   - patch: a `git format-patch` text built from a commit no branch points to.
// A dry run plans and diffs, and writes nothing. Pushing, opening the pull request and posting the applied comment are
// the caller's (CLI, MCP), with the developer's own access.

import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { baseBranchOf, CONFIG_FILE, loadConfig, protectedBranchesOf, type BridgeConfig } from '../config';
import { slugify } from '../pr-composer';
import { planSuggestionApply, suggestionAppliedComment, type PlanSuggestionApplyInput, type SuggestionApplyOutcome, type SuggestionApplyPlan, type SuggestionWorkspace } from '../suggestion-apply';
import { gitBlobSha } from '../suggestions';
import { branchExists, commitToNewLocalBranch, commitTree, git, listFilesAt } from './git-local';

/** Runs git and returns the exit code with the output instead of throwing on a non-zero code. */
function gitCode(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : -1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

/** `git ls-tree <ref> -- <path>`: mode, type and object of one entry, or null. */
async function treeEntry(root: string, ref: string, path: string): Promise<{ mode: string; type: string; sha: string } | null> {
  const r = await gitCode(root, ['ls-tree', ref, '--', path]);
  const m = /^(\d+) (\w+) ([0-9a-f]+)\t/.exec(r.stdout);
  return r.code === 0 && m ? { mode: m[1]!, type: m[2]!, sha: m[3]! } : null;
}

/** Each folder on the way to a path, then the path itself: "a", "a/b", "a/b/c.json". */
const prefixes = (path: string) => path.split('/').map((_, i, segs) => segs.slice(0, i + 1).join('/'));

/** 3-way merge of three texts with `git merge-file -p`: the merged text, with conflict markers when not clean. */
export async function mergeText(root: string, input: { ours: string; base: string; theirs: string }): Promise<{ clean: boolean; text: string; conflicts: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-merge-'));
  try {
    const [o, b, t] = ['current', 'base', 'suggested'].map((n) => join(dir, n));
    await Promise.all([writeFile(o!, input.ours), writeFile(b!, input.base), writeFile(t!, input.theirs)]);
    const r = await gitCode(root, ['merge-file', '-p', '-L', 'current', '-L', 'base', '-L', 'suggested', o!, b!, t!]);
    if (r.code < 0 || r.code > 127) throw new Error(`git merge-file failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    return { clean: r.code === 0, text: r.stdout, conflicts: r.code };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A unified diff of one file between two texts (null: absent), with a/ and b/ paths like `git diff`. */
export async function fileDiff(path: string, before: string | null, after: string | null): Promise<string> {
  if (before === after) return '';
  const dir = await mkdtemp(join(tmpdir(), 'bridge-diff-'));
  try {
    const side = async (name: 'a' | 'b', text: string | null) => {
      if (text === null) return '/dev/null';
      const p = join(dir, name, path);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, text);
      return `${name}/${path}`;
    };
    const a = await side('a', before);
    const b = await side('b', after);
    const r = await new Promise<{ stdout: string }>((resolve) => execFile('git', ['diff', '--no-index', '--no-color', '--src-prefix=', '--dst-prefix=', '--', a, b], { cwd: dir, maxBuffer: 32 * 1024 * 1024 }, (_e, stdout) => resolve({ stdout })));
    return r.stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface GitWorkspaceOptions {
  /** Read this commit or branch. Absent: the working tree. */
  ref?: string | undefined;
  /** When the base commit is not in the clone, how to read a file there (for example GitHubClient.readFile). */
  readBase?: ((path: string, sha: string) => Promise<string | null>) | undefined;
}

/**
 * The workspace a suggestion plans against on a git checkout: the working tree (to write files there) or a ref (to
 * commit on top of it). The base commit is fetched from origin when the clone lacks it.
 */
export function gitWorkspace(root: string, opts: GitWorkspaceOptions = {}): SuggestionWorkspace {
  const { ref } = opts;
  let fetched = false;
  return {
    async read(path) {
      if (ref) {
        const e = await treeEntry(root, ref, path);
        if (!e || e.type !== 'blob' || e.mode === '120000') return null;
        return { text: await git(root, ['cat-file', 'blob', e.sha]), sha: e.sha };
      }
      try {
        const st = await lstat(join(root, path));
        if (!st.isFile()) return null;
        const text = await readFile(join(root, path), 'utf8');
        return { text, sha: gitBlobSha(text) };
      } catch {
        return null;
      }
    },
    async readAt(at, path) {
      if ((await gitCode(root, ['cat-file', '-e', `${at}^{commit}`])).code !== 0 && !fetched) {
        fetched = true;
        await gitCode(root, ['fetch', '--no-tags', '--quiet', 'origin', at]);
      }
      const e = await treeEntry(root, at, path);
      if (e?.type === 'blob') return git(root, ['cat-file', 'blob', e.sha]);
      return opts.readBase ? opts.readBase(path, at) : null;
    },
    async list() {
      if (ref) return listFilesAt(root, ref);
      const out = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
      const all = [...new Set(out.split('\0').filter(Boolean))];
      const present = await Promise.all(all.map((p) => lstat(join(root, p)).then((s) => s.isFile(), () => false)));
      return all.filter((_, i) => present[i]);
    },
    async isSymlink(path) {
      for (const p of prefixes(path)) {
        if (ref) {
          const e = await treeEntry(root, ref, p);
          if (!e) return false;
          if (e.mode === '120000') return true;
        } else {
          try {
            if ((await lstat(join(root, p))).isSymbolicLink()) return true;
          } catch {
            return false;
          }
        }
      }
      return false;
    },
    merge: (input) => mergeText(root, input),
  };
}

export type LocalApplyMode = 'branch' | 'write' | 'patch';

export interface ApplySuggestionLocallyInput extends Omit<PlanSuggestionApplyInput, 'workspace' | 'config'> {
  /** Repository root (a git checkout). */
  root: string;
  /** The issue number, for the branch name and the commit message. */
  number: number;
  /** Default: bridge.config.json read where the plan reads (the base ref, or the working tree for "write"). */
  config?: BridgeConfig | undefined;
  /** Default "branch". */
  mode?: LocalApplyMode | undefined;
  /** Plan and diff only: nothing is written. */
  dryRun?: boolean | undefined;
  /** The ref the branch or patch builds on. Default "HEAD". Ignored by "write" (the working tree). */
  base?: string | undefined;
  /** Branch name. Default `<branchPrefix>suggestion-<n>-<slug>`, then -2, -3 when taken. */
  branch?: string | undefined;
  /** GitHub login of the developer, for the applied comment. */
  by?: string | undefined;
  readBase?: GitWorkspaceOptions['readBase'];
  /** Clock for the applied comment (tests). */
  now?: (() => string) | undefined;
}

export type LocalApplyStatus = 'dry-run' | 'branch-created' | 'branch-exists' | 'written' | 'patch' | Exclude<SuggestionApplyOutcome, 'ready'>;

export interface LocalSuggestionApply {
  status: LocalApplyStatus;
  exitCode: 0 | 1 | 3;
  message: string;
  plan: SuggestionApplyPlan;
  branch?: string | undefined;
  commit?: string | undefined;
  /** `git format-patch` text (mode "patch"). */
  patch?: string | undefined;
  /** Unified diff of what is (or, in a dry run, would be) written. */
  diff?: string | undefined;
  /** Files written into the working tree (mode "write"). */
  written?: string[] | undefined;
  /** The applied record to post on the issue once a branch or files exist (posting is the caller's). */
  appliedComment?: string | undefined;
}

const COMMIT_TYPE: Record<string, string> = { 'token-change': 'feat(tokens)', docs: 'docs', 'component-spec': 'feat', brand: 'feat(tokens)', revert: 'revert', config: 'chore(config)' };

function commitMessage(plan: SuggestionApplyPlan, n: number): string {
  const p = plan.payload;
  const type = `${COMMIT_TYPE[p.kind] ?? 'chore'}${p.tier.bump === 'major' ? '!' : ''}`;
  return [`${type}: ${p.title.trim()}`, '', p.summary.trim(), '', `Applies Bridge suggestion #${n} (version ${plan.payloadSha.slice(0, 7)}).`].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

async function readConfigAt(ws: SuggestionWorkspace): Promise<BridgeConfig> {
  const text = (await ws.read(CONFIG_FILE))?.text;
  if (!text) throw new Error(`No ${CONFIG_FILE} here: run \`bridge init\` first, or apply from the repository root.`);
  return loadConfig(text);
}

/**
 * Plans a suggestion against the local checkout and hands the result over as a branch (default), files in the
 * working tree, or a patch. Refused, blocked, conflicting or already applied plans write nothing.
 */
export async function applySuggestionLocally(input: ApplySuggestionLocallyInput): Promise<LocalSuggestionApply> {
  const mode = input.mode ?? 'branch';
  const base = input.base ?? 'HEAD';
  const { root } = input;
  const wsOpts = { readBase: input.readBase };
  const ws = gitWorkspace(root, mode === 'write' ? wsOpts : { ...wsOpts, ref: base });
  const config = input.config ?? (await readConfigAt(ws));
  const planFor = (workspace: SuggestionWorkspace) => planSuggestionApply({ ...input, config, workspace });
  const plan = await planFor(ws);
  const at = (input.now ?? (() => new Date().toISOString()))();
  const result = (status: LocalApplyStatus, rest: Partial<LocalSuggestionApply> = {}): LocalSuggestionApply => ({ status, exitCode: plan.exitCode, message: plan.message, plan, ...rest });
  if (plan.outcome !== 'ready') return result(plan.outcome);

  const readNow = async (path: string) => (await ws.read(path))?.text ?? null;
  const diffOf = async () => (await Promise.all(plan.writes.map(async (w) => fileDiff(w.path, await readNow(w.path), w.content)))).join('');

  if (input.dryRun) return result('dry-run', { message: `Dry run: ${plan.message.replace(/^Ready: /, '')} Nothing written.`, diff: await diffOf() });

  if (mode === 'patch') {
    const { sha } = await commitTree(root, { base, message: commitMessage(plan, input.number), files: plan.writes });
    const patch = await git(root, ['format-patch', '-1', '--stdout', sha]);
    return result('patch', { message: 'Patch ready: apply it with `git am`.', patch, commit: sha });
  }

  if (mode === 'write') {
    const paths = plan.writes.map((w) => w.path);
    const dirty = (await git(root, ['status', '--porcelain', '-z', '--', ...paths])).split('\0').filter((l) => l.length > 3).map((l) => l.slice(3));
    if (dirty.length) {
      return result('refused', {
        exitCode: 1,
        message: `Not written: these files have uncommitted changes: ${dirty.join(', ')}. Commit or stash them, or apply on a branch instead.`,
      });
    }
    const diff = await diffOf();
    for (const w of plan.writes) {
      const full = join(root, w.path);
      if (w.content === null) await rm(full, { force: true });
      else {
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, w.content);
      }
    }
    return result('written', {
      message: `Written: ${paths.length} file(s) in the working tree. Review them, commit, and say "Closes #${input.number}" in the pull request.`,
      written: paths,
      diff,
      appliedComment: suggestionAppliedComment(plan, { by: input.by, at }),
    });
  }

  // Branch: reuse a branch of the same name when its tip already has the change, else -2, -3.
  const prefix = config.governance.branchPrefix;
  const wanted = input.branch ?? `${prefix}suggestion-${input.number}-${slugify(plan.payload.title, 40)}`;
  let branch = wanted;
  for (let i = 2; await branchExists(root, branch); i++) {
    const there = await planFor(gitWorkspace(root, { ...wsOpts, ref: branch }));
    if (there.outcome === 'already-applied') {
      const commit = (await git(root, ['rev-parse', `refs/heads/${branch}`])).trim();
      return result('branch-exists', {
        exitCode: 0,
        message: `Already on ${branch}: that branch has every change of this suggestion. Push it and open a pull request that says "Closes #${input.number}".`,
        branch,
        commit,
        appliedComment: suggestionAppliedComment(plan, { by: input.by, branch, commit, at }),
      });
    }
    branch = `${wanted}-${i}`;
  }
  const protectedBranches = [...new Set([...protectedBranchesOf(config), baseBranchOf(config)])];
  const res = await commitToNewLocalBranch(root, { base, branch, message: commitMessage(plan, input.number), files: plan.writes, protectedBranches, branchPrefix: prefix });
  return result('branch-created', {
    message: `Applied on ${branch}, your working tree is untouched. Push it and open a pull request that says "Closes #${input.number}".`,
    branch,
    commit: res.sha,
    diff: res.diff,
    appliedComment: suggestionAppliedComment(plan, { by: input.by, branch, commit: res.sha, at }),
  });
}
