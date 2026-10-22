// Every place that writes HTML text into the page (innerHTML, outerHTML, insertAdjacentHTML, dangerouslySetInnerHTML,
// set:html) is on this list, with what makes it safe. A new sink fails this test until it is reviewed and added:
// repo and GitHub content must go through lib/html.ts (escapeHtml, attrUrl, cssValue, html, jsonForScript) or
// lib/markdown.ts (inline, mdTitleHtml) first. Hosted Studio renders other teams' repos on a shared origin, where a
// GitHub token sits in localStorage, so this list is a release gate (docs/multi-team plan, security).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const SINK = /\.innerHTML\s*\+?=(?!=)|\.outerHTML\s*=(?!=)|insertAdjacentHTML\(|dangerouslySetInnerHTML\s*[=:]|set:html|createContextualFragment|document\.write\(/;

const ALLOWED: Record<string, string> = {
  // Build-time JSON data blocks: jsonForScript.
  'components/explorer/ExplorerData.astro': 'jsonForScript',
  'components/TokenEditorData.astro': 'jsonForScript',
  'layouts/Layout.astro': 'jsonForScript (siteRepoJson)',
  'pages/studio/changes.astro': 'jsonForScript',
  'pages/studio/components/index.astro': 'jsonForScript',
  'pages/studio/index.astro': 'jsonForScript',
  'pages/studio/review.astro': 'jsonForScript',
  'pages/studio/settings/index.astro': 'jsonForScript',
  'components/ds/library/views/AllTokensView.tsx': 'jsonForScript',
  // Build-time Markdown and constants.
  'pages/how-review-works.astro': 'inline() on docs/GOVERNANCE.md and AGENTS.md (escaped, link schemes allow-listed)',
  'components/ds/MarkdownTable.tsx': 'cells from inline()',
  'components/ds/AgentToolsTable.tsx': 'inline() on docs/AI.md (lib/mcp.ts)',
  'pages/agents.astro': 'inline() on docs/AI.md (lib/mcp.ts)',
  'components/ds/ReleaseEntries.tsx': 'mdTitleHtml (escaped, no links)',
  'pages/components/[slug].astro': 'mdTitleHtml',
  'components/ds/studio/Drawing.tsx': 'hardcoded SVG from brand/illustrations.ts, never repo SVG',
  'components/Illustration.astro': 'hardcoded SVG from brand/illustrations.ts, never repo SVG',
  'components/home/HpStepSection.astro': 'Astro-rendered slot markup written in the page',
  'components/ds/ScriptDialog.astro': 'dialogHtml escapes title, description and attributes; body is a slot',
  'pages/studio/components/docs/[slug].astro': 'redirectScript: constant body, target escaped in data-to',
  'components/LibraryEditMode.tsx': 'static example markup rendered at build time from registry resolveProps (handlers, raw HTML and unsafe URLs dropped)',
  'pages/install.astro': 'the match is text inside a code sample shown on the page, not a sink',
  // Browser scripts: GitHub and repo data through esc / attrUrl / cssValue.
  'scripts/explorations.ts': 'esc, attrUrl on preview and PR URLs',
  'scripts/explorer/detail.ts': 'esc, attrUrl, cssValue on token values',
  'scripts/explorer/grid.ts': 'esc; cells via cellHtml (cssValue)',
  'scripts/explorer/index.ts': 'esc; tiers and categories from fixed sets',
  'scripts/explorer/inline-edit.ts': 'esc, cssValue',
  'scripts/explorer/review.ts': 'esc, attrUrl, cssValue',
  'scripts/github-session.ts': 'esc, attrUrl (showGhError, prLinksHtml)',
  'scripts/history/page.ts': 'esc, attrUrl on PR URLs',
  'scripts/history/planner.ts': 'esc, attrUrl, hex-only swatches',
  'scripts/history/token-panel.ts': 'esc, hex-only swatches',
  'scripts/integrations.ts': 'prLinksHtml (attrUrl)',
  'scripts/people.ts': 'avatarHtml escapes; illustrations are data: SVG in <img>',
  'scripts/product-branch.ts': "innerHTML = '' only",
  'scripts/request-form.ts': 'esc; numbers from GitHub write responses',
  'scripts/requests.ts': 'esc, attrUrl on issue, Figma, Jira and image URLs',
  'scripts/reviews.ts': 'esc, cssValue; constants',
  'scripts/reviews/visual-impact.ts': 'esc, attrUrl, numbers coerced from the repo manifest',
  'scripts/roles.ts': 'prLinksHtml (attrUrl)',
  'scripts/token-editor.ts': 'esc, attrUrl, tokenValueHtml',
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|astro)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });

/** Lines that write HTML, comments left out. */
const sinkLines = (text: string) =>
  text.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && SINK.test(t);
  });

const found = walk(SRC)
  .map((p) => relative(SRC, p).split('\\').join('/'))
  .filter((rel) => sinkLines(readFileSync(join(SRC, rel), 'utf8')).length > 0)
  .sort();

describe('HTML sinks', () => {
  it('every file that writes HTML is reviewed (add it to ALLOWED with what makes it safe)', () => {
    expect(found.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it('the list has no stale entries', () => {
    expect(Object.keys(ALLOWED).filter((f) => !found.includes(f))).toEqual([]);
  });

  it('the detector sees each kind of sink', () => {
    for (const l of ['el.innerHTML = x', 'el.innerHTML += x', 'el.outerHTML = x', "el.insertAdjacentHTML('beforeend', x)", '<p dangerouslySetInnerHTML={{ __html: x }} />', '<p set:html={x} />'])
      expect(sinkLines(l)).toHaveLength(1);
    expect(sinkLines('// el.innerHTML = x')).toHaveLength(0);
    expect(sinkLines("if (el.innerHTML === '') go()")).toHaveLength(0);
    expect(sinkLines("if (key === 'dangerouslySetInnerHTML') return;")).toHaveLength(0);
    expect(sinkLines('createElement("p", { dangerouslySetInnerHTML: { __html: x } })')).toHaveLength(1);
  });
});
