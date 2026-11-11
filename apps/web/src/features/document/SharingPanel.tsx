/**
 * Sharing panel (administrators).
 *
 * Two independent ways to give access, shown as two sections on purpose:
 *   - People: accounts of this workspace added to the document as editor or viewer.
 *   - Share links: links that open the document without an account.
 * Revoking a link never removes a person and removing a person never affects
 * a link. A third section lists who has the document open right now.
 *
 * Everything shown comes from `GET /api/documents/:id/access`, refreshed
 * while the panel is open. A share link's full URL exists only in this
 * component's state, right after the link is created or rotated.
 */
import type {
  AccessListResponse,
  DocumentRole,
  DocumentSummary,
  Member,
  ShareGrant,
  User,
} from '@realtimedocs/contracts';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  CopyField,
  Dialog,
  DropdownMenu,
  IconButton,
  MenuItem,
  MenuSeparator,
  SegmentedControl,
  Select,
  Skeleton,
  TextField,
  useToast,
} from '@realtimedocs/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Ellipsis, Link2, Pencil, Plus, RefreshCw, RotateCw, UserMinus } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { ErrorView } from '../../components/ErrorScreen';
import { useRouterLink } from '../../components/links';
import { RelativeTime } from '../../components/RelativeTime';
import { GrantBadge, RoleBadge } from '../../components/RoleBadge';
import { PanelSection, SidePanel } from '../../components/SidePanel';
import { api } from '../../lib/api';
import { errorMessage, requestIdOf } from '../../lib/errors';
import {
  computeExpiry,
  DEFAULT_EXPIRY_PRESET,
  EXPIRY_PRESETS,
  type ExpiryPreset,
  toDatetimeLocalValue,
} from '../../lib/expiry';
import { useNow } from '../../lib/hooks';
import { documentRoleLabel } from '../../lib/permissions';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime, formatExpiry } from '../../lib/time';
import { useLimits } from '../../lib/useLimits';

const ACCESS_REFRESH_MS = 15_000;

const ROLE_OPTIONS: readonly { value: DocumentRole; label: string }[] = [
  { value: 'viewer', label: 'View only' },
  { value: 'editor', label: 'Can edit' },
];

function failureText(error: unknown): string {
  const requestId = requestIdOf(error);
  return requestId ? `${errorMessage(error)} Reference ${requestId}` : errorMessage(error);
}

/** For `ConfirmDialog`, which prints the message of a rejected promise. */
function asDialogError(error: unknown): Error {
  return new Error(failureText(error), { cause: error });
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* ------------------------------------------------------------- people */

function AddMemberForm({
  documentId,
  members,
  onChanged,
}: {
  documentId: string;
  members: Member[];
  onChanged: (members: Member[]) => void;
}) {
  const toast = useToast();
  const people = useRouterLink('/admin/users');
  const users = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users.list() });
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<DocumentRole>('viewer');
  const [error, setError] = useState<string | undefined>();

  const add = useMutation({
    mutationFn: (input: { user: User; role: DocumentRole }) =>
      api.members.set(documentId, input.user.id, { role: input.role }),
    onSuccess: (response, input) => {
      onChanged(response.members);
      setUserId('');
      toast.show({
        title: `Added ${input.user.displayName}`,
        description:
          input.role === 'editor' ? 'They can edit this document.' : 'They can view this document.',
      });
    },
    onError: (failure) => {
      toast.show({
        tone: 'danger',
        title: 'Could not add the person',
        description: failureText(failure),
      });
    },
  });

  if (users.isError) {
    return (
      <p className="app-note" role="alert">
        The list of accounts could not be loaded. {errorMessage(users.error)}{' '}
        <button type="button" className="rd-link" onClick={() => void users.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  if (!users.data) return <Skeleton height={32} />;

  const memberIds = new Set(members.map((member) => member.userId));
  const candidates = users.data.users.filter(
    (user) => user.status === 'active' && !memberIds.has(user.id),
  );
  if (candidates.length === 0) {
    return (
      <p className="app-note">
        Every active account already has access to this document.{' '}
        <a className="rd-link" href={people.href} onClick={people.onClick}>
          Invite someone new
        </a>
      </p>
    );
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const user = candidates.find((candidate) => candidate.id === userId);
    if (!user) {
      setError('Choose an account.');
      return;
    }
    add.mutate({ user, role });
  };

  return (
    <form className="share-add" onSubmit={submit} noValidate data-testid="add-member-form">
      <Select
        className="share-add__person"
        label="Add a person"
        placeholder="Choose an account"
        value={userId}
        error={error}
        onValueChange={(value) => {
          setUserId(value);
          setError(undefined);
        }}
        options={candidates.map((user) => ({
          value: user.id,
          label:
            user.role === 'admin'
              ? `${user.displayName} (${user.email}), administrator`
              : `${user.displayName} (${user.email})`,
        }))}
        data-testid="add-member-select"
      />
      <div className="share-add__row">
        <SegmentedControl
          ariaLabel="Access for the new person"
          size="sm"
          options={ROLE_OPTIONS}
          value={role}
          onValueChange={setRole}
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={add.isPending}
          iconLeft={<Plus />}
        >
          Add
        </Button>
      </div>
    </form>
  );
}

function MemberRow({
  documentId,
  member,
  onChanged,
}: {
  documentId: string;
  member: Member;
  onChanged: (members: Member[]) => void;
}) {
  const toast = useToast();

  const setRole = useMutation({
    mutationFn: (role: DocumentRole) => api.members.set(documentId, member.userId, { role }),
    onSuccess: (response, role) => {
      onChanged(response.members);
      toast.show({
        title: `${member.displayName}: ${documentRoleLabel(role).toLowerCase()}`,
        description:
          role === 'viewer'
            ? 'If they have the document open, it is read-only for them now.'
            : undefined,
      });
    },
    onError: (failure) => {
      toast.show({
        tone: 'danger',
        title: 'Could not change access',
        description: failureText(failure),
      });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.members.remove(documentId, member.userId),
    onSuccess: (response) => {
      onChanged(response.members);
      toast.show({
        title: `Removed ${member.displayName}`,
        description: 'Share links are not affected.',
        action: {
          label: 'Undo',
          onClick: () => {
            void api.members.set(documentId, member.userId, { role: member.role }).then(
              (restored) => onChanged(restored.members),
              (failure: unknown) =>
                toast.show({
                  tone: 'danger',
                  title: 'Could not add the person back',
                  description: failureText(failure),
                }),
            );
          },
        },
      });
    },
    onError: (failure) => {
      toast.show({
        tone: 'danger',
        title: 'Could not remove the person',
        description: failureText(failure),
      });
    },
  });

  return (
    <li className="app-row" data-testid="member-row" data-user-id={member.userId}>
      <div className="app-row__main">
        <Avatar name={member.displayName} size="md" aria-hidden="true" />
        <div className="app-row__text">
          <span className="app-row__title">{member.displayName}</span>
          <span className="app-row__meta app-row__meta--line" title={member.email}>
            {member.userStatus === 'disabled' ? 'Account disabled. ' : ''}
            {member.email}
          </span>
        </div>
      </div>
      <div className="app-row__actions">
        <Select
          size="sm"
          label={`Access for ${member.displayName}`}
          hideLabel
          value={member.role}
          disabled={setRole.isPending || remove.isPending}
          onValueChange={(value) => {
            if (value === 'viewer' || value === 'editor') setRole.mutate(value);
          }}
          options={ROLE_OPTIONS}
        />
        <IconButton
          label={`Remove ${member.displayName}`}
          tooltip="Remove"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <UserMinus />
        </IconButton>
      </div>
    </li>
  );
}

/* --------------------------------------------------------- share links */

interface ExpiryFieldsProps {
  preset: ExpiryPreset | 'keep';
  custom: string;
  error?: string;
  /** Shown as the first option when editing an existing link. */
  keepLabel?: string;
  onPreset: (preset: ExpiryPreset | 'keep') => void;
  onCustom: (value: string) => void;
}

function ExpiryFields({ preset, custom, error, keepLabel, onPreset, onCustom }: ExpiryFieldsProps) {
  const options = [
    ...(keepLabel ? [{ value: 'keep', label: keepLabel }] : []),
    ...EXPIRY_PRESETS.map((option) => ({ value: option.value, label: option.label })),
  ];
  return (
    <>
      <Select
        label="Expires"
        value={preset}
        options={options}
        onValueChange={(value) => onPreset(value as ExpiryPreset | 'keep')}
        data-testid="share-expiry"
      />
      {preset === 'custom' ? (
        <TextField
          label="Expiry date and time"
          type="datetime-local"
          min={toDatetimeLocalValue(new Date())}
          value={custom}
          error={error}
          hint="In your local time zone."
          onChange={(event) => onCustom(event.target.value)}
          data-testid="share-expiry-custom"
        />
      ) : null}
    </>
  );
}

function EditAccessWarning() {
  return (
    <Banner tone="warning" data-testid="edit-link-warning">
      Anyone who gets this link can change the document. Send it only to people who should edit.
    </Banner>
  );
}

function CreateLinkForm({
  documentId,
  onCreated,
  onCancel,
}: {
  documentId: string;
  onCreated: (share: ShareGrant, url: string) => void;
  onCancel: () => void;
}) {
  const limits = useLimits();
  const toast = useToast();
  // View-only is the default; edit access is an explicit choice.
  const [role, setRole] = useState<DocumentRole>('viewer');
  const [label, setLabel] = useState('');
  const [preset, setPreset] = useState<ExpiryPreset>(DEFAULT_EXPIRY_PRESET);
  const [custom, setCustom] = useState('');
  const [expiryError, setExpiryError] = useState<string | undefined>();

  const create = useMutation({
    mutationFn: (expiresAt: string | null) =>
      api.shares.create(documentId, { role, label: label.trim(), expiresAt }),
    onSuccess: (response) => onCreated(response.share, response.url),
    onError: (failure) => {
      toast.show({
        tone: 'danger',
        title: 'Could not create the link',
        description: failureText(failure),
      });
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (create.isPending) return;
    const expiry = computeExpiry(preset, new Date(), custom);
    if (!expiry.ok) {
      setExpiryError(expiry.error);
      return;
    }
    create.mutate(expiry.expiresAt);
  };

  return (
    <form className="share-form" onSubmit={submit} noValidate data-testid="create-link-form">
      <div className="share-form__group">
        <span className="rd-field__label" aria-hidden="true">
          Access
        </span>
        <SegmentedControl
          ariaLabel="Access for the new link"
          fullWidth
          options={ROLE_OPTIONS}
          value={role}
          onValueChange={setRole}
          data-testid="share-role"
        />
      </div>
      {role === 'editor' ? <EditAccessWarning /> : null}
      <TextField
        label="Label (optional)"
        hint="Only administrators see it. Useful for remembering who the link is for."
        maxLength={limits.shareLabelMaxLength}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        data-testid="share-label"
      />
      <ExpiryFields
        preset={preset}
        custom={custom}
        error={expiryError}
        onPreset={(value) => {
          if (value !== 'keep') setPreset(value);
          setExpiryError(undefined);
        }}
        onCustom={(value) => {
          setCustom(value);
          setExpiryError(undefined);
        }}
      />
      <div className="app-form__actions">
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          data-testid="create-link-submit"
        >
          Create link
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EditLinkDialog({
  share,
  onSaved,
  onClose,
}: {
  share: ShareGrant;
  onSaved: (share: ShareGrant) => void;
  onClose: () => void;
}) {
  const limits = useLimits();
  const now = useNow();
  const expired = share.state === 'expired';
  const [role, setRole] = useState<DocumentRole>(share.role);
  const [label, setLabel] = useState(share.label);
  // An expired link is opened here to make it work again, so a new expiry is preselected.
  const [preset, setPreset] = useState<ExpiryPreset | 'keep'>(
    expired ? DEFAULT_EXPIRY_PRESET : 'keep',
  );
  const [custom, setCustom] = useState('');
  const [expiryError, setExpiryError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (changes: Parameters<typeof api.shares.update>[2]) =>
      api.shares.update(share.documentId, share.id, changes),
    onSuccess: (response) => {
      onSaved(response.share);
      onClose();
    },
    onError: (error) => setFailure(failureText(error)),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (save.isPending) return;
    const changes: Parameters<typeof api.shares.update>[2] = {};
    if (role !== share.role) changes.role = role;
    if (label.trim() !== share.label) changes.label = label.trim();
    if (preset !== 'keep') {
      const expiry = computeExpiry(preset, new Date(), custom);
      if (!expiry.ok) {
        setExpiryError(expiry.error);
        return;
      }
      changes.expiresAt = expiry.expiresAt;
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setFailure(null);
    save.mutate(changes);
  };

  return (
    <Dialog
      open
      size="sm"
      title={expired ? 'Extend share link' : 'Edit share link'}
      description={
        expired
          ? 'This link has expired. With a new expiry it works again under the same address, for everyone who still has it.'
          : 'Changes apply at once, including for people who have the document open through this link.'
      }
      dismissible={!save.isPending}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      data-testid="edit-link-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="edit-share-link" loading={save.isPending}>
            {expired ? 'Extend link' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="edit-share-link" className="share-form" onSubmit={submit} noValidate>
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <div className="share-form__group">
          <span className="rd-field__label" aria-hidden="true">
            Access
          </span>
          <SegmentedControl
            ariaLabel="Access for this link"
            fullWidth
            options={ROLE_OPTIONS}
            value={role}
            onValueChange={setRole}
          />
        </div>
        {role === 'editor' && share.role !== 'editor' ? <EditAccessWarning /> : null}
        <TextField
          label="Label (optional)"
          maxLength={limits.shareLabelMaxLength}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <ExpiryFields
          preset={preset}
          custom={custom}
          error={expiryError}
          keepLabel={
            expired
              ? undefined
              : `Keep current (${formatExpiry(share.expiresAt, now).toLowerCase()})`
          }
          onPreset={(value) => {
            setPreset(value);
            setExpiryError(undefined);
          }}
          onCustom={(value) => {
            setCustom(value);
            setExpiryError(undefined);
          }}
        />
      </form>
    </Dialog>
  );
}

/** The one moment a share link's full URL is visible. */
function NewLinkCallout({
  url,
  rotated,
  onDone,
}: {
  url: string;
  rotated: boolean;
  onDone: () => void;
}) {
  // The button that created the link is gone; put focus on what replaced it.
  const calloutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    calloutRef.current?.focus();
  }, [url]);
  return (
    <div
      ref={calloutRef}
      className="app-once"
      data-testid="new-share-link"
      role="group"
      aria-label="New share link"
      tabIndex={-1}
    >
      <p className="app-once__title">
        {rotated ? 'Link rotated. Copy the new link now' : 'Link created. Copy it now'}
      </p>
      <CopyField
        label="Share link"
        value={url}
        masked
        data-testid="new-share-url"
        hint="This is the only time the full link is shown. RealtimeDocs keeps a fingerprint of it, not the link itself, so it cannot be shown again. If it gets lost, rotate the link to get a new one."
      />
      <div>
        <Button size="sm" onClick={onDone} data-testid="new-share-done">
          Done
        </Button>
      </div>
    </div>
  );
}

const STATE_TONE = { active: 'success', expired: 'neutral', revoked: 'danger' } as const;
const STATE_LABEL = { active: 'Active', expired: 'Expired', revoked: 'Revoked' } as const;

function ShareRow({
  share,
  onEdit,
  onRotate,
  onRevoke,
}: {
  share: ShareGrant;
  onEdit: (share: ShareGrant) => void;
  onRotate: (share: ShareGrant) => void;
  onRevoke: (share: ShareGrant) => void;
}) {
  const now = useNow();
  const active = share.state === 'active';
  const expired = share.state === 'expired';
  const name = share.label || 'Unlabelled link';
  return (
    <li
      className="share-link"
      data-testid="share-row"
      data-share-id={share.id}
      data-share-state={share.state}
    >
      <div className="share-link__head">
        <span className="share-link__name" title={name}>
          {name}
        </span>
        <span className="share-link__badges">
          <Badge tone={STATE_TONE[share.state]} data-testid="share-state">
            {STATE_LABEL[share.state]}
          </Badge>
          <GrantBadge role={share.role} />
        </span>
        {active || expired ? (
          <DropdownMenu
            placement="bottom-end"
            trigger={
              <IconButton
                size="sm"
                label={`Actions for ${name}`}
                tooltip="Actions"
                data-testid="share-actions"
              >
                <Ellipsis />
              </IconButton>
            }
          >
            <MenuItem icon={<Pencil />} onSelect={() => onEdit(share)}>
              {expired ? 'Extend or edit' : 'Edit access and expiry'}
            </MenuItem>
            {active ? (
              <MenuItem icon={<RotateCw />} onSelect={() => onRotate(share)}>
                Rotate link
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem icon={<Ban />} danger onSelect={() => onRevoke(share)}>
              Revoke link
            </MenuItem>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="app-facts">
        {share.state === 'revoked' && share.revokedAt ? (
          <RelativeTime prefix="Revoked" value={share.revokedAt} />
        ) : (
          <span title={share.expiresAt ? formatDateTime(share.expiresAt) : undefined}>
            {formatExpiry(share.expiresAt, now)}
          </span>
        )}
        {share.lastUsedAt ? (
          <RelativeTime prefix="Last used" value={share.lastUsedAt} />
        ) : (
          <span>Never used</span>
        )}
        {active ? (
          <>
            <span>{plural(share.activeSessions, 'session', 'sessions')}</span>
            <span data-live={share.liveConnections > 0 ? '' : undefined}>
              {share.liveConnections} connected now
            </span>
          </>
        ) : null}
      </div>
      <div className="app-facts share-link__origin">
        <span>
          Created <RelativeTime value={share.createdAt} />
          {share.createdByName ? ` by ${share.createdByName}` : ''}
        </span>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- panel */

export interface SharingPanelProps {
  document: DocumentSummary;
  onClose: () => void;
}

export function SharingPanel({ document, onClose }: SharingPanelProps) {
  const documentId = document.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const accessKey = queryKeys.access(documentId);

  const access = useQuery({
    queryKey: accessKey,
    queryFn: () => api.documents.accessList(documentId),
    refetchInterval: ACCESS_REFRESH_MS,
  });

  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ url: string; rotated: boolean } | null>(null);
  const [editing, setEditing] = useState<ShareGrant | null>(null);
  const [rotating, setRotating] = useState<ShareGrant | null>(null);
  const [revoking, setRevoking] = useState<ShareGrant | null>(null);

  const patch = (update: (current: AccessListResponse) => AccessListResponse): void => {
    queryClient.setQueryData<AccessListResponse>(accessKey, (current) =>
      current ? update(current) : current,
    );
  };
  const setMembers = (members: Member[]): void => patch((current) => ({ ...current, members }));
  const upsertShare = (share: ShareGrant): void =>
    patch((current) => ({
      ...current,
      shares: current.shares.some((each) => each.id === share.id)
        ? current.shares.map((each) => (each.id === share.id ? share : each))
        : [share, ...current.shares],
    }));
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: accessKey });
  };

  let content: ReactNode;
  if (access.isError && !access.data) {
    content = (
      <ErrorView
        error={access.error}
        compact
        title="Sharing could not be loaded"
        onRetry={() => void access.refetch()}
        retrying={access.isFetching}
        headingLevel={3}
      />
    );
  } else if (!access.data) {
    content = (
      <div className="app-panel-section" aria-hidden="true" data-testid="sharing-loading">
        <Skeleton height={14} width="40%" />
        <Skeleton lines={3} style={{ marginTop: 14 }} />
        <Skeleton height={32} style={{ marginTop: 18 }} />
      </div>
    );
  } else {
    const { members, shares, live } = access.data;
    const activeShares = shares.filter((share) => share.state === 'active');
    const inactiveShares = shares.filter((share) => share.state !== 'active');
    content = (
      <>
        <PanelSection
          title="People"
          description="Accounts in this workspace that you added to this document. Administrators can always open and manage every document."
          data-testid="members-section"
        >
          <AddMemberForm documentId={documentId} members={members} onChanged={setMembers} />
          {members.length > 0 ? (
            <ul className="app-rows share-members" aria-label="People with access">
              {members.map((member) => (
                <MemberRow
                  key={member.userId}
                  documentId={documentId}
                  member={member}
                  onChanged={setMembers}
                />
              ))}
            </ul>
          ) : (
            <p className="app-note share-empty">
              Nobody has been added yet. Until then only administrators and people with a share link
              can open this document.
            </p>
          )}
        </PanelSection>

        <PanelSection
          title="Share links"
          description="A link opens this document for anyone who has it, without an account. Links are view-only unless you choose otherwise, and they are independent of the people above."
          data-testid="shares-section"
          aside={
            creating ? null : (
              <Button
                size="sm"
                iconLeft={<Link2 />}
                onClick={() => {
                  setFresh(null);
                  setCreating(true);
                }}
                data-testid="new-link"
              >
                New link
              </Button>
            )
          }
        >
          {fresh ? (
            <NewLinkCallout url={fresh.url} rotated={fresh.rotated} onDone={() => setFresh(null)} />
          ) : null}
          {creating ? (
            <CreateLinkForm
              documentId={documentId}
              onCancel={() => setCreating(false)}
              onCreated={(share, url) => {
                upsertShare(share);
                setCreating(false);
                setFresh({ url, rotated: false });
              }}
            />
          ) : null}
          {activeShares.length > 0 ? (
            <ul className="share-links" aria-label="Active share links">
              {activeShares.map((share) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  onEdit={setEditing}
                  onRotate={setRotating}
                  onRevoke={setRevoking}
                />
              ))}
            </ul>
          ) : creating || fresh ? null : (
            <p className="app-note share-empty">
              No active links. Create one to let someone read this document without an account.
            </p>
          )}
          {inactiveShares.length > 0 ? (
            <details className="share-inactive" data-testid="inactive-links">
              <summary>
                Expired and revoked links{' '}
                <span className="app-tabular">({inactiveShares.length})</span>
              </summary>
              <ul className="share-links" aria-label="Expired and revoked share links">
                {inactiveShares.map((share) => (
                  <ShareRow
                    key={share.id}
                    share={share}
                    onEdit={setEditing}
                    onRotate={setRotating}
                    onRevoke={setRevoking}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </PanelSection>

        <PanelSection
          title="Open right now"
          description="Everyone connected to this document at the moment, as reported by the server."
          data-testid="live-section"
          aside={
            <IconButton
              size="sm"
              label="Refresh"
              disabled={access.isFetching}
              onClick={() => void access.refetch()}
            >
              <RefreshCw />
            </IconButton>
          }
        >
          <div className="app-facts share-summary" data-testid="access-summary">
            <span>{plural(live.length, 'connection', 'connections')}</span>
            <span>{plural(members.length, 'person added', 'people added')}</span>
            <span>{plural(activeShares.length, 'active link', 'active links')}</span>
          </div>
          {live.length > 0 ? (
            <ul className="app-rows" aria-label="Connected now">
              {live.map((participant) => (
                <li key={participant.id} className="app-row" data-testid="live-participant">
                  <div className="app-row__main">
                    <Avatar
                      name={participant.name}
                      color={participant.color}
                      size="md"
                      aria-hidden="true"
                    />
                    <div className="app-row__text">
                      <span className="app-row__title">{participant.name}</span>
                      <span className="app-row__meta">
                        {participant.kind === 'guest'
                          ? 'Guest through a share link'
                          : 'Signed-in account'}
                      </span>
                    </div>
                  </div>
                  <div className="app-row__actions">
                    <RoleBadge role={participant.role} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-note share-empty">Nobody has the document open right now.</p>
          )}
        </PanelSection>
      </>
    );
  }

  return (
    <SidePanel
      title="Share"
      description={`Who can open “${document.title}”.`}
      onClose={onClose}
      data-testid="sharing-panel"
    >
      {content}

      {editing ? (
        <EditLinkDialog
          share={editing}
          onClose={() => setEditing(null)}
          onSaved={(share) => {
            const revived = editing.state === 'expired' && share.state === 'active';
            upsertShare(share);
            toast.show({
              title: revived ? 'Link extended' : 'Link updated',
              description: revived ? 'It works again under the same address.' : undefined,
            });
          }}
        />
      ) : null}

      {rotating ? (
        <ConfirmDialog
          title="Rotate this link?"
          message="The current link stops working at once and anyone using it is disconnected. You get a new link with the same access and expiry to send out."
          confirmLabel="Rotate link"
          onCancel={() => setRotating(null)}
          onConfirm={async () => {
            try {
              const response = await api.shares.rotate(documentId, rotating.id);
              upsertShare(response.share);
              setCreating(false);
              setFresh({ url: response.url, rotated: true });
              setRotating(null);
              refresh();
            } catch (error) {
              throw asDialogError(error);
            }
          }}
          data-testid="rotate-confirm"
        />
      ) : null}

      {revoking ? (
        <ConfirmDialog
          danger
          title="Revoke this link?"
          message={
            revoking.state === 'expired'
              ? 'The link has already expired; revoking makes that final, so it can no longer be extended. Revoking cannot take back what people have already seen, copied or downloaded. Other links and the people you added keep their access.'
              : 'The link stops working immediately and everyone using it right now is disconnected. Revoking stops future access. It cannot take back what people have already seen, copied or downloaded. Other links and the people you added keep their access.'
          }
          confirmLabel="Revoke link"
          onCancel={() => setRevoking(null)}
          onConfirm={async () => {
            try {
              const response = await api.shares.revoke(documentId, revoking.id);
              upsertShare(response.share);
              setRevoking(null);
              toast.show({
                title: 'Link revoked',
                // Nobody was using a link that had already expired.
                description:
                  revoking.state === 'expired' ? undefined : 'People using it were disconnected.',
              });
              refresh();
            } catch (error) {
              throw asDialogError(error);
            }
          }}
          data-testid="revoke-confirm"
        />
      ) : null}
    </SidePanel>
  );
}
