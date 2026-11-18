import { StrictMode } from 'react';
import { applyTheme } from './theme';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
