import './landing.css';
import {
  FileText,
  History,
  KeyRound,
  LifeBuoy,
  Link2,
  MonitorUp,
  ShieldCheck,
  Smartphone,
  Users,
  WifiOff,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/Brand';
import { RouterLinkButton } from '../../components/links';
import { ThemeControl } from '../../components/ThemeControl';
import { useDocumentTitle } from '../../lib/hooks';
import { useServerMeta } from '../../lib/useLimits';
import { CompatibilityMatrix } from './compatibility';
import { DownloadSection } from './DownloadSection';

/** The owner's wording; shown under the headline and in the screen-sharing section. */
export const CAVEAT =
  'Behavior depends on your operating system, meeting application, capture mode, and version. Verify your setup before relying on it.';
const MACOS_WARNING =
  'Whole-display capture may include RealtimeDocs on this macOS and meeting-app configuration. Share a selected application, window, or browser tab and verify using another participant.';

const line = (index: number): CSSProperties => ({ '--i': index }) as CSSProperties;

/**
 * A drawn picture, not a screenshot: a shared document being edited by two people, and the
 * translucent presenter panel next to it that mirrors the same notes. The lines are typed in
 * once, by CSS, on load; with reduced motion the picture is simply there.
 */
function HeroPicture() {
  return (
    <div className="land-pic" aria-hidden="true" data-testid="hero-picture">
      <div className="land-doc">
        <div className="land-doc__bar">
          <span className="land-doc__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="land-doc__title">Client call, Thursday</span>
          <span className="land-doc__people">
            <b>A</b>
            <b>P</b>
          </span>
        </div>
        <div className="land-doc__body">
          <p className="land-line land-doc__h" style={line(0)}>
            Agenda
          </p>
          <p className="land-line" style={line(1)}>
            Confirm the new timeline
          </p>
          <p className="land-line land-doc__task" style={line(2)} data-done="true">
            <span className="land-box" />
            Send the revised quote
          </p>
          <p className="land-line land-doc__task" style={line(3)}>
            <span className="land-box" />
            Book the follow-up
          </p>
          <div className="land-line land-doc__table" style={line(4)}>
            <span>Option A</span>
            <span>4,200</span>
            <span>Option B</span>
            <span>5,100</span>
          </div>
          <p className="land-line land-doc__other" style={line(5)}>
            <span className="land-flag">Priya</span>
            They also want the PDF
            <span className="land-caret land-caret--other" />
          </p>
        </div>
      </div>
      <div className="land-panel">
        <div className="land-panel__head">
          <span className="land-panel__dot" />
          Presenter panel
          <span className="land-panel__live">Live</span>
        </div>
        <p className="land-line" style={line(2)}>
          Confirm the new timeline
        </p>
        <p className="land-line" style={line(3)}>
          Walk through the two options
        </p>
        <p className="land-line" style={line(6)}>
          They also want the PDF
          <span className="land-caret" />
        </p>
      </div>
    </div>
  );
}

interface Feature {
  icon: ReactNode;
  title: string;
  text: string;
  link?: { to: string; label: string };
}

const FEATURES: readonly Feature[] = [
  {
    icon: <Users />,
    title: 'Live collaboration',
    text: 'Several people edit the same document at once and see each other’s changes as they are typed. No refreshing, no merging, no “final_v3”.',
  },
  {
    icon: <FileText />,
    title: 'Rich documents',
    text: 'Headings, tables, code with highlighting, images pasted straight in, diagrams written as text, checklists and callouts.',
  },
  {
    icon: <Link2 />,
    title: 'Secure links',
    text: 'Share links are view-only unless you choose otherwise, can expire, and stop working the moment you revoke them, even for someone who already has the document open.',
  },
  {
    icon: <MonitorUp />,
    title: 'Windows',
    text: 'A floating, see-through notes panel that stays on top, with click-through so you can work underneath it.',
    link: { to: '/docs/windows-client', label: 'Windows guide' },
  },
  {
    icon: <MonitorUp />,
    title: 'macOS',
    text: 'The same panel on Apple Silicon and Intel Macs. Screen-share behavior differs from Windows, and the guide says how.',
    link: { to: '/docs/macos-client', label: 'macOS guide' },
  },
  {
    icon: <WifiOff />,
    title: 'Offline recovery',
    text: 'If you lose your connection, unsent changes stay on your device and are merged when you are back. The status always says whether your work has reached the server.',
  },
  {
    icon: <History />,
    title: 'Snapshots',
    text: 'Save the document as it is now, and restore that version later if a meeting went somewhere unexpected.',
  },
  {
    icon: <ShieldCheck />,
    title: 'Privacy verification',
    text: 'The Privacy Test Center in the desktop app is where you record which exact setups you checked, so you rely on your own results.',
  },
];

const FAQ: readonly { question: string; answer: ReactNode }[] = [
  {
    question: 'Can meeting participants see my notes?',
    answer: (
      <>
        <p>
          It depends on your operating system, meeting application, version and sharing mode. On
          Windows 10 (version 2004 and later) and Windows 11, the panel is usually left out of
          captures. On macOS, whole-display capture may include it. Always verify with a second
          participant before you rely on it, and when in doubt share one window instead of your
          whole screen.
        </p>
        <p>Nothing hides the panel from a phone camera, or from a person standing behind you.</p>
      </>
    ),
  },
  {
    question: 'Do I have to install anything?',
    answer: (
      <p>
        No. Open your share link in any modern browser to read or edit. The desktop app is only
        needed for the floating panel.
      </p>
    ),
  },
  {
    question: 'Who can open a document?',
    answer: (
      <p>
        Members of your workspace you add to it, and anyone you give a share link to. A link is
        view-only unless you make it an edit link, and you can set an expiry or revoke it at any
        time.
      </p>
    ),
  },
  {
    question: 'How do I get an account?',
    answer: (
      <p>
        Accounts are normally created from an invitation link that your workspace administrator
        sends you. Some servers also allow signing up yourself; when this one does, a “Sign up”
        button appears at the top of this page.
      </p>
    ),
  },
  {
    question: 'What happens if my connection drops?',
    answer: (
      <p>
        Your unsent changes stay on your device and are merged when the connection returns. The
        status next to the title shows whether your latest work has been saved.
      </p>
    ),
  },
  {
    question: 'Why does Windows or macOS warn me when I open the app?',
    answer: (
      <p>
        The desktop builds are not signed yet, so SmartScreen and Gatekeeper show a warning the
        first time. Keep those protections on and follow the steps in the{' '}
        <Link to="/docs/windows-client">Windows</Link> or <Link to="/docs/macos-client">macOS</Link>{' '}
        guide.
      </p>
    ),
  },
];

export function LandingPage() {
  useDocumentTitle(null);
  const signupEnabled = useServerMeta().data?.signupEnabled === true;
  return (
    <div className="land" data-testid="landing">
      <header className="land-top">
        <div className="land-wrap land-top__row">
          <Brand to="/" />
          <div className="land-top__end">
            <a className="rd-link rd-link--quiet land-top__jump" href="#download">
              Download
            </a>
            <Link to="/login" className="rd-link rd-link--quiet">
              Sign in
            </Link>
            {signupEnabled ? (
              <Link to="/signup" className="rd-link rd-link--quiet" data-testid="top-sign-up">
                Sign up
              </Link>
            ) : null}
            <ThemeControl compact className="land-top__theme" />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="land-main">
        <section className="land-hero" aria-labelledby="hero-title">
          <div className="land-wrap land-hero__grid">
            <div className="land-hero__copy">
              <p className="land-hero__name">RealtimeDocs</p>
              <h1 id="hero-title" className="land-h1">
                Private presenter notes with <span className="nowrap">OS-supported</span>{' '}
                <span className="nowrap">screen-share</span> exclusion.
              </h1>
              <p className="land-hero__second" data-testid="hero-second">
                Verify your exact meeting setup before relying on privacy mode.
              </p>
              <p className="land-hero__caveat" data-testid="hero-caveat">
                {CAVEAT}
              </p>
              <div className="land-hero__actions">
                <RouterLinkButton to="/login" variant="primary" data-testid="hero-sign-in">
                  Sign in
                </RouterLinkButton>
                <RouterLinkButton to="#download" data-testid="hero-download">
                  Download the desktop app
                </RouterLinkButton>
                {signupEnabled ? (
                  <RouterLinkButton to="/signup" variant="ghost" data-testid="hero-sign-up">
                    Sign up
                  </RouterLinkButton>
                ) : null}
              </div>
            </div>
            <HeroPicture />
          </div>
        </section>

        <section className="land-section" aria-labelledby="what-title">
          <div className="land-wrap land-split">
            <div>
              <h2 id="what-title" className="land-h2">
                What it does
              </h2>
              <p className="land-lead">
                Documents that several people can edit at the same moment, with your notes always
                one glance away.
              </p>
            </div>
            <ul className="land-points">
              <li>
                <FileText aria-hidden="true" />
                <div>
                  <h3>Live collaborative documents</h3>
                  <p>
                    Everyone sees changes as they are typed. Nobody has to refresh, merge or send a
                    new version.
                  </p>
                </div>
              </li>
              <li>
                <Link2 aria-hidden="true" />
                <div>
                  <h3>Share with anyone</h3>
                  <p>
                    An administrator creates documents and shares view or edit links with members
                    and with people outside your team: clients, candidates, friends.
                  </p>
                </div>
              </li>
              <li>
                <MonitorUp aria-hidden="true" />
                <div>
                  <h3>A panel for presenting</h3>
                  <p>
                    The desktop app shows your live notes in a floating panel on top of everything
                    else, so you can read them while you present.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className="land-section land-meeting-notes" aria-labelledby="notes-title">
          <div className="land-wrap">
            <div className="land-card" data-testid="meeting-notes-card">
              <h2 id="notes-title" className="land-h2">
                Meeting notes
              </h2>
              <p className="land-lead">
                Keep one document for each meeting, and let the other person follow along. Notes
                save live and survive reconnects.
              </p>
              <p className="land-card__line">
                Share a link with a client or a friend. They open it in the browser or in the
                desktop panel.
              </p>
            </div>
          </div>
        </section>

        <section className="land-section" aria-labelledby="workflow-title" data-testid="workflow">
          <div className="land-wrap">
            <h2 id="workflow-title" className="land-h2">
              From a blank page to a verified meeting
            </h2>
            <ol className="land-steps land-steps--five">
              <li>
                <div>
                  <strong>Create</strong>
                  <span>Start one document for the meeting.</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>Share</strong>
                  <span>Make a view or edit link, with an expiry if you like.</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>Paste the link</strong>
                  <span>Paste it into the desktop app, or open it in a browser.</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>Open Presenter Mode</strong>
                  <span>Put the notes in the floating panel.</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>Verify the meeting setup</strong>
                  <span>
                    Check what a second participant sees, with your meeting app and sharing mode.
                  </span>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="land-section" aria-labelledby="features-title">
          <div className="land-wrap">
            <h2 id="features-title" className="land-h2">
              Built for notes you can rely on
            </h2>
            <ul className="land-features">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="land-feature">
                  <span className="land-feature__icon" aria-hidden="true">
                    {feature.icon}
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                  {feature.link ? <Link to={feature.link.to}>{feature.link.label}</Link> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className="land-section land-presenting"
          aria-labelledby="presenting-title"
          data-testid="presenter-section"
        >
          <div className="land-wrap">
            <h2 id="presenting-title" className="land-h2">
              Presenter panel and screen sharing
            </h2>
            <p className="land-lead">
              Whether other people can see your notes depends on how you share and on your operating
              system. This is what we can and cannot say.
            </p>
            <p className="land-caveat" data-testid="presenter-caveat">
              {CAVEAT}
            </p>
            <div className="land-sure">
              <LifeBuoy aria-hidden="true" />
              <div>
                <h3>The sure way</h3>
                <p>
                  The sure way, on every system and meeting app: share a single application window
                  instead of your whole screen, or keep your notes on a second screen or device you
                  don&rsquo;t share.
                </p>
              </div>
            </div>
            <div className="land-extra">
              <h3>An extra layer: private mode</h3>
              <p>
                Private mode in the desktop app asks the operating system to leave its own window
                out of screen capture.
              </p>
              <dl className="land-platforms">
                <div>
                  <dt>Windows</dt>
                  <dd>
                    On Windows 10 (version 2004) and later it usually keeps the panel out of a
                    shared screen, including an entire-screen share.
                  </dd>
                </div>
                <div>
                  <dt>macOS</dt>
                  <dd>
                    On macOS, today&rsquo;s meeting apps capture it anyway: keep your notes on a
                    second display, an iPad or your phone.
                    <q className="land-quote">{MACOS_WARNING}</q>
                  </dd>
                </div>
                <div>
                  <dt>
                    <Smartphone aria-hidden="true" /> Cameras
                  </dt>
                  <dd>Nothing hides it from a phone camera.</dd>
                </div>
              </dl>
              <p className="land-extra__test">Test once with a second participant.</p>
            </div>
            <div className="land-guide" data-testid="safe-share-guide">
              <h3>In the desktop app: Safe Share Guide and Privacy Test Center</h3>
              <p>
                The desktop app contains a Safe Share Guide that walks you through four steps before
                a meeting:
              </p>
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
            </div>
          </div>
        </section>

        <section
          className="land-section"
          aria-labelledby="compat-title"
          data-testid="compatibility-section"
        >
          <div className="land-wrap">
            <h2 id="compat-title" className="land-h2">
              Compatibility, honestly
            </h2>
            <p className="land-lead">
              What a meeting participant sees depends on the operating system, the meeting app, its
              version and the sharing mode you pick. The table below lists only setups that someone
              has actually tested, with the evidence. Every other cell says &ldquo;Not
              tested&rdquo;, and that is the truth today.
            </p>
            <CompatibilityMatrix />
          </div>
        </section>

        <DownloadSection />

        <section className="land-section" aria-labelledby="start-title" data-testid="get-started">
          <div className="land-wrap land-split">
            <div>
              <h2 id="start-title" className="land-h2">
                Get started
              </h2>
              <p className="land-lead">Three ways in, depending on how you were given access.</p>
            </div>
            <ul className="land-points">
              <li>
                <KeyRound aria-hidden="true" />
                <div>
                  <h3>Sign in</h3>
                  <p>
                    Already have an account? <Link to="/login">Sign in</Link> to see your documents.
                  </p>
                </div>
              </li>
              <li>
                <Link2 aria-hidden="true" />
                <div>
                  <h3>Accept an invitation</h3>
                  <p>
                    Invitation links come from your administrator. Open the link you were sent, and
                    you will be asked for your name and a password.
                  </p>
                </div>
              </li>
              {signupEnabled ? (
                <li data-testid="start-sign-up">
                  <Users aria-hidden="true" />
                  <div>
                    <h3>Sign up</h3>
                    <p>
                      This server lets you create your own account.{' '}
                      <Link to="/signup">Sign up</Link>.
                    </p>
                  </div>
                </li>
              ) : null}
            </ul>
          </div>
        </section>

        <section className="land-section land-faq" aria-labelledby="faq-title">
          <div className="land-wrap">
            <h2 id="faq-title" className="land-h2">
              Questions
            </h2>
            <div className="land-faq__list" data-testid="faq">
              {FAQ.map((item) => (
                <details key={item.question} className="land-faq__item">
                  <summary>{item.question}</summary>
                  <div className="land-faq__answer">{item.answer}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="land-section land-facts" aria-label="Privacy, security and limitations">
          <div className="land-wrap land-facts__grid">
            <div data-testid="privacy">
              <h2 className="land-h3">Privacy</h2>
              <p>
                The desktop app asks for no microphone, camera or screen-recording permission, and
                needs no administrator rights for normal use. The results you record in the Privacy
                Test Center stay on your computer.
              </p>
            </div>
            <div data-testid="security">
              <h2 className="land-h3">Security</h2>
              <p>
                The server stores only a hash of each share link, so a leaked database does not leak
                working links. Links are view-only by default, can expire, and revoking one
                disconnects the people who have it open at that moment.{' '}
                <Link to="/docs/security">Read the security page</Link>.
              </p>
            </div>
            <div data-testid="limitations">
              <h2 className="land-h3">Limitations</h2>
              <p>
                The native Windows and macOS behavior has not been verified on real computers with
                real meeting apps yet; the guides mark it as not tested. Hiding a window from screen
                capture does nothing against a phone camera or a person looking at your screen.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="land-footer">
        <div className="land-wrap land-footer__row">
          <Brand to="/" />
          <nav aria-label="Footer" className="land-footer__nav">
            <Link to="/docs/readme">About</Link>
            <Link to="/docs/windows-client">Windows app</Link>
            <Link to="/docs/macos-client">macOS app</Link>
            <Link to="/docs/security">Security</Link>
            <Link to="/login">Sign in</Link>
          </nav>
          <ThemeControl />
        </div>
      </footer>
    </div>
  );
}
