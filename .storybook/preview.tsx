import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import '@demo-ds/tokens/fonts.css';
import '@demo-ds/tokens/tokens.css';
import '../packages/react/src/styles/base.css';
import './preview.css';
import { ThemeProvider } from '../packages/react/src/theme';
import type { Brand, Density, Theme } from '@demo-ds/tokens';

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
      <Story />
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
        items: [
          { value: 'bridge', title: 'Bridge' },
          { value: 'ocean', title: 'Ocean' },
        ],
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
  initialGlobals: { theme: 'light', brand: 'bridge', density: 'comfortable' },
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
