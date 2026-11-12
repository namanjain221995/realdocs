/**
 * API keys (administrators): create, rotate and revoke the keys that call `/api/v1`.
 * The full key is shown once, in component state only.
 */
import './admin.css';
import './service.css';
import {
  type ApiKey,
  SERVICE_SCOPE_DESCRIPTIONS,
  SERVICE_SCOPES,
  type ServiceScope,
} from '@realtimedocs/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  TextArea,
  TextField,
  useToast,
  VisuallyHidden,
} from '@realtimedocs/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
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
import { KEY_STATE_TONE, localDateToIso, parseLines } from './serviceFormat';

type Pending = { kind: 'rotate' | 'revoke'; key: ApiKey };

function CreateKeyForm({ onCreated }: { onCreated: (key: ApiKey, secret: string) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ServiceScope>>(new Set());
  const [expires, setExpires] = useState('');
  const [cidrs, setCidrs] = useState('');
  const [error, setError] = useState<unknown>(null);

  const create = useMutation({
    mutationFn: () => {
      const allowed = parseLines(cidrs);
      return serviceApi.apiKeys.create({
        name: name.trim(),
        scopes: SERVICE_SCOPES.filter((scope) => scopes.has(scope)),
        expiresAt: expires ? localDateToIso(expires, true) : undefined,
        allowedCidrs: allowed.length > 0 ? allowed : undefined,
      });
    },
    onSuccess: (response) => {
      setName('');
      setScopes(new Set());
      setExpires('');
      setCidrs('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
      onCreated(response.key, response.secret);
    },
    onError: (failure) => {
      setError(failure);
      toast.show({
        tone: 'danger',
        title: 'Could not create the key',
        description: failureText(failure),
      });
    },
  });

  const issues = fieldIssues(error);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim() && scopes.size > 0) create.mutate();
  };

  return (
    <form className="service-form" onSubmit={submit} aria-label="Create an API key">
      <TextField
        label="Name"
        value={name}
        maxLength={80}
        required
        onChange={(event) => setName(event.target.value)}
        error={issues['name']}
        data-testid="key-name"
      />
      <fieldset className="service-fieldset">
        <legend>Scopes</legend>
        {SERVICE_SCOPES.map((scope) => (
          <Checkbox
            key={scope}
            label={<code>{scope}</code>}
            hint={SERVICE_SCOPE_DESCRIPTIONS[scope]}
            checked={scopes.has(scope)}
            onCheckedChange={(checked) =>
              setScopes((current) => {
                const next = new Set(current);
                if (checked) next.add(scope);
                else next.delete(scope);
                return next;
              })
            }
          />
        ))}
        {issues['scopes'] ? <p className="rd-field__error">{issues['scopes']}</p> : null}
      </fieldset>
      <TextField
        type="date"
        label="Expires on (optional)"
        value={expires}
        onChange={(event) => setExpires(event.target.value)}
        hint="Leave empty for a key that does not expire. The key stops working at the end of that day."
        error={issues['expiresAt']}
        data-testid="key-expiry"
      />
      <TextArea
        label="Allowed networks (optional)"
        value={cidrs}
        rows={3}
        onChange={(event) => setCidrs(event.target.value)}
        hint="One CIDR range per line, such as 203.0.113.0/24. Empty means any address."
        error={issues['allowedCidrs']}
        data-testid="key-cidrs"
      />
      <div>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!name.trim() || scopes.size === 0}
          data-testid="create-key"
        >
          Create key
        </Button>
      </div>
    </form>
  );
}

function KeyRow({ apiKey, onAction }: { apiKey: ApiKey; onAction: (pending: Pending) => void }) {
  return (
    <tr data-testid="api-key-row" data-key-id={apiKey.id}>
      <th scope="row">{apiKey.name}</th>
      <td>
        <code>{apiKey.keyPrefix}</code>
      </td>
      <td>
        <Badge tone={KEY_STATE_TONE[apiKey.state]} data-testid="key-state">
          {apiKey.state}
        </Badge>
      </td>
      <td>
        <ul className="service-chips" aria-label={`Scopes of ${apiKey.name}`}>
          {apiKey.scopes.map((scope) => (
            <li key={scope}>
              <code>{scope}</code>
            </li>
          ))}
        </ul>
        {apiKey.allowedCidrs ? (
          <span className="app-muted">Networks: {apiKey.allowedCidrs.join(', ')}</span>
        ) : null}
      </td>
      <td>{apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : 'Never'}</td>
      <td>{apiKey.lastUsedAt ? <RelativeTime value={apiKey.lastUsedAt} /> : 'Never used'}</td>
      <td>
        {apiKey.state === 'revoked' ? null : (
          <span className="service-actions">
            <Button
              size="sm"
              onClick={() => onAction({ kind: 'rotate', key: apiKey })}
              aria-label={`Rotate ${apiKey.name}`}
            >
              Rotate
            </Button>
            <Button
              size="sm"
              onClick={() => onAction({ kind: 'revoke', key: apiKey })}
              aria-label={`Revoke ${apiKey.name}`}
            >
              Revoke
            </Button>
          </span>
        )}
      </td>
    </tr>
  );
}

export function ApiKeysPage() {
  useDocumentTitle('API keys');
  const queryClient = useQueryClient();
  const toast = useToast();
  const keys = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: () => serviceApi.apiKeys.list(),
  });
  // The full key exists only here, right after creation or rotation.
  const [fresh, setFresh] = useState<{ title: string; secret: OneTimeSecret } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const show = (key: ApiKey, secret: string, verb: string): void =>
    setFresh({
      title: `Key "${key.name}" ${verb}. Copy the secret now`,
      secret: { label: 'API key secret', value: secret },
    });

  return (
    <AdminOnly>
      <header className="app-page-header">
        <h1 className="app-page-title">API keys</h1>
      </header>
      <div className="admin-panel">
        <p className="app-page-lede admin-lede">
          Keys let your own systems create and manage interview sessions through the{' '}
          <code>/api/v1</code> API. Give each integration its own key with only the scopes it needs.
        </p>

        <CreateKeyForm onCreated={(key, secret) => show(key, secret, 'created')} />

        {fresh ? (
          <OneTimeSecrets
            title={fresh.title}
            secrets={[fresh.secret]}
            onDone={() => setFresh(null)}
            testId="new-api-key"
          />
        ) : null}

        <h2 className="admin-subheading">Existing keys</h2>
        {keys.isError && !keys.data ? (
          <ErrorView
            error={keys.error}
            onRetry={() => void keys.refetch()}
            retrying={keys.isFetching}
          />
        ) : !keys.data ? (
          <RowsSkeleton />
        ) : keys.data.keys.length === 0 ? (
          <EmptyState
            compact
            headingLevel={3}
            icon={<KeyRound />}
            title="No API keys yet"
            description="Create one above to call the API."
            data-testid="api-keys-empty"
          />
        ) : (
          <div className="admin-audit">
            <table className="admin-table" aria-label="API keys" data-testid="api-keys-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Prefix</th>
                  <th scope="col">State</th>
                  <th scope="col">Scopes</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.data.keys.map((key) => (
                  <KeyRow key={key.id} apiKey={key} onAction={setPending} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pending ? (
          <ConfirmDialog
            danger
            title={pending.kind === 'rotate' ? 'Rotate this key?' : 'Revoke this key?'}
            message={
              pending.kind === 'rotate'
                ? `A new secret replaces "${pending.key.name}". The old secret stops working at once, so update every system that uses it. The new secret is shown once.`
                : `"${pending.key.name}" stops working at once. This cannot be undone.`
            }
            confirmLabel={pending.kind === 'rotate' ? 'Rotate key' : 'Revoke key'}
            onCancel={() => setPending(null)}
            onConfirm={async () => {
              try {
                if (pending.kind === 'rotate') {
                  const response = await serviceApi.apiKeys.rotate(pending.key.id);
                  show(response.key, response.secret, 'rotated');
                } else {
                  await serviceApi.apiKeys.revoke(pending.key.id);
                  toast.show({ title: `Revoked "${pending.key.name}"` });
                }
                await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
                setPending(null);
              } catch (failure) {
                toast.show({
                  tone: 'danger',
                  title: `Could not ${pending.kind} the key`,
                  description: failureText(failure),
                });
                setPending(null);
              }
            }}
          />
        ) : null}
      </div>
    </AdminOnly>
  );
}
