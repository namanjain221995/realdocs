import './settings.css';
import { Banner, Button, TextField, useToast } from '@realtimedocs/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useSignOut } from '../../components/SignOut';
import { ThemeControl } from '../../components/ThemeControl';
import { api } from '../../lib/api';
import { errorMessage, fieldIssues, requestIdOf } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/hooks';
import { workspaceRoleLabel } from '../../lib/permissions';
import { useSession } from '../../lib/session';
import { formatDateTime } from '../../lib/time';
import { useLimits } from '../../lib/useLimits';
import { PasswordField, PasswordStrengthHint, validateNewPassword } from '../auth/password';
import { RecoveryDrafts } from './RecoveryDrafts';

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section id={id} className="settings-section" aria-labelledby={headingId}>
      <div className="settings-section__intro">
        <h2 id={headingId} className="settings-section__title">
          {title}
        </h2>
        <p className="settings-section__description">{description}</p>
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function ProfileForm() {
  const session = useSession();
  const limits = useLimits();
  const toast = useToast();
  const user = session.user;
  const [name, setName] = useState(user?.displayName ?? '');
  const [error, setError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: api.auth.updateProfile,
    onSuccess: (response) => {
      session.adopt(response);
      toast.show({ tone: 'success', title: 'Name updated' });
    },
    onError: (failure) => {
      const issue = fieldIssues(failure).displayName;
      if (issue) setError(issue);
      else {
        toast.show({
          tone: 'danger',
          title: 'Could not update your name',
          description: errorMessage(failure),
        });
      }
    },
  });

  if (!user) return null;
  const trimmed = name.trim();
  const unchanged = trimmed === user.displayName;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (save.isPending || unchanged) return;
    if (trimmed === '') {
      setError('Enter the name other people will see.');
      return;
    }
    save.mutate({ displayName: trimmed });
  };

  return (
    <form className="app-form" onSubmit={submit} noValidate data-testid="profile-form">
      <TextField
        label="Name"
        name="displayName"
        autoComplete="name"
        hint="Shown to people you work with, next to your edits and in participant lists."
        maxLength={limits.displayNameMaxLength}
        value={name}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          setError(undefined);
        }}
      />
      <dl className="settings-facts">
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd>{workspaceRoleLabel(user.role)}</dd>
      </dl>
      <div className="app-form__actions">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={unchanged}>
          Save name
        </Button>
      </div>
    </form>
  );
}

interface PasswordErrors {
  current?: string;
  password?: string;
  confirm?: string;
}

function PasswordForm() {
  const { user } = useSession();
  const limits = useLimits();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const change = useMutation({
    mutationFn: api.auth.changePassword,
    onSuccess: () => {
      setCurrent('');
      setPassword('');
      setConfirm('');
      setErrors({});
      toast.show({
        tone: 'success',
        title: 'Password changed',
        description: 'Every other browser and device was signed out of your account.',
        durationMs: 8000,
      });
    },
    onError: (error) => {
      const issues = fieldIssues(error);
      if (issues.newPassword) {
        setErrors({ password: issues.newPassword });
        return;
      }
      // The server answers a wrong current password with a validation issue on that field.
      if (issues.currentPassword) {
        setErrors({ current: 'That is not your current password.' });
        formRef.current?.querySelector<HTMLInputElement>('[name="current-password"]')?.select();
        return;
      }
      const requestId = requestIdOf(error);
      setFailure(requestId ? `${errorMessage(error)} Reference ${requestId}` : errorMessage(error));
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (change.isPending) return;
    const next: PasswordErrors = validateNewPassword(
      password,
      confirm,
      limits.passwordMinLength,
      limits.passwordMaxLength,
    );
    if (current === '') next.current = 'Enter your current password.';
    else if (!next.password && password === current) {
      next.password = 'Choose a password that differs from the current one.';
    }
    setErrors(next);
    setFailure(null);
    const order = ['current', 'password', 'confirm'] as const;
    const names = {
      current: 'current-password',
      password: 'new-password',
      confirm: 'confirm-password',
    };
    const firstInvalid = order.find((field) => next[field]);
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${names[firstInvalid]}"]`)?.focus();
      return;
    }
    change.mutate({ currentPassword: current, newPassword: password });
  };

  return (
    <form
      ref={formRef}
      className="app-form"
      onSubmit={submit}
      noValidate
      data-testid="password-form"
    >
      {failure ? <Banner tone="danger">{failure}</Banner> : null}
      {/* Not shown: tells password managers which account these fields belong to. */}
      <input
        className="rd-visually-hidden"
        type="text"
        name="username"
        autoComplete="username"
        value={user?.email ?? ''}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <PasswordField
        label="Current password"
        name="current-password"
        autoComplete="current-password"
        value={current}
        error={errors.current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <PasswordField
        label="New password"
        name="new-password"
        autoComplete="new-password"
        value={password}
        error={errors.password}
        hint={
          <PasswordStrengthHint
            password={password}
            minLength={limits.passwordMinLength}
            personal={user ? [user.displayName, user.email] : []}
          />
        }
        onChange={(event) => setPassword(event.target.value)}
      />
      <PasswordField
        label="Confirm new password"
        name="confirm-password"
        autoComplete="new-password"
        value={confirm}
        error={errors.confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <div className="app-form__actions">
        <Button type="submit" variant="primary" loading={change.isPending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

/** This browser's session, and the way to end every other one. */
function SessionsSection() {
  const { user, expiresAt } = useSession();
  const { requestSignOut, pending } = useSignOut();
  const toast = useToast();

  const revokeOthers = useMutation({
    mutationFn: api.auth.revokeOtherSessions,
    onSuccess: ({ revoked }) => {
      toast.show({
        tone: 'success',
        title:
          revoked === 0
            ? 'No other session was signed in'
            : `Signed out ${revoked} other ${revoked === 1 ? 'session' : 'sessions'}`,
        description:
          revoked === 0
            ? undefined
            : 'Those browsers and desktop apps were disconnected and have to sign in again.',
      });
    },
    onError: (error) => {
      const requestId = requestIdOf(error);
      toast.show({
        tone: 'danger',
        title: 'Could not sign out the other sessions',
        description: requestId
          ? `${errorMessage(error)} Reference ${requestId}`
          : errorMessage(error),
      });
    },
  });

  if (!user) return null;
  return (
    <div className="settings-session" data-testid="session-info">
      <p>
        Signed in as <strong>{user.displayName}</strong> in this browser.
        {expiresAt ? ` This session ends on ${formatDateTime(expiresAt)} at the latest.` : ''}
      </p>
      <div className="app-form__actions">
        <Button loading={pending} onClick={requestSignOut} data-testid="settings-sign-out">
          Sign out
        </Button>
        <Button
          loading={revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}
          data-testid="sign-out-everywhere-else"
        >
          Sign out everywhere else
        </Button>
      </div>
      <p className="app-note">
        “Everywhere else” ends your sessions in other browsers and the desktop apps opened from
        them. This browser stays signed in.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useSession();
  const { hash } = useLocation();
  useDocumentTitle('Settings');

  // Links such as /settings#recovery-drafts arrive before this screen exists,
  // so the browser's own jump to the anchor finds nothing. Do it here.
  useEffect(() => {
    if (hash !== '#recovery-drafts') return;
    document.getElementById('recovery-drafts')?.scrollIntoView({ block: 'start' });
  }, [hash]);

  if (!user) return null;

  return (
    <>
      <header className="app-page-header">
        <div>
          <h1 className="app-page-title">Settings</h1>
          <p className="app-page-lede">
            Your account on this server, and how RealtimeDocs looks in this browser.
          </p>
        </div>
      </header>

      <Section title="Profile" description="How you appear to the people you work with.">
        <ProfileForm />
      </Section>

      <Section
        title="Password"
        description="Changing your password signs out every other browser and device that is signed in to your account."
      >
        <PasswordForm />
      </Section>

      <Section
        title="Appearance"
        description="Applies to this browser. A document’s own colours can be set separately while reading it."
      >
        <ThemeControl />
      </Section>

      <Section
        title="Sessions"
        description="Sign out here when you finish on a shared computer, or end the sessions you left open somewhere else."
      >
        <SessionsSection />
      </Section>

      <Section
        id="recovery-drafts"
        title="Recovery drafts"
        description="Unsaved work that was set aside instead of being published or lost. Drafts stay on this device, are never uploaded on their own, and are deleted when you sign out."
      >
        <RecoveryDrafts accountId={user.id} />
      </Section>
    </>
  );
}
