import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../packages/react/src/**/*.mdx', '../packages/react/src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', 'storybook-addon-pseudo-states'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  // Use the automatic JSX runtime so components do not need to import React.
  // Resolve workspace packages to their TypeScript sources (`source` export condition), not their built files.
  viteFinal: async (cfg) => {
    const { defaultClientConditions } = await import('vite');
    return {
      ...cfg,
      esbuild: { ...(cfg.esbuild || {}), jsx: 'automatic' },
      resolve: { ...cfg.resolve, conditions: ['source', ...(cfg.resolve?.conditions ?? defaultClientConditions)] },
    };
  },
};

export default config;
