import './developers.css';
import { Link, NavLink, useParams } from 'react-router';
import { Brand } from '../../components/Brand';
import { NotFoundPage } from '../../components/NotFoundPage';
import { ThemeControl } from '../../components/ThemeControl';
import { useDocumentTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { ApiReference } from './ApiReference';
import { PORTAL_SECTIONS } from './sections';

const API_REFERENCE = {
  id: 'api-reference',
  title: 'API reference',
  summary: 'Every endpoint, with a try-it form.',
};
const ALL = [...PORTAL_SECTIONS, API_REFERENCE];

/**
 * `/docs` and `/docs/:section`: the public developer portal for the service
 * API. No sign-in needed. Sections are sub-routes, so every one has a deep link
 * and the server's SPA fallback serves them like any other path.
 */
export function DevelopersPage() {
  const { section } = useParams();
  const id = section ?? 'overview';
  const current = ALL.find((entry) => entry.id === id);
  useDocumentTitle(current ? `${current.title} – Developers` : 'Developers');
  const { user } = useSession();
  if (!current) return <NotFoundPage />;
  const portal = PORTAL_SECTIONS.find((entry) => entry.id === id);
  const index = ALL.findIndex((entry) => entry.id === id);
  const previous = ALL[index - 1];
  const next = ALL[index + 1];
  return (
    <div className="dev">
      <header className="dev__bar">
        <Brand to="/" />
        <span className="dev__badge">Developers</span>
        <div className="dev__bar-end">
          <Link to="/guides/readme" className="rd-link rd-link--quiet">
            Guides
          </Link>
          {user ? (
            <Link to="/" className="rd-link rd-link--quiet">
              Open app
            </Link>
          ) : (
            <Link to="/login" className="rd-link rd-link--quiet">
              Sign in
            </Link>
          )}
          <ThemeControl compact />
        </div>
      </header>
      <div className="dev__layout">
        <nav className="dev__nav" aria-label="Developer documentation">
          <ul>
            {ALL.map((entry) => (
              <li key={entry.id}>
                <NavLink
                  to={entry.id === 'overview' ? '/docs' : `/docs/${entry.id}`}
                  end
                  className="dev__nav-link"
                  aria-current={entry.id === id ? 'page' : undefined}
                >
                  {entry.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main
          id="main"
          tabIndex={-1}
          className="dev__main"
          data-testid="developers-page"
          data-section={id}
        >
          <article className="dev-article">
            <h1>{current.title}</h1>
            <p className="dev-lead">{current.summary}</p>
            {portal ? <portal.Component /> : <ApiReference />}
          </article>
          <nav className="dev__pager" aria-label="Previous and next section">
            {previous ? (
              <Link to={previous.id === 'overview' ? '/docs' : `/docs/${previous.id}`} rel="prev">
                &larr; {previous.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={`/docs/${next.id}`} rel="next">
                {next.title} &rarr;
              </Link>
            ) : null}
          </nav>
        </main>
      </div>
    </div>
  );
}
