import '@realtimedocs/ui/styles.css';
import './styles/app.css';
import { ThemeProvider, ToastProvider } from '@realtimedocs/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { AppCrashBoundary } from './components/RouteErrorScreen';
import { captureCapabilityFragment, watchCapabilityFragments } from './lib/capability';
import { createQueryClient } from './lib/queryClient';
import { handleAuthFailure, SessionProvider, sessionQueryOptions } from './lib/session';
import { createAppRouter } from './router';

// First, before the router reads the location and before any request: take a
// share or invitation secret out of the address bar. See lib/capability.ts.
captureCapabilityFragment();
watchCapabilityFragments();

const queryClient = createQueryClient({
  onError: (error, queryKey) => handleAuthFailure(queryClient, error, queryKey),
});
// Ask who is signed in while the first screen's code is still loading.
void queryClient.prefetchQuery(sessionQueryOptions);

const router = createAppRouter();

const container = document.getElementById('root');
if (!container) throw new Error('RealtimeDocs could not start: the page has no #root element.');

createRoot(container).render(
  <StrictMode>
    <AppCrashBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SessionProvider>
              <RouterProvider router={router} />
            </SessionProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </AppCrashBoundary>
  </StrictMode>,
);
