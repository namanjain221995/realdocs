import './auth.css';
import { Banner, Button, TextField } from '@realtimedocs/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { PublicShell } from '../../components/PublicShell';
import { api } from '../../lib/api';
import { errorMessage, formatWait, isApiError, requestIdOf } from '../../lib/errors';
import { useCountdown, useDocumentTitle } from '../../lib/hooks';
import { safeNextPath } from '../../lib/navigation';
import { type SessionEndReason, useSession } from '../../lib/session';
import { useServerMeta } from '../../lib/useLimits';
import { PasswordField } from './password';

interface LoginFailure {
  message: string;
  requestId?: string;
}

/**
 * Wrong email and wrong password get the same sentence on purpose: the screen
 * must not reveal which accounts exist.
 */
function describeLoginFailure(error: unknown): LoginFailure {
  const requestId = requestIdOf(error);
  if (isApiError(error)) {
    switch (error.code) {
      case 'unauthenticated':
      case 'session_expired':
      case 'not_found':
        return {
          message: 'That email and password do not match an account. Check both and try again.',
        };
      case 'forbidden':
        return {
          message: 'This account cannot sign in right now. Ask a workspace administrator.',
          requestId,
        };
      case 'rate_limited':
        return {
          message:
            error.retryAfterSeconds !== undefined
              ? `Too many sign-in attempts. Wait ${formatWait(error.retryAfterSeconds)} before trying again.`
              : 'Too many sign-in attempts. Wait a moment before trying again.',
        };
      case 'validation_failed':
        return { message: 'Enter a valid email address and your password.' };
      default:
        break;
    }
  }
  return { message: errorMessage(error), requestId };
}

function endReasonFrom(state: unknown): SessionEndReason {
  if (typeof state !== 'object' || state === null) return null;
  const reason = (state as { reason?: unknown }).reason;
  return reason === 'expired' || reason === 'signed_out' ? reason : null;
}

export function LoginPage() {
  const session = useSession();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get('next'), window.location.origin);
  useDocumentTitle('Sign in');
  const signupEnabled = useServerMeta().data?.signupEnabled === true;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const secondsLocked = useCountdown(lockedUntil);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const login = useMutation({
    mutationFn: api.auth.login,
    onSuccess: (response) => {
      // Adopting the session re-renders this screen, which then redirects to `next`.
      session.adopt(response);
    },
    onError: (error) => {
      setFailure(describeLoginFailure(error));
      if (isApiError(error) && error.code === 'rate_limited' && error.retryAfterSeconds) {
        setLockedUntil(Date.now() + error.retryAfterSeconds * 1000);
      }
      passwordRef.current?.select();
    },
  });

  if (session.user) return <Navigate to={next} replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (login.isPending || secondsLocked > 0) return;
    const errors: { email?: string; password?: string } = {};
    const trimmedEmail = email.trim();
    if (trimmedEmail === '') errors.email = 'Enter your email address.';
    else if (!/^\S+@\S+$/.test(trimmedEmail))
      errors.email = 'Enter the whole address, including the part after @.';
    if (password === '') errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (errors.email) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }
    setFailure(null);
    login.mutate({ email: trimmedEmail, password });
  };

  const reason = endReasonFrom(location.state);

  return (
    <PublicShell blink>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-lede">Open your documents and the ones shared with your account.</p>

      {reason === 'expired' && !failure ? (
        <Banner tone="info" className="auth-banner" data-testid="session-expired-notice">
          Your session ended. Sign in again to pick up where you left off.
        </Banner>
      ) : null}
      {failure ? (
        <Banner tone="danger" className="auth-banner" data-testid="login-error">
          {failure.message}
          {failure.requestId ? (
            <span className="app-note"> Reference {failure.requestId}</span>
          ) : null}
        </Banner>
      ) : null}

      <form className="app-form" onSubmit={onSubmit} noValidate>
        <TextField
          ref={emailRef}
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={email}
          error={fieldErrors.email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
          }}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          error={fieldErrors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (fieldErrors.password) {
              setFieldErrors((current) => ({ ...current, password: undefined }));
            }
          }}
        />
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={login.isPending}
          disabled={secondsLocked > 0}
        >
          {secondsLocked > 0 ? `Sign in available in ${secondsLocked} s` : 'Sign in'}
        </Button>
      </form>

      <div className="auth-footnote">
        <p>
          No account yet? Accounts are created from an invitation link. Ask a workspace
          administrator to send you one.
          {signupEnabled ? (
            <>
              {' '}
              This server also lets you <Link to="/signup">sign up</Link> yourself.
            </>
          ) : null}
        </p>
        <p data-testid="forgot-password-hint">
          Forgot your password? RealtimeDocs sends no email, so it cannot be reset from here. Ask
          the person who runs this server: they can set a new password for your account with the
          server’s <code>reset-password</code> command.
        </p>
      </div>
    </PublicShell>
  );
}
