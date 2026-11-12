import './print.css';
import { isUuid, type PageSettings } from '@realtimedocs/contracts';
import { Button, Skeleton } from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { lazy, Suspense, useCallback, useId, useState } from 'react';
import { useParams } from 'react-router';
import { RouterLinkButton } from '../../components/links';
import { api } from '../../lib/api';
import { errorScreenKind } from '../../lib/errors';
import { useDocumentTitle, useOnlineStatus } from '../../lib/hooks';
import { documentPath } from '../../lib/navigation';
import { queryKeys } from '../../lib/queryKeys';
import { DocumentError } from './DocumentError';
import { printSheetStyle, usePrintPageRule } from './printPage';

const PrintMount = lazy(async () => ({ default: (await import('./PrintMount')).PrintMount }));

function SheetSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton lines={5} />
      <Skeleton lines={4} style={{ marginTop: 24 }} />
    </div>
  );
}

/**
 * `/d/:documentId/print`: the document on a sheet of paper, with a toolbar and
 * "Save as PDF" instructions that disappear when printing. Works for
 * share-link guests as well as accounts.
 */
export function PrintPage() {
  const { documentId = '' } = useParams();
  const online = useOnlineStatus();
  const valid = isUuid(documentId);
  const helpId = useId();
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const [pageSettings, setPageSettings] = useState<PageSettings | null>(null);
  usePrintPageRule(pageSettings);

  const query = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => api.documents.get(documentId),
    enabled: valid,
  });
  const title = query.data?.document.title;
  useDocumentTitle(title ? `${title} (print view)` : 'Print view');

  if (!valid) {
    return (
      <DocumentError
        documentId={documentId}
        error={null}
        kind="not_found"
        onRetry={() => undefined}
        retrying={false}
      />
    );
  }
  if (query.isError && !query.data) {
    return (
      <DocumentError
        documentId={documentId}
        error={query.error}
        kind={errorScreenKind(query.error, { online })}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  return (
    <div className="print-shell" data-testid="print-view">
      <header className="print-toolbar" data-testid="print-toolbar">
        <RouterLinkButton to={documentPath(documentId)} variant="ghost" iconLeft={<ArrowLeft />}>
          Back to document
        </RouterLinkButton>
        <Button
          variant="primary"
          iconLeft={<Printer />}
          disabled={!ready}
          onClick={() => window.print()}
          data-testid="print-button"
        >
          Print
        </Button>
      </header>

      <section className="print-help" aria-labelledby={helpId} data-testid="print-help">
        <h2 id={helpId}>Save as PDF</h2>
        <ol>
          <li>
            Choose Print above, or press <kbd className="rd-kbd">Ctrl</kbd>{' '}
            <kbd className="rd-kbd">P</kbd> (<kbd className="rd-kbd">⌘</kbd>{' '}
            <kbd className="rd-kbd">P</kbd> on a Mac).
          </li>
          <li>
            As the printer or destination, pick “Save as PDF” in Chrome, Edge or Firefox. In Safari,
            open the PDF menu in the print dialog and choose “Save as PDF”.
          </li>
          <li>
            Turn on “Background graphics” if highlights, table shading and code blocks should keep
            their colours.
          </li>
        </ol>
        <p className="app-note">
          The PDF is a copy of what this page shows when you print. It does not update, and whoever
          receives the file can read it without a link or an account.
        </p>
      </section>

      <main
        id="main"
        tabIndex={-1}
        className="print-sheet"
        data-theme="light"
        style={printSheetStyle(pageSettings)}
      >
        {title === undefined ? (
          <Skeleton width="60%" height={30} style={{ marginBottom: 28 }} />
        ) : (
          <h1 className="print-title">{title}</h1>
        )}
        {query.data ? (
          <Suspense fallback={<SheetSkeleton />}>
            <PrintMount
              documentId={documentId}
              onReady={onReady}
              onPageSettings={setPageSettings}
            />
          </Suspense>
        ) : (
          <SheetSkeleton />
        )}
      </main>
    </div>
  );
}
