// Every Studio link, redirect and fetch of a Studio file goes through studioHref (lib/team-path.ts), so a team shell
// (/studio/<owner>/<repo>/...) keeps its team on every click (multi-team plan, section 4.1). A new literal '/studio/...'
// in code fails this test: write studioHref('changes/?pr=12') instead, or add the line here with the reason it must
// stay a fixed path.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITE = fileURLToPath(new URL('../..', import.meta.url));
const DIRS = ['src', 'api'];
const CODE = /\.(ts|tsx|astro|js|mjs)$/;
const TEST = /\.test\.tsx?$/;
// A string, attribute or template that starts with /studio: '/studio/...', "/studio/...", `/studio/...`, ${origin}/studio/.
const LITERAL = /["'`]\/studio(?:[/"'`?#]|$)|\}\/studio\//;

/** Files that define the Studio paths themselves. */
const OWNERS: Record<string, string> = {
  'src/lib/team-path.ts': 'defines STUDIO_ROOT and studioHref',
  'src/lib/nav.ts': 'the build-time nav constants (STUDIO_HOME, ...); studioHref accepts them as full paths',
  'src/lib/redirects.ts': 'old self-hosted addresses and where they go, written as static redirect pages at build time',
};

/** Single lines that must stay a fixed path, matched by file and a piece of the line. */
const ALLOWED: { file: string; line: string; why: string }[] = [
  {
    file: 'src/lib/github-signin.ts',
    line: "CALLBACK_PATH = '/studio/auth/callback/'",
    why: 'the OAuth callback registered on the GitHub Apps: one address for every team, never under a team',
  },
  {
    file: 'api/github/token.ts',
    line: "CALLBACK_PATH = '/studio/auth/callback/'",
    why: 'the token API checks redirect_uri against the same registered callback (server side, no page)',
  },
  {
    file: 'api/invites/index.ts',
    line: "INVITE_PATH = '/studio/invite/'",
    why: 'the invite link emailed to people: one page for every team, the team is in the stored invite',
  },
  {
    file: 'api/contribute/index.ts',
    line: '/studio/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/#contribute=',
    why: 'the sign-in link emailed to an email contributor: the team shell address, built on the server (no page)',
  },
  {
    file: 'api/claude/index.ts',
    line: '${origin}/studio/${owner}/${repo}/${v.review}',
    why: "See Claude's fix in the Figma plugin: the team shell address of the review, built on the server (no page)",
  },
  {
    file: 'src/pages/tokens/index.astro',
    line: "location.replace('/studio/tokens/'",
    why: 'is:inline script on a Library page (cannot import modules, never on a team shell): old ?edit=1 links',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE.test(name) && !TEST.test(name)) out.push(p);
  }
  return out;
}

const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);

describe('no /studio/ literals', () => {
  it('routes every Studio address through studioHref', () => {
    const found: string[] = [];
    const used = new Set<(typeof ALLOWED)[number]>();
    for (const file of DIRS.flatMap((d) => walk(join(SITE, d)))) {
      const rel = relative(SITE, file).split('\\').join('/');
      if (OWNERS[rel]) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (isComment(line) || !LITERAL.test(line)) return;
          const ok = ALLOWED.find((a) => a.file === rel && line.includes(a.line));
          if (ok) used.add(ok);
          else found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    expect(found, 'write studioHref(...) (lib/team-path.ts) instead of a literal /studio/ path').toEqual([]);
    // An entry that no longer matches anything is stale: remove it so the list stays the real exceptions.
    expect(ALLOWED.filter((a) => !used.has(a)).map((a) => `${a.file}: ${a.line}`)).toEqual([]);
  });

  it('gives every exception a reason', () => {
    for (const a of ALLOWED) expect(a.why.length).toBeGreaterThan(20);
    for (const why of Object.values(OWNERS)) expect(why.length).toBeGreaterThan(10);
  });
});
