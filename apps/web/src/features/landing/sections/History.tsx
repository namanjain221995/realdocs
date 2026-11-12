const ROWS = [
  { time: '15:30:02', what: 'Typed text', who: 'Naman Jain', role: 'Interviewer' },
  { time: '15:30:41', what: 'Pasted content', who: 'Aarav Sharma', role: 'Candidate' },
  { time: '15:31:09', what: 'Inserted image', who: 'Aarav Sharma', role: 'Candidate' },
  { time: '15:33:55', what: 'Changed page settings', who: 'Naman Jain', role: 'Interviewer' },
] as const;

/** Version history: who changed what, with server timestamps. */
export function HistoryShowcase() {
  return (
    <section id="history" className="lp-sec lp-sec--tint" aria-labelledby="history-title">
      <div className="land-wrap lp-split lp-split--flip">
        <div
          className="lp-card lp-timeline"
          data-reveal
          role="group"
          aria-label="Example of a version history timeline"
        >
          <ol>
            {ROWS.map((row) => (
              <li key={row.time}>
                <time>{row.time}</time>
                <div>
                  <strong>{row.what}</strong>
                  <span>
                    {row.who} · {row.role}
                  </span>
                </div>
              </li>
            ))}
            <li className="lp-timeline__admin">
              <time>15:41:55</time>
              <div>
                <strong>Version restored</strong>
                <span>Earlier versions stay in the list</span>
              </div>
            </li>
          </ol>
        </div>
        <div data-reveal>
          <h2 id="history-title" className="lp-h2">
            Version history that names names
          </h2>
          <p className="lp-lead">
            Administrators can see who changed a document, when, and what it looked like then.
          </p>
          <ul className="lp-bullets">
            <li>Every row shows the time to the second, from the server’s clock.</li>
            <li>
              Paste and image events are labelled, so a large insertion is not mistaken for typing.
            </li>
            <li>Filter by editor, by operation or by date, and open any revision.</li>
            <li>Restoring a version never deletes history. It adds an event.</li>
          </ul>
          <p className="lp-note">
            Candidates, interviewers and share-link guests do not see version history.
          </p>
        </div>
      </div>
    </section>
  );
}
