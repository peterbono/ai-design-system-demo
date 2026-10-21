// The browser workspace store (rules in lib/workspace.ts): the Storybook URL of the quick start, kept in this
// browser's localStorage under `bridge.workspace`. Every read and write is guarded: in a private window or with
// storage blocked, the workspace lives for this visit only. Pages listen with onWorkspaceChange, which also hears
// changes made in another tab.
import { parseWorkspace, WORKSPACE_KEY, type Workspace, type WorkspaceStorybook } from '../lib/workspace';

const EVENT = 'bridge:workspace';
let memory: Workspace | null = null;

export function readWorkspace(): Workspace {
  try {
    const stored = localStorage.getItem(WORKSPACE_KEY);
    if (stored !== null || !memory) return parseWorkspace(stored);
  } catch {
    /* storage blocked: fall back to this visit */
  }
  return memory ?? parseWorkspace(null);
}

function write(next: Workspace) {
  memory = next;
  try {
    if (next.storybook) localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next));
    else localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* kept for this visit only */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function saveStorybook(storybook: WorkspaceStorybook) {
  write({ ...readWorkspace(), storybook });
}

export function clearStorybook() {
  write({ ...readWorkspace(), storybook: null });
}

/** Calls `fn` when the workspace changes here or in another tab. Returns the unsubscribe. */
export function onWorkspaceChange(fn: (w: Workspace) => void): () => void {
  const local = () => fn(readWorkspace());
  const other = (e: StorageEvent) => {
    if (e.key === WORKSPACE_KEY || e.key === null) fn(readWorkspace());
  };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener('storage', other);
  };
}
