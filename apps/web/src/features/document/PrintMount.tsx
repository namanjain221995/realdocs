/**
 * The document body of the print view: the server's JSON export rendered
 * with the editor's static renderer, so paper shows the same tables, code,
 * images and diagrams as the screen, without any editing or collaboration
 * machinery. One of the few files that import `@realtimedocs/editor`.
 */
import '@realtimedocs/editor/styles.css';
import { normalizePageSettings, type PageSettings } from '@realtimedocs/contracts';
import { type DocJSON, StaticDocument } from '@realtimedocs/editor';
import { Skeleton } from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ErrorView } from '../../components/ErrorScreen';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

export interface PrintMountProps {
  documentId: string;
  /** Called when the content is laid out and the page is safe to print. */
  onReady?: () => void;
  /** The document's page settings, once the export has arrived. */
  onPageSettings?: (settings: PageSettings) => void;
}

/** How long to wait for images and diagrams before printing is offered anyway. */
const SETTLE_TIMEOUT_MS = 10_000;
const SETTLE_POLL_MS = 150;

/**
 * True when the document is on the sheet, every image has finished loading
 * (or failed) and every diagram is drawn (or has reported why it cannot be).
 *
 * The editor marks its images for lazy loading, which suits a long document
 * on screen. Paper has no "below the fold": an image the reader never
 * scrolled to would be a gap in the PDF, so they are all asked for here.
 */
function isSettled(root: HTMLElement): boolean {
  if (!root.querySelector('.rd-editor--static .ProseMirror')) return false;
  const images = [...root.querySelectorAll('img')];
  for (const image of images) {
    if (image.loading === 'lazy') image.loading = 'eager';
  }
  const diagrams = [...root.querySelectorAll('.rd-diagram__preview')];
  const drawn = diagrams.every(
    (diagram) => diagram.querySelector('.rd-diagram__image, .rd-diagram__error') !== null,
  );
  return drawn && images.every((image) => image.complete);
}

interface PrintContent {
  doc: DocJSON;
  pageSettings: PageSettings;
}

async function loadContent(documentId: string): Promise<PrintContent> {
  // The same content collaborators see right now, as ProseMirror JSON (view access is enough),
  // with the page settings beside it. An older server sends none: defaults.
  const json = JSON.parse(await api.documents.exportText(documentId, 'json')) as DocJSON & {
    pageSettings?: unknown;
  };
  const { pageSettings, ...doc } = json;
  return { doc: doc as DocJSON, pageSettings: normalizePageSettings(pageSettings) };
}

export function PrintMount({ documentId, onReady, onPageSettings }: PrintMountProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const content = useQuery({
    queryKey: [...queryKeys.document(documentId), 'print'],
    queryFn: () => loadContent(documentId),
    // A print view shows the document as it is when the page opens.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const loaded = content.data !== undefined;
  const settings = content.data?.pageSettings;
  useEffect(() => {
    if (settings) onPageSettings?.(settings);
  }, [settings, onPageSettings]);

  // Printing before images and diagrams have arrived would put gaps on paper.
  useEffect(() => {
    if (!loaded) return undefined;
    const started = Date.now();
    // Settled twice in a row: the document's blocks mount one after the other.
    let settledBefore = false;
    const handle = window.setInterval(() => {
      const root = rootRef.current;
      const settled = root !== null && isSettled(root);
      if ((settled && settledBefore) || Date.now() - started > SETTLE_TIMEOUT_MS) {
        window.clearInterval(handle);
        onReady?.();
      }
      settledBefore = settled;
    }, SETTLE_POLL_MS);
    return () => window.clearInterval(handle);
  }, [loaded, onReady]);

  if (content.isError && !loaded) {
    return (
      <ErrorView
        error={content.error}
        compact
        headingLevel={2}
        title="The document could not be loaded for printing"
        onRetry={() => void content.refetch()}
        retrying={content.isFetching}
        data-testid="print-error"
      />
    );
  }
  if (!loaded) {
    return (
      <div aria-busy="true" data-testid="print-loading">
        <Skeleton lines={5} />
        <Skeleton lines={4} style={{ marginTop: 24 }} />
      </div>
    );
  }
  return (
    <div ref={rootRef} className="print-body" data-testid="print-body">
      <StaticDocument
        content={content.data.doc}
        api={api}
        documentId={documentId}
        // Paper sets the width; the sheet is always light.
        display={{ readingWidth: 'full', tone: 'light' }}
      />
    </div>
  );
}
