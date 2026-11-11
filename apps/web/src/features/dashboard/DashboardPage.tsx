import './dashboard.css';
import type { DocumentListView, DocumentSummary } from '@realtimedocs/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  MenuItem,
  MenuSeparator,
  Skeleton,
  TabPanel,
  Tabs,
  TextField,
} from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Clock,
  Copy,
  Ellipsis,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { useRouterLink } from '../../components/links';
import { RelativeTime } from '../../components/RelativeTime';
import { RoleBadge } from '../../components/RoleBadge';
import { api } from '../../lib/api';
import { byLatestChange, latestChange } from '../../lib/documentOrder';
import { useDebouncedValue, useDocumentTitle, useEagerValue, useNow } from '../../lib/hooks';
import { documentPath } from '../../lib/navigation';
import { dashboardViews, type DocumentAction, documentActions } from '../../lib/permissions';
import { queryKeys } from '../../lib/queryKeys';
import { useSession } from '../../lib/session';
import { formatDateTime, formatRelativeTime, toEpochMs } from '../../lib/time';
import { useLimits } from '../../lib/useLimits';
import { type StatusChange, useDocumentActions } from './useDocumentActions';

const VIEW_LABELS: Record<DocumentListView, string> = {
  active: 'Active',
  recent: 'Recent',
  archived: 'Archived',
  trash: 'Trash',
};

const TABS_ID = 'dashboard-views';
const SEARCH_DEBOUNCE_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

function isView(
  value: string | null,
  allowed: readonly DocumentListView[],
): value is DocumentListView {
  return value !== null && (allowed as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ rows */

function RowWhen({ document, view }: { document: DocumentSummary; view: DocumentListView }) {
  const now = useNow();
  if (view === 'trash') {
    if (document.purgeAfter) {
      const purgeAt = toEpochMs(document.purgeAfter);
      const soon = purgeAt - now < 3 * DAY_MS;
      return (
        <span
          className="dash-row__when"
          data-urgent={soon ? '' : undefined}
          title={`Deleted permanently on ${formatDateTime(purgeAt)}`}
        >
          {purgeAt > now
            ? `Deleted permanently ${formatRelativeTime(purgeAt, now)}`
            : 'Due to be deleted permanently'}
        </span>
      );
    }
    return document.trashedAt ? (
      <RelativeTime className="dash-row__when" prefix="Trashed" value={document.trashedAt} />
    ) : null;
  }
  if (view === 'archived' && document.archivedAt) {
    return (
      <RelativeTime className="dash-row__when" prefix="Archived" value={document.archivedAt} />
    );
  }
  // The same clock the list is ordered by: the text, or the title or state after it.
  const change = latestChange(document);
  return (
    <RelativeTime
      className="dash-row__when"
      prefix={change.kind === 'content' ? 'Edited' : 'Updated'}
      value={change.at}
    />
  );
}

interface RowHandlers {
  /** Opens the rename dialog. */
  onRename: (document: DocumentSummary) => void;
  /** Opens the confirmation for permanent deletion. */
  onDelete: (document: DocumentSummary) => void;
  onDuplicate: (document: DocumentSummary) => void;
  onChangeStatus: (document: DocumentSummary, change: StatusChange) => void;
}

function RowMenu({
  document,
  actions,
  handlers,
}: {
  document: DocumentSummary;
  actions: DocumentAction[];
  handlers: RowHandlers;
}) {
  const open = useRouterLink(documentPath(document.id));
  const items: Record<DocumentAction, ReactNode> = {
    open: (
      <MenuItem key="open" href={open.href} onClick={open.onClick} icon={<FileText />}>
        Open
      </MenuItem>
    ),
    rename: (
      <MenuItem key="rename" icon={<Pencil />} onSelect={() => handlers.onRename(document)}>
        Rename
      </MenuItem>
    ),
    duplicate: (
      <MenuItem key="duplicate" icon={<Copy />} onSelect={() => handlers.onDuplicate(document)}>
        Duplicate
      </MenuItem>
    ),
    archive: (
      <MenuItem
        key="archive"
        icon={<Archive />}
        onSelect={() => handlers.onChangeStatus(document, 'archive')}
      >
        Archive
      </MenuItem>
    ),
    unarchive: (
      <MenuItem
        key="unarchive"
        icon={<ArchiveRestore />}
        onSelect={() => handlers.onChangeStatus(document, 'unarchive')}
      >
        Unarchive
      </MenuItem>
    ),
    trash: (
      <MenuItem
        key="trash"
        icon={<Trash2 />}
        danger
        onSelect={() => handlers.onChangeStatus(document, 'trash')}
      >
        Move to trash
      </MenuItem>
    ),
    restore: (
      <MenuItem
        key="restore"
        icon={<RotateCcw />}
        onSelect={() => handlers.onChangeStatus(document, 'restore')}
      >
        Restore
      </MenuItem>
    ),
    delete: (
      <MenuItem key="delete" icon={<Trash2 />} danger onSelect={() => handlers.onDelete(document)}>
        Delete permanently
      </MenuItem>
    ),
  };
  const isDestructive = (action: DocumentAction): boolean =>
    action === 'trash' || action === 'delete';
  const destructive = actions.filter(isDestructive);
  const regular = actions.filter((action) => !isDestructive(action));
  return (
    <DropdownMenu
      placement="bottom-end"
      trigger={
        <IconButton
          label={`Actions for ${document.title}`}
          tooltip="Actions"
          data-testid="row-actions"
        >
          <Ellipsis />
        </IconButton>
      }
    >
      {regular.map((action) => items[action])}
      {regular.length > 0 && destructive.length > 0 ? <MenuSeparator /> : null}
      {destructive.map((action) => items[action])}
    </DropdownMenu>
  );
}

function DocumentRow({
  document,
  view,
  handlers,
}: {
  document: DocumentSummary;
  view: DocumentListView;
  handlers: RowHandlers;
}) {
  const { user } = useSession();
  const actions = documentActions(document.status, user);
  const canOpen = actions.includes('open');
  // The menu is for administrators; a member's only action is opening, which the title does.
  const showMenu = actions.some((action) => action !== 'open');
  return (
    <li className="dash-row" data-testid="document-row" data-document-id={document.id}>
      <div className="dash-row__title">
        {canOpen ? (
          <Link className="dash-row__link" to={documentPath(document.id)}>
            {document.title}
          </Link>
        ) : (
          <span className="dash-row__name">{document.title}</span>
        )}
      </div>
      <div className="dash-row__meta">
        <span className="dash-row__badges">
          {document.status === 'archived' && view !== 'archived' ? <Badge>Archived</Badge> : null}
          <RoleBadge role={document.access.role} />
        </span>
        <RowWhen document={document} view={view} />
      </div>
      <div className="dash-row__actions">
        {showMenu ? <RowMenu document={document} actions={actions} handlers={handlers} /> : null}
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="dash-list" aria-hidden="true" data-testid="documents-loading">
      {[62, 44, 71, 38, 55, 49].map((width) => (
        <li key={width} className="dash-row dash-row--skeleton">
          <div className="dash-row__title">
            <Skeleton width={`${width}%`} height={14} />
          </div>
          <div className="dash-row__meta">
            <span className="dash-row__badges">
              <Skeleton width={44} height={18} />
            </span>
            <span className="dash-row__when">
              <Skeleton width={120} height={12} />
            </span>
          </div>
          <div className="dash-row__actions" />
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------- empty states */

function EmptyView({
  view,
  search,
  isAdmin,
  creating,
  onCreate,
  onClearSearch,
  onShowActive,
}: {
  view: DocumentListView;
  search: string;
  isAdmin: boolean;
  creating: boolean;
  onCreate: () => void;
  onClearSearch: () => void;
  onShowActive: () => void;
}) {
  if (search !== '') {
    return (
      <EmptyState
        data-testid="documents-no-results"
        icon={<SearchX />}
        title={`No documents match “${search}”`}
        description={
          view === 'active'
            ? 'Search looks at document titles. Try fewer or different words.'
            : `Search looks at titles in ${VIEW_LABELS[view]} only. The document may be in another view.`
        }
        action={
          <>
            <Button onClick={onClearSearch}>Clear search</Button>
            {view !== 'active' ? (
              <Button variant="ghost" onClick={onShowActive}>
                Search active documents
              </Button>
            ) : null}
          </>
        }
      />
    );
  }
  switch (view) {
    case 'active':
      return isAdmin ? (
        <EmptyState
          data-testid="documents-empty"
          icon={<FileText />}
          title="No documents yet"
          description="Create the first one, then add an editor or send a view-only link from its Share panel."
          action={
            <Button variant="primary" iconLeft={<Plus />} loading={creating} onClick={onCreate}>
              New document
            </Button>
          }
        />
      ) : (
        <EmptyState
          data-testid="documents-empty"
          icon={<FileText />}
          title="Nothing has been shared with you yet"
          description="Documents appear here when an administrator adds you as an editor or a viewer."
        />
      );
    case 'recent':
      return (
        <EmptyState
          data-testid="documents-empty"
          icon={<Clock />}
          title="No recent activity"
          description="The active documents that changed most recently show up here, newest first."
        />
      );
    case 'archived':
      return (
        <EmptyState
          data-testid="documents-empty"
          icon={<Archive />}
          title="No archived documents"
          description={
            isAdmin
              ? 'Archive a finished document to make it read-only and keep it out of the active list. It can be unarchived at any time.'
              : 'Archived documents you can read appear here. They are read-only.'
          }
        />
      );
    case 'trash':
      return (
        <EmptyState
          data-testid="documents-empty"
          icon={<Trash2 />}
          title="Trash is empty"
          description="Documents moved to trash wait here and can be restored until the date shown next to them. After that they are deleted permanently."
        />
      );
  }
}

/* ------------------------------------------------------------- dialogs */

function RenameDialog({
  document,
  onRename,
  onClose,
}: {
  document: DocumentSummary;
  onRename: (title: string) => void;
  onClose: () => void;
}) {
  const limits = useLimits();
  const [title, setTitle] = useState(document.title);
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('Enter a title.');
      inputRef.current?.focus();
      return;
    }
    if (trimmed !== document.title) onRename(trimmed);
    onClose();
  };

  return (
    <Dialog
      open
      size="sm"
      title="Rename document"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      initialFocus={inputRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="rename-document-form">
            Rename
          </Button>
        </>
      }
    >
      <form id="rename-document-form" onSubmit={submit} noValidate>
        <TextField
          ref={inputRef}
          label="Title"
          name="title"
          autoComplete="off"
          maxLength={limits.titleMaxLength}
          value={title}
          error={error}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(undefined);
          }}
        />
      </form>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- page */

export function DashboardPage() {
  const { user, isAdmin } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const views = dashboardViews(user);
  const requestedView = searchParams.get('view');
  const view: DocumentListView = isView(requestedView, views) ? requestedView : 'active';
  const search = (searchParams.get('q') ?? '').trim();
  useDocumentTitle(view === 'active' ? 'Documents' : `${VIEW_LABELS[view]} documents`);

  // The address holds the search that the list shows; the field holds what is
  // being typed and writes it to the address after a pause.
  const [searchText, setSearchText] = useState(search);
  const debouncedText = useDebouncedValue(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const lastWritten = useRef(search);
  useEffect(() => {
    if (debouncedText === lastWritten.current) return;
    lastWritten.current = debouncedText;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (debouncedText === '') next.delete('q');
        else next.set('q', debouncedText);
        return next;
      },
      { replace: true },
    );
  }, [debouncedText, setSearchParams]);
  useEffect(() => {
    // Back/forward changed the address: bring the field along.
    if (search !== lastWritten.current) {
      lastWritten.current = search;
      setSearchText(search);
    }
  }, [search]);

  const list = useQuery({
    queryKey: queryKeys.documentList(view, search),
    queryFn: () => api.documents.list({ view, q: search || undefined }),
    // While typing, keep showing the previous results of the same view.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === view ? previous : undefined,
  });

  const { create, rename, changeStatus, duplicate, deletePermanently } = useDocumentActions();
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null);
  const handlers: RowHandlers = {
    onRename: setRenaming,
    onDelete: setDeleting,
    onDuplicate: (document) => duplicate.mutate(document),
    onChangeStatus: (document, change) => changeStatus.mutate({ document, change }),
  };

  // The tab row answers at once; the address, and with it the list, follows.
  const [shownView, showView] = useEagerValue(view);
  const setView = (next: DocumentListView): void => {
    showView(next);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === 'active') params.delete('view');
      else params.set('view', next);
      return params;
    });
  };
  const clearSearch = (): void => setSearchText('');

  // Active and recent lists read "last changed first"; see `lib/documentOrder.ts`.
  const listed = list.data?.documents;
  const documents = useMemo(
    () =>
      listed && (view === 'active' || view === 'recent')
        ? [...listed].sort(byLatestChange)
        : listed,
    [listed, view],
  );
  const typing = searchText.trim() !== search;
  const updating = typing || list.isPlaceholderData || (list.isFetching && documents !== undefined);

  let body: ReactNode;
  if (list.isError && documents === undefined) {
    body = (
      <ErrorView
        error={list.error}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        data-testid="documents-error"
      />
    );
  } else if (documents === undefined) {
    body = <ListSkeleton />;
  } else if (documents.length === 0) {
    body = (
      <EmptyView
        view={view}
        search={search}
        isAdmin={isAdmin}
        creating={create.isPending}
        onCreate={() => create.mutate()}
        onClearSearch={clearSearch}
        onShowActive={() => setView('active')}
      />
    );
  } else {
    body = (
      <ul
        className="dash-list"
        aria-label={`${VIEW_LABELS[view]} documents`}
        data-testid="documents-list"
        data-updating={list.isPlaceholderData ? '' : undefined}
      >
        {documents.map((document) => (
          <DocumentRow key={document.id} document={document} view={view} handlers={handlers} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <header className="dash-header">
        <h1 className="app-page-title dash-header__title">Documents</h1>
        <TextField
          className="dash-search"
          label="Search documents"
          hideLabel
          type="search"
          name="q"
          placeholder="Search by title"
          autoComplete="off"
          enterKeyHint="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          prefix={<Search aria-hidden="true" />}
          suffix={
            searchText !== '' ? (
              <IconButton size="sm" label="Clear search" tooltip={false} onClick={clearSearch}>
                <X />
              </IconButton>
            ) : undefined
          }
          data-testid="document-search"
        />
        {isAdmin ? (
          <Button
            variant="primary"
            iconLeft={<Plus />}
            loading={create.isPending}
            onClick={() => create.mutate()}
            data-testid="new-document"
            className="dash-header__new"
          >
            New document
          </Button>
        ) : null}
      </header>

      <Tabs
        id={TABS_ID}
        ariaLabel="Document views"
        tabs={views.map((each) => ({ id: each, label: VIEW_LABELS[each] }))}
        value={shownView}
        onValueChange={setView}
      />
      <TabPanel
        id={view}
        tabsId={TABS_ID}
        tabIndex={-1}
        className="dash-panel"
        aria-busy={updating}
      >
        {list.isError && documents !== undefined ? (
          <p className="dash-stale app-note" role="status">
            This list could not be refreshed and may be out of date.{' '}
            <button type="button" className="rd-link" onClick={() => void list.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        {body}
      </TabPanel>

      {renaming ? (
        <RenameDialog
          document={renaming}
          onRename={(title) => rename.mutate({ document: renaming, title })}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          danger
          title={`Delete “${deleting.title}” permanently?`}
          message="The document, its snapshots and its uploaded files are removed for good. This cannot be undone, and share links to it stop working."
          confirmLabel="Delete permanently"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deletePermanently(deleting);
            setDeleting(null);
          }}
          data-testid="delete-confirm"
        />
      ) : null}
    </>
  );
}
