import { CircleCheck } from 'lucide-react';
import { CompatibilityMatrix, VERIFIED_CONFIGURATIONS } from '../compatibility';
import { LINUX_CAPTURE_NOTE } from '../downloads';

interface Row {
  name: string;
  request: string;
  /** What the owner's team did on this platform. A statement of their own tests, not a guarantee. */
  state: string;
  detail: string;
}

const ROWS: readonly Row[] = [
  {
    name: 'Windows',
    request:
      'On Windows 10 (version 2004) and later the system leaves the panel out of what others see in a screen share. Earlier versions show a black area in its place.',
    state: 'Tested by our team',
    detail: 'Panel hidden from the shared screen in our tests.',
  },
  {
    name: 'macOS',
    request:
      'The panel asks macOS to leave it out of screen sharing. Some capture methods (ScreenCaptureKit, whole-display capture) can still include it, so run the one-minute check with your meeting app.',
    state: 'Tested by our team',
    detail: 'Panel hidden from the shared screen in our tests.',
  },
  {
    name: 'Linux',
    request: LINUX_CAPTURE_NOTE,
    state: 'App tested by our team',
    detail: 'Capture exclusion depends on your desktop.',
  },
];

/** Platform compatibility: what each platform does, what the owner's team tested, and the per-app matrix. */
export function Platforms() {
  return (
    <section
      id="platforms"
      className="lp-sec lp-sec--tint"
      aria-labelledby="platforms-title"
      data-testid="compatibility-section"
    >
      <div className="land-wrap">
        <div data-reveal>
          <h2 id="platforms-title" className="lp-h2">
            Platform compatibility
          </h2>
          <p className="lp-lead">
            Your notes stay yours. RealtimeDocs asks the operating system to keep the panel out of
            screen sharing, so the people in your meeting see your screen, not your notes. Our team
            tested it on Windows and macOS. Meeting apps and operating systems keep changing, so
            check your own setup once before you rely on it: the built-in Privacy Test Center takes
            about a minute.
          </p>
        </div>
        <div className="lp-stack" data-reveal>
          <table className="lp-table" data-testid="platform-table">
            <caption className="lp-sr">What each platform is asked to do</caption>
            <thead>
              <tr>
                <th scope="col">Platform</th>
                <th scope="col">Capture exclusion</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th>
                  <td data-label="Capture exclusion">{row.request}</td>
                  <td data-label="Status" data-testid="platform-status">
                    <span className="lp-tested">
                      <CircleCheck aria-hidden="true" />
                      {row.state}
                    </span>
                    <span className="lp-tested__detail">{row.detail}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* The per-app grid appears with the first recorded test; an empty grid says nothing. */}
        {VERIFIED_CONFIGURATIONS.length > 0 ? <CompatibilityMatrix /> : null}
      </div>
    </section>
  );
}
