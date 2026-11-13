import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { AppShell } from './AppShell';
import { ErrorView } from './ErrorScreen';
import { RouterLinkButton } from './links';
import { PublicShell } from './PublicShell';

/** Any address the app does not know. */
export function NotFoundPage() {
  const { user } = useSession();
  useDocumentTitle('Page not found');
  const view = (
    <ErrorView
      kind="not_found"
      subject="page"
      headingLevel={1}
      data-testid="not-found"
      actions={
        user ? (
          <RouterLinkButton to="/documents" variant="primary">
            Go to documents
          </RouterLinkButton>
        ) : (
          <RouterLinkButton to="/login" variant="primary">
            Sign in
          </RouterLinkButton>
        )
      }
    />
  );
  return user ? <AppShell>{view}</AppShell> : <PublicShell width="wide">{view}</PublicShell>;
}
