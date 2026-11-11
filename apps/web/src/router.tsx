import { createBrowserRouter } from 'react-router';
import { NotFoundPage } from './components/NotFoundPage';
import { RootLayout } from './components/RootLayout';
import { RouteErrorScreen } from './components/RouteErrorScreen';
import { SignedInLayout } from './components/SignedInLayout';
import { Splash } from './components/Splash';
import { HomeGate } from './features/landing/HomeGate';

/**
 * Route table. Every screen is its own chunk (`lazy`), and the editor is a
 * further lazy chunk inside the document screen, so nobody downloads the
 * editor to sign in or to read an error message.
 *
 * Called once at startup, after `captureCapabilityFragment()` has removed any
 * share or invitation secret from the address bar: the router reads
 * `window.location` when it is created and must never see the secret.
 */
export function createAppRouter() {
  return createBrowserRouter([
    {
      id: 'root',
      Component: RootLayout,
      ErrorBoundary: RouteErrorScreen,
      HydrateFallback: Splash,
      children: [
        {
          path: 'login',
          lazy: async () => ({ Component: (await import('./features/auth/LoginPage')).LoginPage }),
        },
        {
          path: 'signup',
          lazy: async () => ({
            Component: (await import('./features/auth/SignupPage')).SignupPage,
          }),
        },
        {
          path: 'invite/:invitationId',
          lazy: async () => ({
            Component: (await import('./features/auth/InvitePage')).InvitePage,
          }),
        },
        {
          path: 's/:grantId',
          lazy: async () => ({
            Component: (await import('./features/share/ShareExchangePage')).ShareExchangePage,
          }),
        },
        {
          // Works without an account: share-link guests land here.
          path: 'd/:documentId',
          lazy: async () => ({
            Component: (await import('./features/document/DocumentPage')).DocumentPage,
          }),
        },
        {
          path: 'd/:documentId/print',
          lazy: async () => ({
            Component: (await import('./features/document/PrintPage')).PrintPage,
          }),
        },
        {
          // Dashboard when signed in, landing page otherwise.
          index: true,
          Component: HomeGate,
        },
        {
          path: 'docs/:name',
          lazy: async () => ({ Component: (await import('./features/docs/DocsPage')).DocsPage }),
        },
        {
          Component: SignedInLayout,
          children: [
            {
              path: 'settings',
              lazy: async () => ({
                Component: (await import('./features/settings/SettingsPage')).SettingsPage,
              }),
            },
            {
              path: 'admin/users',
              lazy: async () => ({
                Component: (await import('./features/admin/AdminUsersPage')).AdminUsersPage,
              }),
            },
          ],
        },
        { path: '*', Component: NotFoundPage },
      ],
    },
  ]);
}
