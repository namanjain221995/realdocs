/**
 * Screen-share protection vocabulary — the single source of truth for every surface that talks
 * about it: the panel's status chip, the tray / menu-bar menu, the settings window, the Safe Share
 * Guide, the Privacy Test Center and the documentation. Written by the lead as a contract; the
 * strings here are reproduced verbatim in `docs/capture-compatibility.md` and on the landing page.
 *
 * Two independent layers:
 *
 * 1. The REQUEST layer — what RealtimeDocs asked the operating system for its own windows, and what
 *    the OS answered. Decided on this computer, from documented APIs only. It never says anything
 *    about what another meeting participant sees.
 *
 * 2. The VERIFICATION layer — whether a person confirmed, from a SECOND participant or a SEPARATE
 *    receiving device, what the shared picture contained for one exact configuration (OS build,
 *    meeting application and version, client, capture mode, monitors, protection on or off).
 *    A local screenshot, an OS return value, an Electron boolean or an in-app preview is never
 *    accepted as verification.
 *
 * Wording rules (enforced by tests that scan the UI strings): never "invisible", "undetectable",
 * "guaranteed", "bypass", "cannot be recorded", "hidden from all monitoring", "proctoring-proof".
 */
import { z } from 'zod';

// ── Request layer ──────────────────────────────────────────────────────────────────────────────

export const PROTECTION_REQUEST_STATES = [
  /** No documented window capture-exclusion control here (Linux, or the browser instead of the desktop app). */
  'unsupported',
  /**
   * A desktop OS that has the control, but exclusion cannot be applied in this situation — for example
   * Windows earlier than 10 version 2004, where the OS can only replace the window with a black area
   * (the detail says so), or the window is not ready yet.
   */
  'unavailable',
  /** The user turned private mode off. Deliberate addition to the brief's list: "off" is a choice, not a failure. */
  'off',
  /** RealtimeDocs asked and the request failed or did not take effect (error, or the read-back disagrees). */
  'request_failed',
  /**
   * RealtimeDocs asked, the request returned without error, the read-back agrees (on Windows: the
   * window's display affinity is WDA_EXCLUDEFROMCAPTURE when the diagnostics module is present), and at
   * least one desktop-composition cycle has passed. On macOS this is a best-effort request only:
   * applications that capture with ScreenCaptureKit can still include the window.
   */
  'os_accepted',
] as const;
export type ProtectionRequestState = (typeof PROTECTION_REQUEST_STATES)[number];

// ── Verification layer ─────────────────────────────────────────────────────────────────────────

export const VERIFICATION_STATES = [
  /** No current record from a second participant or device exists for this exact configuration. */
  'manual_verification_required',
  /** A current record exists for this exact configuration; its observed outcome is shown with it. */
  'verified',
  /**
   * A record exists, but something it depends on changed since (OS build, Electron, RealtimeDocs — all
   * detected automatically), or the user-entered browser / meeting-app version differs, or the record
   * is older than {@link VERIFICATION_MAX_AGE_DAYS} days (browsers and meeting apps update silently).
   */
  'verification_expired',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** Records older than this are treated as expired, because browser and meeting-app updates cannot be detected. */
export const VERIFICATION_MAX_AGE_DAYS = 30;

export type ProtectionStatus = ProtectionRequestState | VerificationState;

/** Exact user-facing names of every status. */
export const PROTECTION_STATUS_LABELS: Readonly<Record<ProtectionStatus, string>> = {
  unsupported: 'Unsupported',
  unavailable: 'Protection unavailable',
  off: 'Protection off',
  request_failed: 'Protection request failed',
  os_accepted: 'OS protection accepted',
  manual_verification_required: 'Manual verification required',
  verified: 'Verified for this exact configuration',
  verification_expired: 'Verification expired after version change',
};

// ── What a second participant observed ─────────────────────────────────────────────────────────

export const OBSERVED_OUTCOMES = ['omitted', 'black', 'partial', 'visible', 'artifact'] as const;
export type ObservedOutcome = (typeof OBSERVED_OUTCOMES)[number];

/** A "verified" status always shows its outcome: only `omitted` means the panel was left out. */
export const OBSERVED_OUTCOME_LABELS: Readonly<Record<ObservedOutcome, string>> = {
  omitted: 'Panel was omitted from the shared view',
  black: 'Panel appeared as a black area',
  partial: 'Panel was partly visible in the shared view',
  visible: 'Panel appeared normally in the shared view',
  artifact: 'Panel produced a visual artifact',
};

export const OBSERVERS = ['second_participant', 'second_device'] as const;
export type Observer = (typeof OBSERVERS)[number];

// ── Configuration vocabulary ───────────────────────────────────────────────────────────────────

export const CAPTURE_MODES = ['tab', 'window', 'application', 'entire_display'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];
export const CAPTURE_MODE_LABELS: Readonly<Record<CaptureMode, string>> = {
  tab: 'Browser tab',
  window: 'Single window',
  application: 'Application',
  entire_display: 'Entire display',
};

export const MEETING_APPS = ['zoom', 'teams', 'meet', 'webex', 'lark', 'chime', 'other'] as const;
export type MeetingApp = (typeof MEETING_APPS)[number];
export const MEETING_APP_LABELS: Readonly<Record<MeetingApp, string>> = {
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  meet: 'Google Meet',
  webex: 'Webex',
  lark: 'Lark',
  chime: 'Amazon Chime',
  other: 'Other',
};

export const CLIENT_KINDS = ['native', 'browser'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

// ── Exact texts required by the brief ──────────────────────────────────────────────────────────

/** Shown on macOS whenever an entire-display share could include the panel. */
export const MACOS_WHOLE_DISPLAY_WARNING =
  'Whole-display capture may include RealtimeDocs on this macOS and meeting-app configuration. Share a selected application, window, or browser tab and verify using another participant.';

/** The Safe Share Guide, in order. */
export const SAFE_SHARE_GUIDE_STEPS = [
  'Share a specific browser tab, presentation window, or application instead of your entire screen.',
  'Keep RealtimeDocs outside the source you selected.',
  'Confirm what others see from a second device or with another participant.',
  'Record the result in the Privacy Test Center.',
] as const;

/** The tray / menu-bar emergency action. */
export const RETURN_TO_INTERACTIVE_LABEL = 'Return to interactive mode';

/** Words that must never appear in any protection-related UI string (case-insensitive). */
export const FORBIDDEN_PROTECTION_WORDS = [
  'invisible',
  'undetectable',
  'guaranteed',
  'bypass',
  'cannot be recorded',
  'hidden from all',
  'proctoring-proof',
  '100%',
] as const;

// ── A verification record ──────────────────────────────────────────────────────────────────────

const ShortText = z.string().trim().min(1).max(120);

export const VerificationRecord = z.object({
  id: z.string().uuid(),
  /** When the test was performed (ISO 8601). */
  testedAt: z.iso.datetime(),
  // Detected automatically when the record is created; a later mismatch expires the record.
  appVersion: ShortText,
  electronVersion: ShortText,
  platform: z.enum(['win32', 'darwin', 'linux']),
  osVersion: ShortText,
  // Entered by the person testing (RealtimeDocs never inspects other applications).
  meetingApp: z.enum(MEETING_APPS),
  meetingAppName: ShortText.optional(),
  meetingAppVersion: ShortText,
  client: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('native') }),
    z.object({ kind: z.literal('browser'), browser: ShortText, browserVersion: ShortText }),
  ]),
  captureMode: z.enum(CAPTURE_MODES),
  monitors: z.object({
    count: z.number().int().min(1).max(16),
    /** Free text such as "panel on display 2, sharing display 1". */
    arrangement: z.string().trim().max(200).optional(),
  }),
  protectionEnabled: z.boolean(),
  /** What the person saw on their own screen during the test. */
  localResult: z.string().trim().min(1).max(500),
  /** What the second participant or device received. Required: there is no verification without it. */
  remote: z.object({
    observedBy: z.enum(OBSERVERS),
    outcome: z.enum(OBSERVED_OUTCOMES),
    note: z.string().trim().max(1000).optional(),
  }),
  /** Where the remote evidence is kept (for example a file name of a photo taken on the second device). */
  evidence: z.string().trim().max(500).optional(),
  /** Behaviour during startup, document switch, resize, hide/show and protection toggling. */
  transitions: z.string().trim().max(1000).optional(),
});
export type VerificationRecord = z.infer<typeof VerificationRecord>;

/** The parts of a configuration two records must share to describe "this exact configuration". */
export interface ConfigurationKey {
  platform: VerificationRecord['platform'];
  meetingApp: MeetingApp;
  clientKind: ClientKind;
  browser?: string;
  captureMode: CaptureMode;
  monitorCount: number;
  protectionEnabled: boolean;
}
