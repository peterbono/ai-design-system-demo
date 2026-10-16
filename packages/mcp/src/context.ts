// Where the server reads from and what it may write. Local: a working tree. Remote: a GitHub repo.
import { resolve } from 'node:path';
import { baseBranchOf, protectedBranchesOf, type FetchLike } from '@bridge/core';
import { isGitRepo, originRepo } from '@bridge/core/node';
import { CONFIG_FILE, detectConfig, parseConfig, type BridgeConfig } from './config.js';
import { core, GitHubClient, type TokenSet } from './core-adapter.js';
import { GitHubSource, LocalSource, type RepoSource } from './source.js';

export interface ContextOptions {
  /** Local repo root (default: cwd). Ignored when `repo` is set. */
  root?: string;
  /** Remote mode: GitHub `owner/name`. */
  repo?: string;
  /** Remote ref to read (default: the repo's default branch). */
  ref?: string;
  /** GitHub token. Without one Bridge is read-only. */
  token?: string;
  fetch?: typeof fetch;
  apiUrl?: string;
  rawUrl?: string;
}

const DEFAULT_PROTECTED = ['main', 'master'];

/** A core GitHub client for owner/name with this context's token, fetch and hosts. */
function client(repo: string, o: ContextOptions, rules: { protectedBranches: string[]; branchPrefix: string }): GitHubClient {
  const { owner, name } = core.parseRepo(repo);
  const f: FetchLike | undefined = o.fetch ? ((url, init) => o.fetch!(url, init as RequestInit) as ReturnType<FetchLike>) : undefined;
  return new GitHubClient(`${owner}/${name}`, o.token ?? '', f, undefined, {
    ...(o.apiUrl ? { apiUrl: o.apiUrl } : {}),
    ...(o.rawUrl ? { rawUrl: o.rawUrl } : {}),
    protectedBranches: rules.protectedBranches,
    branchPrefix: rules.branchPrefix,
  });
}

export class BridgeContext {
  private cached?: { config: BridgeConfig; origin: 'file' | 'detected' };
  private cachedSet?: { at: number; set: TokenSet };
  private gh?: GitHubClient | null;

  private constructor(
    readonly mode: 'local' | 'remote',
    readonly source: RepoSource,
    readonly opts: ContextOptions,
    readonly root?: string,
    readonly isGit = false,
  ) {}

  static async create(opts: ContextOptions = {}): Promise<BridgeContext> {
    if (opts.repo) {
      const gh = client(opts.repo, opts, { protectedBranches: DEFAULT_PROTECTED, branchPrefix: 'bridge/' });
      const ref = opts.ref ?? (await gh.getDefaultBranch());
      const ctx = new BridgeContext('remote', new GitHubSource(gh, ref), opts);
      ctx.gh = gh;
      return ctx;
    }
    const root = resolve(opts.root ?? process.cwd());
    return new BridgeContext('local', new LocalSource(root), opts, root, await isGitRepo(root));
  }

  get ref(): string | undefined {
    return this.source instanceof GitHubSource ? this.source.ref : undefined;
  }

  async config(): Promise<{ config: BridgeConfig; origin: 'file' | 'detected' }> {
    if (this.mode === 'remote' && this.cached) return this.cached;
    const text = await this.source.read(CONFIG_FILE);
    let out: { config: BridgeConfig; origin: 'file' | 'detected' };
    if (text) {
      try {
        out = { config: parseConfig(JSON.parse(text)), origin: 'file' };
      } catch (e) {
        throw new Error(`${CONFIG_FILE} is invalid: ${(e as Error).message}`);
      }
    } else {
      const files = await this.source.list('');
      out = { config: await detectConfig(files, (p) => this.source.read(p), this.opts.repo ? { repo: this.opts.repo } : {}), origin: 'detected' };
    }
    this.cached = out;
    return out;
  }

  /** Token set at the current state. Local mode re-reads files on every call so edits show up at once. */
  async tokens(): Promise<TokenSet> {
    if (this.mode === 'remote' && this.cachedSet && Date.now() - this.cachedSet.at < 60_000) return this.cachedSet.set;
    const { config } = await this.config();
    const set = await core.loadTokenSet(this.source, config);
    this.cachedSet = { at: Date.now(), set };
    return set;
  }

  /**
   * GitHub client for reviews and remote writes, guarded by the config: protected branches plus the base
   * branch are refused, new branches need the agent prefix. Local mode uses config.repo or the origin remote.
   */
  async github(): Promise<GitHubClient | null> {
    const { config } = await this.config();
    const rules = { protectedBranches: [...new Set([...protectedBranchesOf(config), baseBranchOf(config)])], branchPrefix: config.governance.branchPrefix };
    if (this.gh) return client(this.gh.fullName, this.opts, rules);
    if (this.gh === null) return null;
    const repo = config.repo ? `${config.repo.owner}/${config.repo.name}` : this.root ? await originRepo(this.root) : undefined;
    if (!repo) {
      this.gh = null;
      return null;
    }
    this.gh = client(repo, this.opts, rules);
    return this.github();
  }

  get canWriteRemote(): boolean {
    return Boolean(this.opts.token);
  }

  describe(): string {
    return this.mode === 'local' ? `local repo ${this.root}${this.isGit ? '' : ' (not a git repo)'}` : `GitHub ${this.source.label}${this.opts.token ? ' (token: can open PRs)' : ' (no token: read-only)'}`;
  }
}
