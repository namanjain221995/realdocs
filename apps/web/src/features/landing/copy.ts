/** Wording that several parts of the landing page (and its tests) share. */

/** The sentence the owner requires in a prominent place. */
export const REQUIRED_SENTENCE =
  'OS-assisted capture exclusion. Verify your exact meeting and capture setup before relying on it.';

/** The owner's earlier caveat; still shown in the screen-sharing section. */
export const CAVEAT =
  'Behavior depends on your operating system, meeting application, capture mode, and version. Verify your setup before relying on it.';

/** Same text as `MACOS_WHOLE_DISPLAY_WARNING` in the desktop package. */
export const MACOS_WARNING =
  'Whole-display capture may include RealtimeDocs on this macOS and meeting-app configuration. Share a selected application, window, or browser tab and verify using another participant.';

/**
 * Protection vocabulary, verbatim from `apps/desktop/src/shared/privacy/status.ts`
 * (`PROTECTION_STATUS_LABELS`). No other status words are used on this page.
 */
export const REQUEST_STATES = [
  'Unsupported',
  'Protection unavailable',
  'Protection off',
  'Protection request failed',
  'OS protection accepted',
] as const;

export const VERIFICATION_STATES = [
  'Manual verification required',
  'Verified for this exact configuration',
  'Verification expired after version change',
] as const;

export const NAV_LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#sessions', label: 'Sessions' },
  { href: '#history', label: 'History' },
  { href: '#api', label: 'API' },
  { href: '#security', label: 'Security' },
  { href: '#download', label: 'Download' },
] as const;
