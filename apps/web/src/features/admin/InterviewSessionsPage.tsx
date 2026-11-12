/** Interview sessions (administrators): filterable list with "Load more" paging. */
import './admin.css';
import './service.css';
import { type InterviewSession, type InterviewStatus } from '@realtimedocs/contracts';
import { Badge, Button, EmptyState, Select, TextField } from '@realtimedocs/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { AdminOnly } from '../../components/SignedInLayout';
import { useDocumentTitle } from '../../lib/hooks';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime } from '../../lib/time';
import { RowsSkeleton } from './ServiceParts';
import { serviceApi } from './serviceApi';
import {
  EMPTY_FILTERS,
  roundLabel,
  type SessionFilterForm,
  STATUS_LABEL,
  STATUS_TONE,
  toSessionQuery,
} from './serviceFormat';

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  ...(Object.keys(STATUS_LABEL) as InterviewStatus[]).map((value) => ({
    value,
    label: STATUS_LABEL[value],
  })),
];

function FilterForm({ onApply }: { onApply: (form: SessionFilterForm) => void }) {
  const [form, setForm] = useState<SessionFilterForm>(EMPTY_FILTERS);
  const set =
    (key: keyof SessionFilterForm) =>
    (event: { target: { value: string } }): void =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onApply(form);
  };
  return (
    <form className="service-filters" onSubmit={submit} aria-label="Filter interview sessions">
      <TextField label="Search title" value={form.q} onChange={set('q')} data-testid="filter-q" />
      <Select
        label="Status"
        options={STATUS_OPTIONS}
        value={form.status}
        onChange={set('status')}
        data-testid="filter-status"
      />
      <TextField
        label="Candidate email"
        value={form.candidate}
        onChange={set('candidate')}
        data-testid="filter-candidate"
      />
      <TextField
        label="Interviewer email"
        value={form.interviewer}
        onChange={set('interviewer')}
        data-testid="filter-interviewer"
      />
      <TextField label="Company" value={form.company} onChange={set('company')} />
      <TextField
        label="Round"
        type="number"
        min={1}
        max={99}
        value={form.round}
        onChange={set('round')}
      />
      <TextField label="From" type="date" value={form.from} onChange={set('from')} />
      <TextField label="To" type="date" value={form.to} onChange={set('to')} />
      <div className="service-filters__actions">
        <Button type="submit" variant="primary" data-testid="apply-filters">
          Apply filters
        </Button>
        <Button
          type="button"
          onClick={() => {
            setForm(EMPTY_FILTERS);
            onApply(EMPTY_FILTERS);
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

function SessionRow({ session }: { session: InterviewSession }) {
  return (
    <tr data-testid="session-row" data-session-id={session.sessionId}>
      <th scope="row">
        <Link to={`/admin/interview-sessions/${session.sessionId}`}>{session.title}</Link>
      </th>
      <td>
        <Badge tone={STATUS_TONE[session.status]} data-testid="session-status">
          {STATUS_LABEL[session.status]}
        </Badge>
      </td>
      <td>{session.companyName}</td>
      <td>{roundLabel(session.round)}</td>
      <td>{formatDateTime(session.scheduledAt)}</td>
      <td>{session.participants.filter((p) => !p.removedAt).length}</td>
    </tr>
  );
}

export function InterviewSessionsPage() {
  useDocumentTitle('Interview sessions');
  const [form, setForm] = useState<SessionFilterForm>(EMPTY_FILTERS);
  const filters = useMemo(() => toSessionQuery(form), [form]);
  const list = useInfiniteQuery({
    queryKey: queryKeys.interviewSessions(filters),
    queryFn: ({ pageParam }) => serviceApi.sessions.list(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <AdminOnly>
      <header className="app-page-header">
        <h1 className="app-page-title">Interview sessions</h1>
      </header>
      <div className="admin-panel">
        <FilterForm onApply={setForm} />
        {list.isError && !list.data ? (
          <ErrorView
            error={list.error}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        ) : !list.data ? (
          <RowsSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            compact
            headingLevel={2}
            icon={<CalendarClock />}
            title="No interview sessions match"
            description="Sessions are created through the API. Change the filters to see others."
            data-testid="sessions-empty"
          />
        ) : (
          <>
            <div className="admin-audit">
              <table
                className="admin-table"
                aria-label="Interview sessions"
                data-testid="sessions-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Status</th>
                    <th scope="col">Company</th>
                    <th scope="col">Round</th>
                    <th scope="col">Scheduled</th>
                    <th scope="col">People</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((session) => (
                    <SessionRow key={session.sessionId} session={session} />
                  ))}
                </tbody>
              </table>
            </div>
            {list.hasNextPage ? (
              <div className="service-more">
                <Button
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                  data-testid="sessions-load-more"
                >
                  Load more
                </Button>
              </div>
            ) : null}
            {list.isFetchNextPageError ? (
              <p className="rd-field__error" role="alert">
                More sessions could not be loaded. Try again.
              </p>
            ) : null}
          </>
        )}
      </div>
    </AdminOnly>
  );
}
