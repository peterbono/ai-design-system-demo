import { describe, expect, it } from 'vitest';
import { FAQ, INSTALL_COMMAND, TERMINAL, currentStation, drawnLength, journeyPath, terminalText } from './landing';

describe('landing words', () => {
  it('asks four questions and promises nothing planned', () => {
    expect(FAQ).toHaveLength(4);
    const all = JSON.stringify({ FAQ, TERMINAL });
    expect(all).not.toMatch(/planned|coming soon|soon/i);
    expect(all).not.toMatch(/\u2014/);
  });

  it('never says the library branch opens by itself', () => {
    expect(JSON.stringify(FAQ)).not.toMatch(/automatically/i);
    expect(TERMINAL.find((l) => l.tool === 'bridge_open_library_branch')?.note).toMatch(/after you say yes/);
  });

  it('copies the real install command and the real MCP tool names', () => {
    expect(INSTALL_COMMAND).toBe('npx @bridge-ds/cli init');
    expect(terminalText().split('\n')[0]).toMatch(/^> Explore/);
    expect(terminalText()).toContain('bridge_missing_pieces  # 1 piece missing');
  });
});

describe('journey line', () => {
  it('draws nothing for fewer than two points', () => {
    expect(journeyPath([])).toBe('');
    expect(journeyPath([{ x: 1, y: 1 }])).toBe('');
  });

  it('leaves and arrives vertically on each leg', () => {
    expect(journeyPath([{ x: 0, y: 0 }, { x: 100, y: 200 }])).toBe('M0 0 C0 100 100 100 100 200');
    expect(journeyPath([{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 10, y: 60 }])).toBe('M0 0 C0 10 10 10 10 20 C10 40 10 40 10 60');
  });

  it('finds the station the reader is at', () => {
    expect(currentStation([100, 600, 1100], 50)).toBe(-1);
    expect(currentStation([100, 600, 1100], 700)).toBe(1);
    expect(currentStation([100, 600, 1100], 5000)).toBe(2);
  });

  it('draws the line down to the reading line', () => {
    const straight = (len: number) => ({ x: 0, y: len });
    expect(drawnLength(1000, -5, straight)).toBe(0);
    expect(drawnLength(1000, 2000, straight)).toBe(1000);
    expect(drawnLength(1000, 400, straight)).toBeCloseTo(400, 0);
    expect(drawnLength(0, 400, straight)).toBe(0);
  });
});
