/**
 * The Safe Share Guide: what a person should know before they share a screen
 * while their notes are open. Shown on first launch, reopenable from the tray
 * / menu-bar menu, the panel's privacy chip and Settings.
 *
 * Built as plain data from the capture status, so the wording is unit-tested
 * (verbatim steps from the lead's contract, the right paragraph for each
 * platform, no concealment claims) and is the same wherever it is shown.
 *
 * Nothing here is a promise about what a meeting application does. Windows
 * and macOS behaviour is quoted from Microsoft's and Electron's documentation;
 * none of it was observed on Windows or macOS by the people who wrote this.
 */
import {
  MACOS_SINGLE_DISPLAY_WARNING,
  MACOS_WHOLE_DISPLAY_WARNING,
  OS_SURFACES_WARNING,
  type CaptureStatus,
} from './capture';
import { SAFE_SHARE_GUIDE_STEPS } from './privacy/status';
import type { DesktopPlatform } from './shortcuts';

export const SAFE_SHARE_GUIDE_TITLE = 'Safe Share Guide';

export interface ShareGuideStep {
  number: number;
  /** One of `SAFE_SHARE_GUIDE_STEPS`, verbatim. */
  text: string;
  /** Step 4 opens the Privacy Test Center (a tab of the Settings window). */
  link: { label: string; tab: 'privacy-test-center' } | null;
}

export interface ShareGuide {
  title: string;
  steps: ShareGuideStep[];
  /** The one paragraph about this platform. */
  platform: { heading: string; paragraphs: string[] };
  /** Short facts that hold everywhere. */
  notes: string[];
}

/** Shown instead of the panel when the display it was on went away while private mode was on. */
export const PARKED_NOTICE =
  'Notes display disconnected — panel hidden so it is not shared. Click to show.';
/** The same, for the title strip when the panel could not be hidden. */
export const PARKED_STRIP_NOTICE =
  'Notes display disconnected — panel collapsed so it is not shared. Expand to show.';

function platformParagraph(
  platform: DesktopPlatform,
  status: CaptureStatus,
): { heading: string; paragraphs: string[] } {
  if (platform === 'darwin') {
    return {
      heading: 'On this Mac',
      paragraphs: [
        MACOS_WHOLE_DISPLAY_WARNING,
        ...(status.singleDisplay ? [MACOS_SINGLE_DISPLAY_WARNING] : []),
      ],
    };
  }
  if (platform === 'win32') {
    if (status.request === 'off') {
      return {
        heading: 'On this Windows computer',
        paragraphs: [
          'Private mode is off, so no OS protection is requested and an entire-display share includes the panel. Turn private mode on in the tray menu or in Settings, or follow the steps above.',
        ],
      };
    }
    if (status.reason === 'windows_before_2004') {
      return {
        heading: 'On this Windows computer',
        paragraphs: [
          'OS protection is requested, but this Windows version replaces the window with a black area: an entire-display share shows a black rectangle where the panel is. Follow the steps above.',
        ],
      };
    }
    return {
      heading: 'On this Windows computer',
      paragraphs: [
        'OS protection is requested. On Windows 10 version 2004 and later and on Windows 11, entire-display shares usually omit the panel. Verify it with another participant or a second device before you rely on it.',
      ],
    };
  }
  return {
    heading: 'On this computer',
    paragraphs: [
      'This system has no documented control that leaves a window out of screen capture: the panel is part of any share that includes it. Follow the steps above.',
    ],
  };
}

export function buildShareGuide(platform: DesktopPlatform, status: CaptureStatus): ShareGuide {
  return {
    title: SAFE_SHARE_GUIDE_TITLE,
    steps: SAFE_SHARE_GUIDE_STEPS.map((text, index) => ({
      number: index + 1,
      text,
      link:
        index === SAFE_SHARE_GUIDE_STEPS.length - 1
          ? { label: 'Open the Privacy Test Center', tab: 'privacy-test-center' }
          : null,
    })),
    platform: platformParagraph(platform, status),
    notes: [
      'With private mode on, the panel is also missing from your own screenshots and recordings wherever the operating system honours the request.',
      'Private mode never helps against a camera pointed at your screen.',
      OS_SURFACES_WARNING,
    ],
  };
}
