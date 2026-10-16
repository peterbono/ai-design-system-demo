// Where the server reads from and what it may write. Local: a working tree. Remote: a GitHub repo.
import { resolve } from 'node:path';
import { CONFIG_FILE, detectConfig, parseConfig, type BridgeConfig } from './config.js';
import { core, GitHubClient, type TokenSet } from './core-adapter.js';
import { isGitRepo, originRepo } from './internal/git-local.js';
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
      const { owner, repo } = core.parseRepo(opts.repo);
      const client = new GitHubClient({ owner, repo, ...(opts.token ? { token: opts.token } : {}), ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.apiUrl ? { apiUrl: opts.apiUrl } : {}), ...(opts.rawUrl ? { rawUrl: opts.rawUrl } : {}), protectedBranches: DEFAULT_PROTECTED, branchPrefix: 'bridge/' });
      const ref = opts.ref ?? (await client.getDefaultBranch());
      const ctx = new BridgeContext('remote', new GitHubSource(client, ref), opts);
      ctx.gh = client;
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

  /** GitHub client for reviews and remote writes. Local mode uses config.repo or the origin remote. */
  async github(): Promise<GitHubClient | null> {
    const { config } = await this.config();
    if (this.gh) {
      return new GitHubClient({ owner: this.gh.owner, repo: this.gh.repo, ...this.clientOpts(), protectedBranches: [...new Set([...config.governance.protectedBranches, config.branch])], branchPrefix: config.governance.branchPrefix });
    }
    if (this.gh === null) return null;
    const repo = config.repo ?? (this.root ? await originRepo(this.root) : undefined);
    if (!repo) {
      this.gh = null;
      return null;
    }
    const { owner, repo: name } = core.parseRepo(repo);
    this.gh = new GitHubClient({ owner, repo: name, ...this.clientOpts(), protectedBranches: DEFAULT_PROTECTED, branchPrefix: 'bridge/' });
    return this.github();
  }

  private clientOpts() {
    const o = this.opts;
    return { ...(o.token ? { token: o.token } : {}), ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.apiUrl ? { apiUrl: o.apiUrl } : {}), ...(o.rawUrl ? { rawUrl: o.rawUrl } : {}) };
  }

  get canWriteRemote(): boolean {
    return Boolean(this.opts.token);
  }

  describe(): string {
    return this.mode === 'local' ? `local repo ${this.root}${this.isGit ? '' : ' (not a git repo)'}` : `GitHub ${this.source.label}${this.opts.token ? ' (token: can open PRs)' : ' (no token: read-only)'}`;
  }
}
