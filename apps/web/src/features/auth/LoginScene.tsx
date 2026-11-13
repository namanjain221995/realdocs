/**
 * The picture beside the sign-in form: a shared document being written by two people, with the
 * ruler above it and the presenter panel floating over one corner. It is what the product does,
 * drawn with the app's own tokens, and it is decoration: hidden from assistive technology, never
 * focusable, and it holds still when the system asks for reduced motion (the lines are then
 * simply there).
 *
 * One sequence plays once when the page opens: the lines are typed in turn, each by its own
 * caret. Afterwards only the carets blink and the panel drifts a few pixels.
 */
const LINES = [
  // Meera writes the first line and then the third: her caret leaves the first when she moves on.
  { who: 'a', name: 'Meera', text: 'Start with the customer story.', leaves: true },
  { who: 'b', name: 'Aarav', text: 'Show the history of one document.', leaves: false },
  { who: 'a', name: 'Meera', text: 'Agree the date for the next release.', leaves: false },
] as const;

export function LoginScene() {
  return (
    <div className="login-scene" aria-hidden="true" data-testid="login-scene">
      <div className="login-scene__stage">
        <div className="login-scene__sheet">
          <div className="login-scene__ruler">
            <span className="login-scene__margin login-scene__margin--left" />
            <span className="login-scene__margin login-scene__margin--right" />
          </div>
          <div className="login-scene__page">
            <p className="login-scene__title">Review notes</p>
            <p className="login-scene__meta">
              <span className="login-scene__dot" />
              Live
              <span className="login-scene__saved">Saved</span>
            </p>
            <ol className="login-scene__lines">
              {LINES.map((line, index) => (
                <li
                  key={line.text}
                  className="login-scene__line"
                  data-who={line.who}
                  data-leaves={line.leaves ? '' : undefined}
                  style={{ '--i': index } as React.CSSProperties}
                >
                  <span className="login-scene__typed">{line.text}</span>
                  <span className="login-scene__caret">
                    <span className="login-scene__flag">{line.name}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="login-scene__panel">
          <div className="login-scene__panel-bar">
            <span className="login-scene__panel-title">Presenter panel</span>
            <span className="login-scene__pin" />
          </div>
          <p>Start with the customer story.</p>
          <p className="login-scene__panel-next">Show the history of one document.</p>
        </div>
      </div>
    </div>
  );
}
