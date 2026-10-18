import { describe, expect, it } from 'vitest';
import { agentMade, devJargon, devWorkLine, explorationMakerLine, explorationWork, fileSignals, makerOf, showsUnder, workFilterParam, workNature } from './work-nature';

describe('workNature', () => {
  it('real data: the native Select exploration (#98, request #81) is developer work, from its title', () => {
    const r = workNature({ title: 'Add a native Select for pages without React', files: ['.bridge/explorations/add-a-native-select-for-pages-without.md'], requestKind: 'new-variant' });
    expect(r).toEqual({ nature: 'developer', reason: 'the title speaks code (React)', known: true });
  });

  it('real data: the changes in review are design work, from their files', () => {
    // #1 Badge subtle appearance: component styles and markup.
    expect(
      workNature({
        title: 'Add subtle appearance for dense lists',
        files: ['.changeset/badge-subtle-appearance.md', 'docs/pr-drafts/agent-badge-subtle-variant.md', 'packages/react/src/components/Badge/Badge.module.css', 'packages/react/src/components/Badge/Badge.stories.tsx', 'packages/react/src/components/Badge/Badge.tsx', 'packages/react/src/components/Badge/index.ts'],
      }).nature,
    ).toBe('design');
    // #2 focus.ring.offset: tokens.
    expect(workNature({ title: 'Add focus.ring.offset semantic token', files: ['packages/tokens/src/semantic/light.tokens.json', 'packages/react/src/components/Button/Button.module.css'] }).reason).toBe('it changes tokens');
    // #64 "button normal again": only its note, no other signal, so design by default, said as unknown.
    expect(workNature({ title: 'Button normal again', files: ['.bridge/explorations/button-normal-again.md'] })).toEqual({
      nature: 'design',
      reason: 'nothing says it is code only, so designers see it',
      known: false,
    });
  });

  it('a label decides first, either way', () => {
    expect(workNature({ title: 'New color for alerts', labels: [{ name: 'tech' }] }).nature).toBe('developer');
    expect(workNature({ title: 'Tidy React adapters', labels: ['design'] }).nature).toBe('design');
    expect(workNature({ title: 'x', labels: ['type: developer'] }).nature).toBe('developer');
    expect(workNature({ title: 'x', labels: ['exploration', 'component-change'] }).known).toBe(false);
  });

  it('a visual difference keeps it with designers, even with code words in the title', () => {
    expect(workNature({ title: 'Move Button to React 19', visual: 'changes' }).nature).toBe('design');
  });

  it('component code with no visual difference is developer work; pending stays design', () => {
    const files = ['packages/react/src/components/Select/Select.tsx'];
    expect(workNature({ title: 'Select keeps focus on close', files, visual: 'no-change' }).nature).toBe('developer');
    expect(workNature({ title: 'Select keeps focus on close', files, visual: 'pending' }).nature).toBe('design');
    expect(workNature({ title: 'Select keeps focus on close', files }).nature).toBe('design');
  });

  it('tests, examples, types and tooling only are developer work', () => {
    expect(workNature({ title: 'Faster checks', files: ['packages/react/src/components/Select/Select.test.tsx', 'packages/react/src/components/Select/Select.stories.tsx', '.changeset/a.md'] }).nature).toBe('developer');
    expect(workNature({ title: 'Release tooling', files: ['.github/workflows/release.yml', 'package.json'] }).nature).toBe('developer');
    expect(workNature({ title: 'Better MCP answers', files: ['packages/mcp/src/server.ts'] }).nature).toBe('developer');
  });

  it('usage guidance is design work', () => {
    expect(workNature({ title: 'Guidance', guidance: true }).nature).toBe('design');
    expect(workNature({ title: 'Guidance', files: ['packages/react/src/components/Badge/Badge.docs.json'] }).reason).toBe('it changes usage guidance');
  });

  it('a visual impact run with no difference and no files read is developer work', () => {
    expect(workNature({ title: 'Something', visual: 'no-change' }).nature).toBe('developer');
  });

  it('request kinds: new component, variant and look are design; tech is developer', () => {
    expect(workNature({ title: 'Danger ghost', requestKind: 'new-variant' })).toMatchObject({ nature: 'design', known: true });
    expect(workNature({ title: 'Date picker', requestKind: 'new-component' }).nature).toBe('design');
    expect(workNature({ title: 'Faster build', requestKind: 'tech' }).nature).toBe('developer');
    expect(workNature({ title: 'Fix', requestKind: 'bug' }).known).toBe(false);
  });
});

describe('devJargon', () => {
  it('finds whole developer words, any case', () => {
    expect(devJargon('Add a native Select for pages without React')).toBe('React');
    expect(devJargon('Ship it on npm')).toBe('npm');
    expect(devJargon('New size props for Button')).toBe('props');
    expect(devJargon('TypeScript types for tokens')).toBe('TypeScript');
    expect(devJargon('Hydration-free Select')).toBe('hydration');
    expect(devJargon('A CLI flag')).toBe('CLI');
  });
  it('leaves design words alone', () => {
    expect(devJargon('Reactive cards lift on hover')).toBeNull();
    expect(devJargon('Tree node spacing')).toBeNull();
    expect(devJargon('Proper spacing in dense tables')).toBeNull();
    expect(devJargon(null)).toBeNull();
  });
});

describe('fileSignals', () => {
  it('ignores bookkeeping files and needs at least one real file for developer only', () => {
    expect(fileSignals(['.changeset/a.md', '.bridge/explorations/x.md']).developerOnly).toBe(false);
    expect(fileSignals(['packages/tokens/build.mjs'])).toMatchObject({ tokens: false, developerOnly: true });
    expect(fileSignals(['packages/react/src/components/Card/Card.module.css', 'packages/react/src/components/Card/Card.test.tsx'])).toMatchObject({ visual: true, developer: true, developerOnly: false });
  });
});

describe('agentMade and makerOf', () => {
  const template = '## Authored by\n\n- [ ] Human\n- [x] AI agent (Claude), reviewed by a human before merge';
  it('reads the real markers', () => {
    expect(agentMade({ body: template })).toBe(true);
    expect(agentMade({ body: '**Author:** AI agent (Claude), opened as draft.' })).toBe(true);
    expect(agentMade({ body: 'text\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' })).toBe(true);
    expect(agentMade({ body: 'Agent-authored (Claude Code), session https://claude.ai/code/session_01Wd' })).toBe(true);
    expect(agentMade({ commits: ['Fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'] })).toBe(true);
    expect(agentMade({ labels: [{ name: 'agent' }] })).toBe(true);
    expect(agentMade({ source: 'mcp' })).toBe(true);
    expect(agentMade({ source: 'cli', agent: 'claude' })).toBe(true);
    expect(agentMade({ requestSource: 'mcp' })).toBe(true);
  });
  it('an unticked template box or a plain body is not a marker', () => {
    expect(agentMade({ body: '- [x] Human\n- [ ] AI agent (Claude), reviewed by a human before merge' })).toBe(false);
    expect(agentMade({ body: 'Exploration: add a native Select', commits: ['chore(explore): start'], requestSource: 'cli' })).toBe(false);
    expect(agentMade({})).toBe(false);
  });

  it('"You" only for what the viewer started from Studio, with no agent marker', () => {
    const base = { author: 'peterbono', viewer: 'peterbono' };
    expect(makerOf({ ...base, source: 'studio' })).toEqual({ kind: 'you' });
    expect(makerOf({ ...base, source: 'studio', commits: ['x\n\nCo-Authored-By: Claude <noreply@anthropic.com>'] })).toEqual({ kind: 'claude' });
    // Real data #98: the viewer's account, started from the command line (request #81 came from the CLI), no marker.
    expect(makerOf({ ...base, source: 'cli' })).toEqual({ kind: 'account', where: 'cli' });
    expect(makerOf({ ...base })).toEqual({ kind: 'account', where: null });
    expect(makerOf({ author: 'ana', viewer: 'peterbono', source: 'studio' })).toEqual({ kind: 'person', login: 'ana' });
    expect(makerOf({ author: 'ana', viewer: null })).toEqual({ kind: 'person', login: 'ana' });
  });

  it('says it in one sentence', () => {
    expect(explorationMakerLine({ kind: 'claude' })).toBe('Claude is building it.');
    expect(explorationMakerLine({ kind: 'you' })).toBe('You are trying it.');
    expect(explorationMakerLine({ kind: 'person', login: 'ana' })).toBe('@ana is trying it.');
    expect(explorationMakerLine({ kind: 'account', where: 'cli' })).toBe('Started from the command line with your GitHub account.');
    expect(explorationMakerLine({ kind: 'account', where: null })).toBe('Started with your GitHub account.');
  });
});

describe('explorationWork', () => {
  it('real data #98: developer work, started from the command line with the viewer account (request #81 came from the CLI)', () => {
    const r = explorationWork(
      {
        name: 'Add a native Select for pages without React',
        author: 'peterbono',
        body: '## Exploration: Add a native Select for pages without React',
        labels: [{ name: 'exploration' }],
        commits: ['chore(explore): start Add a native Select for pages without React'],
        requests: [{ kind: 'new-variant', source: 'cli', labels: ['component-change', 'exploration', 'request: new-variant', 'source: cli'] }],
      },
      'peterbono',
    );
    expect(r.nature.nature).toBe('developer');
    expect(r.maker).toEqual({ kind: 'account', where: 'cli' });
  });
  it('real data #64: design by default, never "You" without a Studio marker', () => {
    const r = explorationWork({ name: 'Button normal again', author: 'peterbono', labels: ['exploration'] }, 'peterbono');
    expect(r.nature).toMatchObject({ nature: 'design', known: false });
    expect(r.maker).toEqual({ kind: 'account', where: null });
  });
  it('Studio start: You; a Claude commit or an agent block: Claude', () => {
    expect(explorationWork({ name: 'Pill buttons', author: 'me', source: 'studio' }, 'me').maker).toEqual({ kind: 'you' });
    expect(explorationWork({ name: 'Pill buttons', author: 'me', source: 'studio', commits: ['x\n\nCo-Authored-By: Claude <noreply@anthropic.com>'] }, 'me').maker).toEqual({ kind: 'claude' });
    expect(explorationWork({ name: 'Pill buttons', author: 'me', source: 'cli', agent: 'claude' }, 'me').maker).toEqual({ kind: 'claude' });
    expect(explorationWork({ name: 'Pill buttons', author: 'me', requests: [{ source: 'mcp' }] }, 'me').maker).toEqual({ kind: 'claude' });
  });
});

describe('developer work helpers', () => {
  it('one quiet line, empty with none', () => {
    expect(devWorkLine(0)).toBe('');
    expect(devWorkLine(1)).toBe('Developer work, 1 in progress');
  });
  it('filter: All by default, from the address', () => {
    expect(workFilterParam('')).toBe('all');
    expect(workFilterParam('?view=requests&work=developer')).toBe('developer');
    expect(workFilterParam('?work=nope')).toBe('all');
    expect(showsUnder('all', 'developer')).toBe(true);
    expect(showsUnder('design', 'developer')).toBe(false);
    expect(showsUnder('developer', 'developer')).toBe(true);
  });
});
