// Edit mode on a team's Library page (lib/team-docs-ai.ts, components/ds/library/TeamEditMode.tsx): the editor starts
// from the team's docs or the same deterministic pre-fill as Bridge's own pages, drafts from the team's own code,
// links to the team's Studio, and the page reads and writes the team's repository once it says so.
import { afterEach, describe, expect, it } from 'vitest';
import { prefillDocs } from '@bridge-ds/core';
import { repoModel } from './model';
import { loadComponents } from './library/components';
import { componentPrefillInput } from './docs-prefill';
import { teamComponentContrast, teamConventionPaths, teamDocsAiContext, teamEditProps, teamPrefillInput } from './team-docs-ai';
import { teamGuidance } from './team-facts';
import { repoContext, setLibraryTeam } from '../scripts/repo-context';

const comps = loadComponents(repoModel);
const button = comps.find((c) => c.name === 'Button')!;
const team = { owner: 'acme', repo: 'ds', model: repoModel };

describe('a team component in edit mode', () => {
  it('reads the same facts from the code as the build does for Bridge itself', () => {
    const own = componentPrefillInput(button);
    const mine = teamPrefillInput(repoModel, button);
    expect({ ...mine, contrast: undefined }).toEqual({ ...own, contrast: undefined });
    // Same pairs; the ratio is the worst over every brand and theme the team checks.
    const pairs = (xs: { foreground: string; background: string }[]) => xs.map((p) => `${p.foreground} on ${p.background}`).sort();
    expect(pairs(teamComponentContrast(repoModel, button))).toEqual(pairs(own.contrast!));
  });

  it('starts from the docs it has, or the deterministic pre-fill without any', () => {
    const text = JSON.stringify({ summary: 'Starts an action.' });
    expect(teamEditProps(team, button, text).initial).toEqual({ summary: 'Starts an action.' });
    const none = teamEditProps(team, { ...button, docs: null } as typeof button, null);
    expect(none.original).toBeNull();
    expect(none.initial).toEqual(prefillDocs({ ...teamPrefillInput(repoModel, button), existing: null }).draft);
    // A broken docs.json starts from the pre-fill instead of failing.
    expect(teamEditProps(team, button, '{ broken').initial.anatomy).toBeDefined();
  });

  it('writes to the team and links to its Studio, never to this site', () => {
    const p = teamEditProps(team, button, null);
    expect(p.repo).toEqual({ owner: 'acme', repo: 'ds' });
    expect(p.path).toBe(button.files.docs);
    expect(p.studio('changes/?pr=12')).toMatch(/^\/studio\/(~\/)?acme\/ds\/changes\/\?pr=12$/);
  });

  it('drafts from the team files: conventions, the reference docs, the code', () => {
    const paths = teamConventionPaths(repoModel, button);
    expect(paths.source).toBe(button.files.tsx);
    expect(paths.styles).toBe(button.files.css);
    const ctx = teamDocsAiContext(repoModel, button, { agents: '# Agents', designLanguage: '# DL\n\n## Voice\n\nPlain words.\n\n## Next\n\nx', source: 'export {}' });
    expect(ctx).toMatchObject({ slug: button.slug, name: 'Button', files: { docs: button.files.docs }, conventions: { agents: '# Agents', source: 'export {}' } });
    expect(ctx.conventions.voice).toContain('Plain words.');
    expect(ctx.conventions.voice).not.toContain('## Next');
  });

  it('opens guidance Claude drafted in its Library page edit mode, not on GitHub', () => {
    const drafted = { ...button, docs: { ...button.docs, needsReview: true } };
    const rows = teamGuidance({ owner: 'acme', repo: 'ds', sha: 'a'.repeat(40), model: { components: { list: [drafted] } } as never });
    expect(rows).toEqual([{ name: 'Button', slug: 'button', href: '/library/acme/ds/components/button/?edit=1', since: null }]);
  });
});

describe('a team Library page works on its team', () => {
  afterEach(() => setLibraryTeam(null));
  it('reads and writes the team once the page says so, and the site again after', () => {
    setLibraryTeam({ owner: 'acme', repo: 'ds' });
    expect(repoContext()).toMatchObject({ owner: 'acme', repo: 'ds', hosted: true });
    setLibraryTeam(null);
    expect(repoContext().hosted).toBe(false);
  });
});
