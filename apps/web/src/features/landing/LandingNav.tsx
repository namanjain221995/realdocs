import { Download, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/Brand';
import { ThemeControl } from '../../components/ThemeControl';
import { NAV_LINKS } from './copy';
import { PLATFORM_NAMES, chooseBuild } from './downloads';
import { detectPlatform, type PlatformGuess } from './platform';
import { useDesktopRelease } from './useDesktopRelease';

function useGuess(): PlatformGuess | null {
  const [guess, setGuess] = useState<PlatformGuess | null>(null);
  useEffect(() => {
    let alive = true;
    const nav = navigator as Navigator & {
      userAgentData?: Parameters<typeof detectPlatform>[0]['userAgentData'];
    };
    void detectPlatform({
      userAgent: nav.userAgent,
      userAgentData: nav.userAgentData,
      maxTouchPoints: nav.maxTouchPoints,
    }).then((result) => {
      if (alive) setGuess(result);
    });
    return () => {
      alive = false;
    };
  }, []);
  return guess;
}

/**
 * The label of the nav button: "Download for Windows" only when this server publishes a build for
 * the detected computer, otherwise plain "Download". It always goes to the download section, where
 * the checksum, the signature and the manual chooser are, so nothing starts downloading from here.
 */
function useDownloadLabel(): string {
  const guess = useGuess();
  const release = useDesktopRelease().data?.current ?? null;
  if (!guess || guess.unsupported || !guess.platform || !release) return 'Download';
  return chooseBuild(release, guess.platform, guess.arch ?? 'x64')
    ? `Download for ${PLATFORM_NAMES[guess.platform]}`
    : 'Download';
}

export function LandingNav({ signupEnabled }: { signupEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [action = 'Download', os] = useDownloadLabel().split(' for ');

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="lp-nav">
      <div className="land-wrap lp-nav__row">
        <Brand to="/" />
        <nav aria-label="Page sections" className="lp-nav__links">
          {NAV_LINKS.filter((item) => item.href !== '#download').map((item) => (
            <Link key={item.href} to={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="lp-nav__end">
          <ThemeControl compact className="lp-nav__theme" />
          <Link to="/login" className="lp-nav__signin">
            Sign in
          </Link>
          {signupEnabled ? (
            <Link to="/signup" className="lp-nav__signin" data-testid="top-sign-up">
              Sign up
            </Link>
          ) : null}
          <Link
            to="#download"
            className="lp-btn lp-btn--primary lp-nav__cta"
            data-testid="nav-download"
          >
            <Download aria-hidden="true" />
            <span>{action}</span>
            {os ? <span className="lp-nav__for"> for {os}</span> : null}
          </Link>
          <button
            ref={buttonRef}
            type="button"
            className="lp-nav__toggle"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            <span className="lp-sr">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </div>
      <div id={menuId} className="lp-nav__menu" hidden={!open} data-testid="nav-menu">
        <div className="land-wrap lp-nav__menu-inner">
          <nav aria-label="Page sections (menu)">
            {NAV_LINKS.map((item) => (
              <Link key={item.href} to={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ))}
            <Link to="/login">Sign in</Link>
          </nav>
          <ThemeControl />
        </div>
      </div>
    </header>
  );
}
