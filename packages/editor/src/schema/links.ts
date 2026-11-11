/**
 * Link safety. The implementation lives in `@realtimedocs/contracts` (it has no
 * dependencies, so the desktop main process can use it without the editor);
 * this module keeps the editor's import path stable.
 */
export {
  ALLOWED_LINK_PROTOCOLS,
  isSafeExternalUrl,
  isSafeLinkHref,
  sanitizeLinkHref,
} from '@realtimedocs/contracts';
