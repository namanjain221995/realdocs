/**
 * Open in Desktop.
 *
 * The server issues a single-use code that is valid for 60 seconds and bound
 * to this principal and document; the browser hands it to the desktop app
 * through a `realtimedocs://open?...` link. The code only ever exists in that
 * link: it is not rendered, not stored and never part of a web address.
 *
 * A browser cannot tell whether the desktop app is installed. Chromium and
 * Safari stay on the page when it is not, so there the link is followed right
 * after the click that opened this dialog. Firefox replaces the page with an
 * error when no app handles the link, so there the dialog explains first and
 * the reader confirms with a second click.
 */
import { isLoopbackOrigin, parseDesktopHandoffUrl } from '@realtimedocs/contracts';
import { Banner, Button, CopyField, Dialog, Spinner } from '@realtimedocs/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { errorMessage, requestIdOf } from '../../lib/errors';
import { useCountdown } from '../../lib/hooks';
import { useServerMeta } from '../../lib/useLimits';

type Phase = 'ready' | 'requesting' | 'launched' | 'failed';

export interface DesktopHandoffControls {
  open: boolean;
  phase: Phase;
  /** Epoch ms at which the issued code stops working. */
  expiresAt: number | null;
  failure: { message: string; requestId?: string } | null;
  /** Opens the dialog; follows the link at once where that is safe. */
  start: () => void;
  /** Requests a fresh code and follows the link. Call from a click handler. */
  launch: () => void;
  close: () => void;
}

/** Browsers that swap the page for an error when nothing handles a custom link. */
function replacesPageOnUnknownScheme(): boolean {
  return /\bFirefox\//.test(navigator.userAgent);
}

export function useDesktopHandoff(documentId: string): DesktopHandoffControls {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<DesktopHandoffControls['failure']>(null);
  const run = useRef(0);

  const launch = useCallback(() => {
    const current = ++run.current;
    setPhase('requesting');
    setFailure(null);
    setExpiresAt(null);
    void api.desktop.createHandoff(documentId).then(
      (handoff) => {
        if (run.current !== current) return;
        // Follow only a well-formed desktop link for this very document.
        const parsed = parseDesktopHandoffUrl(handoff.url);
        if (!parsed || parsed.documentId !== documentId) {
          setPhase('failed');
          setFailure({ message: 'The server returned a link the desktop app would not accept.' });
          return;
        }
        setExpiresAt(Date.parse(handoff.expiresAt));
        setPhase('launched');
        window.location.assign(handoff.url);
      },
      (error: unknown) => {
        if (run.current !== current) return;
        setPhase('failed');
        setFailure({ message: errorMessage(error), requestId: requestIdOf(error) });
      },
    );
  }, [documentId]);

  const start = useCallback(() => {
    setOpen(true);
    if (replacesPageOnUnknownScheme()) {
      run.current += 1;
      setPhase('ready');
      setFailure(null);
      setExpiresAt(null);
    } else {
      launch();
    }
  }, [launch]);

  const close = useCallback(() => {
    run.current += 1;
    setOpen(false);
  }, []);

  // A different document: forget anything in flight.
  useEffect(
    () => () => {
      run.current += 1;
    },
    [documentId],
  );

  return { open, phase, expiresAt, failure, start, launch, close };
}

export interface OpenInDesktopDialogProps {
  controls: DesktopHandoffControls;
  /** The reader has no account; their access comes from a share link. */
  isGuest: boolean;
  /** Offered to administrators as the way to get a link to paste. */
  onOpenSharing?: () => void;
}

export function OpenInDesktopDialog({
  controls,
  isGuest,
  onOpenSharing,
}: OpenInDesktopDialogProps) {
  const meta = useServerMeta();
  const serverOrigin = meta.data?.publicOrigin || window.location.origin;
  const secondsLeft = useCountdown(controls.phase === 'launched' ? controls.expiresAt : null);
  const cautious = replacesPageOnUnknownScheme();
  // Start at the top of the dialog rather than in the first field inside it.
  const panelRef = useRef<HTMLDivElement>(null);

  let status;
  if (controls.phase === 'requesting') {
    status = (
      <p className="doc-desktop__status" role="status">
        <Spinner size="sm" label={null} /> Asking the server for a one-time code.
      </p>
    );
  } else if (controls.phase === 'launched') {
    status = (
      <Banner tone="info" data-testid="desktop-launched">
        Your browser was asked to open RealtimeDocs Desktop. Allow it if the browser asks.{' '}
        {secondsLeft > 0
          ? `The code works once and expires in ${secondsLeft} s.`
          : 'The code has expired. Try again to get a new one.'}
      </Banner>
    );
  } else if (controls.phase === 'failed' && controls.failure) {
    status = (
      <Banner tone="danger" data-testid="desktop-failed">
        {controls.failure.message}
        {controls.failure.requestId ? (
          <span className="app-note"> Reference {controls.failure.requestId}</span>
        ) : null}
      </Banner>
    );
  } else {
    status = (
      <Banner tone="info">
        Choose Open desktop app to continue. If the app is not installed, this browser shows an
        error page instead: press Back to return to the document.
      </Banner>
    );
  }

  return (
    <Dialog
      ref={panelRef}
      initialFocus={panelRef}
      open={controls.open}
      onOpenChange={(next) => {
        if (!next) controls.close();
      }}
      title="Open in the desktop app"
      description="RealtimeDocs Desktop shows this document in a floating panel on Windows and macOS."
      data-testid="desktop-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={controls.close}>
            Close
          </Button>
          <Button
            variant="primary"
            loading={controls.phase === 'requesting'}
            onClick={controls.launch}
            data-testid="desktop-launch"
          >
            {controls.phase === 'ready' ? 'Open desktop app' : 'Try again'}
          </Button>
        </>
      }
    >
      <div className="doc-desktop">
        {status}

        <section>
          <h3>What happens</h3>
          <p>
            The server issues a code that works once and for 60 seconds. Your browser passes it to
            the desktop app, which uses it to open this document with the access you have here. The
            code is not your password and it is not a share link.
          </p>
          {cautious ? null : (
            <p>
              Nothing happening usually means the app is not installed on this computer, or the
              browser blocked the request. Set the app up as described below, then choose Try again.
            </p>
          )}
        </section>

        <section>
          <h3>First time on this computer</h3>
          <ol>
            <li>
              Install RealtimeDocs Desktop on your Windows or Mac computer. Your administrator has
              the installer and the client guides.
            </li>
            <li>In the app’s settings, set the server address to the address below.</li>
          </ol>
          <CopyField
            label="Server address"
            value={serverOrigin}
            data-testid="desktop-server-address"
          />
          {isLoopbackOrigin(serverOrigin) ? (
            <p className="app-note">
              This is a loopback address. It only reaches the server from the machine the server
              runs on, or through a tunnel you set up to it. “localhost” on your own computer is a
              different machine than a remote server.
            </p>
          ) : (
            <p className="app-note">
              The app only accepts links for the server address it is set to, and your computer must
              be able to reach that address.
            </p>
          )}
        </section>

        <section>
          <h3>If the link does not open the app</h3>
          <p>
            Use Paste share link in the desktop app instead. It works without this button.{' '}
            {isGuest
              ? 'Paste the share link you were sent, the original one. This page’s address is not a share link, because the key was removed from it when the page loaded.'
              : onOpenSharing
                ? 'Paste a share link for this document. You can create one in the Share panel.'
                : 'Paste a share link for this document. Ask an administrator for one.'}
          </p>
          {!isGuest && onOpenSharing ? (
            <Button
              size="sm"
              onClick={() => {
                controls.close();
                onOpenSharing();
              }}
            >
              Create a share link
            </Button>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
