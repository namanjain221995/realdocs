const ITEMS = [
  [
    'Typing never waits for the network',
    'Your keystrokes are applied in your own editor first and synchronised in the background.',
  ],
  [
    '“Saved” means the server stored it',
    'The indicator changes only after the server confirms the change was committed.',
  ],
  [
    'Reconnect without loss',
    'Changes made while offline are kept on the device and merged when the connection returns.',
  ],
] as const;

/** Performance and reliability, without numbers: no load-test report is published. */
export function Reliability() {
  return (
    <section id="reliability" className="lp-sec" aria-labelledby="reliability-title">
      <div className="land-wrap lp-split lp-split--top">
        <div data-reveal>
          <h2 id="reliability-title" className="lp-h2">
            Performance and reliability
          </h2>
          <p className="lp-lead">
            The design goal is that a document feels as fast as a local one. Measurements made on
            one test host are written up in the repository’s performance notes; no load-test report
            is published, so this page quotes no figures.
          </p>
        </div>
        <ul className="lp-points" data-reveal>
          {ITEMS.map(([title, text]) => (
            <li key={title}>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
