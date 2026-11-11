import '@realtimedocs/ui/styles.css';
import './settings.css';
import { ThemeProvider, ToastProvider } from '@realtimedocs/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsApp } from './SettingsApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      {/* The kit's theme context (the Privacy Test Center is built with it). The
          window's colours still follow the panel's text-colour preference. */}
      <ThemeProvider defaultTheme="dark">
        <ToastProvider placement="bottom-end">
          <SettingsApp />
        </ToastProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
