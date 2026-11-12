import { FileText, History, Users, WifiOff } from 'lucide-react';

const POINTS = [
  {
    icon: <Users />,
    title: 'Everyone in the same document',
    text: 'Edits appear as they are typed, with a labelled cursor and a role for each person. No refreshing, merging or “final_v3”.',
  },
  {
    icon: <FileText />,
    title: 'Real documents, not plain text',
    text: 'Headings, tables, checklists, highlighted code and pasted images, on a page with a ruler whose margins you can drag.',
  },
  {
    icon: <WifiOff />,
    title: 'A save state you can believe',
    text: 'The header says Saving… or Saved. If the connection drops, unsent changes stay on your device and are merged when it returns.',
  },
] as const;

/** Real-time collaboration: what it feels like, and what the indicators promise. */
export function Product() {
  return (
    <section id="product" className="lp-sec" aria-labelledby="product-title">
      <div className="land-wrap lp-split">
        <div data-reveal>
          <h2 id="product-title" className="lp-h2">
            Write together, in the same moment
          </h2>
          <p className="lp-lead">
            RealtimeDocs is a collaborative editor built for conversations that happen while you
            type: interviews, reviews, planning calls.
          </p>
          <ul className="lp-points">
            {POINTS.map((point) => (
              <li key={point.title}>
                <span className="lp-ico" aria-hidden="true">
                  {point.icon}
                </span>
                <div>
                  <h3>{point.title}</h3>
                  <p>{point.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <figure className="lp-fig" data-reveal>
          <div
            className="lp-card lp-states"
            role="img"
            aria-label="The three save states a document shows: Saving, Saved, and offline with changes kept on the device."
          >
            <div className="lp-states__row">
              <span className="lp-pill lp-pill--warn">Saving…</span>
              <span>Your change is on its way to the server.</span>
            </div>
            <div className="lp-states__row">
              <span className="lp-pill lp-pill--ok">Saved</span>
              <span>The server confirmed it stored your change.</span>
            </div>
            <div className="lp-states__row">
              <span className="lp-pill lp-pill--off">Offline</span>
              <span>Changes stay on this device and merge when you reconnect.</span>
            </div>
          </div>
          <figcaption>
            <History aria-hidden="true" /> The indicator reports what happened, not what is hoped.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
