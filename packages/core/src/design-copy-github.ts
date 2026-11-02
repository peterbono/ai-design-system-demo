// The design team's copy of a product (bridge.config.json products[].design): a fork of the developers' repository
// that the design team owns. Explorations of the product start there, so designers never open branches in the
// developers' repository; "Done exploring" sends the developers a task (an issue labeled `from-design`) in theirs.
// Shared by Studio (with the viewer's token), the MCP server and the CLI. Make the copy (GitHub's fork, which GitHub
// builds in the background), tell how far behind the product it is, and bring it up to date (GitHub's "Sync fork").

import { GitHubError, parseRepo, type GitHubClient } from './github-client';

/** The label of the developers' task Done exploring opens from a design copy. */
export const FROM_DESIGN_LABEL = 'from-design';
export const FROM_DESIGN_LABEL_COLOR = '1d76db';
export const FROM_DESIGN_LABEL_DESCRIPTION = 'Sent by the design team from Bridge: a prototype to build';

/**
 * Where the copy stands. missing: no copy yet (or out of the viewer's reach). ready: it exists, `behind` commits of
 * the product's default branch are not in it yet (0: up to date; null: Bridge could not tell).
 */
export type DesignCopyState = { kind: 'missing' } | { kind: 'ready'; branch: string; behind: number | null };

const isMissing = (err: unknown) => err instanceof GitHubError && (err.status === 404 || err.status === 403) && err.auth !== 'rejected' && !err.resetsAt;

/**
 * Reads the copy and the product: two or three reads. The copy's default branch is compared with the head of the same
 * branch in the product; a product head the copy cannot see counts as unknown, never as behind.
 */
export async function designCopyStateOnGitHub(copy: GitHubClient, product: GitHubClient): Promise<DesignCopyState> {
  let branch: string;
  try {
    branch = (await copy.getRepo()).defaultBranch;
  } catch (err) {
    if (isMissing(err)) return { kind: 'missing' };
    throw err;
  }
  const head = await product.getBranchSha(branch).catch(() => undefined);
  if (!head) return { kind: 'ready', branch, behind: null };
  const c = await copy.compare(branch, head).catch(() => null);
  return { kind: 'ready', branch, behind: c ? c.aheadBy : null };
}

/** Why GitHub refused to make the copy: copies turned off for the product, or the person may not create one. */
export type MakeCopyResult = { ok: true; repo: string } | { ok: false; reason: 'turned-off' | 'no-access' };

/**
 * Asks GitHub for the copy: a fork of `product` named after `copyRepo`, in its owner when that is an organization
 * (a personal account gets it in its own). Every branch comes along. GitHub answers at once and builds it in the
 * background: waitForDesignCopy polls until it answers. A copy that already exists is fine.
 */
export async function makeDesignCopyOnGitHub(product: GitHubClient, copyRepo: string): Promise<MakeCopyResult> {
  const { owner, name } = parseRepo(copyRepo);
  const kind = await product.getAccountType(owner).catch(() => null);
  try {
    const r = await product.createFork({ ...(kind === 'Organization' ? { organization: owner } : {}), name });
    return { ok: true, repo: r.fullName };
  } catch (err) {
    if (err instanceof GitHubError && err.auth !== 'rejected' && !err.resetsAt) {
      // 422 "name already exists": the copy is there (made a moment ago, or by a teammate).
      if (err.status === 422 && /already exists|name already/i.test(`${err.message} ${err.detail ?? ''}`)) return { ok: true, repo: copyRepo };
      if (err.status === 403 && /fork/i.test(`${err.message} ${err.detail ?? ''}`)) return { ok: false, reason: 'turned-off' };
      if (err.status === 403 || err.status === 404 || err.status === 422) return { ok: false, reason: 'no-access' };
    }
    throw err;
  }
}

/**
 * Waits until GitHub has built the copy: one read every `everyMs` (2 s), up to `tries` times (45, about a minute and a
 * half). True once it answers, false when it still does not.
 */
export async function waitForDesignCopy(copy: GitHubClient, opts: { tries?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tries = opts.tries ?? 45;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(opts.everyMs ?? 2000);
    try {
      const r = await copy.getRepo();
      // A fresh fork answers before its branches are in: wait for the default one.
      if (await copy.getBranchSha(r.defaultBranch)) return true;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return false;
}

/** "Get the latest": up to date now, already up to date, or GitHub could not merge on its own (the copy's main changed). */
export type GetLatestResult = { ok: true; merged: boolean } | { ok: false; reason: 'conflict' };

/** Brings the copy's default branch up to date with the product (GitHub's "Sync fork"). */
export async function getLatestDesignCopyOnGitHub(copy: GitHubClient, branch?: string): Promise<GetLatestResult> {
  const b = branch ?? (await copy.getRepo()).defaultBranch;
  try {
    const r = await copy.mergeUpstream(b);
    return { ok: true, merged: r.merged };
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 409 || err.status === 422)) return { ok: false, reason: 'conflict' };
    throw err;
  }
}

/**
 * The developers' task Done exploring opens in the product's own repository: what the prototype is, its preview, what
 * changes, the library pieces it needed, and where its code is if they want it. Markdown for GitHub.
 */
/**
 * A GitHub login, or null for anything else (an email, a display name with spaces): a member's email never goes
 * into GitHub content, even when a caller passes one by mistake.
 */
export function githubLoginOf(s: string | null | undefined): string | null {
  const v = s?.trim().replace(/^@/, '') ?? '';
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(v) ? v : null;
}

export function designTaskBody(t: {
  name: string;
  purpose?: string | null | undefined;
  previewUrl?: string | null | undefined;
  changes: readonly string[];
  pieces: readonly { title: string; url: string }[];
  copy: string;
  branch: string;
  pr: { number: number; url: string };
  /** The GitHub login of who said Done exploring: "From @login." */
  doneBy?: string | null | undefined;
  /** Who said it when they have no GitHub account (a member who joined by email): their display name, never an email. */
  doneByName?: string | null | undefined;
}): string {
  const login = githubLoginOf(t.doneBy);
  const by = login ? ` From @${login}.` : t.doneByName?.trim() ? ` From ${t.doneByName.trim()}, through Bridge.` : '';
  const lines = [
    `The design team explored this in Bridge and sends it to you to build.${by}`,
    '',
    ...(t.purpose?.trim() ? [`**Purpose.** ${t.purpose.trim()}`, ''] : []),
    `**Preview.** ${t.previewUrl ?? `In the Vercel comment of the prototype: ${t.pr.url}`}`,
    '',
    '### What changes',
    '',
    ...(t.changes.length ? t.changes.slice(0, 20).map((c) => `- ${c}`) : ['- See the prototype.']),
    ...(t.changes.length > 20 ? [`- And ${t.changes.length - 20} more files.`] : []),
    '',
    '### Library pieces it needed',
    '',
    ...(t.pieces.length ? t.pieces.map((p) => `- [${p.title}](${p.url}): asked from the design system team`) : ['- None: everything it uses is in the library.']),
    '',
    '### The prototype code, if you want it',
    '',
    `It lives in the design team's copy, ${t.copy}, on \`${t.branch}\` (${t.pr.url}). It is optional and nobody has reviewed it:`,
    '',
    '```sh',
    `git fetch https://github.com/${t.copy}.git ${t.branch}`,
    `git switch -c ${t.branch} FETCH_HEAD`,
    '```',
  ];
  return lines.join('\n');
}

/** The task title: the exploration's name. */
export const designTaskTitle = (name: string): string => `Design: ${name.trim()}`;
