/**
 * The "Version history document" action group: two downloads (plain links to
 * the server's endpoints) and a button that opens the on-screen versions.
 */
import { VisuallyHidden } from '@realtimedocs/ui';
import { FileArchive, FileText, ListTree } from 'lucide-react';
import { useMemo } from 'react';
import { browserTimeZone, versionsTxtUrl, versionsZipUrl } from './versionsModel';

export function VersionActions({
  documentId,
  open,
  panelId,
  onToggle,
}: {
  documentId: string;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const zone = useMemo(() => browserTimeZone(), []);
  return (
    <div
      className="vers-actions"
      role="group"
      aria-labelledby="vers-actions-title"
      data-testid="history-versions"
    >
      <h2 id="vers-actions-title" className="vers-actions__title">
        Version history document
      </h2>
      <p className="app-note vers-actions__note">
        A text file listing every version with who edited it and what was added and removed, and the
        images pasted into the document.
      </p>
      <div className="vers-actions__row">
        <a
          className="vers-action"
          href={versionsTxtUrl(documentId, zone)}
          download="doc.txt"
          data-testid="history-versions-txt"
        >
          <FileText aria-hidden="true" />
          Download doc.txt
        </a>
        <a
          className="vers-action"
          href={versionsZipUrl(documentId)}
          download
          data-testid="history-versions-zip"
        >
          <FileArchive aria-hidden="true" />
          Download with images (.zip)
        </a>
        <button
          type="button"
          className="vers-action"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          data-testid="history-versions-view"
        >
          <ListTree aria-hidden="true" />
          View versions
          <VisuallyHidden>{open ? ' (shown below)' : ''}</VisuallyHidden>
        </button>
      </div>
    </div>
  );
}
