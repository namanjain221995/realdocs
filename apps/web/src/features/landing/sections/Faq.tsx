import type { ReactNode } from 'react';
import { Link } from 'react-router';

export const FAQ: readonly { question: string; answer: ReactNode }[] = [
  {
    question: 'Can other participants see the presenter panel?',
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
    question: 'Can the panel be detected?',
    answer: (
      <p>
        We make no claim about detection. RealtimeDocs asks the operating system to leave its own
        window out of capture; it does not stop other software, cameras or people from noticing that
        you use it.
      </p>
    ),
  },
  {
    question: 'Which meeting apps does it work with?',
    answer: (
      <p>
        We cannot say yet. No combination of meeting app and capture mode has been tested, and the
        compatibility tables above say “Not tested” for every cell until someone records a result.
      </p>
    ),
  },
  {
    question: 'Does clicking download install the app?',
    answer: (
      <p>
        No. The button downloads a file. You check its SHA-256 checksum if you like, then open and
        install it yourself. Nothing is installed automatically.
      </p>
    ),
  },
  {
    question: 'Which platforms are signed?',
    answer: (
      <p>
        Whatever the release manifest on this server says. Each build in the download section shows
        its own signature status. When a build is unsigned, Windows SmartScreen or macOS Gatekeeper
        warns you before it opens: keep those protections on and follow the{' '}
        <Link to="/guides/windows-client">Windows</Link>,{' '}
        <Link to="/guides/macos-client">macOS</Link> or <Link to="/guides/linux-client">Linux</Link>{' '}
        guide.
      </p>
    ),
  },
  {
    question: 'Do candidates need the desktop app?',
    answer: (
      <p>
        No. A candidate opens their link in a browser. Candidates get no desktop app link and no
        download controls, and the server refuses export and desktop hand-off for them.
      </p>
    ),
  },
  {
    question: 'Is it meant to get around monitoring or rules?',
    answer: (
      <p>
        No. RealtimeDocs is for internal office workflows. Use presenter notes in line with your
        office and meeting policies.
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
    question: 'How do I get an account?',
    answer: (
      <p>
        Accounts are normally created from an invitation link that your workspace administrator
        sends you. Some servers also allow signing up yourself; when this one does, a “Sign up”
        button appears at the top of this page.
      </p>
    ),
  },
];

export function Faq() {
  return (
    <section id="faq" className="lp-sec land-faq" aria-labelledby="faq-title">
      <div className="land-wrap lp-faq">
        <h2 id="faq-title" className="lp-h2" data-reveal>
          Questions
        </h2>
        <div className="land-faq__list" data-testid="faq" data-reveal>
          {FAQ.map((item) => (
            <details key={item.question} className="land-faq__item">
              <summary>{item.question}</summary>
              <div className="land-faq__answer">{item.answer}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
