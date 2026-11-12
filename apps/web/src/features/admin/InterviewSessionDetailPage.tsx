/**
 * One interview session (administrators): details, participants, links, state changes and audit.
 * Links returned by "add interviewer" and "rotate links" are shown once, from component state.
 */
import './admin.css';
import './service.css';
import type { InterviewSession, SessionParticipant } from '@realtimedocs/contracts';
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  Skeleton,
  TextField,
  useToast,
} from '@realtimedocs/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { RelativeTime } from '../../components/RelativeTime';
import { AdminOnly } from '../../components/SignedInLayout';
import { fieldIssues } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/hooks';
import { documentPath } from '../../lib/navigation';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime } from '../../lib/time';
import { type OneTimeSecret, OneTimeSecrets, failureText } from './ServiceParts';
import { type SessionAction, serviceApi } from './serviceApi';
import {
  ACTION_COPY,
  allowedSessionActions,
  LINK_STATE_LABEL,
  roundLabel,
  STATUS_LABEL,
  STATUS_TONE,
} from './serviceFormat';

type Confirm =
  | { kind: SessionAction | 'archive' }
  | { kind: 'remove'; participant: SessionParticipant }
  | { kind: 'rotate'; participants: SessionParticipant[] | null };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="service-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AddInterviewerForm({
  sessionId,
  onAdded,
}: {
  sessionId: string;
  onAdded: (session: string, link: OneTimeSecret) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<unknown>(null);
  const add = useMutation({
    mutationFn: () =>
      serviceApi.sessions.addParticipant(sessionId, {
        role: 'interviewer',
        name: name.trim(),
        email: email.trim(),
      }),
    onSuccess: (response) => {
      setName('');
      setEmail('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviewSession(sessionId) });
      onAdded(sessionId, {
        label: `Link for ${response.participant.name}`,
        value: response.participant.access.url,
        caption: `${response.participant.name} (${response.participant.email}) added as interviewer.`,
      });
    },
    onError: (failure) => {
      setError(failure);
      toast.show({
        tone: 'danger',
        title: 'Could not add the interviewer',
        description: failureText(failure),
      });
    },
  });
  const issues = fieldIssues(error);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim() && email.trim()) add.mutate();
  };
  return (
    <form className="service-inline-form" onSubmit={submit} aria-label="Add an interviewer">
      <TextField
        label="Interviewer name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={issues['name']}
        required
      />
      <TextField
        label="Interviewer email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={issues['email']}
        required
      />
      <Button type="submit" loading={add.isPending} data-testid="add-interviewer">
        Add interviewer
      </Button>
    </form>
  );
}

function AuditList({ sessionId }: { sessionId: string }) {
  const audit = useInfiniteQuery({
    queryKey: queryKeys.interviewSessionAudit(sessionId),
    queryFn: ({ pageParam }) => serviceApi.sessions.audit(sessionId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  if (audit.isError && !audit.data) {
    return (
      <ErrorView
        error={audit.error}
        onRetry={() => void audit.refetch()}
        retrying={audit.isFetching}
        headingLevel={3}
      />
    );
  }
  if (!audit.data) return <Skeleton height={60} />;
  const events = audit.data.pages.flatMap((page) => page.items);
  if (events.length === 0) return <p className="app-muted">Nothing recorded yet.</p>;
  return (
    <>
      <div className="admin-audit">
        <table className="admin-table" aria-label="Session audit" data-testid="session-audit">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td title={formatDateTime(event.at)}>
                  <RelativeTime value={event.at} />
                </td>
                <td>
                  {event.actorName ?? 'System'}{' '}
                  <span className="app-muted">({event.actorKind})</span>
                </td>
                <td>
                  <code>{event.action}</code>
                  {Object.entries(event.details).map(([key, value]) => (
                    <span key={key} className="admin-audit__detail">
                      {key}: {String(value)}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {audit.hasNextPage ? (
        <div className="service-more">
          <Button
            loading={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
            data-testid="audit-load-more"
          >
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Detail({ session }: { session: InterviewSession }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessionId = session.sessionId;
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [links, setLinks] = useState<OneTimeSecret[] | null>(null);
  const allowed = allowedSessionActions(session.status);

  const refreshed = (next: InterviewSession): void => {
    queryClient.setQueryData(queryKeys.interviewSession(sessionId), next);
    void queryClient.invalidateQueries({ queryKey: ['interview-sessions', 'list'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.interviewSessionAudit(sessionId) });
  };

  const run = async (action: Confirm): Promise<void> => {
    try {
      if (action.kind === 'remove') {
        refreshed(
          await serviceApi.sessions.removeParticipant(sessionId, action.participant.participantId),
        );
        toast.show({ title: `Removed ${action.participant.name}` });
      } else if (action.kind === 'rotate') {
        const ids = action.participants?.map((p) => p.participantId);
        const response = await serviceApi.sessions.rotateLinks(sessionId, ids);
        setLinks(
          response.participants.map((p) => ({
            label: `New link for ${p.name}`,
            value: p.access.url,
            caption: `${p.name} (${p.role})`,
          })),
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.interviewSession(sessionId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.interviewSessionAudit(sessionId),
        });
      } else if (action.kind === 'archive') {
        refreshed(await serviceApi.sessions.archive(sessionId));
        toast.show({ title: 'Session archived' });
      } else {
        refreshed(await serviceApi.sessions.transition(sessionId, action.kind));
        toast.show({ title: ACTION_COPY[action.kind].label });
      }
    } catch (failure) {
      toast.show({
        tone: 'danger',
        title: 'The change was not made',
        description: failureText(failure),
      });
    }
    setConfirm(null);
  };

  const copy =
    confirm && (confirm.kind === 'remove' || confirm.kind === 'rotate')
      ? confirm.kind === 'remove'
        ? {
            title: `Remove ${confirm.participant.name}?`,
            message:
              'Their link stops working at once and they are disconnected from the document.',
            label: 'Remove participant',
            danger: true,
          }
        : {
            title: confirm.participants
              ? `Rotate ${confirm.participants[0]?.name}'s link?`
              : 'Rotate every link?',
            message:
              'The previous link stops working at once. The new links are shown once, so be ready to copy and send them.',
            label: 'Rotate links',
            danger: true,
          }
      : confirm
        ? {
            title: ACTION_COPY[confirm.kind].title,
            message: ACTION_COPY[confirm.kind].message,
            label: ACTION_COPY[confirm.kind].label,
            danger: ACTION_COPY[confirm.kind].danger,
          }
        : null;

  const live = (participant: SessionParticipant): boolean => !participant.removedAt;

  return (
    <>
      <header className="app-page-header">
        <h1 className="app-page-title">{session.title}</h1>
        <Badge tone={STATUS_TONE[session.status]} data-testid="session-status">
          {STATUS_LABEL[session.status]}
        </Badge>
      </header>
      <div className="admin-panel">
        <p>
          <Link to="/admin/interview-sessions">All interview sessions</Link>
          {' · '}
          <Link to={documentPath(session.documentId)} data-testid="session-document-link">
            Open the document
          </Link>
        </p>

        <div className="service-actions" role="group" aria-label="Session actions">
          <Button
            disabled={!allowed.start}
            onClick={() => setConfirm({ kind: 'start' })}
            data-testid="action-start"
          >
            Start
          </Button>
          <Button
            disabled={!allowed.complete}
            onClick={() => setConfirm({ kind: 'complete' })}
            data-testid="action-complete"
          >
            Complete
          </Button>
          <Button
            disabled={!allowed.cancel}
            onClick={() => setConfirm({ kind: 'cancel' })}
            data-testid="action-cancel"
          >
            Cancel session
          </Button>
          <Button
            disabled={!allowed.archive}
            onClick={() => setConfirm({ kind: 'archive' })}
            data-testid="action-archive"
          >
            Archive
          </Button>
        </div>

        <h2 className="admin-subheading">Details</h2>
        <dl className="service-facts">
          <Fact label="Company">{session.companyName}</Fact>
          <Fact label="Round">{roundLabel(session.round)}</Fact>
          <Fact label="Scheduled">
            {formatDateTime(session.scheduledAt)} ({session.timezone})
          </Fact>
          <Fact label="Links expire">{formatDateTime(session.expiresAt)}</Fact>
          <Fact label="Permissions">
            <ul className="service-chips">
              <li>Candidate {session.permissions.candidateCanEdit ? 'can edit' : 'read-only'}</li>
              <li>
                Interviewer {session.permissions.interviewerCanEdit ? 'can edit' : 'read-only'}
              </li>
              <li>
                Candidate export {session.permissions.candidateCanExport ? 'allowed' : 'blocked'}
              </li>
              <li>
                Candidate share {session.permissions.candidateCanShare ? 'allowed' : 'blocked'}
              </li>
              <li>
                Candidate history{' '}
                {session.permissions.candidateCanViewHistory ? 'allowed' : 'blocked'}
              </li>
            </ul>
          </Fact>
          <Fact label="Metadata">
            {Object.keys(session.metadata).length === 0 ? (
              'None'
            ) : (
              <ul className="service-chips">
                {Object.entries(session.metadata).map(([key, value]) => (
                  <li key={key}>
                    <code>{key}</code>: {value}
                  </li>
                ))}
              </ul>
            )}
          </Fact>
          <Fact label="Created">{formatDateTime(session.createdAt)}</Fact>
        </dl>

        {links ? (
          <OneTimeSecrets
            title="New participant links. Copy them now"
            secrets={links}
            onDone={() => setLinks(null)}
            testId="new-links"
          />
        ) : null}

        <h2 className="admin-subheading">Participants</h2>
        <div className="admin-audit">
          <table className="admin-table" aria-label="Participants" data-testid="participants-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">First joined</th>
                <th scope="col">Last joined</th>
                <th scope="col">Link</th>
                <th scope="col">Connected now</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {session.participants.map((participant) => (
                <tr key={participant.participantId} data-testid="participant-row">
                  <th scope="row">
                    {participant.name}
                    <br />
                    <span className="app-muted">{participant.email}</span>
                  </th>
                  <td>{participant.role}</td>
                  <td>
                    {participant.firstJoinedAt
                      ? formatDateTime(participant.firstJoinedAt)
                      : 'Not yet'}
                  </td>
                  <td>
                    {participant.lastJoinedAt
                      ? formatDateTime(participant.lastJoinedAt)
                      : 'Not yet'}
                  </td>
                  <td>
                    {participant.removedAt ? 'Removed' : LINK_STATE_LABEL[participant.linkState]}
                  </td>
                  <td>{participant.liveConnections}</td>
                  <td>
                    {live(participant) && session.status !== 'archived' ? (
                      <span className="service-actions">
                        <Button
                          size="sm"
                          aria-label={`Rotate link of ${participant.name}`}
                          onClick={() =>
                            setConfirm({ kind: 'rotate', participants: [participant] })
                          }
                        >
                          Rotate link
                        </Button>
                        <Button
                          size="sm"
                          aria-label={`Remove ${participant.name}`}
                          onClick={() => setConfirm({ kind: 'remove', participant })}
                        >
                          Remove
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {session.status !== 'archived' ? (
          <>
            <div className="service-more">
              <Button
                onClick={() => setConfirm({ kind: 'rotate', participants: null })}
                data-testid="rotate-all"
              >
                Rotate all links
              </Button>
            </div>
            <h3 className="admin-subheading">Add an interviewer</h3>
            <AddInterviewerForm
              sessionId={sessionId}
              onAdded={(_, link) => setLinks((current) => [...(current ?? []), link])}
            />
          </>
        ) : (
          <Banner tone="info">Archived sessions cannot be changed.</Banner>
        )}

        <h2 className="admin-subheading">Audit trail</h2>
        <AuditList sessionId={sessionId} />

        {confirm && copy ? (
          <ConfirmDialog
            danger={copy.danger}
            title={copy.title}
            message={copy.message}
            confirmLabel={copy.label}
            onCancel={() => setConfirm(null)}
            onConfirm={() => run(confirm)}
          />
        ) : null}
      </div>
    </>
  );
}

export function InterviewSessionDetailPage() {
  const { sessionId = '' } = useParams();
  useDocumentTitle('Interview session');
  const session = useQuery({
    queryKey: queryKeys.interviewSession(sessionId),
    queryFn: () => serviceApi.sessions.get(sessionId),
    refetchInterval: 15_000,
  });
  return (
    <AdminOnly>
      {session.isError && !session.data ? (
        <ErrorView
          error={session.error}
          onRetry={() => void session.refetch()}
          retrying={session.isFetching}
        />
      ) : !session.data ? (
        <div role="status" aria-label="Loading session">
          <Skeleton height={80} />
        </div>
      ) : (
        <Detail session={session.data} />
      )}
    </AdminOnly>
  );
}
