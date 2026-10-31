// Your AI tools: which tools the Continue panel and the Start dialog show, and the tab they open on.
import { describe, expect, it } from 'vitest';
import { AI_TOOL_TAB, parseAiTools, tabFor, toolsFor, toolsSummary } from './ai-tools';
import { copilotSetup } from './claude-connector';
import { startLabel, startLines } from '../components/ds/studio/StartExploration';

describe('the AI tools a person sees', () => {
  it('their own choice first: one tool means no tabs (a list of one)', () => {
    expect(toolsFor({ mine: ['copilot'], teamDefault: ['claude-app'], claudeLink: 'yes' })).toEqual({ tools: ['copilot'], chosen: true });
    expect(toolsFor({ mine: ['claude-app', 'copilot'] })).toEqual({ tools: ['claude-app', 'copilot'], chosen: true });
  });

  it('never answered: a Bridge connection in their Claude means the Claude app, else the team default, else Claude app and Terminal', () => {
    expect(toolsFor({ mine: null, teamDefault: ['copilot'], claudeLink: 'yes' })).toEqual({ tools: ['claude-app'], chosen: false });
    expect(toolsFor({ mine: null, teamDefault: ['copilot'], claudeLink: 'no' })).toEqual({ tools: ['copilot'], chosen: false });
    expect(toolsFor({ mine: null })).toEqual({ tools: ['claude-app', 'claude-code'], chosen: false });
  });

  it('opens the tab used last when it is still shown, else the first', () => {
    expect(tabFor(['claude-app', 'copilot'], 'copilot')).toBe('copilot');
    expect(tabFor(['claude-app', 'claude-code'], 'copilot')).toBe('claude-app');
    expect(tabFor(['copilot'], null)).toBe('copilot');
  });

  it('reads stored and posted lists strictly: known tools, deduplicated, in order; nothing valid is null', () => {
    expect(parseAiTools('["copilot","claude-app","copilot"]')).toEqual(['claude-app', 'copilot']);
    expect(parseAiTools(['cursor'])).toBeNull();
    expect(parseAiTools('not json')).toBeNull();
    expect(parseAiTools([])).toBeNull();
  });

  it('names the tabs and the choice in words', () => {
    expect(Object.values(AI_TOOL_TAB)).toEqual(['Claude app', 'Terminal', 'VS Code (Copilot)']);
    expect(toolsSummary(['claude-app', 'copilot'])).toBe('Claude app and GitHub Copilot in VS Code');
  });
});

describe('Copilot set-up and the Start dialog', () => {
  it('a product gets bridge connect --tool copilot; the library gets the server added to VS Code', () => {
    expect(copilotSetup('acme/ds', true).command).toBe('npx @bridge-ds/cli connect --ds acme/ds --tool copilot');
    const lib = copilotSetup('acme/ds', false).command;
    expect(lib.startsWith("code --add-mcp '")).toBe(true);
    expect(JSON.parse(lib.slice("code --add-mcp '".length, -1))).toEqual({ name: 'bridge', type: 'stdio', command: 'npx', args: ['-y', '@bridge-ds/mcp', '--repo', 'acme/ds'] });
  });

  it('the start button and the lines follow the tool', () => {
    expect(startLabel('copilot')).toBe('Start in Copilot');
    expect(startLabel('claude-app')).toBe('Start with Claude AI');
    const lines = startLines(`Open Bridge exploration #3 "Bob's list" in Shop.`);
    expect(lines.copilot).toBe(lines['claude-app']);
    expect(lines['claude-code']).toBe(`claude 'Open Bridge exploration #3 "Bob'\\''s list" in Shop.'`);
  });
});
