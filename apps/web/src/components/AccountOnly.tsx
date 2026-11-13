import { Navigate, Outlet, useLocation } from 'react-router';
import { loginPathFor } from '../lib/navigation';
import { useSession } from '../lib/session';

/**
 * Pages that are shown to signed-in accounts only, without the app frame: the product page, the
 * downloads, the guides and the developer portal. A visitor, and a guest who holds nothing but a
 * share link, is sent to sign in and brought back afterwards.
 *
 * This is a route guard, not a secret: these pages are static text bundled with the app. What
 * they load that is not static (the API description) is refused by the server without a session.
 */
export function AccountOnly() {
  const { user, endReason } = useSession();
  const location = useLocation();
  if (!user) {
    const target =
      endReason === 'signed_out' ? '/login' : loginPathFor(location.pathname, location.search);
    return <Navigate to={target} replace state={{ reason: endReason }} />;
  }
  return <Outlet />;
}
