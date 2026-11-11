/**
 * Snapshots panel (administrators): keep the document as it is now under a
 * name, and restore or delete earlier snapshots.
 *
 * Restoring is the one action here that changes the document for everyone, so
 * its confirmation spells out what a restore does: a new generation starts
 * from the snapshot, connected people are reconnected, and work that had not
 * reached the server is not merged but kept by its author as a recovery draft.
 */
import type { DocumentSummary, Snapshot, SnapshotsResponse } from '@realtimedocs/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Skeleton,
  TextField,
  useToast,
} from '@realtimedocs/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { ErrorView } from '../../components/ErrorScreen';
import { RelativeTime } from '../../components/RelativeTime';
import { PanelSection, SidePanel } from '../../components/SidePanel';
import { api } from '../../lib/api';
import { errorMessage, requestIdOf } from '../../lib/errors';
import { queryKeys } from '../../lib/queryKeys';
import { formatBytes } from '../../lib/time';
import { useLimits } from '../../lib/useLimits';

function failureText(error: unknown): string {
  const requestId = requestIdOf(error);
  return requestId ? `${errorMessage(error)} Reference ${requestId}` : errorMessage(error);
}

function snapshotName(snapshot: Snapshot): string {
  return (
    snapshot.name || (snapshot.kind === 'pre_restore' ? 'Before restore' : 'Untitled snapshot')
  );
}

function CreateSnapshotForm({
  documentId,
  disabled,
  onCreated,
}: {
  documentId: string;
  disabled: boolean;
  onCreated: (snapshot: Snapshot) => void;
}) {
  const limits = useLimits();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: (snapshotLabel: string) =>
      api.snapshots.create(documentId, { name: snapshotLabel }),
    onSuccess: ({ snapshot }) => {
      setName('');
      onCreated(snapshot);
      toast.show({ tone: 'success', title: `Saved snapshot “${snapshotName(snapshot)}”` });
    },
    onError: (failure) => {
      toast.show({
        tone: 'danger',
        title: 'Could not save the snapshot',
        description: failureText(failure),
      });
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (create.isPending) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Give the snapshot a name.');
      inputRef.current?.focus();
      return;
    }
    create.mutate(trimmed);
  };

  return (
    <form className="snap-create" onSubmit={submit} noValidate data-testid="create-snapshot-form">
      <TextField
        ref={inputRef}
        className="snap-create__name"
        label="Name"
        placeholder="Before the legal review"
        maxLength={limits.snapshotNameMaxLength}
        autoComplete="off"
        value={name}
        error={error}
        disabled={disabled}
        onChange={(event) => {
          setName(event.target.value);
          setError(undefined);
        }}
        data-testid="snapshot-name"
      />
      <Button type="submit" variant="primary" loading={create.isPending} disabled={disabled}>
        Save snapshot
      </Button>
    </form>
  );
}

function RestoreDialog({
  snapshot,
  onRestore,
  onClose,
}: {
  snapshot: Snapshot;
  onRestore: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      // Changes the document for everyone: Cancel has the focus.
      danger
      size="md"
      title={`Restore “${snapshotName(snapshot)}”?`}
      message="The document goes back to this snapshot for everyone."
      confirmLabel="Restore snapshot"
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await onRestore();
        } catch (error) {
          throw new Error(failureText(error), { cause: error });
        }
      }}
      data-testid="restore-confirm"
    >
      <div className="snap-restore">
        <p>Restoring starts a new generation of the document from this snapshot. That means:</p>
        <ul>
          <li>
            The content as it is now is saved first as an automatic snapshot, so this restore can be
            reversed.
          </li>
          <li>
            Everyone who has the document open is reconnected and then sees the restored content.
          </li>
          <li>
            Changes that had not reached the server, for example from someone editing offline, are
            not merged in and are not discarded. They stay on that person’s device as a recovery
            draft, which they can open from Settings.
          </li>
        </ul>
      </div>
    </ConfirmDialog>
  );
}

function SnapshotRow({
  snapshot,
  currentGeneration,
  canRestore,
  onRestore,
  onDelete,
}: {
  snapshot: Snapshot;
  currentGeneration: number;
  canRestore: boolean;
  onRestore: (snapshot: Snapshot) => void;
  onDelete: (snapshot: Snapshot) => void;
}) {
  const name = snapshotName(snapshot);
  return (
    <li
      className="snap-row"
      data-testid="snapshot-row"
      data-snapshot-id={snapshot.id}
      data-kind={snapshot.kind}
    >
      <div className="snap-row__head">
        <span className="snap-row__name" title={name}>
          {name}
        </span>
        {snapshot.kind === 'pre_restore' ? (
          <Badge tone="info" title="Saved automatically just before a restore">
            Automatic
          </Badge>
        ) : null}
      </div>
      <div className="app-facts">
        <span>
          <RelativeTime prefix="Saved" value={snapshot.createdAt} />
          {snapshot.createdByName ? ` by ${snapshot.createdByName}` : ''}
        </span>
        <span>{formatBytes(snapshot.sizeBytes)}</span>
        <span
          title={
            snapshot.generation === currentGeneration
              ? 'Taken in the current generation of the document'
              : 'Taken before a restore: each restore starts a new generation'
          }
        >
          Generation {snapshot.generation}
        </span>
      </div>
      <div className="snap-row__actions">
        <Button
          size="sm"
          iconLeft={<History />}
          disabled={!canRestore}
          onClick={() => onRestore(snapshot)}
          data-testid="snapshot-restore"
        >
          Restore
        </Button>
        <IconButton
          size="sm"
          variant="danger"
          label={`Delete snapshot ${name}`}
          tooltip="Delete"
          onClick={() => onDelete(snapshot)}
          data-testid="snapshot-delete"
        >
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

export interface SnapshotsPanelProps {
  document: DocumentSummary;
  onClose: () => void;
}

export function SnapshotsPanel({ document, onClose }: SnapshotsPanelProps) {
  const documentId = document.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const listKey = queryKeys.snapshots(documentId);
  const archived = document.status !== 'active';

  const list = useQuery({ queryKey: listKey, queryFn: () => api.snapshots.list(documentId) });
  const [restoring, setRestoring] = useState<Snapshot | null>(null);
  const [deleting, setDeleting] = useState<Snapshot | null>(null);

  const setSnapshots = (update: (snapshots: Snapshot[]) => Snapshot[]): void => {
    queryClient.setQueryData<SnapshotsResponse>(listKey, (current) =>
      current ? { snapshots: update(current.snapshots) } : current,
    );
  };
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: listKey });
  };

  const restore = async (snapshot: Snapshot): Promise<void> => {
    const response = await api.snapshots.restore(documentId, snapshot.id);
    queryClient.setQueryData(queryKeys.document(documentId), { document: response.document });
    setSnapshots((snapshots) => [
      response.preRestoreSnapshot,
      ...snapshots.filter((each) => each.id !== response.preRestoreSnapshot.id),
    ]);
    setRestoring(null);
    toast.show({
      tone: 'success',
      title: `Restored “${snapshotName(snapshot)}”`,
      description: `The previous content was kept as “${snapshotName(response.preRestoreSnapshot)}”.`,
      durationMs: 9000,
    });
    refresh();
    void queryClient.invalidateQueries({ queryKey: queryKeys.documentLists });
  };

  let content: ReactNode;
  if (list.isError && !list.data) {
    content = (
      <ErrorView
        error={list.error}
        compact
        title="Snapshots could not be loaded"
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        headingLevel={3}
      />
    );
  } else if (!list.data) {
    content = (
      <div className="app-panel-section" aria-hidden="true" data-testid="snapshots-loading">
        <Skeleton height={32} />
        <Skeleton lines={3} style={{ marginTop: 18 }} />
      </div>
    );
  } else {
    const snapshots = list.data.snapshots;
    content = (
      <>
        <PanelSection
          title="Save a snapshot"
          description="A snapshot keeps the document exactly as it is now, including its images. Editing continues as usual."
        >
          {archived ? (
            <p className="app-note">
              This document is archived. Unarchive it to save new snapshots or to restore one.
            </p>
          ) : null}
          <CreateSnapshotForm
            documentId={documentId}
            disabled={archived}
            onCreated={(snapshot) => setSnapshots((current) => [snapshot, ...current])}
          />
        </PanelSection>
        <PanelSection
          title="Saved snapshots"
          description="Named snapshots and the automatic ones taken just before each restore."
          data-testid="snapshots-section"
        >
          {snapshots.length === 0 ? (
            <EmptyState
              compact
              headingLevel={4}
              icon={<History />}
              title="No snapshots yet"
              description="Save one before a big change, so there is a known state to return to."
              data-testid="snapshots-empty"
            />
          ) : (
            <ul className="snap-list" aria-label="Saved snapshots">
              {snapshots.map((snapshot) => (
                <SnapshotRow
                  key={snapshot.id}
                  snapshot={snapshot}
                  currentGeneration={document.generation}
                  canRestore={!archived}
                  onRestore={setRestoring}
                  onDelete={setDeleting}
                />
              ))}
            </ul>
          )}
        </PanelSection>
      </>
    );
  }

  return (
    <SidePanel
      title="Snapshots"
      description={`Saved states of “${document.title}”.`}
      onClose={onClose}
      data-testid="snapshots-panel"
    >
      {content}

      {restoring ? (
        <RestoreDialog
          snapshot={restoring}
          onClose={() => setRestoring(null)}
          onRestore={() => restore(restoring)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          danger
          title={`Delete snapshot “${snapshotName(deleting)}”?`}
          message="The snapshot is removed for good and can no longer be restored. The document itself does not change."
          confirmLabel="Delete snapshot"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.snapshots.remove(documentId, deleting.id);
            } catch (error) {
              throw new Error(failureText(error), { cause: error });
            }
            setSnapshots((snapshots) => snapshots.filter((each) => each.id !== deleting.id));
            setDeleting(null);
            toast.show({ title: 'Snapshot deleted' });
            refresh();
          }}
          data-testid="delete-snapshot-confirm"
        />
      ) : null}
    </SidePanel>
  );
}
