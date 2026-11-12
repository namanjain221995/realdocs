import { redirect } from 'react-router';

/**
 * The guide reader used to live at `/docs/:name`; `/docs` is now the developer
 * portal. Old links (bookmarks, mails, the desktop app's help) keep working:
 * a guide name under `/docs` is sent on to `/guides`. Kept apart from
 * `documents.ts` so the router can use it without loading the bundled text.
 */
export const GUIDE_SLUGS = [
  'readme',
  'windows-client',
  'macos-client',
  'linux-client',
  'security',
] as const;

/** `README`, `readme.md`, `Windows-Client.MD` … to the slug, or null. */
export function legacyGuideSlug(name: string | undefined): (typeof GUIDE_SLUGS)[number] | null {
  if (name === undefined) return null;
  const slug = name.toLowerCase().replace(/\.md$/, '');
  return GUIDE_SLUGS.find((candidate) => candidate === slug) ?? null;
}

/** Route loader of `/docs/:section`: redirects (replacing the history entry) when `name` is a guide. */
export function legacyGuideLoader({
  params,
  request,
}: {
  params: { section?: string };
  request: Request;
}): Response | null {
  const slug = legacyGuideSlug(params.section);
  if (!slug) return null;
  return redirect(`/guides/${slug}${new URL(request.url).hash}`);
}
