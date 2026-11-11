import '@realtimedocs/ui/styles.css';
import '@realtimedocs/editor/styles.css';
import './panel.css';
import { ToastProvider } from '@realtimedocs/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelApp } from './PanelApp';
import { installSurfaceGuards } from './surface-guards';

// Before anything renders: no native tooltip or select popup ever leaves the window.
installSurfaceGuards();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ToastProvider placement="bottom-center" max={2}>
        <PanelApp />
      </ToastProvider>
    </StrictMode>,
  );
}
