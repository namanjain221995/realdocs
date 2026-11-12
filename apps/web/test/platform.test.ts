import { describe, expect, it } from 'vitest';
import {
  chooseBuild,
  fromLegacy,
  orderBuilds,
  signatureNotice,
  type DisplayArtifact,
  type DisplayRelease,
} from '../src/features/landing/downloads';
import { detectFromUserAgent, detectPlatform } from '../src/features/landing/platform';

const UA = {
  win10Chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  win11Edge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  winArm:
    'Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  win32bit: 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/54.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macFirefox:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
  linuxChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linuxArm:
    'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ubuntuFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  fedoraFirefox: 'Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  linuxNoArch: 'Mozilla/5.0 (X11; Linux) AppleWebKit/537.36 Chrome/126.0.0.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  bot: 'curl/8.4.0',
  empty: '',
};

describe('detectFromUserAgent', () => {
  it.each([
    ['win10Chrome', 'windows', 'x64', true],
    ['win11Edge', 'windows', 'x64', true],
    ['winFirefox', 'windows', 'x64', true],
    ['winArm', 'windows', 'arm64', true],
    ['win32bit', 'windows', 'x64', true], // WOW64: a 32-bit browser on a 64-bit Windows
    ['linuxChrome', 'linux', 'x64', true],
    ['linuxArm', 'linux', 'arm64', true],
    ['ubuntuFirefox', 'linux', 'x64', true],
    ['fedoraFirefox', 'linux', 'x64', true],
    ['linuxNoArch', 'linux', 'x64', false],
  ] as const)('%s', (name, platform, arch, known) => {
    expect(detectFromUserAgent(UA[name])).toMatchObject({
      platform,
      arch,
      archKnown: known,
      unsupported: null,
      source: 'userAgent',
    });
  });

  it.each(['macSafari', 'macChrome', 'macFirefox'] as const)(
    '%s: a Mac, with an architecture that is only a default',
    (name) => {
      expect(detectFromUserAgent(UA[name])).toMatchObject({
        platform: 'macos',
        arch: 'arm64',
        archKnown: false,
      });
    },
  );

  it.each([
    ['iphone', 'ios'],
    ['ipad', 'ios'],
    ['androidPhone', 'android'],
    ['androidTablet', 'android'],
    ['chromebook', 'chromeos'],
  ] as const)('%s has no desktop build (%s)', (name, reason) => {
    expect(detectFromUserAgent(UA[name])).toMatchObject({ platform: null, unsupported: reason });
  });

  it('treats a Mac user agent with a touch screen as an iPad in desktop mode', () => {
    expect(detectFromUserAgent(UA.ipadDesktopMode, 5)).toMatchObject({ unsupported: 'ios' });
    expect(detectFromUserAgent(UA.ipadDesktopMode, 0)).toMatchObject({ platform: 'macos' });
  });

  it('knows nothing about unknown agents', () => {
    expect(detectFromUserAgent(UA.bot)).toMatchObject({
      platform: null,
      unsupported: null,
      source: 'none',
    });
    expect(detectFromUserAgent(UA.empty).source).toBe('none');
  });
});

describe('detectPlatform', () => {
  it('prefers userAgentData and asks for architecture and bitness', async () => {
    const asked: string[][] = [];
    const guess = await detectPlatform({
      userAgent: UA.win10Chrome,
      userAgentData: {
        platform: 'Windows',
        mobile: false,
        getHighEntropyValues: async (hints) => {
          asked.push(hints);
          return { architecture: 'arm', bitness: '64' };
        },
      },
    });
    expect(asked).toEqual([['architecture', 'bitness']]);
    expect(guess).toMatchObject({
      platform: 'windows',
      arch: 'arm64',
      archKnown: true,
      source: 'userAgentData',
    });
  });

  it('knows an Apple Silicon Mac when the browser says so, and still guesses when it does not', async () => {
    const known = await detectPlatform({
      userAgent: UA.macChrome,
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: async () => ({ architecture: 'arm', bitness: '64' }),
      },
    });
    expect(known).toMatchObject({ platform: 'macos', arch: 'arm64', archKnown: true });
    const intel = await detectPlatform({
      userAgent: UA.macChrome,
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64' }),
      },
    });
    expect(intel).toMatchObject({ arch: 'x64', archKnown: true });
    const refused = await detectPlatform({
      userAgent: UA.macChrome,
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: async () => {
          throw new Error('blocked');
        },
      },
    });
    expect(refused).toMatchObject({ platform: 'macos', arch: 'arm64', archKnown: false });
  });

  it('refuses mobile and Android through client hints', async () => {
    expect(
      await detectPlatform({
        userAgent: UA.androidPhone,
        userAgentData: { platform: 'Android', mobile: true },
      }),
    ).toMatchObject({ platform: null, unsupported: 'android' });
    expect(
      await detectPlatform({
        userAgent: UA.chromebook,
        userAgentData: { platform: 'Chrome OS', mobile: false },
      }),
    ).toMatchObject({ platform: null, unsupported: 'chromeos' });
  });

  it('falls back to the user agent without client hints and to unknown without either', async () => {
    expect(await detectPlatform({ userAgent: UA.linuxArm })).toMatchObject({
      platform: 'linux',
      arch: 'arm64',
    });
    expect(await detectPlatform({ userAgent: UA.bot })).toMatchObject({
      platform: null,
      source: 'none',
    });
    expect(await detectPlatform({})).toMatchObject({ platform: null });
  });

  it('never decides from navigator.platform alone (it is not even read)', async () => {
    const nav = { userAgent: UA.bot, platform: 'Win32' } as unknown as Parameters<
      typeof detectPlatform
    >[0];
    expect((await detectPlatform(nav)).platform).toBeNull();
  });

  it('uses an Arm user agent to complete Linux client hints', async () => {
    const guess = await detectPlatform({
      userAgent: UA.linuxArm,
      userAgentData: { platform: 'Linux', getHighEntropyValues: async () => ({}) },
    });
    expect(guess).toMatchObject({ platform: 'linux', arch: 'arm64', archKnown: true });
  });
});

const file = (
  platform: DisplayArtifact['platform'],
  arch: DisplayArtifact['arch'],
  format: DisplayArtifact['format'],
  signatureStatus: DisplayArtifact['signatureStatus'] = 'unsigned',
): DisplayArtifact => ({
  platform,
  arch,
  format,
  fileName: `RealtimeDocs-1.0.0-${platform}-${arch}.${format}`,
  sizeBytes: 10,
  sha256: 'a'.repeat(64),
  minimumOsVersion: 'x',
  signatureStatus,
  downloadUrl: `/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-${platform}-${arch}.${format}`,
});
const release = (artifacts: DisplayArtifact[]): DisplayRelease => ({
  version: '1.0.0',
  publishedAt: null,
  notes: '',
  artifacts,
  legacy: false,
});

describe('chooseBuild', () => {
  it('picks the preferred format and falls back like the server does', () => {
    const r = release([
      file('windows', 'x64', 'zip'),
      file('windows', 'x64', 'exe', 'signed'),
      file('macos', 'universal', 'zip'),
    ]);
    expect(chooseBuild(r, 'windows', 'x64')?.format).toBe('exe');
    expect(chooseBuild(r, 'windows', 'arm64')?.arch).toBe('x64');
    expect(chooseBuild(r, 'macos', 'arm64')?.arch).toBe('universal');
  });
  it('returns null — no dead link — when the platform has no build', () => {
    const r = release([file('windows', 'x64', 'zip')]);
    expect(chooseBuild(r, 'linux', 'x64')).toBeNull();
    expect(chooseBuild(r, 'macos', 'arm64')).toBeNull();
  });
  it('never offers a link that is not a same-origin path', () => {
    const r = release([
      { ...file('linux', 'x64', 'tar.gz'), downloadUrl: 'https://evil.example/x' },
    ]);
    expect(chooseBuild(r, 'linux', 'x64')).toBeNull();
  });
  it('orders windows, macos, linux and x64 before arm64', () => {
    const ordered = orderBuilds([
      file('linux', 'x64', 'zip'),
      file('macos', 'arm64', 'zip'),
      file('windows', 'arm64', 'zip'),
      file('windows', 'x64', 'zip'),
    ]);
    expect(ordered.map((a) => `${a.platform}-${a.arch}`)).toEqual([
      'windows-x64',
      'windows-arm64',
      'macos-arm64',
      'linux-x64',
    ]);
  });
});

describe('signature wording', () => {
  it('names the warning of each platform for an unsigned build', () => {
    expect(signatureNotice('unsigned', 'windows')).toBe(
      'Unsigned build — Windows SmartScreen will warn you before it opens.',
    );
    expect(signatureNotice('unsigned', 'macos')).toContain('Gatekeeper');
    expect(signatureNotice('notarized', 'macos')).toContain('notarised');
    expect(signatureNotice('unknown', 'windows')).toContain('not stated');
  });
});

describe('legacy listing', () => {
  const base = { bytes: 5, sha256: 'b'.repeat(64), modifiedAt: '2026-11-10T10:00:00.000Z' };
  it('adapts the flat files and does not invent a signature', () => {
    const adapted = fromLegacy({
      release: { version: '0.1.0', notes: null, signed: null },
      artifacts: [
        {
          ...base,
          file: 'realtimedocs-windows-x64.zip',
          platform: 'windows',
          arch: 'x64',
          url: '/download/realtimedocs-windows-x64.zip',
        },
      ],
    });
    expect(adapted?.legacy).toBe(true);
    expect(adapted?.artifacts[0]).toMatchObject({
      format: 'zip',
      signatureStatus: 'unknown',
      minimumOsVersion: null,
    });
    expect(fromLegacy({ release: null, artifacts: [] })).toBeNull();
  });
  it('drops non-path URLs', () => {
    expect(
      fromLegacy({
        release: null,
        artifacts: [
          { ...base, file: 'x', platform: 'windows', arch: 'x64', url: 'https://evil.example/x' },
        ],
      }),
    ).toBeNull();
  });
});
