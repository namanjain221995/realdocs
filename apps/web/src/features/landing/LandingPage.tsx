import './landing.css';
import { useRef } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/Brand';
import { ThemeControl } from '../../components/ThemeControl';
import { useDocumentTitle } from '../../lib/hooks';
import { DOCUMENTS_PATH, PRODUCT_PATH } from '../../lib/navigation';
import { DownloadSection } from './DownloadSection';
import { Hero } from './Hero';
import { LandingNav } from './LandingNav';
import { ApiSection } from './sections/ApiSection';
import { Faq } from './sections/Faq';
import { GetStarted } from './sections/GetStarted';
import { HistoryShowcase } from './sections/History';
import { Platforms } from './sections/Platforms';
import { Presenter } from './sections/Presenter';
import { Product } from './sections/Product';
import { Reliability } from './sections/Reliability';
import { Security } from './sections/Security';
import { Sessions } from './sections/Sessions';
import { useReveal } from './useReveal';

export { CAVEAT, REQUIRED_SENTENCE } from './copy';

export function LandingPage() {
  useDocumentTitle(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  return (
    <div ref={rootRef} className="land rd-landing" data-testid="landing">
      <LandingNav />
      <main id="main" tabIndex={-1} className="land-main">
        <Hero />
        <Product />
        <Presenter />
        <Sessions />
        <HistoryShowcase />
        <ApiSection />
        <Security />
        <Reliability />
        <Platforms />
        <DownloadSection />
        <GetStarted />
        <Faq />
      </main>

      <footer className="lp-footer">
        <div className="land-wrap">
          <div className="lp-footer__row">
            <Brand to={PRODUCT_PATH} />
            <nav aria-label="Footer" className="lp-footer__nav">
              <Link to="/guides/readme">About</Link>
              <Link to="/guides/windows-client">Windows app</Link>
              <Link to="/guides/macos-client">macOS app</Link>
              <Link to="/guides/linux-client">Linux app</Link>
              <Link to="/guides/security">Security</Link>
              <Link to="/docs">Developers</Link>
              <Link to={DOCUMENTS_PATH}>My documents</Link>
            </nav>
            <ThemeControl />
          </div>
          <p className="lp-footer__fine">
            RealtimeDocs is for internal office workflows. Use presenter notes in line with your
            office and meeting policies.
          </p>
        </div>
      </footer>
    </div>
  );
}
