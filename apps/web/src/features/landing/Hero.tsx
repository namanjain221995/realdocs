import { ArrowRight, BookOpen } from 'lucide-react';
import { Skeleton } from '@realtimedocs/ui';
import { Link } from 'react-router';
import { RouterLinkButton } from '../../components/links';
import { REQUIRED_SENTENCE } from './copy';
import { DownloadPicker } from './DownloadPicker';
import { DemoSlot } from './hero/DemoSlot';
import { useDesktopRelease } from './useDesktopRelease';

export function Hero({ signupEnabled }: { signupEnabled: boolean }) {
  const releases = useDesktopRelease();
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="land-wrap">
        <div className="lp-hero__grid">
          <div className="lp-hero__copy">
            <h1 id="hero-title" className="lp-h1">
              Collaborative documents with a private presenter panel.
            </h1>
            <p className="lp-hero__sub">
              Write together in real time, then open the same notes in Private Presenter Mode: a
              floating panel that asks your operating system to keep it out of screen capture. Built
              for internal office workflows such as interviews, with presenter notes used in line
              with your office and meeting policies.
            </p>
            <p className="lp-callout" data-testid="hero-caveat">
              {REQUIRED_SENTENCE}
            </p>
          </div>
          <div className="lp-hero__cta" data-testid="hero-cta">
            {releases.isPending ? (
              <div role="status" aria-label="Checking which builds are published">
                <Skeleton height={56} />
              </div>
            ) : releases.isError ? (
              <p className="dl-empty" role="note">
                The list of desktop builds could not be loaded just now. See{' '}
                <Link to="#download">the download section</Link> to try again.
              </p>
            ) : (
              <DownloadPicker release={releases.data?.current ?? null} headingLevel={2} compact />
            )}
            <div className="lp-hero__actions">
              <RouterLinkButton to="/login" variant="secondary" data-testid="hero-sign-in">
                Sign in
              </RouterLinkButton>
              {signupEnabled ? (
                <RouterLinkButton to="/signup" variant="ghost" data-testid="hero-sign-up">
                  Sign up
                </RouterLinkButton>
              ) : null}
              <RouterLinkButton
                to="/docs"
                variant="ghost"
                iconLeft={<BookOpen />}
                data-testid="hero-docs"
              >
                Read the API docs
              </RouterLinkButton>
            </div>
            <p className="lp-hero__more">
              <Link to="#download" data-testid="hero-download">
                Checksums and other platforms <ArrowRight aria-hidden="true" />
              </Link>
            </p>
          </div>
        </div>
        <DemoSlot />
      </div>
    </section>
  );
}
