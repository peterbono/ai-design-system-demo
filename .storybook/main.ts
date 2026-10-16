import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../packages/react/src/**/*.mdx', '../packages/react/src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', 'storybook-addon-pseudo-states'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  // Use the automatic JSX runtime so components do not need to import React.
  viteFinal: async (cfg) => ({ ...cfg, esbuild: { ...(cfg.esbuild || {}), jsx: 'automatic' } }),
};

export default config;
