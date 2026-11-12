import { CompatibilityMatrix } from '../compatibility';
import { LINUX_CAPTURE_NOTE } from '../downloads';

const ROWS = [
  {
    name: 'Windows',
    request:
      'Requests capture exclusion on Windows 10 (version 2004) and later. Earlier versions can only replace the window with a black area.',
    state: 'Not tested',
  },
  {
    name: 'macOS',
    request:
      'A best-effort request. Applications that capture with ScreenCaptureKit can still include the window, and whole-display capture may include RealtimeDocs.',
    state: 'Not tested',
  },
  { name: 'Linux', request: LINUX_CAPTURE_NOTE, state: 'Not tested' },
] as const;

/** Platform compatibility: what is requested per platform, and the matrix that nobody has filled in yet. */
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
            What a meeting participant sees depends on the operating system, the meeting app, its
            version and the sharing mode. The tables list only setups that someone has actually
            tested, with the evidence. Every other cell says “Not tested”, and that is the truth
            today.
          </p>
        </div>
        <div className="lp-stack" data-reveal>
          <table className="lp-table" data-testid="platform-table">
            <caption className="lp-sr">What each platform is asked to do</caption>
            <thead>
              <tr>
                <th scope="col">Platform</th>
                <th scope="col">Capture exclusion</th>
                <th scope="col">Tested with meeting apps</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th>
                  <td data-label="Capture exclusion">{row.request}</td>
                  <td data-label="Tested with meeting apps">{row.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CompatibilityMatrix />
      </div>
    </section>
  );
}
