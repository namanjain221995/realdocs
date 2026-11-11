/**
 * Rules for the surfaces of this app that are NOT inside one of its windows,
 * and therefore not covered by a window's capture exclusion: the title the
 * operating system shows for a window (taskbar, Alt+Tab, the window list of a
 * meeting app's share picker), the tray tooltip and menu, native tooltips
 * (`title` attributes) and the popup list of a native `<select>`.
 *
 * While private mode is on, none of them carries anything from a document.
 *
 * Pure: no DOM and no Electron types, so the rules are unit-tested directly.
 */

export const NEUTRAL_TITLE = 'RealtimeDocs';

/**
 * The native title of the panel window. With private mode on it never names
 * the document: that text is drawn by the operating system, outside the window.
 */
export function panelWindowTitle(input: {
  documentTitle: string | null | undefined;
  privateMode: boolean;
}): string {
  const title = input.documentTitle?.trim();
  if (input.privateMode || !title) return NEUTRAL_TITLE;
  return `${title} — ${NEUTRAL_TITLE}`;
}

/** The parts of an element that the tooltip rule looks at. */
export interface TitledElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  readonly textContent: string | null;
}

/**
 * Removes the `title` attribute of an element, so the operating system never
 * draws a native tooltip for it (a separate little window, outside the panel).
 * A control whose only name was its `title` keeps that name as `aria-label`;
 * nothing else is kept. Returns true if a `title` was removed.
 */
export function removeNativeTooltip(element: TitledElement): boolean {
  const title = element.getAttribute('title');
  if (title === null) return false;
  const named =
    (element.getAttribute('aria-label') ?? '').trim() !== '' ||
    (element.getAttribute('aria-labelledby') ?? '').trim() !== '' ||
    (element.textContent ?? '').trim() !== '';
  if (!named && title.trim() !== '') element.setAttribute('aria-label', title);
  element.removeAttribute('title');
  return true;
}

/** The parts of a key press that decide whether a closed `<select>` would open its popup. */
export interface SelectKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * True for the keys with which Chromium opens the popup list of a focused,
 * closed `<select>` on some platform: Space, Enter, F4, and the vertical
 * arrows (with Alt on Windows and Linux, without on macOS). The panel opens
 * its own list inside the window for all of them, so that no native popup
 * ever appears, whatever the platform.
 */
export function opensSelectPopup(event: SelectKey): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
    case 'Enter':
    case 'F4':
    case 'ArrowDown':
    case 'ArrowUp':
      return true;
    default:
      return false;
  }
}
