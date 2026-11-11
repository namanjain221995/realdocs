/**
 * People (administrators): accounts, invitations and the audit log.
 *
 * Invitations create accounts. They are a different thing from a document's
 * share links and the page says so wherever the two could be confused: an
 * invitation never grants access to a document, and a share link never
 * creates an account.
 */
import './admin.css';
import type {
  AuditEvent,
  Invitation,
  InvitationsResponse,
  User,
  WorkspaceRole,
} from '@realtimedocs/contracts';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  CopyField,
  EmptyState,
  Select,
  Skeleton,
  Switch,
  TabPanel,
  Tabs,
  TextField,
  type Tone,
  useToast,
} from '@realtimedocs/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, ScrollText } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { RelativeTime } from '../../components/RelativeTime';
import { WorkspaceRoleBadge } from '../../components/RoleBadge';
import { AdminOnly } from '../../components/SignedInLayout';
import { api } from '../../lib/api';
import { errorMessage, fieldIssues, requestIdOf } from '../../lib/errors';
import { DEFAULT_INVITATION_EXPIRY_HOURS, INVITATION_EXPIRY_OPTIONS } from '../../lib/expiry';
import { useDocumentTitle, useEagerValue, useNow } from '../../lib/hooks';
import { accountControls } from '../../lib/permissions';
import { queryKeys } from '../../lib/queryKeys';
import { useSession } from '../../lib/session';
import { formatDateTime, formatExpiry, formatShortDate } from '../../lib/time';
import { useLimits } from '../../lib/useLimits';

type AdminTab = 'accounts' | 'invitations' | 'audit';
const TABS: readonly { id: AdminTab; label: string }[] = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'audit', label: 'Audit log' },
];
const TABS_ID = 'admin-tabs';

const ROLE_OPTIONS: readonly { value: WorkspaceRole; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Administrator' },
];

function failureText(error: unknown): string {
  const requestId = requestIdOf(error);
  return requestId ? `${errorMessage(error)} Reference ${requestId}` : errorMessage(error);
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" data-testid="admin-loading">
      {[0, 1, 2].map((row) => (
        <div key={row} className="admin-skeleton-row">
          <Skeleton circle width={28} height={28} />
          <Skeleton width="38%" height={14} />
          <Skeleton width={96} height={24} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- accounts */

type PendingChange = { kind: 'promote'; user: User } | { kind: 'disable'; user: User };

function AccountsTab() {
  const { user: self } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users.list() });
  const [confirming, setConfirming] = useState<PendingChange | null>(null);

  const update = useMutation({
    mutationFn: (input: { user: User; change: Parameters<typeof api.users.update>[1] }) =>
      api.users.update(input.user.id, input.change),
    onSuccess: (response, input) => {
      queryClient.setQueryData(queryKeys.users, response);
      const name = input.user.displayName;
      if (input.change.role) {
        toast.show({
          title: `${name} is now ${input.change.role === 'admin' ? 'an administrator' : 'a member'}`,
        });
      } else if (input.change.status) {
        toast.show({
          title:
            input.change.status === 'disabled'
              ? `Disabled ${name}’s account`
              : `Enabled ${name}’s account`,
        });
      }
    },
    onError: (failure) => {
      toast.show({
        tone: 'danger',
        title: 'Could not change the account',
        description: failureText(failure),
      });
    },
  });

  if (users.isError && !users.data) {
    return (
      <ErrorView
        error={users.error}
        onRetry={() => void users.refetch()}
        retrying={users.isFetching}
      />
    );
  }
  if (!users.data) return <ListSkeleton />;

  return (
    <>
      <p className="app-page-lede admin-lede">
        Everyone with an account on this server. Administrators can open and manage every document;
        members see only the documents they were added to.
      </p>
      <ul className="app-rows admin-list" aria-label="Accounts" data-testid="accounts-list">
        {users.data.users.map((account) => {
          const controls = accountControls(account, self);
          const isSelf = account.id === self?.id;
          const busy = update.isPending && update.variables?.user.id === account.id;
          return (
            <li
              key={account.id}
              className="app-row admin-row"
              data-testid="account-row"
              data-user-id={account.id}
            >
              <div className="app-row__main">
                <Avatar name={account.displayName} size="md" aria-hidden="true" />
                <div className="app-row__text">
                  <span className="app-row__title">
                    {account.displayName}
                    {isSelf ? <Badge className="admin-you">You</Badge> : null}
                    {account.status === 'disabled' ? (
                      <Badge tone="danger" className="admin-you">
                        Disabled
                      </Badge>
                    ) : null}
                  </span>
                  <span className="app-row__meta">
                    {account.email}
                    <span className="admin-joined">
                      Joined{' '}
                      <time dateTime={account.createdAt}>{formatShortDate(account.createdAt)}</time>
                    </span>
                  </span>
                </div>
              </div>
              <div className="app-row__actions admin-controls">
                <Select
                  size="sm"
                  label={`Role of ${account.displayName}`}
                  hideLabel
                  value={account.role}
                  disabled={!controls.canChangeRole || busy}
                  title={controls.canChangeRole ? undefined : (controls.reason ?? undefined)}
                  options={ROLE_OPTIONS}
                  onValueChange={(value) => {
                    if (value === account.role) return;
                    if (value === 'admin') setConfirming({ kind: 'promote', user: account });
                    else if (value === 'member')
                      update.mutate({ user: account, change: { role: 'member' } });
                  }}
                  data-testid="account-role"
                />
                <Switch
                  label="Active"
                  checked={account.status === 'active'}
                  disabled={!controls.canChangeStatus || busy}
                  title={controls.canChangeStatus ? undefined : (controls.reason ?? undefined)}
                  aria-label={`${account.displayName}: account active`}
                  onCheckedChange={(checked) => {
                    if (checked) update.mutate({ user: account, change: { status: 'active' } });
                    else setConfirming({ kind: 'disable', user: account });
                  }}
                  data-testid="account-status"
                />
              </div>
              {isSelf ? (
                <p className="app-note admin-row__note">
                  You cannot change your own role or disable your own account. Another administrator
                  can.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {confirming?.kind === 'promote' ? (
        <ConfirmDialog
          title={`Make ${confirming.user.displayName} an administrator?`}
          message="Administrators can open and manage every document, change accounts, create invitations and restore snapshots."
          confirmLabel="Make administrator"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            update.mutate({ user: confirming.user, change: { role: 'admin' } });
            setConfirming(null);
          }}
        />
      ) : null}
      {confirming?.kind === 'disable' ? (
        <ConfirmDialog
          danger
          title={`Disable ${confirming.user.displayName}’s account?`}
          message="They are signed out everywhere, lose their live connections and cannot sign in until the account is enabled again. Their document memberships are kept for when it is. Share links they hold keep working, because links are not tied to accounts."
          confirmLabel="Disable account"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            update.mutate({ user: confirming.user, change: { status: 'disabled' } });
            setConfirming(null);
          }}
          data-testid="disable-confirm"
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- invitations */

const INVITATION_TONE: Record<Invitation['state'], Tone> = {
  pending: 'info',
  accepted: 'success',
  expired: 'neutral',
  revoked: 'danger',
};
const INVITATION_LABEL: Record<Invitation['state'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Revoked',
};

function CreateInvitationForm({
  onCreated,
}: {
  onCreated: (invitation: Invitation, url: string) => void;
}) {
  const limits = useLimits();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [hours, setHours] = useState(DEFAULT_INVITATION_EXPIRY_HOURS);
  const [emailError, setEmailError] = useState<string | undefined>();

  const create = useMutation({
    mutationFn: api.invitations.create,
    onSuccess: (response) => {
      setEmail('');
      setRole('member');
      onCreated(response.invitation, response.url);
    },
    onError: (failure) => {
      const issue = fieldIssues(failure).email;
      if (issue) setEmailError(issue);
      else {
        toast.show({
          tone: 'danger',
          title: 'Could not create the invitation',
          description: failureText(failure),
        });
      }
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (create.isPending) return;
    const trimmed = email.trim();
    if (trimmed !== '' && !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setEmailError('Enter a complete email address, or leave the field empty.');
      return;
    }
    create.mutate({
      ...(trimmed ? { email: trimmed } : {}),
      role,
      expiresInHours: hours,
    });
  };

  return (
    <form
      className="admin-invite-form"
      onSubmit={submit}
      noValidate
      data-testid="create-invitation-form"
    >
      <TextField
        className="admin-invite-form__email"
        label="Email (optional)"
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={limits.emailMaxLength}
        hint="With an address, the account is created for exactly that address. Without one, the person chooses."
        value={email}
        error={emailError}
        onChange={(event) => {
          setEmail(event.target.value);
          setEmailError(undefined);
        }}
        data-testid="invitation-email"
      />
      <Select
        label="Role"
        value={role}
        options={ROLE_OPTIONS}
        onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}
        data-testid="invitation-role"
      />
      <Select
        label="Valid for"
        value={String(hours)}
        options={INVITATION_EXPIRY_OPTIONS.map((option) => ({
          value: String(option.hours),
          label: option.label,
        }))}
        onValueChange={(value) => setHours(Number(value))}
        data-testid="invitation-expiry"
      />
      <Button
        type="submit"
        variant="primary"
        iconLeft={<MailPlus />}
        loading={create.isPending}
        className="admin-invite-form__submit"
      >
        Create invitation
      </Button>
      {role === 'admin' ? (
        <Banner tone="warning" className="admin-invite-form__warning">
          Whoever accepts this invitation becomes an administrator and can open and manage every
          document.
        </Banner>
      ) : null}
    </form>
  );
}

function InvitationRow({
  invitation,
  onRevoke,
}: {
  invitation: Invitation;
  onRevoke: (invitation: Invitation) => void;
}) {
  const now = useNow();
  return (
    <li className="app-row admin-row" data-testid="invitation-row" data-state={invitation.state}>
      <div className="app-row__text">
        <span className="app-row__title">
          {invitation.email ?? 'Anyone with the link'}
          <Badge
            tone={INVITATION_TONE[invitation.state]}
            className="admin-you"
            data-testid="invitation-state"
          >
            {INVITATION_LABEL[invitation.state]}
          </Badge>
          <WorkspaceRoleBadge role={invitation.role} className="admin-you" />
        </span>
        <span className="app-facts">
          {invitation.state === 'accepted' && invitation.acceptedAt ? (
            <span>
              <RelativeTime prefix="Accepted" value={invitation.acceptedAt} />
              {invitation.acceptedByName ? ` by ${invitation.acceptedByName}` : ''}
            </span>
          ) : invitation.state === 'revoked' ? (
            <span>No longer usable</span>
          ) : (
            <span title={formatDateTime(invitation.expiresAt)}>
              {formatExpiry(invitation.expiresAt, now)}
            </span>
          )}
          <span>
            Created <RelativeTime value={invitation.createdAt} />
            {invitation.createdByName ? ` by ${invitation.createdByName}` : ''}
          </span>
        </span>
      </div>
      <div className="app-row__actions">
        {invitation.state === 'pending' ? (
          <Button size="sm" onClick={() => onRevoke(invitation)} data-testid="revoke-invitation">
            Revoke
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function InvitationsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const invitations = useQuery({
    queryKey: queryKeys.invitations,
    queryFn: () => api.invitations.list(),
  });
  // The full link exists only here, right after creation.
  const [fresh, setFresh] = useState<{ url: string; email: string | null } | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  // The button that created the invitation keeps its place, but the new link
  // appears below it: move focus there so it is not missed.
  const freshRef = useRef<HTMLDivElement>(null);
  const freshUrl = fresh?.url;
  useEffect(() => {
    if (freshUrl) freshRef.current?.focus();
  }, [freshUrl]);

  const setList = (update: (current: Invitation[]) => Invitation[]): void => {
    queryClient.setQueryData<InvitationsResponse>(queryKeys.invitations, (current) =>
      current ? { invitations: update(current.invitations) } : current,
    );
  };

  return (
    <>
      <p className="app-page-lede admin-lede">
        An invitation link lets one person create an account here. It gives no access to any
        document: once they have joined, add them from a document’s Share panel. RealtimeDocs does
        not send email, so copy the link and send it yourself.
      </p>

      <CreateInvitationForm
        onCreated={(invitation, url) => {
          setList((current) => [invitation, ...current]);
          setFresh({ url, email: invitation.email });
        }}
      />

      {fresh ? (
        <div
          ref={freshRef}
          className="app-once admin-new-invitation"
          data-testid="new-invitation"
          role="group"
          aria-label="New invitation link"
          tabIndex={-1}
        >
          <p className="app-once__title">
            Invitation created{fresh.email ? ` for ${fresh.email}` : ''}. Copy the link now
          </p>
          <CopyField
            label="Invitation link"
            value={fresh.url}
            masked
            data-testid="new-invitation-url"
            hint="This is the only time the full link is shown. RealtimeDocs keeps a fingerprint of it, not the link itself. If it gets lost, revoke this invitation and create a new one."
          />
          <div>
            <Button size="sm" onClick={() => setFresh(null)} data-testid="new-invitation-done">
              Done
            </Button>
          </div>
        </div>
      ) : null}

      <h2 className="admin-subheading">Sent invitations</h2>
      {invitations.isError && !invitations.data ? (
        <ErrorView
          error={invitations.error}
          onRetry={() => void invitations.refetch()}
          retrying={invitations.isFetching}
        />
      ) : !invitations.data ? (
        <ListSkeleton />
      ) : invitations.data.invitations.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          icon={<MailPlus />}
          title="No invitations yet"
          description="Create one above for each person who needs an account."
          data-testid="invitations-empty"
        />
      ) : (
        <ul className="app-rows admin-list" aria-label="Invitations" data-testid="invitations-list">
          {invitations.data.invitations.map((invitation) => (
            <InvitationRow key={invitation.id} invitation={invitation} onRevoke={setRevoking} />
          ))}
        </ul>
      )}

      {revoking ? (
        <ConfirmDialog
          danger
          title="Revoke this invitation?"
          message={`The invitation link${revoking.email ? ` for ${revoking.email}` : ''} stops working. Nothing else changes: no account is removed and no document access is affected.`}
          confirmLabel="Revoke invitation"
          onCancel={() => setRevoking(null)}
          onConfirm={async () => {
            try {
              await api.invitations.revoke(revoking.id);
            } catch (error) {
              throw new Error(failureText(error), { cause: error });
            }
            setList((current) =>
              current.map((each) =>
                each.id === revoking.id ? { ...each, state: 'revoked' } : each,
              ),
            );
            setRevoking(null);
            toast.show({ title: 'Invitation revoked' });
            void queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
          }}
          data-testid="revoke-invitation-confirm"
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- audit */

function describeTarget(event: AuditEvent): string | null {
  if (!event.targetType) return null;
  return event.targetId ? `${event.targetType} ${event.targetId}` : event.targetType;
}

function AuditTab() {
  const audit = useQuery({ queryKey: queryKeys.audit, queryFn: () => api.audit.list(100) });

  if (audit.isError && !audit.data) {
    return (
      <ErrorView
        error={audit.error}
        onRetry={() => void audit.refetch()}
        retrying={audit.isFetching}
      />
    );
  }
  if (!audit.data) return <ListSkeleton />;
  if (audit.data.events.length === 0) {
    return (
      <EmptyState
        compact
        headingLevel={2}
        icon={<ScrollText />}
        title="Nothing recorded yet"
        description="Sign-ins, sharing changes, account changes and snapshot restores appear here."
      />
    );
  }

  return (
    <>
      <p className="app-page-lede admin-lede">
        The latest {audit.data.events.length} administrative and security events. The log records
        who did what and when. It never contains document text, passwords or link secrets.
      </p>
      <div className="admin-audit" role="region" aria-label="Audit log" tabIndex={0}>
        <table className="admin-table" data-testid="audit-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Action</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {audit.data.events.map((event) => {
              const target = describeTarget(event);
              const details = Object.entries(event.details);
              return (
                <tr key={event.id}>
                  <td className="app-tabular">
                    <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                  </td>
                  <td>
                    {event.actorName ??
                      (event.actorKind === 'system'
                        ? 'System'
                        : event.actorKind === 'guest'
                          ? 'Guest'
                          : 'Unknown')}
                    {event.actorName && event.actorKind === 'guest' ? ' (guest)' : ''}
                  </td>
                  <td>
                    <code>{event.action}</code>
                  </td>
                  <td>
                    {target ? <span className="admin-audit__target">{target}</span> : null}
                    {details.map(([key, value]) => (
                      <span key={key} className="admin-audit__detail">
                        {key}: {String(value)}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- page */

function isTab(value: string | null): value is AdminTab {
  return value === 'accounts' || value === 'invitations' || value === 'audit';
}

export function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: AdminTab = isTab(requested) ? requested : 'accounts';
  useDocumentTitle(`People: ${TABS.find((each) => each.id === tab)?.label ?? 'Accounts'}`);

  // The tab row answers at once; the address, and with it the panel, follows.
  const [shownTab, showTab] = useEagerValue(tab);
  const setTab = (next: AdminTab): void => {
    showTab(next);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === 'accounts') params.delete('tab');
      else params.set('tab', next);
      return params;
    });
  };

  return (
    <AdminOnly>
      <header className="app-page-header">
        <h1 className="app-page-title">People</h1>
      </header>
      <Tabs
        id={TABS_ID}
        ariaLabel="People sections"
        tabs={TABS}
        value={shownTab}
        onValueChange={setTab}
      />
      <TabPanel id={tab} tabsId={TABS_ID} tabIndex={-1} className="admin-panel">
        {tab === 'accounts' ? <AccountsTab /> : null}
        {tab === 'invitations' ? <InvitationsTab /> : null}
        {tab === 'audit' ? <AuditTab /> : null}
      </TabPanel>
    </AdminOnly>
  );
}
