import './guides.css';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { Brand } from '../../components/Brand';
import { NotFoundPage } from '../../components/NotFoundPage';
import { ThemeControl } from '../../components/ThemeControl';
import { useDocumentTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { BUNDLED_DOCUMENTS, findDocument, resolveDocumentLink } from './documents';
import { renderMarkdown } from './markdown';

function GuidesReader({ name }: { name: string }) {
  const entry = findDocument(name);
  useDocumentTitle(entry?.title);
  const { user } = useSession();
  const body = useMemo(
    () =>
      entry
        ? renderMarkdown(entry.source, {
            resolveLink: (href) => resolveDocumentLink(entry.file, entry.slug, href),
          })
        : null,
    [entry],
  );
  if (!entry) return null;
  return (
    <div className="docs">
      <header className="docs__bar">
        <Brand to="/" />
        <nav className="docs__nav" aria-label="Documentation">
          {BUNDLED_DOCUMENTS.map((item) => (
            <Link
              key={item.slug}
              to={`/guides/${item.slug}`}
              aria-current={item.slug === entry.slug ? 'page' : undefined}
              className="docs__nav-link"
            >
              {item.title}
            </Link>
          ))}
        </nav>
        <div className="docs__bar-end">
          {user ? null : (
            <Link to="/login" className="rd-link rd-link--quiet">
              Sign in
            </Link>
          )}
          <ThemeControl compact />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="docs__main">
        <article className="docs-article" data-testid="docs-article" data-doc={entry.slug}>
          {body}
        </article>
        <p className="docs__source">
          This page is the file <code>{entry.file}</code> from the RealtimeDocs source, shown here
          as it was when this version of the site was built.{' '}
          <Link to="/" className="rd-link">
            Back to RealtimeDocs
          </Link>
        </p>
      </main>
    </div>
  );
}

/** `/guides/:name`: README and the guides, rendered in the app. */
export function GuidesPage() {
  const { name } = useParams();
  if (!findDocument(name)) return <NotFoundPage />;
  return <GuidesReader key={name} name={name ?? ''} />;
}
