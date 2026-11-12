import { Link } from 'react-router';

export function GetStarted({ signupEnabled }: { signupEnabled: boolean }) {
  return (
    <section className="lp-sec lp-start" aria-labelledby="start-title" data-testid="get-started">
      <div className="land-wrap">
        <div className="lp-card lp-start__card" data-reveal>
          <h2 id="start-title" className="lp-h2">
            Get started
          </h2>
          <ul>
            <li>
              Already have an account? <Link to="/login">Sign in</Link>.
            </li>
            <li>
              Invitation links come from your administrator. Open yours and you will be asked for
              your name and a password.
            </li>
            {signupEnabled ? (
              <li data-testid="start-sign-up">
                This server lets you create your own account. <Link to="/signup">Sign up</Link>.
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </section>
  );
}
