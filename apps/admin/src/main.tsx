import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@demo-ds/tokens/fonts.css';
import '@demo-ds/tokens/tokens.css';
import '@demo-ds/react/styles.css';
import './styles/app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
