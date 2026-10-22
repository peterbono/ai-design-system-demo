// What this browser remembers of the start (rules in lib/start.ts), under `bridge.start` in localStorage. Every read
// and write is guarded: in a private window or with storage blocked, the start lives for this visit only. Reads only
// this browser: no GitHub call, so the demo banner and the team menu stay free for guests.
import { EMPTY_START, parseStartMemory, START_KEY, type StartFacts, type StartMemory } from '../lib/start';
import { loadRecentTeams } from '../lib/recent-teams';
import { readWorkspace } from './workspace';

let memory: StartMemory | null = null;

export function readStart(): StartMemory {
  try {
    const stored = localStorage.getItem(START_KEY);
    if (stored !== null || !memory) return parseStartMemory(stored);
  } catch {
    /* storage blocked: fall back to this visit */
  }
  return memory ?? { ...EMPTY_START };
}

/** Merges `next` into what is remembered and returns the result. */
export function rememberStart(next: Partial<StartMemory>): StartMemory {
  const merged = { ...readStart(), ...next };
  memory = merged;
  try {
    localStorage.setItem(START_KEY, JSON.stringify(merged));
  } catch {
    /* kept for this visit only */
  }
  return merged;
}

/** Everything lib/start.ts decides from, read from this browser. */
export function startFacts(): StartFacts {
  return { recent: loadRecentTeams(), storybook: Boolean(readWorkspace().storybook), memory: readStart() };
}
