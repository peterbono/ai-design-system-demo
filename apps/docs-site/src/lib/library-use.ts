// What Bridge's own Use pages hand the shared views (components/ds/library/views/InstallView, AgentsView, ReviewView,
// ChangelogView), from this build: the Bridge tools (CLI, MCP server, Figma plugin) every Library documents the same
// way, and Bridge's own packages, code samples, llms.txt, governance files and version picker. A team's Library shell
// gets `bridgeTools()` as build-time props (pages/library-shell/) and reads the rest from the team's repository.
import type { BridgeTools, UseExtras } from '../components/ds/library/library-data';
import { versionInfo } from './changelog';
import { agentRules, approvals, reviewGates, reviewingAgentPrs, riskTiers } from './governance';
import { buildLlmsTxt } from './llms';
import { AI_DOC, mcpPrompts, mcpTools, safetyModel } from './mcp';
import { GITHUB_URL, PLUGIN_URL, readJson, sourceUrl } from './repo';
import { humanDate, repoStatus } from './stats';

const pkg = (dir: string) => readJson<{ name: string; version: string }>(`packages/${dir}/package.json`);

/** The Bridge tools, as this build knows them: the same for every Library. */
export function bridgeTools(): BridgeTools {
  return {
    cliPackage: pkg('cli').name,
    mcpPackage: pkg('mcp').name,
    tools: mcpTools(),
    prompts: mcpPrompts(),
    safety: safetyModel(),
    pluginUrl: PLUGIN_URL,
    repoUrl: GITHUB_URL,
    pluginReadmeUrl: sourceUrl('apps/figma-plugin/README.md'),
    aiDoc: { label: AI_DOC, href: sourceUrl(AI_DOC) },
    tiers: riskTiers(),
    agentPrs: reviewingAgentPrs(),
  };
}

/** The packages of the Install page, in this order, with what each is for. Versions from each package.json. */
export const INSTALL_PACKAGES = ['react', 'tokens', 'cli', 'mcp', 'stylelint-plugin', 'eslint-plugin', 'core', 'visual'] as const;
const USES: Record<(typeof INSTALL_PACKAGES)[number], string> = {
  react: 'The React components. Behavior from Base UI, styling only through tokens.',
  tokens: 'Every token as CSS variables (tokens.css) and TypeScript, plus the self-hosted fonts (fonts.css).',
  cli: 'The bridge command: check tokens and contrast in CI, search and diff tokens, audit adoption in product code.',
  mcp: 'The MCP server that connects Claude to your design system. Setup on the Agents page.',
  'stylelint-plugin': 'Flags raw colors, lengths and shadows in product CSS where a token exists, with the token to use.',
  'eslint-plugin': 'Flags raw style values and native elements in product code where a token or a component exists.',
  core: 'For tools, not for product UI: config, token loading, alias resolution, contrast, diffs and the GitHub client.',
  visual: 'Visual impact: screenshots what a change touches at both versions and pixel-diffs them.',
};

const tgz = (name: string, version: string) => `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;

/** Bridge's own code samples on the Install page. */
function samples(): NonNullable<UseExtras['samples']> {
  const react = pkg('react');
  const tokens = pkg('tokens');
  return {
    app: `import '@bridge-ds/tokens/fonts.css';   // Fraunces, Instrument Sans, IBM Plex, self-hosted
import '@bridge-ds/tokens/tokens.css';  // every token as a CSS variable
import '@bridge-ds/react/styles.css';   // base styles

import { Button, Field, Input, ThemeProvider } from '@bridge-ds/react';

export function App() {
  return (
    <ThemeProvider asRoot theme="light" brand="bridge" density="comfortable">
      <Field label="Repository" description="Owner and name, like acme/design-tokens.">
        <Input placeholder="acme/design-tokens" />
      </Field>
      <Button>Connect repository</Button>
    </ThemeProvider>
  );
}`,
    html: `<html data-theme="light" data-brand="bridge" data-density="comfortable">`,
    dom: `import { badgeHtml, bindCodeBlocks, bindTooltips, codeBlockHtml } from '@bridge-ds/react/dom';

row.innerHTML = badgeHtml('Ready', { tone: 'success' }) + codeBlockHtml('npx @bridge-ds/cli check', { label: 'Check tokens' });
bindTooltips();
bindCodeBlocks();`,
    clone: ['git clone https://github.com/peterbono/ai-design-system-demo', 'cd ai-design-system-demo', 'npm install', 'npm run pack:packages'].join('\n'),
    add: `npm install ${[tokens, react].map((p) => `/abs/path/ai-design-system-demo/.packs/${tgz(p.name, p.version)}`).join(' \\\n  ')}`,
  };
}

/** The sources the Install page reads (its freshness and "View source"). */
export const INSTALL_SOURCES = ['README.md', ...INSTALL_PACKAGES.map((d) => `packages/${d}/package.json`), 'apps/figma-plugin/README.md'];

/** Everything Bridge's own Use pages show, from this build. */
export function siteUseExtras(): UseExtras {
  const version = versionInfo();
  const repo = repoStatus();
  return {
    bridge: bridgeTools(),
    packages: INSTALL_PACKAGES.map((d) => ({ ...pkg(d), use: USES[d] })),
    samples: samples(),
    llms: { text: buildLlmsTxt(), href: '/llms.txt' },
    governance: { tiers: riskTiers(), approvals: approvals(), gates: reviewGates(), agentPrs: reviewingAgentPrs(), rules: agentRules() },
    versionMenu: {
      current: version.current,
      past: version.past.map((r) => r.name),
      branch: repo.branch,
      sha: repo.sha,
      pending: version.pending,
      builtFrom: `Built from ${repo.branch} at ${repo.sha}, ${humanDate(repo.lastChange)}`,
    },
  };
}
