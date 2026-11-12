/**
 * The document as it was at one revision, rendered read-only with the
 * editor's static renderer. Its own chunk: importing it pulls in the editor.
 * Images load through the normal asset URL; the server keeps the files of
 * every retained revision.
 */
import '@realtimedocs/editor/styles.css';
import { type DocJSON, StaticDocument } from '@realtimedocs/editor';
import { api } from '../../lib/api';

export default function RevisionPreview({
  documentId,
  content,
}: {
  documentId: string;
  content: unknown;
}) {
  return (
    <div className="hist-paper" data-testid="revision-preview">
      <StaticDocument
        content={content as DocJSON}
        api={api}
        documentId={documentId}
        display={{ readingWidth: 'full', tone: 'light' }}
      />
    </div>
  );
}
