import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@bridge-ds/tokens/fonts.css';
import '@bridge-ds/tokens/tokens.css';
import '@bridge-ds/react/styles.css';
import { ThemeProvider } from '@bridge-ds/react';
import { BridgeToolbar } from '@bridge-ds/toolbar';
// The link to the team's library: Bridge writes it when it starts the product (the same file `bridge connect` writes).
import link from '../.bridge/product.json';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider asRoot theme="light" brand="bridge" density="comfortable">
      <App />
      <BridgeToolbar ds={link.designSystem} product={link.product} />
    </ThemeProvider>
  </StrictMode>,
);
