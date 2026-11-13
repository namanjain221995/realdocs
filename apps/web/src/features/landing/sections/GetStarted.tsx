import { Link } from 'react-router';
import { DOCUMENTS_PATH } from '../../../lib/navigation';
import { useSession } from '../../../lib/session';

/** The last step of the page, for someone who is already signed in. */
export function GetStarted() {
  const { isAdmin } = useSession();
  return (
    <section className="lp-sec lp-start" aria-labelledby="start-title" data-testid="get-started">
      <div className="land-wrap">
        <div className="lp-card lp-start__card" data-reveal>
          <h2 id="start-title" className="lp-h2">
            Get started
          </h2>
          <ul>
            <li>
              Your documents, and the ones shared with you, are one click away:{' '}
              <Link to={DOCUMENTS_PATH}>open your documents</Link>.
            </li>
            <li>
              For the floating notes panel, <Link to="#download">download the desktop app</Link> and
              connect it to this server.
            </li>
            <li>
              {isAdmin ? (
                <>
                  New people join with an invitation link. Send one from{' '}
                  <Link to="/admin/users">People</Link>.
                </>
              ) : (
                <>New people join with an invitation link from a workspace administrator.</>
              )}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
