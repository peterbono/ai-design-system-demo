// The Library libs are functions of a RepoModel: they never read the site's files or the build-time model, so a
// team's Library (in the browser) can call them with its own model.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('lib/library', () => {
  it.each(sources)('%s imports no Node API and not the build-time model', (file) => {
    const src = readFileSync(join(dir, file), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => i!.startsWith('node:') || i === '@bridge-ds/core/node' || /(^|\/)model$/.test(i!) && !i!.includes('explorer/'))).toEqual([]);
  });
});

describe('component pages', async () => {
  const { componentNotes, componentSlugFromPath, previewUrl, readableDocs, storyArgs } = await import('./component-page');

  it('reads the component from a team Library address', () => {
    expect(componentSlugFromPath('/library/acme/ds/components/button/')).toBe('button');
    expect(componentSlugFromPath('/library/acme/ds/components/Alert-Dialog')).toBe('alert-dialog');
    expect(componentSlugFromPath('/library/acme/ds/components/')).toBeNull();
    expect(componentSlugFromPath('/library/acme/ds/components/a/b/')).toBeNull();
    expect(componentSlugFromPath('/library/acme/ds/components/%3Cx%3E/')).toBeNull();
    expect(componentSlugFromPath('/components/button/')).toBeNull();
  });

  it('turns playground values into story args Storybook accepts in an address', () => {
    expect(storyArgs({ variant: 'primary', disabled: true, loading: false, label: 'Save, now!', empty: '' }, 'Publish tokens')).toEqual({ variant: 'primary', disabled: '!true', loading: '!false', children: 'Publish tokens' });
    expect(previewUrl('https://sb.example.com', 'a--b', { theme: 'dark', brand: 'ocean' }, { size: 'sm' })).toBe('https://sb.example.com/iframe.html?id=a--b&viewMode=story&globals=theme:dark;brand:ocean&args=size:sm');
  });

  it('finds the release notes that name a component, by title or package', () => {
    const notes = componentNotes('Button', [
      { name: 'v2', date: '2026-10-20', entries: [{ kind: 'Fix', title: 'Fix ButtonGroup gap', packages: [] }, { kind: 'New', title: 'Button loading state', packages: [] }] as never },
      { name: 'v1', date: '2026-10-01', entries: [{ kind: 'Fix', title: 'Focus ring', packages: ['Button'], date: '2026-09-30' }] as never },
    ]);
    expect(notes).toEqual([
      { kind: 'New', title: 'Button loading state', release: 'v2', date: '2026-10-20' },
      { kind: 'Fix', title: 'Focus ring', release: 'v1', date: '2026-09-30' },
    ]);
  });

  it('reads any docs.json shape as text', () => {
    const d = readableDocs({ summary: 3, whenToUse: ['a', { x: 1 }], dos: [{ title: 'T', text: 5 }, 'x'], donts: null } as never)!;
    expect(d.summary).toBe('');
    expect(d.whenToUse).toEqual(['a']);
    expect(d.dos).toEqual([{ title: 'T', text: '' }]);
    expect(d.donts).toEqual([]);
    expect(readableDocs(null)).toBeNull();
  });
});
