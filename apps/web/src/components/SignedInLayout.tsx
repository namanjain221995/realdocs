import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { loginPathFor } from '../lib/navigation';
import { useSession } from '../lib/session';
import { AppShell } from './AppShell';
import { ErrorView } from './ErrorScreen';
import { RouterLinkButton } from './links';

/** Routes that need an account. Anyone else is sent to sign in and brought back afterwards. */
export function SignedInLayout() {
  const { user, endReason } = useSession();
  const location = useLocation();
  if (!user) {
    // After an explicit sign-out there is no page to come back to.
    const target =
      endReason === 'signed_out' ? '/login' : loginPathFor(location.pathname, location.search);
    return <Navigate to={target} replace state={{ reason: endReason }} />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/** Wraps administrator-only pages. The server enforces this too; this is the explanation. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (isAdmin) return <>{children}</>;
  return (
    <ErrorView
      kind="forbidden"
      headingLevel={1}
      title="This page is for administrators"
      description="Accounts and invitations are managed by workspace administrators. Ask one of them if you need a change."
      actions={
        <RouterLinkButton to="/" variant="primary">
          Go to documents
        </RouterLinkButton>
      }
    />
  );
}
