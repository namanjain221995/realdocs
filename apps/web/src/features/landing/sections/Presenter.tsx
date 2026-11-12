import { Kbd } from '@realtimedocs/ui';
import { LifeBuoy, Smartphone } from 'lucide-react';
import { CAVEAT, MACOS_WARNING, REQUEST_STATES, VERIFICATION_STATES } from '../copy';

const CAPABILITIES = [
  [
    'Always on top',
    'When pinned, the panel stays above your other windows while you work in them.',
  ],
  ['Adjustable opacity', 'Make it see-through enough to read what is underneath.'],
  [
    'Click-through',
    'Clicks pass through the panel to the window behind it, and there is always a way back.',
  ],
  [
    'Multi-monitor',
    'Park the panel on a display you are not sharing, or move it where you need it.',
  ],
] as const;

/** Private Presenter Mode with the honest protection states. */
export function Presenter() {
  return (
    <section
      id="presenter"
      className="lp-sec lp-sec--tint"
      aria-labelledby="presenter-title"
      data-testid="presenter-section"
    >
      <div className="land-wrap">
        <div className="lp-split lp-split--top">
          <div data-reveal>
            <h2 id="presenter-title" className="lp-h2">
              Private Presenter Mode
            </h2>
            <p className="lp-lead">
              The desktop app shows the live document in a small panel. Private mode in the desktop
              app asks the operating system to leave its own window out of screen capture. It is a
              request, and what it achieves depends on your setup.
            </p>
            <p className="lp-callout" data-testid="presenter-caveat">
              {CAVEAT}
            </p>
            <p className="lp-note">
              Presenter notes are for use in line with your office and meeting policies.
            </p>
          </div>
          <div className="lp-card lp-panelcard" data-reveal aria-label="Presenter panel controls">
            <ul className="lp-caps">
              {CAPABILITIES.map(([title, text]) => (
                <li key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
            <div className="lp-keys">
              <h3>Your way back</h3>
              <p>
                Choose <strong>Return to interactive mode</strong> in the tray or menu-bar menu, or
                press the shortcut. It leaves click-through, shows the panel and moves it fully on
                screen.
              </p>
              <dl>
                <div>
                  <dt>Return to interactive mode</dt>
                  <dd>
                    <Kbd>Ctrl</Kbd> <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>T</Kbd>
                    <span className="lp-or">Mac</span>
                    <Kbd>Cmd</Kbd> <Kbd>Option</Kbd> <Kbd>Shift</Kbd> <Kbd>T</Kbd>
                  </dd>
                </div>
                <div>
                  <dt>Show or hide the panel</dt>
                  <dd>
                    <Kbd>Ctrl</Kbd> <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>D</Kbd>
                    <span className="lp-or">Mac</span>
                    <Kbd>Cmd</Kbd> <Kbd>Option</Kbd> <Kbd>Shift</Kbd> <Kbd>D</Kbd>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <div className="lp-states-grid" data-reveal>
          <div className="lp-card">
            <h3>What the panel can tell you</h3>
            <p>
              The status chip names what RealtimeDocs asked your operating system for and what it
              answered:
            </p>
            <ul className="lp-chips" aria-label="Protection request states">
              {REQUEST_STATES.map((state) => (
                <li key={state}>{state}</li>
              ))}
            </ul>
          </div>
          <div className="lp-card">
            <h3>What only a second person can tell you</h3>
            <p>
              Whether a participant sees the panel can only be confirmed by a second participant or
              device. These states are about that check:
            </p>
            <ul className="lp-chips" aria-label="Verification states">
              {VERIFICATION_STATES.map((state) => (
                <li key={state}>{state}</li>
              ))}
            </ul>
            <p className="lp-note">
              A local screenshot or an operating-system return value is never accepted as
              verification.
            </p>
          </div>
        </div>

        <div className="lp-sure" data-reveal>
          <LifeBuoy aria-hidden="true" />
          <div>
            <h3>The sure way</h3>
            <p>
              The sure way, on every system and meeting app: share a single application window
              instead of your whole screen, or keep your notes on a second screen or device you
              don’t share.
            </p>
          </div>
        </div>

        <dl className="lp-platforms" data-reveal>
          <div>
            <dt>Windows</dt>
            <dd>
              On Windows 10 (version 2004) and later it usually keeps the panel out of a shared
              screen, including an entire-screen share.
            </dd>
          </div>
          <div>
            <dt>macOS</dt>
            <dd>
              On macOS, today’s meeting apps capture it anyway: keep your notes on a second display,
              an iPad or your phone.
              <q className="lp-quote">{MACOS_WARNING}</q>
            </dd>
          </div>
          <div>
            <dt>
              <Smartphone aria-hidden="true" /> Cameras
            </dt>
            <dd>Nothing hides it from a phone camera.</dd>
          </div>
        </dl>

        <div className="lp-card lp-guide" data-testid="safe-share-guide" data-reveal>
          <h3>In the desktop app: Safe Share Guide and Privacy Test Center</h3>
          <p>The Safe Share Guide walks you through four steps before a meeting:</p>
          <ol>
            <li>Share a specific tab, window or application instead of your entire screen.</li>
            <li>Keep RealtimeDocs outside the source you selected.</li>
            <li>Confirm what others see from a second device or with another participant.</li>
            <li>Record the result.</li>
          </ol>
          <p>
            The Privacy Test Center is where you record which exact configurations you have
            verified. Results are shown only for the configuration that was tested, never as a
            general promise.
          </p>
          <p className="lp-note">Test once with a second participant.</p>
        </div>
      </div>
    </section>
  );
}
