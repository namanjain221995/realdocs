/**
 * Which desktop build suits this visitor. Pure functions, unit-tested with many user-agent strings.
 *
 * Order of evidence: `navigator.userAgentData` (platform, and architecture/bitness from
 * `getHighEntropyValues` when the browser allows it) -> user-agent string parsing -> unknown.
 * `navigator.platform` is never used on its own. A guess is always shown to the visitor with a way
 * to choose another platform; nothing here claims certainty it does not have.
 */
import type { ReleaseArch, ReleasePlatform } from '@realtimedocs/contracts';

/** Why there is no desktop build for this device. */
export type UnsupportedDevice = 'ios' | 'android' | 'chromeos';

export interface PlatformGuess {
  platform: ReleasePlatform | null;
  /** The device cannot run the desktop app (a phone, a tablet or a Chromebook). */
  unsupported: UnsupportedDevice | null;
  arch: ReleaseArch | null;
  /** False when the architecture is a default, not something the browser told us. */
  archKnown: boolean;
  source: 'userAgentData' | 'userAgent' | 'none';
}

const NONE: PlatformGuess = {
  platform: null,
  unsupported: null,
  arch: null,
  archKnown: false,
  source: 'none',
};

export interface UserAgentDataLike {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    architecture?: string;
    bitness?: string;
    platform?: string;
  }>;
}

export interface NavigatorLike {
  userAgent?: string;
  userAgentData?: UserAgentDataLike;
  /** `navigator.maxTouchPoints`: an iPad asks for desktop sites and reports a Mac otherwise. */
  maxTouchPoints?: number;
}

function fromPlatformName(name: string): Pick<PlatformGuess, 'platform' | 'unsupported'> | null {
  const value = name.trim().toLowerCase();
  if (value === 'windows') return { platform: 'windows', unsupported: null };
  if (value === 'macos') return { platform: 'macos', unsupported: null };
  if (value === 'linux') return { platform: 'linux', unsupported: null };
  if (value === 'android') return { platform: null, unsupported: 'android' };
  if (value === 'ios') return { platform: null, unsupported: 'ios' };
  if (value === 'chrome os' || value === 'chromeos')
    return { platform: null, unsupported: 'chromeos' };
  return null;
}

/** Architecture as far as a user-agent string tells it. Apple Silicon Macs report Intel: never known. */
function archFromUserAgent(
  platform: ReleasePlatform,
  ua: string,
): Pick<PlatformGuess, 'arch' | 'archKnown'> {
  if (platform === 'macos') {
    // "Intel Mac OS X" is what Safari, Chrome and Firefox send on every Mac, Apple Silicon included.
    return { arch: 'arm64', archKnown: false };
  }
  if (/\b(arm64|aarch64|armv8)/i.test(ua)) return { arch: 'arm64', archKnown: true };
  if (platform === 'windows') {
    // Windows on Arm usually reports x64 in the user agent; only the client hints say otherwise.
    return { arch: 'x64', archKnown: /\b(win64|x64|wow64|amd64)\b/i.test(ua) };
  }
  return { arch: 'x64', archKnown: /\b(x86_64|x64|amd64)\b/i.test(ua) };
}

/** Parses a user-agent string. `touch` distinguishes an iPad that asks for desktop sites. */
export function detectFromUserAgent(ua: string, touchPoints = 0): PlatformGuess {
  if (!ua) return NONE;
  const base = { source: 'userAgent' as const };
  if (/iPhone|iPod|iPad/i.test(ua)) {
    return { ...base, platform: null, unsupported: 'ios', arch: null, archKnown: false };
  }
  if (/Android/i.test(ua)) {
    return { ...base, platform: null, unsupported: 'android', arch: null, archKnown: false };
  }
  if (/\bCrOS\b/.test(ua)) {
    return { ...base, platform: null, unsupported: 'chromeos', arch: null, archKnown: false };
  }
  if (/Windows NT|Win64|Win32|WOW64/i.test(ua)) {
    return { ...base, platform: 'windows', unsupported: null, ...archFromUserAgent('windows', ua) };
  }
  if (/Macintosh|Mac OS X|MacIntel/i.test(ua)) {
    // iPadOS in desktop mode sends a Mac user agent; a Mac has no touch screen.
    if (touchPoints > 1) {
      return { ...base, platform: null, unsupported: 'ios', arch: null, archKnown: false };
    }
    return { ...base, platform: 'macos', unsupported: null, ...archFromUserAgent('macos', ua) };
  }
  if (/Linux|X11|Ubuntu|Fedora|Debian/i.test(ua)) {
    return { ...base, platform: 'linux', unsupported: null, ...archFromUserAgent('linux', ua) };
  }
  return NONE;
}

/** Evidence from `userAgentData` alone (low-entropy: the platform name and the mobile flag). */
function detectFromClientHints(data: UserAgentDataLike): PlatformGuess | null {
  if (data.mobile === true) {
    const named = data.platform ? fromPlatformName(data.platform) : null;
    return {
      platform: null,
      unsupported: named?.unsupported ?? 'android',
      arch: null,
      archKnown: false,
      source: 'userAgentData',
    };
  }
  const named = data.platform ? fromPlatformName(data.platform) : null;
  if (!named) return null;
  return {
    platform: named.platform,
    unsupported: named.unsupported,
    arch: named.platform ? (named.platform === 'macos' ? 'arm64' : 'x64') : null,
    archKnown: false,
    source: 'userAgentData',
  };
}

/** Applies `architecture` / `bitness` hints. Returns the input when they say nothing usable. */
export function applyArchitectureHints(
  guess: PlatformGuess,
  hints: { architecture?: string; bitness?: string },
): PlatformGuess {
  if (!guess.platform) return guess;
  // On a Mac the hint is reliable in browsers that provide it ("arm" or "x86").
  const architecture = hints.architecture?.toLowerCase();
  if (architecture === 'arm') return { ...guess, arch: 'arm64', archKnown: true };
  if (architecture === 'x86' && hints.bitness === '64')
    return { ...guess, arch: 'x64', archKnown: true };
  return guess;
}

/**
 * The visitor's platform. Never throws: a browser that refuses the high-entropy request simply
 * keeps the guess it had.
 */
export async function detectPlatform(nav: NavigatorLike): Promise<PlatformGuess> {
  const data = nav.userAgentData;
  let guess: PlatformGuess | null = data ? detectFromClientHints(data) : null;
  if (guess?.platform && data?.getHighEntropyValues) {
    try {
      const hints = await data.getHighEntropyValues(['architecture', 'bitness']);
      guess = applyArchitectureHints(guess, hints);
    } catch {
      // Permission policy or an old browser: keep the low-entropy answer.
    }
  }
  if (guess && (guess.platform || guess.unsupported)) {
    // Client hints name the OS; the user agent may add what they did not (a Linux Arm string).
    if (guess.platform && !guess.archKnown) {
      const parsed = detectFromUserAgent(nav.userAgent ?? '', nav.maxTouchPoints ?? 0);
      if (parsed.platform === guess.platform && parsed.archKnown) {
        return { ...guess, arch: parsed.arch, archKnown: true };
      }
    }
    return guess;
  }
  return detectFromUserAgent(nav.userAgent ?? '', nav.maxTouchPoints ?? 0);
}
