/**
 * The four documents the web app publishes itself. They are the repository's
 * own files, bundled as text at build time (`?raw`), so the reader works
 * offline of the repository and never fetches anything.
 */
import readme from '../../../../../README.md?raw';
import linuxClient from '../../../../../docs/linux-client.md?raw';
import macosClient from '../../../../../docs/macos-client.md?raw';
import security from '../../../../../docs/security.md?raw';
import windowsClient from '../../../../../docs/windows-client.md?raw';
import type { ResolvedLink } from './markdown';

export interface BundledDocument {
  slug: 'readme' | 'windows-client' | 'macos-client' | 'linux-client' | 'security';
  /** The file in the repository, relative to its root. */
  file: string;
  title: string;
  source: string;
}

export const BUNDLED_DOCUMENTS: readonly BundledDocument[] = [
  { slug: 'readme', file: 'README.md', title: 'About RealtimeDocs', source: readme },
  {
    slug: 'windows-client',
    file: 'docs/windows-client.md',
    title: 'Windows desktop app',
    source: windowsClient,
  },
  {
    slug: 'macos-client',
    file: 'docs/macos-client.md',
    title: 'macOS desktop app',
    source: macosClient,
  },
  {
    slug: 'linux-client',
    file: 'docs/linux-client.md',
    title: 'Linux desktop app',
    source: linuxClient,
  },
  { slug: 'security', file: 'docs/security.md', title: 'Security', source: security },
];

/** `README`, `readme.md`, `Windows-Client.MD` … to the document, or null. */
export function findDocument(name: string | undefined): BundledDocument | null {
  if (name === undefined) return null;
  const slug = name.toLowerCase().replace(/\.md$/, '');
  return BUNDLED_DOCUMENTS.find((entry) => entry.slug === slug) ?? null;
}

/** Joins a link written in `fromFile` onto the repository root; null if it leaves the repository. */
function repositoryPath(fromFile: string, target: string): string | null {
  const parts = fromFile.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

/**
 * What a link inside a bundled document becomes: another bundled document is
 * a route of this app, a web address opens in a new tab, an in-page anchor
 * stays on the page, and a link to any other file of the repository (which is
 * not part of this site) is shown as plain text.
 */
export function resolveDocumentLink(fromFile: string, slug: string, href: string): ResolvedLink {
  if (href.startsWith('#')) return { kind: 'internal', to: `/guides/${slug}${href}` };
  if (/^(?:https?:\/\/|mailto:)/i.test(href)) return { kind: 'external', href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { kind: 'none' };
  const hashAt = href.indexOf('#');
  const file = hashAt === -1 ? href : href.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : href.slice(hashAt);
  const resolved = repositoryPath(fromFile, file);
  const target = BUNDLED_DOCUMENTS.find((entry) => entry.file === resolved);
  return target ? { kind: 'internal', to: `/guides/${target.slug}${fragment}` } : { kind: 'none' };
}
