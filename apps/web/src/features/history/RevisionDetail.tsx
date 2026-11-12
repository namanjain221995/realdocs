/**
 * One revision: who, when (server clocks), what changed, what it looked like,
 * and what an administrator can do with it.
 */
import type { DocumentSummary, HistoryRevisionResponse } from '@realtimedocs/contracts';
import {
  Banner,
  Button,
  ConfirmDialog,
  copyText,
  Dialog,
  DropdownMenu,
  IconButton,
  Link,
  MenuItem,
  Skeleton,
  TabPanel,
  Tabs,
  TextField,
  useToast,
  VisuallyHidden,
} from '@realtimedocs/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, FileDown, History, Pencil, Undo2 } from 'lucide-react';
import { type FormEvent, lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { useRouterLink } from '../../components/links';
import { api } from '../../lib/api';
import { errorMessage, requestIdOf } from '../../lib/errors';
import { documentPath } from '../../lib/navigation';
import { queryKeys } from '../../lib/queryKeys';
import {
  collapseDiff,
  formatIsoMs,
  formatSizeDelta,
  operationLabel,
  pasteBasis,
  restoredVersionName,
  roleLabel,
  shortId,
  summaryParts,
} from './model';

const RevisionPreview = lazy(() => import('./RevisionPreview'));

export const historyKey = (documentId: string) =>
  [...queryKeys.document(documentId), 'history'] as const;

function failureText(error: unknown): string {
  const requestId = requestIdOf(error);
  return requestId ? `${errorMessage(error)} Reference ${requestId}` : errorMessage(error);
}

function CopyId({ label, value }: { label: string; value: string | null }) {
  const toast = useToast();
  if (!value) return <span aria-label={`${label}: none`}>{'—'}</span>;
  return (
    <span className="hist-id">
      <code title={value}>{shortId(value)}</code>
      <IconButton
        size="sm"
        label={`Copy ${label}`}
        onClick={() =>
          void copyText(value).then((copied) =>
            toast.show({ title: copied ? `${label} copied` : `Could not copy the ${label}` }),
          )
        }
      >
        <Copy />
      </IconButton>
    </span>
  );
}

function DiffView({ revision }: { revision: HistoryRevisionResponse }) {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const changed = revision.diff.some((line) => line.op !== 'equal');
  const note = revision.diffTruncated ? (
    <Banner tone="warning" data-testid="diff-truncated">
      This document is very large, so only the beginning of the comparison is shown.
    </Banner>
  ) : null;
  if (!changed) {
    return (
      <>
        {note}
        <p className="app-note" data-testid="diff-empty">
          No text changed in this revision. It may have changed formatting, page settings or
          attachments only; formatting is not shown in this view.
        </p>
      </>
    );
  }
  const items = collapseDiff(revision.diff);
  return (
    <>
      {note}
      <ol className="hist-diff" aria-label="Text changes of this revision" data-testid="diff">
        {items.map((item) => {
          if (item.type === 'gap') {
            if (opened.has(item.index)) {
              return item.lines.map((line) => (
                <li key={line.index} className="hist-diff__line" data-op="equal">
                  <span className="hist-diff__mark" aria-hidden="true" />
                  <span className="hist-diff__text">{line.text || ' '}</span>
                </li>
              ));
            }
            return (
              <li key={`gap-${item.index}`} className="hist-diff__gap">
                <button
                  type="button"
                  onClick={() => setOpened((current) => new Set(current).add(item.index))}
                >
                  Show {item.count} unchanged {item.count === 1 ? 'line' : 'lines'}
                </button>
              </li>
            );
          }
          const mark = item.op === 'insert' ? '+' : item.op === 'delete' ? '−' : '';
          return (
            <li key={item.index} className="hist-diff__line" data-op={item.op}>
              <span className="hist-diff__mark" aria-hidden="true">
                {mark}
              </span>
              {item.op === 'equal' ? null : (
                <VisuallyHidden>{item.op === 'insert' ? 'Added: ' : 'Removed: '}</VisuallyHidden>
              )}
              <span className="hist-diff__text">{item.text || ' '}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function NameDialog({
  documentId,
  revision,
  onClose,
}: {
  documentId: string;
  revision: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const formId = useId();
  const mutation = useMutation({
    mutationFn: (value: string) => api.history.name(documentId, revision, { name: value }),
    onSuccess: ({ snapshot }) => {
      toast.show({ tone: 'success', title: `Named revision ${revision} “${snapshot.name}”` });
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(documentId) });
      void queryClient.invalidateQueries({ queryKey: [...historyKey(documentId), 'list'] });
      onClose();
    },
    onError: (failure) => setError(failureText(failure)),
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Give this version a name.');
      return;
    }
    mutation.mutate(trimmed);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      dismissible={!mutation.isPending}
      title="Name this version"
      description={`Keeps revision ${revision} as a named version you can find and restore later.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={mutation.isPending}>
            Save name
          </Button>
        </>
      }
      data-testid="name-dialog"
    >
      <form id={formId} onSubmit={submit} noValidate>
        <TextField
          label="Name"
          placeholder="Candidate’s first working solution"
          maxLength={120}
          autoComplete="off"
          value={name}
          error={error}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          data-testid="version-name"
        />
      </form>
    </Dialog>
  );
}

export interface RevisionDetailProps {
  document: DocumentSummary;
  revision: number;
  /** Narrow screens show this pane on its own and need a way back. */
  onBack: () => void;
  focusOnOpen: boolean;
}

export function RevisionDetail({ document, revision, onBack, focusOnOpen }: RevisionDetailProps) {
  const documentId = document.id;
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'changes' | 'preview'>('changes');
  const [naming, setNaming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [copy, setCopy] = useState<{ documentId: string; title: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const query = useQuery({
    queryKey: [...historyKey(documentId), 'revision', revision],
    queryFn: () => api.history.revision(documentId, revision),
    staleTime: Infinity,
  });
  const data = query.data;

  useEffect(() => {
    if (data && focusOnOpen) headingRef.current?.focus();
  }, [data, focusOnOpen]);
  useEffect(() => setCopy(null), [revision]);

  const copyMutation = useMutation({
    mutationFn: () => api.history.copy(documentId, revision),
    onSuccess: (created) => {
      setCopy(created);
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentLists });
      toast.show({ tone: 'success', title: `Restored revision ${revision} as a copy` });
    },
    onError: (failure) =>
      toast.show({
        tone: 'danger',
        title: 'Could not make the copy',
        description: failureText(failure),
      }),
  });

  const copyLink = useRouterLink(copy ? documentPath(copy.documentId) : '/');
  const active = document.status === 'active';

  if (query.isError && !data) {
    return (
      <ErrorView
        error={query.error}
        compact
        headingLevel={2}
        title="This revision could not be loaded"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        data-testid="revision-error"
      />
    );
  }
  if (!data) {
    return (
      <div aria-busy="true" data-testid="revision-loading">
        <VisuallyHidden role="status">Loading revision {revision}</VisuallyHidden>
        <Skeleton height={28} />
        <Skeleton lines={4} style={{ marginTop: 18 }} />
      </div>
    );
  }

  const { entry } = data;
  const basis = pasteBasis(entry);
  const parts = summaryParts(entry);

  const restore = async (): Promise<void> => {
    try {
      const { snapshot } = await api.history.name(documentId, revision, {
        name: restoredVersionName(entry),
      });
      const restored = await api.snapshots.restore(documentId, snapshot.id);
      queryClient.setQueryData(queryKeys.document(documentId), { document: restored.document });
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(documentId) });
      void queryClient.invalidateQueries({ queryKey: historyKey(documentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentLists });
      toast.show({
        tone: 'success',
        title: `Restored revision ${revision}`,
        description: `The previous content was kept as “${restored.preRestoreSnapshot.name}”.`,
        durationMs: 9000,
      });
    } catch (error) {
      throw new Error(failureText(error), { cause: error });
    }
    setRestoring(false);
    void navigate(documentPath(documentId));
  };

  return (
    <article
      className="hist-detail"
      aria-labelledby="hist-detail-title"
      data-testid="revision-detail"
    >
      <Button
        variant="ghost"
        size="sm"
        iconLeft={<ArrowLeft />}
        className="hist-back"
        onClick={onBack}
        data-testid="history-back"
      >
        Back to timeline
      </Button>
      <h2 id="hist-detail-title" className="hist-detail__title" ref={headingRef} tabIndex={-1}>
        Revision {entry.revision}
        <span className="hist-detail__op">
          {' '}
          {'·'} {operationLabel(entry.operation)}
        </span>
      </h2>
      {parts.length > 0 ? <p className="hist-detail__summary">{parts.join(' · ')}</p> : null}
      {basis ? <p className="app-note">{basis}.</p> : null}

      <dl className="hist-facts" data-testid="revision-facts">
        <div>
          <dt>Changed by</dt>
          <dd>
            {entry.actor.name} {'—'} {roleLabel(entry.actor)}
          </dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>
            <CopyId label="session id" value={entry.actor.sessionId} />
          </dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd>
            <CopyId label="connection id" value={entry.actor.connectionId} />
          </dd>
        </div>
        <div>
          <dt>Received by the server</dt>
          <dd>
            <time dateTime={entry.receivedAt}>{formatIsoMs(entry.receivedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Committed by the server</dt>
          <dd>
            <time dateTime={entry.committedAt}>{formatIsoMs(entry.committedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Client time</dt>
          <dd>
            {entry.clientOccurredAt ? (
              <>
                <time dateTime={entry.clientOccurredAt}>{formatIsoMs(entry.clientOccurredAt)}</time>{' '}
                <span className="app-note">reported by the client, not verified</span>
              </>
            ) : (
              <span className="app-note">not reported</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Size change</dt>
          <dd>{formatSizeDelta(entry.contentSizeDelta)}</dd>
        </div>
        <div>
          <dt>Generation</dt>
          <dd>{entry.generation}</dd>
        </div>
      </dl>

      <div className="hist-actions" role="group" aria-label="Actions for this revision">
        <Button iconLeft={<Pencil />} onClick={() => setNaming(true)} data-testid="name-version">
          Name this version{'…'}
        </Button>
        <Button
          variant="primary"
          iconLeft={<History />}
          disabled={!active}
          onClick={() => setRestoring(true)}
          data-testid="restore-version"
        >
          Restore this version{'…'}
        </Button>
        <Button
          iconLeft={<Undo2 />}
          loading={copyMutation.isPending}
          onClick={() => copyMutation.mutate()}
          data-testid="restore-copy"
        >
          Restore as a copy
        </Button>
        <DropdownMenu
          placement="bottom-start"
          trigger={
            <Button iconLeft={<Download />} data-testid="download-revision">
              Download
            </Button>
          }
        >
          <MenuItem
            icon={<FileDown />}
            href={api.history.revisionExportUrl(documentId, revision, 'json')}
            download
          >
            Revision as JSON
          </MenuItem>
          <MenuItem
            icon={<FileDown />}
            href={api.history.revisionExportUrl(documentId, revision, 'markdown')}
            download
          >
            Revision as Markdown
          </MenuItem>
          <MenuItem
            icon={<FileDown />}
            href={api.history.revisionExportUrl(documentId, revision, 'text')}
            download
          >
            Revision as plain text
          </MenuItem>
        </DropdownMenu>
      </div>
      {active ? null : (
        <p className="app-note">Unarchive the document to restore a version of it.</p>
      )}
      {copy ? (
        <Banner tone="success" data-testid="copy-banner">
          Created “{copy.title}”.{' '}
          <Link href={copyLink.href} onClick={copyLink.onClick}>
            Open the copy
          </Link>
        </Banner>
      ) : null}

      <Tabs
        ariaLabel="Revision view"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'changes', label: 'Changes' },
          { id: 'preview', label: 'Preview' },
        ]}
      >
        <TabPanel id="changes">
          <DiffView revision={data} />
        </TabPanel>
        <TabPanel id="preview">
          <p className="app-note">The document as it was after this revision. Read only.</p>
          <Suspense fallback={<Skeleton lines={5} />}>
            <RevisionPreview documentId={documentId} content={data.content} />
          </Suspense>
        </TabPanel>
      </Tabs>

      {naming ? (
        <NameDialog documentId={documentId} revision={revision} onClose={() => setNaming(false)} />
      ) : null}
      {restoring ? (
        <ConfirmDialog
          danger
          size="md"
          title={`Restore revision ${revision}?`}
          message="The document goes back to this revision for everyone who has it open."
          confirmLabel="Restore this version"
          onCancel={() => setRestoring(false)}
          onConfirm={restore}
          data-testid="restore-version-confirm"
        >
          <ul className="hist-restore-list">
            <li>
              The content as it is now is kept first as an automatic snapshot, so this restore can
              be reversed.
            </li>
            <li>
              Nothing in the history is deleted: the restore becomes a new entry and every earlier
              revision stays.
            </li>
            <li>
              Everyone who has the document open is reconnected and then sees the restored content.
            </li>
          </ul>
        </ConfirmDialog>
      ) : null}
    </article>
  );
}
