// Which repo files feed each page. Used for the "last updated" freshness line and the "source" links.
import { CONTRAST_FILE } from './contrast';
import { AGENTS_FILE, GOVERNANCE_FILE, PLAIN_RULES_FILE } from './governance';
import { lastUpdated, readJson } from './repo';
import { TOKEN_SOURCE_FILES, primitiveFiles, semanticFile, type Semantic } from './tokens';

export const USAGE_FILE = 'apps/docs-site/src/content/token-usage.json';

export const PAGE_SOURCES = {
  home: ['README.md', 'docs/ARCHITECTURE.md'],
  color: [...primitiveFiles().filter((f) => f.includes('color')), semanticFile('light'), semanticFile('dark'), USAGE_FILE],
  contrast: [CONTRAST_FILE, semanticFile('light'), semanticFile('dark')],
  typography: primitiveFiles().filter((f) => f.includes('typography')),
  spacing: primitiveFiles().filter((f) => f.includes('space')),
  radius: [...primitiveFiles().filter((f) => f.includes('radius')), semanticFile('light')],
  elevation: [...primitiveFiles().filter((f) => f.includes('shadow')), semanticFile('light'), semanticFile('dark')],
  lookup: [...TOKEN_SOURCE_FILES(), 'packages/react/src/components'],
  components: ['packages/react/src/components'],
  governance: [GOVERNANCE_FILE, AGENTS_FILE, PLAIN_RULES_FILE],
  changelog: ['.changeset'],
  agents: [...TOKEN_SOURCE_FILES(), 'packages/react/src/components', AGENTS_FILE, CONTRAST_FILE],
  mcp: ['docs/AI.md', 'packages/mcp/README.md', 'packages/cli/src/index.ts'],
} as const;

export const freshness = (paths: readonly string[]) => lastUpdated([...paths]);

const usage = readJson<Record<string, string>>(USAGE_FILE);
export const usageFor = (s: Pick<Semantic, 'group' | 'description'>) => s.description ?? usage[s.group] ?? '';
export const groupUsage = (group: string) => usage[group] ?? '';
