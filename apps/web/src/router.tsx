import { createBrowserRouter } from 'react-router';
import { NotFoundPage } from './components/NotFoundPage';
import { RootLayout } from './components/RootLayout';
import { RouteErrorScreen } from './components/RouteErrorScreen';
import { SignedInLayout } from './components/SignedInLayout';
import { Splash } from './components/Splash';
import { legacyGuideLoader } from './features/guides/legacy';
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
          // Public: the distribution page and the notes of one release.
          path: 'download',
          lazy: async () => ({
            Component: (await import('./features/landing/DownloadPage')).DownloadPage,
          }),
        },
        {
          path: 'releases/:version',
          lazy: async () => ({
            Component: (await import('./features/landing/ReleaseNotesPage')).ReleaseNotesPage,
          }),
        },
        {
          // The in-app guides (README, desktop clients, security). They used to live under /docs.
          path: 'guides/:name',
          lazy: async () => ({
            Component: (await import('./features/guides/GuidesPage')).GuidesPage,
          }),
        },
        {
          // Public developer portal. Old guide links (/docs/readme …) are sent on to /guides.
          path: 'docs/:section?',
          loader: legacyGuideLoader,
          lazy: async () => ({
            Component: (await import('./features/developers/DevelopersPage')).DevelopersPage,
          }),
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
              path: 'admin/releases',
              lazy: async () => ({
                Component: (await import('./features/admin/AdminReleasesPage')).AdminReleasesPage,
              }),
            },
            {
              path: 'admin/api-keys',
              lazy: async () => ({
                Component: (await import('./features/admin/ApiKeysPage')).ApiKeysPage,
              }),
            },
            {
              path: 'admin/interview-sessions',
              lazy: async () => ({
                Component: (await import('./features/admin/InterviewSessionsPage'))
                  .InterviewSessionsPage,
              }),
            },
            {
              path: 'admin/interview-sessions/:sessionId',
              lazy: async () => ({
                Component: (await import('./features/admin/InterviewSessionDetailPage'))
                  .InterviewSessionDetailPage,
              }),
            },
            {
              path: 'admin/webhooks',
              lazy: async () => ({
                Component: (await import('./features/admin/WebhooksPage')).WebhooksPage,
              }),
            },
            {
              path: 'admin/users',
              lazy: async () => ({
                Component: (await import('./features/admin/AdminUsersPage')).AdminUsersPage,
              }),
            },
            {
              path: 'd/:documentId/history',
              lazy: async () => ({
                Component: (await import('./features/history/HistoryPage')).HistoryPage,
              }),
            },
          ],
        },
        { path: '*', Component: NotFoundPage },
      ],
    },
  ]);
}
