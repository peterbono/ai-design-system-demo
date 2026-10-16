// Local git through plumbing commands: a proposal becomes a commit on a new branch without touching the
// working tree, the index or the checked-out branch. Never pushes.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function git(root: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: root, env: { ...process.env, ...opts.env }, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')}: ${stderr || err.message}`.trim()));
      else resolve(stdout);
    });
    if (opts.input !== undefined) child.stdin!.end(opts.input);
  });
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function currentBranch(root: string): Promise<string> {
  return (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

export async function branchExists(root: string, branch: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function showFile(root: string, ref: string, path: string): Promise<string | null> {
  try {
    return await git(root, ['show', `${ref}:${path}`]);
  } catch {
    return null;
  }
}

export async function listFilesAt(root: string, ref: string): Promise<string[]> {
  return (await git(root, ['ls-tree', '-r', '--name-only', ref])).split('\n').filter(Boolean);
}

export async function originRepo(root: string): Promise<string | undefined> {
  try {
    const url = (await git(root, ['remote', 'get-url', 'origin'])).trim();
    return /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(url)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Commits `files` on top of `base` into the new branch `branch` using a throwaway index.
 * Refuses protected branches and existing branches (nothing is ever overwritten).
 */
export async function commitToNewLocalBranch(
  root: string,
  args: { base: string; branch: string; message: string; files: { path: string; content: string | null }[]; protectedBranches: string[]; branchPrefix: string },
): Promise<{ sha: string; diff: string }> {
  if (args.protectedBranches.includes(args.branch) || !args.branch.startsWith(args.branchPrefix)) {
    throw new Error(`Refusing to write branch "${args.branch}": new branches must start with "${args.branchPrefix}" and never be ${args.protectedBranches.join('/')}.`);
  }
  if (await branchExists(root, args.branch)) throw new Error(`Branch "${args.branch}" already exists. Pick another title or delete it first.`);
  const baseSha = (await git(root, ['rev-parse', '--verify', `${args.base}^{commit}`])).trim();
  const dir = await mkdtemp(join(tmpdir(), 'bridge-index-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    await git(root, ['read-tree', baseSha], { env });
    for (const f of args.files) {
      if (f.content === null) {
        await git(root, ['update-index', '--force-remove', f.path], { env });
        continue;
      }
      const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: f.content })).trim();
      await git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${f.path}`], { env });
    }
    const tree = (await git(root, ['write-tree'], { env })).trim();
    const ident = await identityEnv(root);
    const sha = (await git(root, ['commit-tree', tree, '-p', baseSha, '-F', '-'], { input: args.message, env: ident })).trim();
    // Empty old value: create only, fail if the ref appeared meanwhile.
    await git(root, ['update-ref', `refs/heads/${args.branch}`, sha, '']);
    const diff = await git(root, ['diff', baseSha, sha]);
    return { sha, diff };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function identityEnv(root: string): Promise<Record<string, string>> {
  const get = async (k: string) => (await git(root, ['config', k]).catch(() => '')).trim();
  const name = (await get('user.name')) || 'Bridge MCP';
  const email = (await get('user.email')) || 'bridge-mcp@users.noreply.github.com';
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}
