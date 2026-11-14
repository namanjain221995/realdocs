import { copyText } from '@realtimedocs/ui';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

const REQUEST = `curl -sS https://docs.example.com/api/v1/interview-sessions \\
  -H "Authorization: Bearer $RDK_KEY" \\
  -H "Idempotency-Key: interview-84721-create" \\
  -H "Content-Type: application/json" -d '{
    "candidate": {"name": "Aarav Sharma", "email": "aarav@example.com"},
    "interviewers": [{"name": "Naman Jain", "email": "naman@acme.example"}],
    "companyName": "Acme Corp",
    "round": {"number": "2", "name": "System design"},
    "scheduledAt": "2030-03-14T15:30:00+05:30",
    "timezone": "Asia/Kolkata",
    "expiresAt": "2030-03-21T00:00:00Z",
    "permissions": {"candidateCanEdit": true, "candidateCanExport": false}
  }'`;

const RESPONSE = `HTTP/1.1 201 Created
{
  "sessionId": "…",
  "documentId": "…",
  "title": "Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30",
  "status": "scheduled",
  "candidateAccess": { "url": "https://…/s/<grantId>#<secret>", "expiresAt": "…" },
  "interviewerAccess": { "url": "…", "expiresAt": "…" },
  "participants": [ … ],
  "adminUrl": "/admin/interview-sessions/<id>",
  "createdAt": "…"
}`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="lp-copy"
      onClick={() => {
        void copyText(text).then((ok) => {
          setDone(ok);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 2000);
        });
      }}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{done ? 'Copied' : label}</span>
    </button>
  );
}

/** The developer API, with a real request from the contract. */
export function ApiSection() {
  return (
    <section id="api" className="lp-sec" aria-labelledby="api-title">
      <div className="land-wrap">
        <div className="lp-split lp-split--top">
          <div data-reveal>
            <h2 id="api-title" className="lp-h2">
              A developer API for the people who schedule
            </h2>
            <p className="lp-lead">
              Create a session with an API key that only works on <code>/api/v1</code>. An{' '}
              <code>Idempotency-Key</code> makes a retried request return the same session and the
              same links instead of a second document.
            </p>
            <ul className="lp-bullets">
              <li>
                Scopes per key, such as <code>sessions:create</code> and <code>sessions:read</code>.
              </li>
              <li>Links are returned once, at creation and at rotation.</li>
              <li>An OpenAPI 3.1 description is served by the API itself.</li>
            </ul>
            <p>
              <Link to="/docs" className="lp-textlink" data-testid="api-docs">
                Read the API docs
              </Link>
            </p>
          </div>
          <div className="lp-code" data-reveal>
            <div className="lp-code__bar">
              <span>Create a session</span>
              <CopyButton text={REQUEST} label="Copy request" />
            </div>
            <pre tabIndex={0} aria-label="Request: create an interview session">
              <code>{REQUEST}</code>
            </pre>
            <div className="lp-code__bar lp-code__bar--sub">
              <span>Response</span>
            </div>
            <pre tabIndex={0} aria-label="Response: the created session">
              <code>{RESPONSE}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
