// The server's record that a pull request is a push from the Figma plugin (docs/HOSTED.md "Ship from Figma"). A label
// or a block in the body says where a change comes from, but anyone who can edit them can write them, so /api/ship
// never trusts them alone. Right after the plugin opens its pull request, its author asks Bridge to mark it
// (POST /api/ship { mark: "figma" }); Bridge checks who asks and what the head holds, then writes a mark signed with a
// key of its own into the body. The signature binds the repository, the pull request, the head commit and the author:
// it opens for nothing else, and a new commit on the branch makes it stale. Node built-ins only. Nothing here logs.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { sealingKey } from './sealed.js';

/** The HKDF purpose of the mark key: a key no other feature derives. */
export const FIGMA_MARK_PURPOSE = 'figma-ship-mark/v1';
const MARK = /<!-- bridge-figma-mark (\{[^<>]{1,400}\}) -->/g;
const SHA = /^[0-9a-z]{7,64}$/;

export interface MarkFacts {
  /** owner/name, any case. */
  repo: string;
  pr: number;
  /** The head commit the mark is given for. */
  sha: string;
  /** The GitHub login of the pull request's author. */
  author: string;
}

/** The mark key from the session secret, or null when the secret is missing or short (nothing gets marked then). */
export const figmaMarkKey = (secret: string | undefined): Buffer | null => sealingKey(secret, FIGMA_MARK_PURPOSE);

const lower = (x: string) => x.trim().replace(/^@/, '').toLowerCase();
const message = (f: MarkFacts) => ['bridge-figma-mark', 'v1', lower(f.repo), String(f.pr), f.sha.toLowerCase(), lower(f.author)].join('\n');
const sign = (key: Buffer, f: MarkFacts) => createHmac('sha256', key).update(message(f)).digest('base64url');

/** The mark Bridge writes into the body, as an HTML comment (invisible on GitHub). */
export function figmaMark(key: Buffer, f: MarkFacts): string {
  return `<!-- bridge-figma-mark ${JSON.stringify({ v: 1, sha: f.sha.toLowerCase(), by: lower(f.author), sig: sign(key, f) })} -->`;
}

/** The body without any mark, so marking again replaces the old one. */
export const withoutFigmaMark = (body: string | null | undefined): string => (body ?? '').replace(MARK, '').replace(/\n{3,}/g, '\n\n').trimEnd();

/** The body with a fresh mark at its end. */
export const withFigmaMark = (body: string | null | undefined, mark: string): string => [withoutFigmaMark(body), mark].filter(Boolean).join('\n\n');

/**
 * True when the body holds a mark Bridge signed for exactly this repository, pull request, head commit and author.
 * Any other mark (unsigned, another key, another pull request, an older commit, another author) does not count.
 */
export function figmaMarkValid(body: string | null | undefined, key: Buffer | null, f: MarkFacts): boolean {
  if (!key || !SHA.test(f.sha.toLowerCase()) || !f.author) return false;
  const want = Buffer.from(sign(key, f));
  for (const m of (body ?? '').matchAll(MARK)) {
    let o: any;
    try {
      o = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    if (o?.v !== 1 || typeof o.sig !== 'string' || o.sha !== f.sha.toLowerCase() || o.by !== lower(f.author)) continue;
    const got = Buffer.from(o.sig);
    if (got.length === want.length && timingSafeEqual(got, want)) return true;
  }
  return false;
}
