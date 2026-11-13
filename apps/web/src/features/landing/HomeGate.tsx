import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router';
import { Splash } from '../../components/Splash';
import { ADMIN_HOME_PATH } from '../../lib/navigation';
import { useSession } from '../../lib/session';

const LandingPage = lazy(async () => ({ default: (await import('./LandingPage')).LandingPage }));

/**
 * `/`: where a person starts.
 *
 * - Nobody signed in (a visitor, or a guest who only holds a share link): the sign-in page.
 *   Nothing else of the site is shown without an account.
 * - An administrator: the administration area.
 * - A member: the product page, with their account in its header.
 *
 * A page that was asked for while signed out (`/login?next=…`) wins over these defaults.
 */
export function HomeGate() {
  const { user, isAdmin, endReason } = useSession();
  if (!user) return <Navigate to="/login" replace state={{ reason: endReason }} />;
  if (isAdmin) return <Navigate to={ADMIN_HOME_PATH} replace />;
  return (
    <Suspense fallback={<Splash />}>
      <LandingPage />
    </Suspense>
  );
}
