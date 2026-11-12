import { Link2, ShieldOff, Users } from 'lucide-react';

/** The candidate and interviewer workflow, from one API call. */
export function Sessions() {
  return (
    <section id="sessions" className="lp-sec" aria-labelledby="sessions-title">
      <div className="land-wrap lp-split">
        <div data-reveal>
          <h2 id="sessions-title" className="lp-h2">
            Interview sessions in one API call
          </h2>
          <p className="lp-lead">
            Your scheduling or HR system makes one request. RealtimeDocs creates the document and
            returns a separate link for the candidate and for each interviewer.
          </p>
          <ol className="lp-steps">
            <li>
              <strong>One request, one document.</strong> A session is one document and one
              collaboration room.
            </li>
            <li>
              <strong>Two role-scoped, expiring links.</strong> Each person gets their own link. It
              is shown once, expires, and can be rotated or revoked.
            </li>
            <li>
              <strong>Live presence with roles.</strong> Everyone sees who is in the room, labelled
              by the role the server assigned.
            </li>
          </ol>
        </div>
        <div
          className="lp-card lp-links"
          data-reveal
          role="group"
          aria-label="Example of the two links of a session"
        >
          <div className="lp-link">
            <span className="lp-ico" aria-hidden="true">
              <Users />
            </span>
            <div>
              <h3>Aarav — Candidate</h3>
              <p>Edits the document. Expires with the session.</p>
              <ul className="lp-tags">
                <li>Own link</li>
                <li>Can edit</li>
              </ul>
              <p className="lp-link__no">
                <ShieldOff aria-hidden="true" /> No desktop app and no download controls. The server
                refuses export and the desktop hand-off for candidates.
              </p>
            </div>
          </div>
          <div className="lp-link">
            <span className="lp-ico" aria-hidden="true">
              <Link2 />
            </span>
            <div>
              <h3>Naman — Interviewer</h3>
              <p>Edits, and can use Private Presenter Mode in the desktop app.</p>
              <ul className="lp-tags">
                <li>Own link</li>
                <li>Can edit</li>
                <li>Desktop app</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
