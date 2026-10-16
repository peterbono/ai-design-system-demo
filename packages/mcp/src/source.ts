// Where the repo comes from: the local working tree, a local git ref, or GitHub over the REST API.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitHubClient } from '@bridge/core';
import { listFilesAt, showFile } from '@bridge/core/node';

export interface RepoSource {
  kind: 'local' | 'git-ref' | 'github';
  /** Human label: a path, `ref` or `owner/repo@ref`. */
  label: string;
  /** Repo-relative file paths under `prefix` ('' for everything). */
  list(prefix?: string): Promise<string[]>;
  read(path: string): Promise<string | null>;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', '.turbo', '.next', '.astro']);
const under = (prefix: string) => (f: string) => !prefix || prefix === '.' || f === prefix || f.startsWith(`${prefix.replace(/\/$/, '')}/`);

export class LocalSource implements RepoSource {
  readonly kind = 'local' as const;
  constructor(readonly root: string) {}
  get label() {
    return this.root;
  }
  async list(prefix = ''): Promise<string[]> {
    const out: string[] = [];
    const start = prefix && prefix !== '.' ? prefix.replace(/\/$/, '') : '';
    const walk = async (rel: string) => {
      let entries;
      try {
        entries = await readdir(join(this.root, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) out.push(p);
      }
    };
    await walk(start);
    return out.sort();
  }
  async read(path: string): Promise<string | null> {
    try {
      return await readFile(join(this.root, path), 'utf8');
    } catch {
      return null;
    }
  }
}

/** A local git ref (branch, tag, sha): reviews of local proposal branches and `bridge diff <base>`. */
export class GitRefSource implements RepoSource {
  readonly kind = 'git-ref' as const;
  private files?: Promise<string[]>;
  constructor(
    readonly root: string,
    readonly ref: string,
  ) {}
  get label() {
    return this.ref;
  }
  async list(prefix = ''): Promise<string[]> {
    this.files ??= listFilesAt(this.root, this.ref);
    return (await this.files).filter(under(prefix));
  }
  read(path: string) {
    return showFile(this.root, this.ref, path);
  }
}

export class GitHubSource implements RepoSource {
  readonly kind = 'github' as const;
  private tree?: Promise<string[]>;
  private cache = new Map<string, Promise<string | null>>();
  constructor(
    readonly client: GitHubClient,
    readonly ref: string,
  ) {}
  get label() {
    return `${this.client.fullName}@${this.ref}`;
  }
  async list(prefix = ''): Promise<string[]> {
    this.tree ??= this.client.listFiles(this.ref);
    return (await this.tree).filter(under(prefix));
  }
  read(path: string): Promise<string | null> {
    let p = this.cache.get(path);
    if (!p) {
      p = this.client.readFile(path, this.ref).then((t) => t ?? null);
      this.cache.set(path, p);
    }
    return p;
  }
}
