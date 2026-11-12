/** Small pieces shared by the service-API admin pages. */
import { Banner, Button, CopyField, Skeleton } from '@realtimedocs/ui';
import { useEffect, useRef } from 'react';
import { errorMessage, requestIdOf } from '../../lib/errors';

export function failureText(error: unknown): string {
  const requestId = requestIdOf(error);
  return requestId ? `${errorMessage(error)} Reference ${requestId}` : errorMessage(error);
}

export function RowsSkeleton() {
  return (
    <div aria-hidden="true" data-testid="admin-loading">
      {[0, 1, 2].map((row) => (
        <div key={row} className="admin-skeleton-row">
          <Skeleton width="38%" height={14} />
          <Skeleton width={96} height={24} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

export interface OneTimeSecret {
  label: string;
  value: string;
  /** Short caption above the field, e.g. who the link is for. */
  caption?: string;
}

/**
 * Shows secrets exactly once. The values live in the parent's component state only; "Done"
 * makes the parent drop them. They never enter the query cache.
 */
export function OneTimeSecrets({
  title,
  secrets,
  onDone,
  testId,
}: {
  title: string;
  secrets: readonly OneTimeSecret[];
  onDone: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className="app-once service-once"
      role="group"
      aria-label={title}
      tabIndex={-1}
      data-testid={testId}
    >
      <p className="app-once__title">{title}</p>
      <Banner tone="warning" data-testid="shown-once-warning">
        Shown once. Copy it now: it cannot be retrieved again, and closing this panel removes it
        from this page.
      </Banner>
      {secrets.map((secret) => (
        <div key={`${secret.label}:${secret.value}`}>
          {secret.caption ? <p className="service-once__caption">{secret.caption}</p> : null}
          <CopyField label={secret.label} value={secret.value} masked />
        </div>
      ))}
      <div>
        <Button size="sm" onClick={onDone} data-testid={`${testId}-done`}>
          Done, I have copied it
        </Button>
      </div>
    </div>
  );
}
