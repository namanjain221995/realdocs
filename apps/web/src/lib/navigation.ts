/**
 * Helpers for "send me back where I was going" after sign-in.
 */

const DEFAULT_PATH = '/';

/** A person's documents (the dashboard). */
export const DOCUMENTS_PATH = '/documents';
/** The product page, for signed-in accounts. `/` shows it to members too. */
export const PRODUCT_PATH = '/product';
/** Where an administrator starts after signing in. */
export const ADMIN_HOME_PATH = '/admin/users';

/**
 * Accepts only a path inside this app. Anything that could leave the origin
 * (`//host`, `/\host`, a scheme, control characters) falls back to the
 * dashboard, so a crafted `?next=` can never become an open redirect.
 */
export function safeNextPath(value: string | null | undefined, origin: string): string {
  if (!value) return DEFAULT_PATH;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_PATH;
  }
  // Reject control characters and whitespace outright.
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return DEFAULT_PATH;
  }
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return DEFAULT_PATH;
  }
  if (url.origin !== origin) return DEFAULT_PATH;
  // Signing in never returns to the sign-in page itself.
  if (url.pathname === '/login') return DEFAULT_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/login?next=<current place>` — omitted for the start page, which is the default anyway. */
export function loginPathFor(pathname: string, search = ''): string {
  const target = `${pathname}${search}`;
  if (target === DEFAULT_PATH || target === '') return '/login';
  return `/login?next=${encodeURIComponent(target)}`;
}

export function documentPath(documentId: string): string {
  return `/d/${documentId}`;
}

export function documentPrintPath(documentId: string): string {
  return `/d/${documentId}/print`;
}
