/**
 * The Safe Share Guide, rendered from `buildShareGuide` (plain data, tested
 * on its own). Used by the panel's card and by the Privacy tab in Settings,
 * so both always say the same thing.
 */
import { Button } from '@realtimedocs/ui';
import { buildShareGuide } from '../../shared/share-guide';
import type { AppState } from '../../shared/state';
import { desktop } from './desktop';

export function ShareGuideView({
  state,
  headingLevel = 2,
}: {
  state: AppState;
  headingLevel?: 2 | 3;
}) {
  const guide = buildShareGuide(state.app.platform, state.capture.status);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const Sub = headingLevel === 2 ? 'h3' : 'h4';
  return (
    <section className="rd-guide" data-testid="rd-share-guide" aria-label={guide.title}>
      <Heading className="rd-guide-title">{guide.title}</Heading>
      <ol className="rd-guide-steps" data-testid="rd-share-guide-steps">
        {guide.steps.map((step) => (
          <li key={step.number} className="rd-guide-step">
            <span>{step.text}</span>
            {step.link ? (
              <Button
                size="sm"
                variant="ghost"
                className="rd-guide-link"
                data-testid="rd-share-guide-test-center"
                onClick={() =>
                  void desktop?.window.action('open-settings', { tab: step.link?.tab ?? 'privacy' })
                }
              >
                {step.link.label}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <Sub className="rd-guide-subtitle">{guide.platform.heading}</Sub>
      {guide.platform.paragraphs.map((paragraph) => (
        <p key={paragraph} className="rd-guide-platform" data-testid="rd-share-guide-platform">
          {paragraph}
        </p>
      ))}
      <ul className="rd-guide-notes">
        {guide.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
