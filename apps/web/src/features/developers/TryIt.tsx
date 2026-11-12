import { Banner, Button } from '@realtimedocs/ui';
import { useState } from 'react';
import { prettyJson, type Operation } from './openapi';
import { prepareRequest, sendRequest, type TryItResult } from './tryit';
import { CodeBlock } from './widgets';

/**
 * Sends a real request to this server. The API key sits in component state
 * only: not in storage, not in the URL, not in a cookie.
 */
export function TryIt({ operation }: { operation: Operation }) {
  const [apiKey, setApiKey] = useState('');
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [queryValues, setQueryValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState(() =>
    operation.body?.example !== undefined ? prettyJson(operation.body.example) : '{}',
  );
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TryItResult | null>(null);

  const pathParams = operation.parameters.filter((p) => p.in === 'path');
  const queryParams = operation.parameters.filter((p) => p.in === 'query');
  const idempotent = operation.parameters.some(
    (p) => p.in === 'header' && p.name === 'Idempotency-Key',
  );
  const uid = `try-${operation.id}`;

  async function send() {
    setError(null);
    setResult(null);
    const prepared = prepareRequest(operation, {
      apiKey,
      pathValues,
      queryValues,
      body,
      idempotencyKey,
    });
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    setBusy(true);
    try {
      setResult(await sendRequest(prepared));
    } catch {
      setError('The request could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="dev-try"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h4>Try it</h4>
      <Banner tone="warning">
        This sends a real request to this server with your key. Creating, changing or closing things
        here creates, changes or closes real data.
      </Banner>
      <div className="dev-try__grid">
        <label className="dev-try__field" htmlFor={`${uid}-key`}>
          <span>API key</span>
          <input
            id={`${uid}-key`}
            className="rd-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            placeholder="rdk_…"
            onChange={(event) => setApiKey(event.target.value)}
          />
          <small className="dev-muted">
            Kept in this page&rsquo;s memory only; gone when you reload.
          </small>
        </label>
        {pathParams.map((p) => (
          <label key={p.name} className="dev-try__field" htmlFor={`${uid}-p-${p.name}`}>
            <span>
              {p.name} <small className="dev-muted">path</small>
            </span>
            <input
              id={`${uid}-p-${p.name}`}
              className="rd-input"
              value={pathValues[p.name] ?? ''}
              onChange={(event) => setPathValues((v) => ({ ...v, [p.name]: event.target.value }))}
            />
          </label>
        ))}
        {queryParams.map((p) => (
          <label key={p.name} className="dev-try__field" htmlFor={`${uid}-q-${p.name}`}>
            <span>
              {p.name} <small className="dev-muted">query{p.required ? ', required' : ''}</small>
            </span>
            <input
              id={`${uid}-q-${p.name}`}
              className="rd-input"
              value={queryValues[p.name] ?? ''}
              onChange={(event) => setQueryValues((v) => ({ ...v, [p.name]: event.target.value }))}
            />
          </label>
        ))}
        {idempotent ? (
          <label className="dev-try__field" htmlFor={`${uid}-idem`}>
            <span>
              Idempotency-Key <small className="dev-muted">optional</small>
            </span>
            <input
              id={`${uid}-idem`}
              className="rd-input"
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      {operation.body ? (
        <label className="dev-try__field" htmlFor={`${uid}-body`}>
          <span>JSON body</span>
          <textarea
            id={`${uid}-body`}
            className="rd-input dev-try__body"
            rows={12}
            spellCheck={false}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          Send {operation.method.toUpperCase()}
        </Button>
      </div>
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
      {result ? (
        <div className="dev-try__result" aria-live="polite">
          <p>
            <strong>
              {result.status} {result.statusText}
            </strong>{' '}
            <span className="dev-muted">{result.durationMs} ms</span>
          </p>
          {result.headers.length > 0 ? (
            <ul className="dev-try__headers">
              {result.headers.map(([name, value]) => (
                <li key={name}>
                  <code>{name}</code>: <code>{value}</code>
                </li>
              ))}
            </ul>
          ) : null}
          {result.body ? (
            <CodeBlock code={result.body} label="Response body" />
          ) : (
            <p className="dev-muted">No body.</p>
          )}
        </div>
      ) : null}
    </form>
  );
}
