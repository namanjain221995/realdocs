import './auth.css';
import { isUuid } from '@realtimedocs/contracts';
import { Banner, Button, Skeleton, TextField, useToast } from '@realtimedocs/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { RouterLinkButton } from '../../components/links';
import { PublicShell } from '../../components/PublicShell';
import { useSignOut } from '../../components/SignOut';
import { Splash } from '../../components/Splash';
import { api } from '../../lib/api';
import { dropCapability } from '../../lib/capability';
import {
  errorMessage,
  errorScreenKind,
  type ErrorScreenKind,
  fieldIssues,
  isApiError,
  requestIdOf,
} from '../../lib/errors';
import { useDocumentTitle, useOnlineStatus } from '../../lib/hooks';
import { workspaceRoleLabel } from '../../lib/permissions';
import { useSession } from '../../lib/session';
import { formatDateTime, formatRelativeTime } from '../../lib/time';
import { useCapability } from '../../lib/useCapability';
import { useLimits } from '../../lib/useLimits';
import { PasswordField, PasswordStrengthHint, validateNewPassword } from './password';

const INCOMPLETE_DESCRIPTION =
  'The part of the link after the # sign is missing or was changed, so the invitation cannot be checked. Open the complete link exactly as it was sent to you. If you reloaded this page, open the original link again: the key is removed from the address bar as soon as the page loads.';

interface FormErrors {
  email?: string;
  displayName?: string;
  password?: string;
  confirm?: string;
}

export function InvitePage() {
  const { invitationId = '' } = useParams();
  const capability = useCapability('invite', invitationId);
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const toast = useToast();
  const limits = useLimits();
  const online = useOnlineStatus();
  useDocumentTitle('Accept invitation');

  const usable = capability.kind === 'ok' && isUuid(invitationId);
  const secret = capability.kind === 'ok' ? capability.secret : null;

  // The secret is read inside the query function and is never part of the key.
  const lookup = useQuery({
    queryKey: ['invitation-lookup', invitationId],
    queryFn: () => {
      if (secret === null) throw new Error('The invitation link has no key.');
      return api.invitations.lookup({ invitationId, secret });
    },
    enabled: usable && !session.user,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);
  // Set when accepting shows that the invitation stopped being valid meanwhile.
  const [ended, setEnded] = useState<{ kind: ErrorScreenKind; requestId?: string } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const accept = useMutation({
    mutationFn: api.invitations.accept,
    onSuccess: (response) => {
      dropCapability('invite', invitationId);
      setAccepted(true);
      session.adopt(response);
      toast.show({
        tone: 'success',
        title: 'Account created',
        description: 'You are signed in. Documents shared with you appear here.',
      });
      void navigate('/', { replace: true });
    },
    onError: (error) => {
      const kind = errorScreenKind(error, { online });
      if (kind === 'invite_invalid' || kind === 'invite_expired') {
        dropCapability('invite', invitationId);
        setEnded({ kind, requestId: requestIdOf(error) });
        return;
      }
      const issues = fieldIssues(error);
      if (Object.keys(issues).length > 0) {
        setErrors({
          email: issues.email,
          displayName: issues.displayName,
          password: issues.password,
        });
      }
      setFailure({
        message:
          isApiError(error) && error.code === 'conflict'
            ? 'An account with this email address already exists. Sign in instead, or ask an administrator.'
            : errorMessage(error, 'The account could not be created. Try again.'),
        requestId: requestIdOf(error),
      });
    },
  });

  // An invitation the server refuses will not work on a second try. Remember
  // the refusal first (forgetting the key re-renders this screen, which would
  // otherwise report a link without a key), then forget the key.
  const lookupKind = lookup.isError ? errorScreenKind(lookup.error, { online }) : null;
  const lookupError = lookup.error;
  useEffect(() => {
    if (lookupKind === null) return;
    const kind = lookupKind === 'not_found' ? 'invite_invalid' : lookupKind;
    if (kind === 'invite_invalid' || kind === 'invite_expired') {
      setEnded({ kind, requestId: requestIdOf(lookupError) });
      dropCapability('invite', invitationId);
    }
  }, [lookupKind, lookupError, invitationId]);

  // The account exists and the dashboard is opening.
  if (accepted) return <Splash label="Opening your documents" />;

  if (session.user) {
    return (
      <PublicShell width="wide" brandTo="/">
        <h1 className="auth-title">You are already signed in</h1>
        <p className="auth-lede">
          You are signed in as {session.user.displayName} ({session.user.email}). An invitation
          creates a new account. If this one is meant for a different person, sign out, then open
          the invitation link again.
        </p>
        <div className="app-form__actions">
          <RouterLinkButton to="/" variant="primary">
            Go to documents
          </RouterLinkButton>
          <Button onClick={signOut.requestSignOut} loading={signOut.pending}>
            Sign out
          </Button>
        </div>
      </PublicShell>
    );
  }

  if (ended) {
    return (
      <PublicShell width="wide">
        <ErrorView
          kind={ended.kind}
          requestId={ended.requestId}
          headingLevel={1}
          data-testid="invite-error"
        />
      </PublicShell>
    );
  }

  if (!usable) {
    return (
      <PublicShell width="wide">
        <ErrorView
          kind="invite_invalid"
          headingLevel={1}
          title="This invitation link is incomplete"
          description={INCOMPLETE_DESCRIPTION}
          data-testid="invite-error"
        />
      </PublicShell>
    );
  }

  if (lookup.isError) {
    // Refusals were handled above; what is left here can be retried.
    return (
      <PublicShell width="wide">
        <ErrorView
          error={lookup.error}
          kind={lookupKind === 'not_found' ? 'invite_invalid' : (lookupKind ?? 'unexpected')}
          headingLevel={1}
          onRetry={() => void lookup.refetch()}
          retrying={lookup.isFetching}
          data-testid="invite-error"
        />
      </PublicShell>
    );
  }

  if (!lookup.data) {
    return (
      <PublicShell>
        <div role="status" aria-label="Checking the invitation">
          <Skeleton height={28} width="70%" />
          <Skeleton lines={2} style={{ marginTop: 12 }} />
          <Skeleton height={72} style={{ marginTop: 20 }} />
          <Skeleton height={32} style={{ marginTop: 20 }} />
          <Skeleton height={32} style={{ marginTop: 14 }} />
        </div>
      </PublicShell>
    );
  }

  const invitation = lookup.data;
  const needsEmail = invitation.email === null;
  const minLength = limits.passwordMinLength;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (accept.isPending || secret === null) return;
    const next: FormErrors = {};
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();
    if (needsEmail) {
      if (trimmedEmail === '') next.email = 'Enter your email address.';
      else if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) next.email = 'Enter a complete email address.';
      else if (trimmedEmail.length > limits.emailMaxLength)
        next.email = 'That address is too long.';
    }
    if (trimmedName === '') next.displayName = 'Enter the name other people will see.';
    else if (trimmedName.length > limits.displayNameMaxLength) {
      next.displayName = `Use at most ${limits.displayNameMaxLength} characters.`;
    }
    Object.assign(
      next,
      validateNewPassword(password, confirm, minLength, limits.passwordMaxLength),
    );
    setErrors(next);
    const firstInvalid = (['email', 'displayName', 'password', 'confirm'] as const).find(
      (field) => next[field],
    );
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setFailure(null);
    accept.mutate({
      invitationId,
      secret,
      ...(needsEmail ? { email: trimmedEmail } : {}),
      displayName: trimmedName,
      password,
    });
  };

  return (
    <PublicShell>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-lede">
        You were invited to {invitation.workspaceName}. Choose how your name appears and set a
        password.
      </p>

      <dl className="auth-invite-facts" data-testid="invite-facts">
        <dt>Workspace</dt>
        <dd>{invitation.workspaceName}</dd>
        <dt>Role</dt>
        <dd>{workspaceRoleLabel(invitation.role)}</dd>
        {invitation.email ? (
          <>
            <dt>Email</dt>
            <dd>{invitation.email}</dd>
          </>
        ) : null}
        <dt>Valid until</dt>
        <dd title={formatDateTime(invitation.expiresAt)}>
          {formatDateTime(invitation.expiresAt)} ({formatRelativeTime(invitation.expiresAt)})
        </dd>
      </dl>

      {failure ? (
        <Banner tone="danger" className="auth-banner" data-testid="invite-form-error">
          {failure.message}
          {failure.requestId ? (
            <span className="app-note"> Reference {failure.requestId}</span>
          ) : null}
        </Banner>
      ) : null}

      <form ref={formRef} className="app-form" onSubmit={onSubmit} noValidate>
        {needsEmail ? (
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
        ) : (
          // Not shown: lets password managers file the new password under the right account.
          <input
            className="rd-visually-hidden"
            type="text"
            name="username"
            autoComplete="username"
            value={invitation.email ?? ''}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
        )}
        <TextField
          label="Name"
          name="displayName"
          autoComplete="name"
          hint="Shown to people you work with, next to your edits."
          maxLength={limits.displayNameMaxLength}
          value={displayName}
          error={errors.displayName}
          onChange={(event) => setDisplayName(event.target.value)}
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
              personal={[displayName, needsEmail ? email : (invitation.email ?? '')]}
            />
          }
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordField
          label="Confirm password"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <Button type="submit" variant="primary" fullWidth loading={accept.isPending}>
          Create account
        </Button>
      </form>

      <p className="auth-footnote">
        This invitation creates an account. It does not give access to any document by itself: an
        administrator adds you to documents separately.
      </p>
    </PublicShell>
  );
}
