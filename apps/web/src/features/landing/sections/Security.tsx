import { Link } from 'react-router';

const ITEMS = [
  [
    'Roles from the server',
    'Administrator, editor and viewer are resolved from the database on every request and again when a live connection is opened. The client never supplies its role.',
  ],
  [
    'Hashed tokens',
    'Session tokens and share links are stored as SHA-256 hashes, and a link is shown once. Passwords use Argon2id.',
  ],
  [
    'Audit trail',
    'Administrative and security events record who, what, when and the request id. Keystrokes and document content are never audited.',
  ],
  [
    'Content Security Policy',
    'The server sends a policy with script-src limited to its own origin, no plugins and no framing.',
  ],
  [
    'Sandboxed desktop app',
    'The desktop windows run with context isolation and the operating-system sandbox on, and ask for no microphone, camera or screen-recording permission.',
  ],
  [
    'Revocation',
    'Revoking or letting a link expire stops future access and disconnects open connections.',
  ],
] as const;

/** Security and administration, limited to what docs/security.md states. */
export function Security() {
  return (
    <section
      id="security"
      className="lp-sec lp-sec--tint"
      aria-labelledby="security-title"
      data-testid="security"
    >
      <div className="land-wrap">
        <div data-reveal>
          <h2 id="security-title" className="lp-h2">
            Security and administration
          </h2>
          <p className="lp-lead">
            How access is decided and what is recorded. The security page lists the checks behind
            each statement, and what is still weak.
          </p>
        </div>
        <ul className="lp-grid" data-reveal>
          {ITEMS.map(([title, text]) => (
            <li key={title} className="lp-card">
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
        <div className="lp-facts" data-reveal>
          <div data-testid="privacy">
            <h3>Privacy</h3>
            <p>
              The desktop app asks for no microphone, camera or screen-recording permission, and
              needs no administrator rights for normal use. The results you record in the Privacy
              Test Center stay on your computer.
            </p>
          </div>
          <div data-testid="limitations">
            <h3>Limits</h3>
            <p>
              Documents are not end-to-end encrypted, and whoever operates the server can read them.
              Revocation stops future access but does not erase what someone already received. The
              native Windows and macOS behavior has not been verified on real computers with real
              meeting apps yet. <Link to="/guides/security">Read the security page</Link>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
