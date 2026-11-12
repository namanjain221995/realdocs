/**
 * `/d/:documentId/history`: the version history of a document, for people who
 * manage it. Timeline on the left, the chosen revision on the right; on a
 * phone the revision is its own view with a way back.
 *
 * The server decides who may read history (manage rights); this page only
 * explains the refusal.
 */
import './history.css';
import { type DocumentSummary, type HistoryOperation, isUuid } from '@realtimedocs/contracts';
import {
  Banner,
  Button,
  DropdownMenu,
  EmptyState,
  MenuItem,
  Select,
  Skeleton,
  TextField,
  VisuallyHidden,
} from '@realtimedocs/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileDown, History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { RouterLinkButton } from '../../components/links';
import { api } from '../../lib/api';
import { useDebouncedValue, useDocumentTitle, useMediaQuery } from '../../lib/hooks';
import { documentPath } from '../../lib/navigation';
import { documentCapabilities } from '../../lib/permissions';
import { queryKeys } from '../../lib/queryKeys';
import { useSession } from '../../lib/session';
import { dayBoundsIso, groupTimeline, interleave, OPERATION_OPTIONS, timeZoneName } from './model';
import { historyKey, RevisionDetail } from './RevisionDetail';
import { Timeline } from './Timeline';

const PAGE_SIZE = 50;

interface Filters {
  actor: string;
  operation: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { actor: '', operation: '', from: '', to: '' };

function HistoryScreen({ document }: { document: DocumentSummary }) {
  const { id: documentId, title, status } = document;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const actor = useDebouncedValue(filters.actor.trim(), 300);
  const [params, setParams] = useSearchParams();
  const narrow = useMediaQuery('(max-width: 768px)');
  const timelineRef = useRef<HTMLDivElement>(null);

  const revisionParam = params.get('rev');
  const selected =
    revisionParam && /^[1-9][0-9]{0,15}$/.test(revisionParam) ? Number(revisionParam) : null;

  const from = dayBoundsIso(filters.from, 'start');
  const to = dayBoundsIso(filters.to, 'end');
  const query = useMemo(
    () => ({
      ...(actor ? { actor } : {}),
      ...(filters.operation ? { operation: filters.operation as HistoryOperation } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [actor, filters.operation, from, to],
  );
  const filtered = Object.keys(query).length > 0;

  const list = useInfiniteQuery({
    queryKey: [...historyKey(documentId), 'list', query],
    queryFn: ({ pageParam }) =>
      api.history.list(documentId, { ...query, limit: PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    placeholderData: keepPreviousData,
  });

  const pages = useMemo(() => list.data?.pages ?? [], [list.data]);
  const firstEvents = pages[0]?.events;
  const entries = useMemo(() => pages.flatMap((page) => page.entries), [pages]);
  const hasMore = list.hasNextPage;
  const retentionDays = pages[0]?.retentionDays ?? 0;
  const days = useMemo(() => {
    // Administrative events are not filtered by the server. They are shown on the unfiltered
    // timeline and, for a date range, only inside it; an editor or operation filter hides them.
    const events =
      query.actor || query.operation
        ? []
        : (firstEvents ?? []).filter((event) => {
            const at = Date.parse(event.at);
            return (!from || at >= Date.parse(from)) && (!to || at <= Date.parse(to));
          });
    return groupTimeline(interleave(entries, events, hasMore));
  }, [entries, firstEvents, hasMore, query.actor, query.operation, from, to]);
  const zone = useMemo(() => timeZoneName(Date.now()), []);

  const select = (revision: number): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('rev', String(revision));
      return next;
    });
  };
  const back = (): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('rev');
        return next;
      },
      { replace: true },
    );
  };

  // Returning to the timeline on a phone puts focus back on the row that was open.
  const wasSelected = useRef<number | null>(null);
  useEffect(() => {
    if (wasSelected.current !== null && selected === null && narrow) {
      timelineRef.current
        ?.querySelector<HTMLElement>(`[data-revision="${wasSelected.current}"]`)
        ?.focus();
    }
    wasSelected.current = selected;
  }, [selected, narrow]);

  useDocumentTitle(`Version history – ${title}`);
  const update = (patch: Partial<Filters>): void =>
    setFilters((current) => ({ ...current, ...patch }));

  let timeline;
  if (list.isError && !list.data) {
    timeline = (
      <ErrorView
        error={list.error}
        compact
        headingLevel={3}
        title="The history could not be loaded"
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        data-testid="history-error"
      />
    );
  } else if (!list.data) {
    timeline = (
      <div aria-hidden="true" data-testid="history-loading">
        <Skeleton height={20} style={{ width: '40%' }} />
        <Skeleton lines={5} style={{ marginTop: 16 }} />
      </div>
    );
  } else if (entries.length === 0 && days.length === 0) {
    timeline = (
      <EmptyState
        compact
        headingLevel={3}
        icon={<History />}
        title={filtered ? 'No changes match these filters' : 'No recorded changes yet'}
        description={
          filtered
            ? 'Change or clear the filters to see more of the history.'
            : 'Changes appear here as people edit the document.'
        }
        action={
          filtered ? (
            <Button onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>
          ) : undefined
        }
        data-testid="history-empty"
      />
    );
  } else {
    timeline = (
      <>
        <Timeline days={days} selected={selected} onSelect={select} />
        {hasMore ? (
          <div className="hist-more">
            <Button
              onClick={() => void list.fetchNextPage()}
              loading={list.isFetchingNextPage}
              data-testid="history-load-more"
            >
              Load more
            </Button>
          </div>
        ) : (
          <p className="app-note hist-end">That is the start of the recorded history.</p>
        )}
      </>
    );
  }

  const status_ =
    list.isPending || list.isPlaceholderData
      ? 'Loading history'
      : list.isFetchingNextPage
        ? 'Loading more history'
        : `${entries.length} changes loaded`;

  return (
    <div className="hist" data-testid="history-page">
      <div className="app-page-header">
        <div>
          <h1 className="app-page-title">Version history</h1>
          <p className="app-page-lede">
            Who changed “{title}”, and when. Times come from the server and are shown in {zone}.
          </p>
        </div>
        <div className="app-page-actions">
          <RouterLinkButton to={documentPath(documentId)} variant="ghost" iconLeft={<ArrowLeft />}>
            Back to document
          </RouterLinkButton>
          <DropdownMenu
            placement="bottom-end"
            trigger={
              <Button iconLeft={<Download />} data-testid="export-audit">
                Export audit trail
              </Button>
            }
          >
            <MenuItem icon={<FileDown />} href={api.history.exportUrl(documentId, 'csv')} download>
              Audit trail as CSV
            </MenuItem>
            <MenuItem icon={<FileDown />} href={api.history.exportUrl(documentId, 'json')} download>
              Audit trail as JSON
            </MenuItem>
          </DropdownMenu>
        </div>
      </div>
      {status === 'active' ? null : (
        <Banner tone="info">
          This document is {status}. You can read its history and copy a revision, but not restore
          it.
        </Banner>
      )}

      <div className="hist-layout" data-detail={selected !== null ? 'open' : 'closed'}>
        <section
          className="hist-pane hist-pane--timeline"
          aria-labelledby="hist-timeline-title"
          ref={timelineRef}
        >
          <h2 id="hist-timeline-title" className="hist-pane__title">
            Timeline
          </h2>
          <VisuallyHidden role="status">{status_}</VisuallyHidden>
          <form
            className="hist-filters"
            role="search"
            aria-label="Filter the history"
            onSubmit={(e) => e.preventDefault()}
          >
            <TextField
              label="Editor"
              placeholder="Name"
              autoComplete="off"
              value={filters.actor}
              onChange={(event) => update({ actor: event.target.value })}
              data-testid="filter-actor"
            />
            <Select
              label="Operation"
              value={filters.operation}
              onValueChange={(operation) => update({ operation })}
              data-testid="filter-operation"
            >
              <option value="">Any operation</option>
              {OPERATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <TextField
              label="From"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => update({ from: event.target.value })}
              data-testid="filter-from"
            />
            <TextField
              label="To"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => update({ to: event.target.value })}
              data-testid="filter-to"
            />
            {filtered || filters.actor ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters(NO_FILTERS)}
                data-testid="filter-clear"
              >
                Clear filters
              </Button>
            ) : null}
          </form>
          {retentionDays > 0 ? (
            <p className="app-note" data-testid="retention-note">
              History is kept for {retentionDays} {retentionDays === 1 ? 'day' : 'days'}; older
              entries are removed automatically.
            </p>
          ) : null}
          {timeline}
        </section>

        <section className="hist-pane hist-pane--detail" aria-label="Revision">
          {selected !== null ? (
            <RevisionDetail
              key={selected}
              document={document}
              revision={selected}
              onBack={back}
              focusOnOpen={narrow}
            />
          ) : (
            <p className="hist-placeholder app-muted" data-testid="history-no-selection">
              Choose a change in the timeline to see what it did.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { documentId = '' } = useParams();
  const { user } = useSession();
  const valid = isUuid(documentId);
  const query = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => api.documents.get(documentId),
    enabled: valid,
  });
  useDocumentTitle('Version history');

  if (!valid) {
    return (
      <ErrorView
        kind="not_found"
        subject="document"
        headingLevel={1}
        data-testid="history-not-found"
      />
    );
  }
  if (query.isError && !query.data) {
    return (
      <ErrorView
        error={query.error}
        subject="document"
        headingLevel={1}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (!query.data) {
    return (
      <div aria-busy="true" data-testid="history-loading-page">
        <VisuallyHidden role="status">Loading</VisuallyHidden>
        <Skeleton height={32} style={{ width: '50%' }} />
        <Skeleton lines={5} style={{ marginTop: 24 }} />
      </div>
    );
  }
  const { document } = query.data;
  if (!documentCapabilities(document, user).canManage) {
    return (
      <ErrorView
        kind="forbidden"
        headingLevel={1}
        title="Version history is for administrators"
        description="Only people who manage this document can see who changed it and when. Ask an administrator if you need that."
        actions={
          <RouterLinkButton to={documentPath(document.id)} variant="primary">
            Back to the document
          </RouterLinkButton>
        }
        data-testid="history-forbidden"
      />
    );
  }
  return <HistoryScreen document={document} />;
}
