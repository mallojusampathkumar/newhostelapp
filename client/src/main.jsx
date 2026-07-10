import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// installable PWA: register the service worker (no-op on the Vite dev server)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* http or dev — fine */ });
  });
}

// stash the browser's install prompt so More → "Install App" can trigger it
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__ssInstallPrompt = e;
  window.dispatchEvent(new Event('ss-can-install'));
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
