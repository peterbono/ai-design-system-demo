import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@bridge-ds/tokens/fonts.css';
import '@bridge-ds/tokens/tokens.css';
import '@bridge-ds/react/styles.css';
import './styles/app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
