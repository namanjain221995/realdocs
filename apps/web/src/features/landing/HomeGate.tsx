import { lazy, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router';
import { AppShell } from '../../components/AppShell';
import { Splash } from '../../components/Splash';
import { loginPathFor } from '../../lib/navigation';
import { useSession } from '../../lib/session';

const LandingPage = lazy(async () => ({ default: (await import('./LandingPage')).LandingPage }));
const DashboardPage = lazy(async () => ({
  default: (await import('../dashboard/DashboardPage')).DashboardPage,
}));

/**
 * `/`: the dashboard for someone who is signed in, the public landing page for
 * everyone else. Only the code of the screen that is shown is downloaded.
 */
export function HomeGate() {
  const { user, endReason } = useSession();
  const location = useLocation();
  // A session that ended while the dashboard was open is explained on the sign-in screen,
  // which brings the person back here afterwards. Everyone else is a visitor.
  if (!user && endReason === 'expired') {
    return (
      <Navigate
        to={loginPathFor(location.pathname, location.search)}
        replace
        state={{ reason: endReason }}
      />
    );
  }
  return (
    <Suspense fallback={<Splash />}>
      {user ? (
        <AppShell>
          <DashboardPage />
        </AppShell>
      ) : (
        <LandingPage />
      )}
    </Suspense>
  );
}
