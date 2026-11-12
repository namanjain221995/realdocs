import { Button, Dialog } from '@realtimedocs/ui';
import { MonitorOff } from 'lucide-react';
import { useState } from 'react';

/** The exact wording is part of the product's capture-status vocabulary; do not rephrase it. */
export const BROWSER_CAPTURE_LABEL = 'Browser mode: capture exclusion unavailable';

export interface CaptureStatusProps {
  /** Starts the Open in Desktop flow from the guidance dialog. */
  onOpenInDesktop?: () => void;
}

/**
 * Says plainly that a browser tab cannot be kept out of screen sharing, and
 * links to what to do instead. A web page must never suggest otherwise.
 */
export function CaptureStatus({ onOpenInDesktop }: CaptureStatusProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="doc-capture" data-testid="capture-status">
      <MonitorOff className="doc-capture__icon" aria-hidden="true" />
      <span
        className="doc-capture__label"
        title="A web page cannot be kept out of screen sharing or recording."
      >
        {BROWSER_CAPTURE_LABEL}
      </span>
      <button
        type="button"
        className="rd-link doc-capture__more"
        onClick={() => setOpen(true)}
        data-testid="capture-guidance-link"
      >
        Desktop and fallback guidance
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Screen sharing and this page"
        description="This tab can appear in a screen share or a recording like any other window."
        data-testid="capture-guidance"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            {onOpenInDesktop ? (
              <Button
                variant="primary"
                onClick={() => {
                  setOpen(false);
                  onOpenInDesktop();
                }}
              >
                Open in Desktop
              </Button>
            ) : null}
          </>
        }
      >
        <div className="doc-guidance">
          <p>
            A web page cannot ask the operating system to leave it out of screen capture, so
            RealtimeDocs in a browser offers no capture exclusion at all. Nothing on this page
            changes that, whichever browser you use.
          </p>
          <h3>If the document should stay out of a meeting</h3>
          <ul>
            <li>
              Share one window, such as your slides, instead of the entire screen, and keep this tab
              out of that window.
            </li>
            <li>
              Keep the document on a second display or another device that you are not sharing.
            </li>
            <li>
              Ask someone in the meeting what they actually see before you rely on it. Your own
              screen is not evidence of what participants receive.
            </li>
          </ul>
          <h3>The desktop app</h3>
          <p>
            RealtimeDocs Desktop for Windows and macOS shows the document in a floating panel and
            can ask the operating system to exclude that panel from capture. Whether the request has
            an effect depends on the system and the meeting app. On macOS, current capture methods
            can still include the panel. The app reports its own status and never promises that a
            meeting cannot see it.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
