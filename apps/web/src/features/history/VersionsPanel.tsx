/**
 * "View versions": the version history document on screen. Version number,
 * edited at / by, added and removed lines, the images that first appeared in
 * the version and a collapsible current snapshot. Every string from the server
 * is rendered as text. Versions are shown 25 at a time and a snapshot is only
 * rendered while it is open, so long documents stay light.
 */
import { Badge, Banner, Button, EmptyState, Skeleton, VisuallyHidden } from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { ErrorView } from '../../components/ErrorScreen';
import { isApiError } from '../../lib/errors';
import {
  fetchVersionHistory,
  imagesById,
  editorText,
  imagesFirstIn,
  paginate,
  parseImageLine,
  safeImageUrl,
  type ShownLine,
  shownLines,
  snapshotLines,
  type VersionEntry,
  type VersionImage,
} from './versionsModel';

function Thumb({ image }: { image: VersionImage }) {
  const src = safeImageUrl(image.url);
  if (!src) return null;
  return (
    <img
      className="vers-thumb"
      src={src}
      alt={image.fileName}
      loading="lazy"
      decoding="async"
      data-testid="version-thumb"
    />
  );
}

/** One line of added / removed / snapshot text; `[IMAGE id]` lines get the id and a thumbnail. */
function Line({ text, images }: { text: string; images: Map<string, VersionImage> }) {
  const parsed = parseImageLine(text);
  if (!parsed) return <>{text}</>;
  const image = images.get(parsed.id);
  return (
    <>
      <span className="vers-imageid">[IMAGE {parsed.id}]</span>
      {parsed.rest ? ` ${parsed.rest}` : ''}
      {image ? <Thumb image={image} /> : null}
    </>
  );
}

function ChangeList({
  kind,
  lines,
  images,
}: {
  kind: 'added' | 'removed';
  lines: ShownLine[];
  images: Map<string, VersionImage>;
}) {
  const label = kind === 'added' ? 'Added' : 'Removed';
  const mark = kind === 'added' ? '+' : '−';
  return (
    <div className="vers-changes" data-kind={kind}>
      <h4 className="vers-subtitle">{label}</h4>
      {lines.length === 0 ? (
        <p className="app-muted vers-none">(nothing {kind})</p>
      ) : (
        <ul className="vers-lines" aria-label={`${label} lines`}>
          {lines.map((line, index) => (
            <li key={index} className="vers-line" data-kind={kind} data-testid={`version-${kind}`}>
              <span className="vers-mark" aria-hidden="true">
                {mark}
              </span>
              <VisuallyHidden>{label}: </VisuallyHidden>
              <span className="vers-text">
                {line.atText ? (
                  <span className="vers-at" data-testid="version-line-at">
                    [{line.atText}]{' '}
                  </span>
                ) : null}
                <Line text={line.text} images={images} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Snapshot({
  text,
  version,
  images,
}: {
  text: string;
  version: number;
  images: Map<string, VersionImage>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="vers-snapshot">
      <button
        type="button"
        className="vers-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        data-testid="version-snapshot-toggle"
      >
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        Current snapshot
      </button>
      <div id={panelId} hidden={!open}>
        {open ? (
          <pre
            className="vers-pre"
            tabIndex={0}
            aria-label={`Snapshot of version ${version}`}
            data-testid="version-snapshot"
          >
            {snapshotLines(text).map((line, index) => (
              <span key={index} className="vers-snapline">
                <Line text={line} images={images} />
                {'\n'}
              </span>
            ))}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function ImageStrip({ images }: { images: VersionImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className="vers-images" data-testid="version-images">
      <h4 className="vers-subtitle">Images</h4>
      <ul className="vers-imagelist">
        {images.map((image) => {
          const src = safeImageUrl(image.url);
          return (
            <li key={image.id} className="vers-image" data-testid="version-image">
              <Thumb image={image} />
              <div className="vers-imagemeta">
                <code className="vers-imageid">{image.id}</code>
                <span className="vers-filename">{image.fileName}</span>
                {src ? (
                  <a href={src} download={image.fileName} data-testid="version-image-download">
                    Download<VisuallyHidden> {image.fileName}</VisuallyHidden>
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Version({
  entry,
  images,
  byId,
}: {
  entry: VersionEntry;
  images: VersionImage[];
  byId: Map<string, VersionImage>;
}) {
  return (
    <li className="vers-version" data-testid="version" data-version={entry.version}>
      <h3 className="vers-title">
        Version {entry.version}
        {entry.action ? (
          <>
            {' '}
            <Badge data-testid="version-action">{entry.action}</Badge>
          </>
        ) : null}
      </h3>
      <dl className="vers-meta">
        <div>
          <dt>Edited at</dt>
          <dd>{entry.editedAtText}</dd>
        </div>
        <div>
          <dt>Edited by</dt>
          <dd data-testid="version-editor">{editorText(entry)}</dd>
        </div>
        {entry.startedAtText ? (
          <div>
            <dt>Started at</dt>
            <dd data-testid="version-started">{entry.startedAtText}</dd>
          </div>
        ) : null}
      </dl>
      <ChangeList kind="added" lines={shownLines(entry.added, entry.addedDetail)} images={byId} />
      <ChangeList
        kind="removed"
        lines={shownLines(entry.removed, entry.removedDetail)}
        images={byId}
      />
      <ImageStrip images={imagesFirstIn(images, entry.version)} />
      <Snapshot text={entry.snapshot} version={entry.version} images={byId} />
    </li>
  );
}

export function VersionsPanel({
  documentId,
  headingId,
}: {
  documentId: string;
  headingId: string;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['version-history', documentId],
    queryFn: ({ signal }) => fetchVersionHistory(documentId, signal),
    retry: false,
  });
  const data = query.data;
  const byId = useMemo(() => imagesById(data?.images ?? []), [data]);
  const slice = useMemo(() => paginate(data?.versions ?? [], page), [data, page]);

  if (query.isError) {
    const forbidden = isApiError(query.error) && query.error.code === 'forbidden';
    return (
      <ErrorView
        error={query.error}
        compact
        headingLevel={3}
        {...(forbidden
          ? {
              kind: 'forbidden' as const,
              title: 'You cannot view the version history document',
              description: 'Ask an administrator for access to this document’s history.',
            }
          : {
              title: 'The versions could not be loaded',
              onRetry: () => void query.refetch(),
              retrying: query.isFetching,
            })}
        data-testid="versions-error"
      />
    );
  }
  if (!data) {
    return (
      <div aria-hidden="true" data-testid="versions-loading">
        <Skeleton lines={4} />
      </div>
    );
  }
  if (data.versions.length === 0) {
    return (
      <EmptyState
        compact
        headingLevel={3}
        icon={<ScrollText />}
        title="No versions recorded yet"
        description="Versions appear here once people edit the document."
        data-testid="versions-empty"
      />
    );
  }
  return (
    <div data-testid="versions-list" aria-labelledby={headingId}>
      {data.session ? (
        <p className="app-muted" data-testid="versions-session">
          {data.session.candidate} · {data.session.company} · Round {String(data.session.round)}
        </p>
      ) : null}
      <p className="app-note">Times are shown in {data.timezone}.</p>
      {data.versions.length > 100 ? (
        <Banner tone="info">Long history: versions are shown 25 at a time.</Banner>
      ) : null}
      <ol className="vers-items" start={slice.items[0]?.version}>
        {slice.items.map((entry) => (
          <Version key={entry.version} entry={entry} images={data.images} byId={byId} />
        ))}
      </ol>
      {slice.pageCount > 1 ? (
        <nav className="vers-pager" aria-label="Versions pages">
          <Button
            size="sm"
            disabled={slice.page <= 1}
            onClick={() => setPage(slice.page - 1)}
            data-testid="versions-prev"
          >
            Previous
          </Button>
          <span role="status" data-testid="versions-range">
            Versions {slice.from}–{slice.to} of {data.versions.length}
          </span>
          <Button
            size="sm"
            disabled={slice.page >= slice.pageCount}
            onClick={() => setPage(slice.page + 1)}
            data-testid="versions-next"
          >
            Next
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
