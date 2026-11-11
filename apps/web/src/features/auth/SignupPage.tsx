import './auth.css';
import { Banner, Button, TextField } from '@realtimedocs/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { PublicShell } from '../../components/PublicShell';
import { api } from '../../lib/api';
import { errorMessage, fieldIssues, formatWait, isApiError, requestIdOf } from '../../lib/errors';
import { useCountdown, useDocumentTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { useLimits, useServerMeta } from '../../lib/useLimits';
import { PasswordField, PasswordStrengthHint } from './password';

interface Failure {
  message: string;
  requestId?: string;
}

interface FormErrors {
  displayName?: string;
  email?: string;
  password?: string;
}

const TURNED_OFF = 'Sign-up is turned off on this server.';

function describeSignupFailure(error: unknown): Failure {
  const requestId = requestIdOf(error);
  if (isApiError(error)) {
    switch (error.code) {
      case 'forbidden':
        return { message: `${TURNED_OFF} Ask a workspace administrator for an invitation link.` };
      case 'conflict':
        return {
          message:
            'An account with this email address already exists. Sign in instead, or ask an administrator.',
        };
      case 'rate_limited':
        return {
          message:
            error.retryAfterSeconds !== undefined
              ? `Too many attempts. Wait ${formatWait(error.retryAfterSeconds)} before trying again.`
              : 'Too many attempts. Wait a moment before trying again.',
        };
      default:
        break;
    }
  }
  return {
    message: errorMessage(error, 'The account could not be created. Try again.'),
    requestId,
  };
}

/** `/signup`: self-service sign-up, offered only when the server has it turned on. */
export function SignupPage() {
  const session = useSession();
  const meta = useServerMeta();
  const limits = useLimits();
  useDocumentTitle('Sign up');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const secondsLocked = useCountdown(lockedUntil);
  const formRef = useRef<HTMLFormElement>(null);

  const signup = useMutation({
    mutationFn: api.auth.signup,
    onSuccess: (response) => session.adopt(response),
    onError: (error) => {
      const issues = fieldIssues(error);
      if (Object.keys(issues).length > 0) {
        setErrors({
          displayName: issues.displayName,
          email: issues.email,
          password: issues.password,
        });
      }
      setFailure(describeSignupFailure(error));
      if (isApiError(error) && error.code === 'rate_limited' && error.retryAfterSeconds) {
        setLockedUntil(Date.now() + error.retryAfterSeconds * 1000);
      }
    },
  });

  if (session.user) return <Navigate to="/" replace />;

  // The server says up front when sign-up is off; the form is not offered for nothing.
  if (meta.data && !meta.data.signupEnabled) {
    return (
      <PublicShell blink>
        <h1 className="auth-title">Sign up</h1>
        <Banner tone="info" className="auth-banner" data-testid="signup-off">
          {TURNED_OFF} Accounts here are created from an invitation link, which comes from your
          workspace administrator.
        </Banner>
        <p className="auth-footnote">
          Already have an account? <Link to="/login">Sign in</Link>.
        </p>
      </PublicShell>
    );
  }

  const minLength = limits.passwordMinLength;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (signup.isPending || secondsLocked > 0) return;
    const next: FormErrors = {};
    const name = displayName.trim();
    const address = email.trim();
    if (name === '') next.displayName = 'Enter the name other people will see.';
    else if (name.length > limits.displayNameMaxLength) {
      next.displayName = `Use at most ${limits.displayNameMaxLength} characters.`;
    }
    if (address === '') next.email = 'Enter your email address.';
    else if (!/^\S+@\S+\.\S+$/.test(address)) next.email = 'Enter a complete email address.';
    else if (address.length > limits.emailMaxLength) next.email = 'That address is too long.';
    const length = [...password].length;
    if (length === 0) next.password = 'Choose a password.';
    else if (length < minLength) next.password = `Use at least ${minLength} characters.`;
    else if (length > limits.passwordMaxLength) {
      next.password = `Use at most ${limits.passwordMaxLength} characters.`;
    }
    setErrors(next);
    const first = (['displayName', 'email', 'password'] as const).find((field) => next[field]);
    if (first) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setFailure(null);
    signup.mutate({ email: address, displayName: name, password });
  };

  return (
    <PublicShell blink>
      <h1 className="auth-title">Sign up</h1>
      <p className="auth-lede">
        Create an account. You will see the documents that an administrator or a share link gives
        you access to.
      </p>

      {failure ? (
        <Banner tone="danger" className="auth-banner" data-testid="signup-error">
          {failure.message}
          {failure.requestId ? (
            <span className="app-note"> Reference {failure.requestId}</span>
          ) : null}
        </Banner>
      ) : null}

      <form ref={formRef} className="app-form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Name"
          name="displayName"
          autoComplete="name"
          autoFocus
          hint="Shown to people you work with, next to your edits."
          maxLength={limits.displayNameMaxLength}
          value={displayName}
          error={errors.displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          hint="You will sign in with this address."
          value={email}
          error={errors.email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          hint={
            <PasswordStrengthHint
              password={password}
              minLength={minLength}
              personal={[displayName, email]}
            />
          }
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={signup.isPending}
          disabled={secondsLocked > 0}
        >
          {secondsLocked > 0 ? `Sign up available in ${secondsLocked} s` : 'Create account'}
        </Button>
      </form>

      <div className="auth-footnote">
        <p>
          Already have an account? <Link to="/login">Sign in</Link>.
        </p>
        <p>
          Have an invitation link? Open it from your email or message to join with the role the
          administrator chose.
        </p>
      </div>
    </PublicShell>
  );
}
