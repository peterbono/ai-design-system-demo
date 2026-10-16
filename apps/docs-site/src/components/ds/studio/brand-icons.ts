// Brand marks (GitHub, Figma, Storybook) as Lucide-compatible icons, so DS Button and IconButton can show them:
// lucide-react ships no brand icons. Same paths as the site's own set (src/brand/icons.ts), 24px grid.
import { createLucideIcon } from 'lucide-react';

export const GitHubMark = createLucideIcon('github-mark', [
  [
    'path',
    {
      d: 'M9 19c-4 1.3-4-2-5.5-2.5M14.5 21v-3.4c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.1 2.9 5.1 3.2 5.1 3.2a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.7 9.6c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
      key: 'gh',
    },
  ],
]);

export const FigmaMark = createLucideIcon('figma-mark', [
  ['path', { d: 'M9 3h3v6H9a3 3 0 0 1 0-6zM12 3h3a3 3 0 0 1 0 6h-3zM9 9h3v6H9a3 3 0 0 1 0-6z', key: 'f1' }],
  ['circle', { cx: '15', cy: '12', r: '3', key: 'f2' }],
  ['path', { d: 'M9 15h3v3a3 3 0 1 1-3-3z', key: 'f3' }],
]);

export const StorybookMark = createLucideIcon('storybook-mark', [
  ['path', { d: 'M5.5 3.5 18 3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1l-12.5-.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z', key: 's1' }],
  ['path', { d: 'M15 3v3.5l-1.2-1-1.3 1V3.2', key: 's2' }],
  ['path', { d: 'M14.5 10.5c-.5-.6-1.4-1-2.5-1-1.4 0-2.4.7-2.4 1.7 0 2.4 5 1.3 5 3.8 0 1-1.1 1.8-2.6 1.8-1.2 0-2.2-.4-2.7-1.2', key: 's3' }],
]);
