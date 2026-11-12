/** Webhooks (administrators): endpoints, their secrets (shown once) and delivery history. */
import './admin.css';
import './service.css';
import {
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
  WEBHOOK_EVENTS,
  type WebhookEventType,
} from '@realtimedocs/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Select,
  Switch,
  TextField,
  useToast,
} from '@realtimedocs/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Webhook } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ErrorView } from '../../components/ErrorScreen';
import { RelativeTime } from '../../components/RelativeTime';
import { AdminOnly } from '../../components/SignedInLayout';
import { fieldIssues } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/hooks';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime } from '../../lib/time';
import { type OneTimeSecret, OneTimeSecrets, RowsSkeleton, failureText } from './ServiceParts';
import { serviceApi } from './serviceApi';
import { DELIVERY_TONE } from './serviceFormat';

const DELIVERY_FILTERS = [
  { value: '', label: 'Any status' },
  { value: 'pending', label: 'Pending' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'dead', label: 'Dead' },
];

function CreateEndpointForm({ onCreated }: { onCreated: (secret: OneTimeSecret) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<WebhookEventType>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const create = useMutation({
    mutationFn: () =>
      serviceApi.webhooks.create({
        url: url.trim(),
        events: WEBHOOK_EVENTS.filter((event) => events.has(event)),
        enabled: true,
      }),
    onSuccess: (response) => {
      setUrl('');
      setEvents(new Set());
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
      onCreated({
        label: 'Signing secret',
        value: response.secret,
        caption: `Endpoint ${response.endpoint.url} created. Deliveries are signed with this secret (RD-Webhook-Signature).`,
      });
    },
    onError: (failure) => {
      setError(failure);
      toast.show({
        tone: 'danger',
        title: 'Could not create the endpoint',
        description: failureText(failure),
      });
    },
  });
  const issues = fieldIssues(error);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim() && events.size > 0) create.mutate();
  };
  return (
    <form className="service-form" onSubmit={submit} aria-label="Create a webhook endpoint">
      <TextField
        label="Endpoint URL"
        type="url"
        value={url}
        placeholder="https://example.com/hooks/realtimedocs"
        required
        onChange={(event) => setUrl(event.target.value)}
        error={issues['url']}
        data-testid="webhook-url"
      />
      <fieldset className="service-fieldset">
        <legend>Events</legend>
        {WEBHOOK_EVENTS.map((event) => (
          <Checkbox
            key={event}
            label={<code>{event}</code>}
            checked={events.has(event)}
            onCheckedChange={(checked) =>
              setEvents((current) => {
                const next = new Set(current);
                if (checked) next.add(event);
                else next.delete(event);
                return next;
              })
            }
          />
        ))}
        {issues['events'] ? <p className="rd-field__error">{issues['events']}</p> : null}
      </fieldset>
      <div>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!url.trim() || events.size === 0}
          data-testid="create-webhook"
        >
          Create endpoint
        </Button>
      </div>
    </form>
  );
}

function Deliveries({ endpoint }: { endpoint: WebhookEndpoint }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<WebhookDeliveryStatus | ''>('');
  const key = queryKeys.webhookDeliveries(endpoint.id, status);
  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => serviceApi.webhooks.deliveries(endpoint.id, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const retry = useMutation({
    mutationFn: (delivery: WebhookDelivery) => serviceApi.webhooks.retry(delivery.id),
    onSuccess: () => {
      toast.show({ title: 'Delivery queued for retry' });
      void queryClient.invalidateQueries({
        queryKey: ['webhooks', 'deliveries', endpoint.id],
      });
    },
    onError: (failure) =>
      toast.show({
        tone: 'danger',
        title: 'Could not retry the delivery',
        description: failureText(failure),
      }),
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="service-deliveries" data-testid="deliveries">
      <Select
        label="Delivery status"
        options={DELIVERY_FILTERS}
        value={status}
        onChange={(event) => setStatus(event.target.value as WebhookDeliveryStatus | '')}
      />
      {list.isError && !list.data ? (
        <ErrorView
          error={list.error}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
          headingLevel={3}
        />
      ) : !list.data ? (
        <RowsSkeleton />
      ) : items.length === 0 ? (
        <p className="app-muted">No deliveries yet.</p>
      ) : (
        <>
          <div className="admin-audit">
            <table className="admin-table" aria-label={`Deliveries for ${endpoint.url}`}>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Last result</th>
                  <th scope="col">Next attempt</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((delivery) => (
                  <tr key={delivery.id} data-testid="delivery-row">
                    <td>
                      <code>{delivery.eventType}</code>
                      <br />
                      <span className="app-muted" title={formatDateTime(delivery.createdAt)}>
                        <RelativeTime value={delivery.createdAt} />
                      </span>
                    </td>
                    <td>
                      <Badge tone={DELIVERY_TONE[delivery.status]}>{delivery.status}</Badge>
                    </td>
                    <td>{delivery.attempts}</td>
                    <td>
                      {delivery.lastStatusCode !== null ? `HTTP ${delivery.lastStatusCode}` : '—'}
                      {delivery.lastError ? (
                        <span className="admin-audit__detail"> {delivery.lastError}</span>
                      ) : null}
                    </td>
                    <td>{delivery.nextAttemptAt ? formatDateTime(delivery.nextAttemptAt) : '—'}</td>
                    <td>
                      {delivery.status === 'failed' || delivery.status === 'dead' ? (
                        <Button
                          size="sm"
                          loading={retry.isPending && retry.variables?.id === delivery.id}
                          onClick={() => retry.mutate(delivery)}
                          aria-label={`Retry ${delivery.eventType} delivery`}
                        >
                          Retry
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.hasNextPage ? (
            <div className="service-more">
              <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function EndpointCard({
  endpoint,
  onDelete,
}: {
  endpoint: WebhookEndpoint;
  onDelete: (endpoint: WebhookEndpoint) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showDeliveries, setShowDeliveries] = useState(false);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => serviceApi.webhooks.update(endpoint.id, { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks }),
    onError: (failure) =>
      toast.show({
        tone: 'danger',
        title: 'Could not change the endpoint',
        description: failureText(failure),
      }),
  });
  return (
    <article
      className="admin-release"
      data-testid="webhook-endpoint"
      data-endpoint-id={endpoint.id}
    >
      <h3>
        <span className="service-url">{endpoint.url}</span>{' '}
        <Badge tone={endpoint.enabled ? 'success' : 'neutral'}>
          {endpoint.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </h3>
      <ul className="service-chips" aria-label="Subscribed events">
        {endpoint.events.map((event) => (
          <li key={event}>
            <code>{event}</code>
          </li>
        ))}
      </ul>
      <div className="service-actions">
        <Switch
          label="Enabled"
          checked={endpoint.enabled}
          disabled={toggle.isPending}
          onCheckedChange={(enabled) => toggle.mutate(enabled)}
        />
        <Button size="sm" pressed={showDeliveries} onClick={() => setShowDeliveries((v) => !v)}>
          Deliveries
        </Button>
        <Button
          size="sm"
          onClick={() => onDelete(endpoint)}
          aria-label={`Delete endpoint ${endpoint.url}`}
        >
          Delete
        </Button>
      </div>
      {showDeliveries ? <Deliveries endpoint={endpoint} /> : null}
    </article>
  );
}

export function WebhooksPage() {
  useDocumentTitle('Webhooks');
  const queryClient = useQueryClient();
  const toast = useToast();
  const hooks = useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: () => serviceApi.webhooks.list(),
  });
  const [fresh, setFresh] = useState<OneTimeSecret | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);

  return (
    <AdminOnly>
      <header className="app-page-header">
        <h1 className="app-page-title">Webhooks</h1>
      </header>
      <div className="admin-panel">
        <p className="app-page-lede admin-lede">
          RealtimeDocs calls your endpoint when something happens to an interview session. Every
          delivery is signed with the endpoint&apos;s secret and contains no document content.
        </p>
        <CreateEndpointForm onCreated={setFresh} />
        {fresh ? (
          <OneTimeSecrets
            title="Endpoint created. Copy the signing secret now"
            secrets={[fresh]}
            onDone={() => setFresh(null)}
            testId="new-webhook-secret"
          />
        ) : null}

        <h2 className="admin-subheading">Endpoints</h2>
        {hooks.isError && !hooks.data ? (
          <ErrorView
            error={hooks.error}
            onRetry={() => void hooks.refetch()}
            retrying={hooks.isFetching}
          />
        ) : !hooks.data ? (
          <RowsSkeleton />
        ) : hooks.data.endpoints.length === 0 ? (
          <EmptyState
            compact
            headingLevel={3}
            icon={<Webhook />}
            title="No webhook endpoints yet"
            description="Create one above to receive session events."
            data-testid="webhooks-empty"
          />
        ) : (
          hooks.data.endpoints.map((endpoint) => (
            <EndpointCard key={endpoint.id} endpoint={endpoint} onDelete={setDeleting} />
          ))
        )}

        {deleting ? (
          <ConfirmDialog
            danger
            title="Delete this endpoint?"
            message={`${deleting.url} stops receiving events and its delivery history is removed. This cannot be undone.`}
            confirmLabel="Delete endpoint"
            onCancel={() => setDeleting(null)}
            onConfirm={async () => {
              try {
                await serviceApi.webhooks.remove(deleting.id);
                await queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
                toast.show({ title: 'Endpoint deleted' });
              } catch (failure) {
                toast.show({
                  tone: 'danger',
                  title: 'Could not delete the endpoint',
                  description: failureText(failure),
                });
              }
              setDeleting(null);
            }}
          />
        ) : null}
      </div>
    </AdminOnly>
  );
}
