import type { ReleaseArch, ReleasePlatform } from '@realtimedocs/contracts';
import { Button, CopyField, LinkButton } from '@realtimedocs/ui';
import { Download } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  FORMAT_LABELS,
  LINUX_CAPTURE_NOTE,
  PLATFORMS,
  PLATFORM_NAMES,
  archLabel,
  buildLabel,
  chooseBuild,
  formatBytes,
  orderBuilds,
  signatureNotice,
  type DisplayArtifact,
  type DisplayRelease,
} from './downloads';
import { detectPlatform, type PlatformGuess } from './platform';

const UNSUPPORTED_TEXT = {
  ios: 'an iPhone or iPad',
  android: 'an Android device',
  chromeos: 'a Chromebook',
} as const;

function readNavigator(): Promise<PlatformGuess> {
  const nav = navigator as Navigator & {
    userAgentData?: Parameters<typeof detectPlatform>[0]['userAgentData'];
  };
  return detectPlatform({
    userAgent: nav.userAgent,
    userAgentData: nav.userAgentData,
    maxTouchPoints: nav.maxTouchPoints,
  });
}

function BuildDetails({ build, tid }: { build: DisplayArtifact; tid: (name: string) => string }) {
  return (
    <dl className="dl-facts" data-testid={tid('download-facts')}>
      <dt>Format</dt>
      <dd>{FORMAT_LABELS[build.format]}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(build.sizeBytes)}</dd>
      <dt>Needs</dt>
      <dd>{build.minimumOsVersion ?? 'Not stated by this server'}</dd>
      <dt>Signature</dt>
      <dd data-testid={tid('download-signature')} data-status={build.signatureStatus}>
        {signatureNotice(build.signatureStatus, build.platform)}
      </dd>
      <dt>SHA-256</dt>
      <dd>
        <CopyField
          value={build.sha256}
          aria-label={`SHA-256 checksum of ${build.fileName}`}
          copyLabel="Copy checksum"
          data-testid={tid('download-sha256')}
        />
      </dd>
    </dl>
  );
}

export interface DownloadPickerProps {
  release: DisplayRelease | null;
  /** Heading level of the picker's own headings (the page decides). */
  headingLevel?: 2 | 3;
  /**
   * The hero's smaller variant: the same detection, states and wording, a tighter layout. Its test
   * ids are prefixed with `hero-` so one page can hold both pickers.
   */
  compact?: boolean;
}

/**
 * The detected platform's download, a way to choose another, and the list of every file. Nothing
 * is offered that the server did not list, and a platform without a build gets a plain statement
 * instead of a link. The app is downloaded and installed by the visitor; nothing here installs it.
 */
export function DownloadPicker({
  release,
  headingLevel = 3,
  compact = false,
}: DownloadPickerProps) {
  const tid = (name: string) => (compact ? `hero-${name}` : name);
  const allId = useId();
  const [guess, setGuess] = useState<PlatformGuess | null>(null);
  const [chosen, setChosen] = useState<{ platform: ReleasePlatform; arch: ReleaseArch } | null>(
    null,
  );
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void readNavigator().then((result) => {
      if (alive) setGuess(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  const all = useMemo(() => (release ? orderBuilds(release.artifacts) : []), [release]);

  const platform = chosen?.platform ?? guess?.platform ?? null;
  const arch = chosen?.arch ?? guess?.arch ?? 'x64';
  const build = release && platform ? chooseBuild(release, platform, arch) : null;
  const archGuessed = !chosen && guess?.platform === 'macos' && !guess.archKnown;

  if (!release) {
    return (
      <p className="dl-empty" data-testid={tid('downloads-empty')}>
        Release not published — build the desktop app locally (see the{' '}
        <Link to="/guides/windows-client">Windows</Link>,{' '}
        <Link to="/guides/macos-client">macOS</Link> and{' '}
        <Link to="/guides/linux-client">Linux</Link> guides).
      </p>
    );
  }

  return (
    <div className={compact ? 'dl-picker dl-picker--compact' : 'dl-picker'}>
      {release.version && (
        <p className="dl-version" data-testid={tid('release-version')}>
          Version {release.version}
        </p>
      )}

      {guess === null ? (
        <p role="status" className="dl-hint">
          Checking which computer you are using…
        </p>
      ) : guess.unsupported && !chosen ? (
        <div className="dl-unsupported" data-testid={tid('download-unsupported')} role="note">
          <Heading>The desktop app is not available for this device</Heading>
          <p>
            RealtimeDocs Desktop runs on Windows, macOS and Linux computers. You seem to be using{' '}
            {UNSUPPORTED_TEXT[guess.unsupported]}. In a browser you can still open any share link
            and edit documents. To get the app, choose a platform below.
          </p>
        </div>
      ) : platform === null ? (
        <div className="dl-unsupported" data-testid={tid('download-unknown')} role="note">
          <Heading>Choose your computer</Heading>
          <p>We could not tell which operating system you use. Pick a platform from the list.</p>
        </div>
      ) : build ? (
        <div className="dl-primary" data-testid={tid('download-primary')} data-platform={platform}>
          <Heading>
            {PLATFORM_NAMES[platform]} · {archLabel(build.arch, build.platform)}
          </Heading>
          <LinkButton
            variant="primary"
            href={build.downloadUrl}
            iconLeft={<Download />}
            data-testid={tid('download-link')}
            data-file={build.fileName}
          >
            Download for {PLATFORM_NAMES[platform]}
          </LinkButton>
          <BuildDetails build={build} tid={tid} />
          {archGuessed && (
            <p className="dl-hint" data-testid={tid('download-arch-note')}>
              A browser cannot reliably tell Apple Silicon from Intel, so this is the{' '}
              {archLabel(build.arch, 'macos')} build. Not sure? Choose another build below ( → Apple
              menu → About This Mac shows your chip).
            </p>
          )}
          {platform === 'linux' && <p className="dl-hint">{LINUX_CAPTURE_NOTE}</p>}
        </div>
      ) : (
        <div className="dl-unavailable" data-testid={tid('download-unavailable')} role="note">
          <Heading>No release published for {PLATFORM_NAMES[platform]} yet</Heading>
          <p>
            This server has no {PLATFORM_NAMES[platform]} build. Pick another platform below, use
            RealtimeDocs in your browser, or build the app yourself (see the{' '}
            <Link to={`/guides/${platform === 'macos' ? 'macos' : platform}-client`}>
              {PLATFORM_NAMES[platform]} guide
            </Link>
            ).
          </p>
        </div>
      )}

      <p>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={showAll}
          aria-controls={allId}
          onClick={() => setShowAll((value) => !value)}
          data-testid={tid('download-choose-other')}
        >
          {showAll ? 'Hide other platforms' : 'Choose another platform'}
        </Button>
      </p>

      {showAll && (
        <div id={allId} data-testid={tid('download-all')}>
          <div className="dl-platforms" role="group" aria-label="Platform">
            {PLATFORMS.map((name) => (
              <Button
                key={name}
                size="sm"
                variant={platform === name ? 'primary' : 'secondary'}
                aria-pressed={platform === name}
                onClick={() => {
                  setChosen({ platform: name, arch: name === 'macos' ? 'arm64' : 'x64' });
                }}
              >
                {PLATFORM_NAMES[name]}
              </Button>
            ))}
          </div>
          <ul className="dl-builds">
            {all.map((item) => (
              <li
                key={item.fileName}
                className="dl-build"
                data-testid={tid('download-build')}
                data-file={item.fileName}
              >
                <div>
                  <strong>{buildLabel(item)}</strong>
                  <span className="dl-hint">
                    {' '}
                    · {formatBytes(item.sizeBytes)} ·{' '}
                    {signatureNotice(item.signatureStatus, item.platform)}
                  </span>
                  <div className="dl-hash">
                    SHA-256 <code>{item.sha256}</code>
                  </div>
                </div>
                <LinkButton
                  size="sm"
                  variant="secondary"
                  href={item.downloadUrl}
                  aria-label={`Download ${buildLabel(item)}`}
                  data-testid={tid('download-link-row')}
                >
                  Download
                </LinkButton>
              </li>
            ))}
          </ul>
          {PLATFORMS.filter((name) => !all.some((item) => item.platform === name)).map((name) => (
            <p key={name} className="dl-hint" data-testid={tid('download-missing')}>
              No release published for {PLATFORM_NAMES[name]} yet.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
