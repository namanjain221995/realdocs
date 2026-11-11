/**
 * Capture-exclusion status ("private mode"), in the vocabulary of the lead's
 * contract `./privacy/status.ts`.
 *
 * What the app can do is ask the operating system to leave its own windows
 * out of screen capture (`BrowserWindow.setContentProtection`). The status has
 * two layers, as the contract defines them:
 *
 * 1. REQUEST — what RealtimeDocs asked for its own windows and what the OS
 *    answered: `unsupported | unavailable | off | request_failed | os_accepted`.
 *    This is the label on every surface (panel chip, tray / menu-bar menu,
 *    Settings), always `PROTECTION_STATUS_LABELS[request]`.
 * 2. VERIFICATION — only when the request is `os_accepted`: what people
 *    recorded in the Privacy Test Center after checking with a second
 *    participant or device. Computed in the main process from those records
 *    (`summarizeVerification`); never from an OS return value.
 *
 * Under the label, `kind` and `reason` keep the finer facts (macOS and
 * ScreenCaptureKit, Windows before 10 version 2004, …) and `detail` explains
 * them in plain sentences.
 *
 * `os_accepted` needs three things: the request returned without error, the
 * read-back agrees (Electron's `isContentProtected()`, or on Windows the
 * diagnostics module's `GetWindowDisplayAffinity`), and every window that is
 * on screen has been drawn at least once since (one desktop composition).
 * None of that says what a meeting participant receives.
 *
 * Pure: no Electron imports. Documented behaviour (Electron 45
 * `win.setContentProtection`, Microsoft `SetWindowDisplayAffinity`) is quoted
 * in docs/notes/desktop.md.
 */
import {
  MACOS_WHOLE_DISPLAY_WARNING,
  PROTECTION_STATUS_LABELS,
  type ProtectionRequestState,
  type VerificationRecord,
  type VerificationState,
} from './privacy/status';
import { summarize, type DetectedEnvironment } from './privacy/test-center';

export { MACOS_WHOLE_DISPLAY_WARNING };

/** The finer state under the request label; explained by `detail`. */
export const CAPTURE_STATUS_KINDS = [
  /** Not running in the desktop app. */
  'browser_unavailable',
  /** The user turned private mode off. */
  'off',
  /** Asked, accepted, read back, and drawn once. */
  'requested',
  /** Asked; waiting until every visible window has been drawn once since. */
  'pending',
  /** The OS call failed or did not stick. */
  'request_failed',
  /** The platform cannot or does not reliably exclude (see `reason`). */
  'unreliable_platform',
] as const;
export type CaptureStatusKind = (typeof CAPTURE_STATUS_KINDS)[number];

export const CAPTURE_REASONS = [
  'macos_screencapturekit',
  'windows_before_2004',
  'windows_build_unknown',
  'linux_unavailable',
  'unsupported_platform',
  'os_call_failed',
  'not_applied',
] as const;
export type CaptureReason = (typeof CAPTURE_REASONS)[number] | null;

export type StatusTone = 'neutral' | 'info' | 'warning' | 'danger';

/** Windows 10 version 2004: first build that implements `WDA_EXCLUDEFROMCAPTURE`. */
export const WINDOWS_EXCLUDE_FROM_CAPTURE_MIN_BUILD = 19041;

export type PlatformCaptureSupport =
  /** Windows 10 2004+: the documented behaviour is removal from capture. */
  | { kind: 'exclusion'; windowsBuild: number }
  /** Older Windows: behaves like `WDA_MONITOR`, viewers get a black window. */
  | { kind: 'black_window'; windowsBuild: number }
  | { kind: 'windows_unknown' }
  /** macOS: `NSWindowSharingNone` is not honoured by ScreenCaptureKit-based capture. */
  | { kind: 'screencapturekit_unreliable' }
  | { kind: 'unavailable'; platform: string };

/** Parses the build number from a Windows version such as `10.0.22631`. */
export function parseWindowsBuild(systemVersion: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(systemVersion.trim());
  if (!match || !match[1] || !match[3]) return null;
  const major = Number(match[1]);
  const build = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(build)) return null;
  // Windows 8.1 and earlier report major < 10 and never support exclusion.
  if (major < 10) return 0;
  return build;
}

export function classifyPlatformCapture(
  platform: string,
  systemVersion: string,
): PlatformCaptureSupport {
  if (platform === 'win32') {
    const build = parseWindowsBuild(systemVersion);
    if (build === null) return { kind: 'windows_unknown' };
    return build >= WINDOWS_EXCLUDE_FROM_CAPTURE_MIN_BUILD
      ? { kind: 'exclusion', windowsBuild: build }
      : { kind: 'black_window', windowsBuild: build };
  }
  if (platform === 'darwin') return { kind: 'screencapturekit_unreliable' };
  return { kind: 'unavailable', platform };
}

/** Whether `setContentProtection` is implemented at all on this platform (Electron: macOS, Windows). */
export function platformHasProtectionApi(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}

export const PROTECTED_WINDOW_KINDS = ['panel', 'settings', 'probe'] as const;
export type ProtectedWindowKind = (typeof PROTECTED_WINDOW_KINDS)[number];

/** Window display affinity as the Windows diagnostics module reads it back. */
export type AffinityName = 'none' | 'monitor' | 'exclude_from_capture' | 'unknown';

/** Outcome of the OS request for one window. */
export interface WindowProtectionResult {
  window: ProtectedWindowKind;
  /** Value passed to `setContentProtection`. */
  requested: boolean;
  /** False when the platform has no API and nothing was called. */
  attempted: boolean;
  /** Message of a thrown error, if any. Never contains document content. */
  error: string | null;
  /** `isContentProtected()` read back after the call; null when unavailable. */
  readBack: boolean | null;
  /**
   * Windows with the diagnostics module: `GetWindowDisplayAffinity` after one
   * composition cycle. Null without the module or before it was read.
   */
  affinity: AffinityName | null;
  /**
   * True while the window is on screen and has not been drawn since the
   * request (or since it was shown): the change takes effect with the next
   * desktop composition, so until then nothing may be reported as accepted.
   */
  pendingComposition: boolean;
  /** When the composition wait last ended (ISO), for Diagnostics. */
  composedAt: string | null;
  at: string;
}

export interface CaptureEnvironment {
  platform: string;
  /** `process.getSystemVersion()`: `10.0.22631` on Windows, `14.6.1` on macOS. */
  systemVersion: string;
}

export interface CaptureStatusInput extends CaptureEnvironment {
  mode: 'desktop' | 'browser';
  /** The user's preference: private mode on/off. */
  requested: boolean;
  results: readonly WindowProtectionResult[];
  /**
   * Number of displays, when known. On a Mac with one display an entire-screen
   * share always contains the panel, and the status says so.
   */
  displayCount?: number | undefined;
  /** From the Privacy Test Center records; used only when the request is `os_accepted`. */
  verification?: VerificationSummary | null | undefined;
}

/** The verification layer, as one line and its warnings. Counts only: no records. */
export interface VerificationSummary {
  state: VerificationState;
  /** The secondary line under `os_accepted`, the same on every surface. */
  line: string;
  /** Extra lines: verifications that expired, configurations in which the panel was seen. */
  warnings: string[];
  /** Configurations (with protection on) whose newest record is current. */
  verified: number;
  /** Configurations (with protection on) whose newest record expired. */
  expired: number;
  /** Of the verified ones: the second participant saw the panel or a black area or an artifact. */
  negative: number;
}

export interface CaptureStatus {
  /** Request layer of the contract. */
  request: ProtectionRequestState;
  /** `PROTECTION_STATUS_LABELS[request]`, verbatim. */
  label: string;
  kind: CaptureStatusKind;
  reason: CaptureReason;
  tone: StatusTone;
  /** One or two plain sentences under the label. */
  detail: string;
  /** Caveats that always apply in the current situation. */
  warnings: string[];
  /** Windows for which the OS request failed. */
  failedWindows: ProtectedWindowKind[];
  /** Private mode is requested on a Mac that has only one display. */
  singleDisplay: boolean;
  /** Verification layer; present exactly when `request` is `os_accepted`. */
  verification: VerificationSummary | null;
}

export const SCOPE_WARNING =
  'The request covers RealtimeDocs windows only. A browser tab, an exported file, a photograph of the screen or a capture tool that ignores the setting are outside it.';
export const VERIFY_WARNING =
  'A successful request does not show what another participant receives. Check with a second device before you rely on it.';
export const WINDOWS_COMPOSITION_WARNING =
  'Windows applies the change with the next desktop composition, so a capture that began immediately before can still contain the window.';
/** For a Mac with one display; an addition to `MACOS_WHOLE_DISPLAY_WARNING`. */
export const MACOS_SINGLE_DISPLAY_WARNING =
  'Sharing your entire screen on this Mac will include this panel. Put it on a second display or an iPad (Sidecar) and share only your main display, or open your notes on your phone.';
/** What the operating system draws itself, outside any window of this app. */
export const OS_SURFACES_WARNING =
  'Some things are drawn by the operating system, not by this app, and private mode does not cover them: the candidate window of an input method (for example while typing Chinese, Japanese or Korean) and the picture that follows the pointer while you drag something.';
export const FALLBACK_ADVICE =
  'Reliable alternatives: share a single application window instead of the whole screen, keep notes on a display or device you are not sharing, and ask a participant to confirm what they see.';
/** Detail for Windows earlier than 10 version 2004, in the words of the lead's brief. */
export const BLACK_AREA_DETAIL =
  'This Windows version replaces the window with a black area: viewers see a black rectangle where the panel is instead of nothing.';

export const NO_VERIFICATION: VerificationSummary = {
  state: 'manual_verification_required',
  line: PROTECTION_STATUS_LABELS.manual_verification_required,
  warnings: [],
  verified: 0,
  expired: 0,
  negative: 0,
};

/**
 * The verification line for the panel, the tray and Settings, from the
 * Privacy Test Center records. The panel cannot know which meeting app or
 * capture mode is in use, so it never claims "verified" for one
 * configuration: it counts the configurations with protection on whose newest
 * record is current for this computer, and says where to look.
 */
export function summarizeVerification(
  records: readonly VerificationRecord[],
  environment: DetectedEnvironment,
  now: Date,
): VerificationSummary {
  const rows = summarize(records, environment, 'os_accepted', now).filter(
    (row) => row.key.protectionEnabled,
  );
  const verified = rows.filter((row) => row.headline.status === 'verified');
  const expired = rows.filter((row) => row.headline.status === 'verification_expired').length;
  const negative = verified.filter((row) => row.headline.negative).length;
  const warnings: string[] = [];
  if (expired > 0) {
    // The contract's own words, with the count: never a copy of them.
    const label = PROTECTION_STATUS_LABELS.verification_expired;
    warnings.push(
      expired === 1 ? `${label} (1 configuration)` : `${label} (${expired} configurations)`,
    );
  }
  if (negative > 0) {
    warnings.push(
      negative === 1
        ? 'In 1 of them the other participant still saw the panel or a black area'
        : `In ${negative} of them the other participant still saw the panel or a black area`,
    );
  }
  if (verified.length === 0) {
    return {
      ...NO_VERIFICATION,
      state: expired > 0 ? 'verification_expired' : 'manual_verification_required',
      warnings,
      expired,
    };
  }
  return {
    state: 'verified',
    line:
      verified.length === 1
        ? 'Verified for 1 configuration — see Privacy Test Center'
        : `Verified for ${verified.length} configurations — see Privacy Test Center`,
    warnings,
    verified: verified.length,
    expired,
    negative,
  };
}

function base(
  request: ProtectionRequestState,
): Pick<CaptureStatus, 'request' | 'label' | 'failedWindows' | 'singleDisplay' | 'verification'> {
  return {
    request,
    label: PROTECTION_STATUS_LABELS[request],
    failedWindows: [],
    singleDisplay: false,
    verification: null,
  };
}

/** Maps platform facts, the user's request and OS results to one honest status. */
export function computeCaptureStatus(input: CaptureStatusInput): CaptureStatus {
  const mac = input.platform === 'darwin';
  // Shown on every macOS setup, whatever the state of private mode.
  const macWarnings = mac ? [MACOS_WHOLE_DISPLAY_WARNING] : [];

  if (input.mode === 'browser') {
    return {
      ...base('unsupported'),
      kind: 'browser_unavailable',
      reason: null,
      tone: 'neutral',
      detail:
        'A web page cannot ask the operating system to leave it out of screen capture. This view appears in screen shares like any other browser content.',
      warnings: [FALLBACK_ADVICE],
    };
  }

  if (!input.requested) {
    return {
      ...base('off'),
      kind: 'off',
      reason: null,
      tone: 'neutral',
      detail:
        'Private mode is off: no capture exclusion is requested. The panel can appear in screen shares, recordings and screenshots like any other window.',
      warnings: macWarnings,
    };
  }

  const support = classifyPlatformCapture(input.platform, input.systemVersion);

  if (support.kind === 'unavailable') {
    const linux = input.platform === 'linux';
    return {
      ...base('unsupported'),
      kind: 'unreliable_platform',
      reason: linux ? 'linux_unavailable' : 'unsupported_platform',
      tone: 'warning',
      detail: linux
        ? 'Linux has no documented control that leaves a window out of screen capture. The panel is captured like any other window.'
        : 'This platform has no documented control that leaves a window out of screen capture. The panel is captured like any other window.',
      warnings: [FALLBACK_ADVICE],
    };
  }

  const relevant = input.results.filter((result) => result.requested);
  const failedWindows = relevant
    .filter(
      (result) =>
        result.error !== null ||
        result.readBack === false ||
        !result.attempted ||
        result.affinity === 'none' ||
        result.affinity === 'unknown',
    )
    .map((result) => result.window);

  if (failedWindows.length > 0) {
    const errored = relevant.some((result) => result.error !== null);
    return {
      ...base('request_failed'),
      failedWindows,
      kind: 'request_failed',
      reason: errored ? 'os_call_failed' : 'not_applied',
      tone: 'danger',
      detail: `The operating system did not accept the request for: ${failedWindows.join(', ')}. Treat the panel as visible in screen shares and recordings.`,
      warnings: [...macWarnings, FALLBACK_ADVICE],
    };
  }

  // The diagnostics module read back WDA_MONITOR, or the build is older than
  // 10 version 2004: the OS replaces the window with a black area.
  const blackArea =
    support.kind === 'black_window' || relevant.some((result) => result.affinity === 'monitor');
  if (blackArea) {
    return {
      ...base('unavailable'),
      kind: 'unreliable_platform',
      reason: 'windows_before_2004',
      tone: 'warning',
      detail: `${BLACK_AREA_DETAIL} Exclusion needs Windows 10 version 2004 (build ${WINDOWS_EXCLUDE_FROM_CAPTURE_MIN_BUILD}) or later.`,
      warnings: [SCOPE_WARNING, FALLBACK_ADVICE],
    };
  }

  if (relevant.some((result) => result.pendingComposition)) {
    return {
      ...base('unavailable'),
      kind: 'pending',
      reason: null,
      tone: 'neutral',
      detail:
        'The request was made. It is reported as accepted once every RealtimeDocs window on screen has been drawn at least once since, because the operating system applies it with the next screen update.',
      warnings: [...macWarnings, WINDOWS_COMPOSITION_WARNING],
    };
  }

  const verification = input.verification ?? NO_VERIFICATION;
  if (support.kind === 'screencapturekit_unreliable') {
    const singleDisplay = input.displayCount === 1;
    return {
      ...base('os_accepted'),
      verification,
      singleDisplay,
      kind: 'unreliable_platform',
      reason: 'macos_screencapturekit',
      tone: singleDisplay ? 'danger' : 'warning',
      detail:
        'macOS accepted the request (NSWindowSharingNone). On macOS this is a best-effort request only: applications that capture with ScreenCaptureKit, which current meeting and recording apps use, can still include the panel.',
      warnings: [
        MACOS_WHOLE_DISPLAY_WARNING,
        ...(singleDisplay ? [MACOS_SINGLE_DISPLAY_WARNING] : []),
        SCOPE_WARNING,
      ],
    };
  }

  if (support.kind === 'windows_unknown') {
    return {
      ...base('os_accepted'),
      verification,
      kind: 'unreliable_platform',
      reason: 'windows_build_unknown',
      tone: 'warning',
      detail:
        'Windows accepted the request, but this Windows build could not be identified, so viewers may get nothing where the panel is or a black area. That is a request to the operating system, not proof of what a participant receives.',
      warnings: [VERIFY_WARNING, SCOPE_WARNING],
    };
  }

  return {
    ...base('os_accepted'),
    verification,
    kind: 'requested',
    reason: null,
    tone: 'info',
    detail:
      'Windows accepted the request to leave RealtimeDocs windows out of screen capture (WDA_EXCLUDEFROMCAPTURE) and has drawn them since. That is a request to the operating system, not proof of what a meeting participant receives.',
    warnings: [VERIFY_WARNING, WINDOWS_COMPOSITION_WARNING, SCOPE_WARNING],
  };
}

/**
 * The lines the tray / menu-bar menu shows under "Private mode": the request
 * label and, when the request is accepted, the verification line. The same
 * words as the panel chip and Settings, because they are the same values.
 */
export function captureTrayLines(status: CaptureStatus): string[] {
  return status.verification ? [status.label, status.verification.line] : [status.label];
}

export interface CaptureChip {
  /** `PROTECTION_STATUS_LABELS[request]`. */
  label: string;
  /** The verification line when the request is `os_accepted`, else null. */
  secondary: string | null;
  tone: StatusTone;
  /** What the chip's explanation shows: the detail, then every warning that applies. */
  explanation: string[];
}

/** The compact chip in the panel header. */
export function captureChip(status: CaptureStatus): CaptureChip {
  return {
    label: status.label,
    secondary: status.verification?.line ?? null,
    tone: status.tone,
    explanation: [status.detail, ...(status.verification?.warnings ?? []), ...status.warnings],
  };
}
