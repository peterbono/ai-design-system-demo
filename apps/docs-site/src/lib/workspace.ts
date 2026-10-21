// The browser workspace: what this browser connected without a repository (plan section 5, "Config source in quick
// start"). Today one thing: the Storybook URL of the quick start, with what was found there when it was checked.
// Pure parsing here (covered by workspace.test.ts); reading and writing localStorage in scripts/workspace.ts.
// It is a per-viewer convenience: once a repository is connected, the URL belongs in bridge.config.json `storybook.url`.

export const WORKSPACE_KEY = 'bridge.workspace';

export interface WorkspaceStorybook {
  /** Base URL, as normalizeStorybookUrl returns it (no trailing slash). */
  url: string;
  /** Components and stories found on the last check. */
  components: number;
  stories: number;
  /** ISO time of that check. */
  checkedAt: string;
}

export interface Workspace {
  storybook: WorkspaceStorybook | null;
}

export const EMPTY_WORKSPACE: Workspace = { storybook: null };

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** Reads what was stored, dropping anything malformed (a URL that is not http(s), negative counts). */
export function parseWorkspace(text: string | null): Workspace {
  if (!text) return { ...EMPTY_WORKSPACE };
  try {
    const v = JSON.parse(text) as { storybook?: Partial<WorkspaceStorybook> } | null;
    const sb = v?.storybook;
    if (!sb || typeof sb.url !== 'string' || !/^https?:\/\/[^\s/]+/.test(sb.url)) return { ...EMPTY_WORKSPACE };
    const components = count(sb.components);
    const stories = count(sb.stories);
    if (components === null || stories === null) return { ...EMPTY_WORKSPACE };
    const checkedAt = typeof sb.checkedAt === 'string' && !Number.isNaN(Date.parse(sb.checkedAt)) ? sb.checkedAt : new Date(0).toISOString();
    return { storybook: { url: sb.url.replace(/\/+$/, ''), components, stories, checkedAt } };
  } catch {
    return { ...EMPTY_WORKSPACE };
  }
}

/** The host shown for a Storybook ("storybook.example.com", or "primer.style/react/storybook" when it has a path). */
export function storybookHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}
