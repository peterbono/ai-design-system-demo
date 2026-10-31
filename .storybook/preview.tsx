import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import '@bridge-ds/tokens/fonts.css';
import '@bridge-ds/tokens/tokens.css';
import '../packages/react/src/styles/base.css';
import './preview.css';
import { ThemeProvider } from '../packages/react/src/theme';
import { ToastProvider } from '../packages/react/src/components/Toast';
import { TooltipProvider } from '../packages/react/src/components/Tooltip';
import { type Brand, type Density, type Theme, brands, defaults } from '@bridge-ds/tokens';

// Embedded in a Bridge Studio drawer (iframe.html?...&embed=bridge, apps/docs-site/src/lib/story-frame.ts): the
// canvas sizes to the story instead of the viewport, the story is centered, and the document height is posted to the
// parent so the drawer frame fits it with no inner scrollbar. The full Storybook and the measure pipeline never pass
// the parameter, so their canvas is unchanged.
if (typeof window !== 'undefined' && window.parent !== window && new URLSearchParams(window.location.search).get('embed') === 'bridge') {
  document.documentElement.classList.add('sb-embed');
  let last = 0;
  // The story's own height plus the canvas padding: never the viewport, so a taller frame does not grow the report.
  const post = () => {
    const story = document.getElementById('storybook-root');
    if (!story) return;
    const pad = getComputedStyle(document.body);
    const height = Math.ceil(story.getBoundingClientRect().height + parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom));
    if (height === last) return;
    last = height;
    window.parent.postMessage({ type: 'bridge:story-height', height }, '*');
  };
  const watch = () => {
    const story = document.getElementById('storybook-root');
    if (story) new ResizeObserver(post).observe(story);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
  window.addEventListener('load', post);
}

// Brands come from bridge.config.json through the token build, so a merged brand shows up in the toolbar.
const brandTitle = (b: string) => b.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Applies the scope the way a product does: all three attributes on <html> (for portaled overlays and the
// page background) and a ThemeProvider around the story.
const withScope: Decorator = (Story, context) => {
  const theme = (context.globals.theme ?? 'light') as Theme;
  const brand = (context.globals.brand ?? 'bridge') as Brand;
  const density = (context.globals.density ?? 'comfortable') as Density;
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-brand', brand);
    root.setAttribute('data-density', density);
  }, [theme, brand, density]);
  return (
    <ThemeProvider theme={theme} brand={brand} density={density} className="sb-theme-root">
      <TooltipProvider>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withScope],
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    brand: {
      description: 'Brand',
      toolbar: {
        title: 'Brand',
        icon: 'paintbrush',
        items: brands.map((b) => ({ value: b, title: brandTitle(b) })),
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Density',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: [
          { value: 'comfortable', title: 'Comfortable' },
          { value: 'compact', title: 'Compact' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light', brand: defaults.brand, density: 'comfortable' },
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    options: {
      storySort: { order: ['Foundations', 'Actions', 'Forms', 'Feedback', 'Overlays', 'Navigation', 'Data display', 'Layout', '*'] },
    },
    // Accessibility violations fail story tests instead of only showing as warnings.
    a11y: { test: 'error' },
  },
};

export default preview;
