import { Banner, Button, Spinner } from '@realtimedocs/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { groupByTag, parseOperations, prettyJson, specTags, type Operation } from './openapi';
import { SchemaTable } from './SchemaTable';
import { TryIt } from './TryIt';
import { CodeBlock, InlineText } from './widgets';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; operations: Operation[]; tags: string[] };

function OperationView({ operation }: { operation: Operation }) {
  const headers = operation.parameters.filter((p) => p.in === 'header');
  const other = operation.parameters.filter((p) => p.in !== 'header');
  const hashOpen = typeof window !== 'undefined' && window.location.hash === `#op-${operation.id}`;
  return (
    <details className="dev-op" id={`op-${operation.id}`} open={hashOpen || undefined}>
      <summary className="dev-op__head">
        <span className={`dev-method dev-method--${operation.method}`}>
          {operation.method.toUpperCase()}
        </span>
        <code className="dev-op__path">{operation.path}</code>
        <span className="dev-op__summary">{operation.summary}</span>
      </summary>
      <div className="dev-op__body">
        {operation.description ? (
          <p>
            <InlineText text={operation.description} />
          </p>
        ) : null}
        {operation.scope ? (
          <p>
            Required scope: <code>{operation.scope}</code>
          </p>
        ) : null}
        {other.length > 0 ? (
          <>
            <h4>Parameters</h4>
            <div className="dev-table" tabIndex={0} role="region" aria-label="Parameters">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">In</th>
                    <th scope="col">Type</th>
                    <th scope="col">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {other.map((p) => (
                    <tr key={`${p.in}-${p.name}`}>
                      <td>
                        <code>{p.name}</code>
                        {p.required ? <span className="dev-req"> required</span> : null}
                      </td>
                      <td>{p.in}</td>
                      <td>
                        <code>{typeof p.schema.type === 'string' ? p.schema.type : 'string'}</code>
                        {p.schema.enum ? (
                          <div className="dev-muted">
                            values: {p.schema.enum.map(String).join(', ')}
                          </div>
                        ) : null}
                        {p.schema.default !== undefined ? (
                          <div className="dev-muted">
                            default: {JSON.stringify(p.schema.default)}
                          </div>
                        ) : null}
                      </td>
                      <td>{p.description ? <InlineText text={p.description} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {headers.length > 0 ? (
          <p className="dev-muted">
            Optional headers:{' '}
            {headers.map((h, index) => (
              <span key={h.name}>
                {index > 0 ? ', ' : ''}
                <code>{h.name}</code>
              </span>
            ))}
            .
          </p>
        ) : null}
        {operation.body ? (
          <>
            <h4>Request body</h4>
            <SchemaTable schema={operation.body.schema} caption="Request body fields" />
            {operation.body.example !== undefined ? (
              <CodeBlock label="Example request" code={prettyJson(operation.body.example)} />
            ) : null}
          </>
        ) : null}
        <h4>Responses</h4>
        {operation.responses.map((response) => (
          <details
            key={response.status}
            className="dev-resp"
            open={response.status.startsWith('2') || undefined}
          >
            <summary>
              <strong>{response.status}</strong> <InlineText text={response.description} />
            </summary>
            {response.schema ? (
              <SchemaTable
                schema={response.schema}
                caption={`Response ${response.status} fields`}
              />
            ) : null}
            {response.example !== undefined ? (
              <CodeBlock label="Example response" code={prettyJson(response.example)} />
            ) : null}
          </details>
        ))}
        <TryIt operation={operation} />
      </div>
    </details>
  );
}

/** The endpoint reference, built at runtime from `GET /api/openapi.json`. */
export function ApiReference() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetch('/api/openapi.json', {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<unknown>;
      })
      .then((spec) => {
        const operations = parseOperations(spec);
        if (operations.length === 0) throw new Error('empty');
        setState({ kind: 'ready', operations, tags: specTags(spec) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const groups = useMemo(
    () => (state.kind === 'ready' ? groupByTag(state.operations, state.tags) : []),
    [state],
  );

  if (state.kind === 'loading') {
    return (
      <p role="status" className="dev-muted">
        <Spinner size="sm" /> Loading the API description…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <Banner
        tone="danger"
        title="The API description could not be loaded"
        action={<Button onClick={retry}>Try again</Button>}
      >
        The reference is built from <code>/api/openapi.json</code> on this server.
      </Banner>
    );
  }
  return (
    <div className="dev-ref">
      <p>
        Generated from <a href="/api/openapi.json">/api/openapi.json</a> (OpenAPI 3.1). All paths
        are relative to this server. Authenticate with <code>Authorization: Bearer rdk_…</code>.
      </p>
      {groups.map((group) => (
        <section key={group.tag} aria-labelledby={`tag-${group.tag.replace(/\W+/g, '-')}`}>
          <h3 id={`tag-${group.tag.replace(/\W+/g, '-')}`}>{group.tag}</h3>
          {group.operations.map((operation) => (
            <OperationView key={operation.id} operation={operation} />
          ))}
        </section>
      ))}
    </div>
  );
}
