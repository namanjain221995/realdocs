/**
 * Keeps the panel's content inside the panel window.
 *
 * On Windows, a native tooltip (a `title` attribute) and the popup list of a
 * native `<select>` are separate windows that the panel's capture-exclusion
 * request does not cover. The panel uses the UI kit's DOM tooltips and DOM
 * menus instead; these guards make sure nothing (the editor, a future
 * component, or document content) brings the native ones back:
 *
 * - every `title` attribute in the page is removed as soon as it appears
 *   (an element whose only name it was keeps it as `aria-label`);
 * - a native `<select>` cannot open its popup by mouse or keyboard.
 *
 * Input-method candidate windows and drag images are drawn by the operating
 * system and cannot be covered from here; the Safe Share Guide says so.
 */
import { opensSelectPopup, removeNativeTooltip } from '../../shared/surfaces';

function stripTitles(root: ParentNode): void {
  if (root instanceof Element && root.hasAttribute('title')) removeNativeTooltip(root);
  for (const element of root.querySelectorAll('[title]')) removeNativeTooltip(element);
}

function isSelect(target: EventTarget | null): boolean {
  return target instanceof HTMLSelectElement;
}

export function installSurfaceGuards(doc: Document = document): () => void {
  stripTitles(doc);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        removeNativeTooltip(record.target);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) stripTitles(node);
      }
    }
  });
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });

  const onPointer = (event: Event): void => {
    if (isSelect(event.target)) event.preventDefault();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (isSelect(event.target) && opensSelectPopup(event)) event.preventDefault();
  };
  doc.addEventListener('mousedown', onPointer, true);
  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('keydown', onKey, true);
  return () => {
    observer.disconnect();
    doc.removeEventListener('mousedown', onPointer, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('keydown', onKey, true);
  };
}
