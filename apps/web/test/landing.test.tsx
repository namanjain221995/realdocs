import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDocument, resolveDocumentLink } from '../src/features/guides/documents';
import { renderMarkdown } from '../src/features/guides/markdown';
import {
  CompatibilityMatrix,
  isVerifiedConfiguration,
  VERIFIED_CONFIGURATIONS,
  type VerifiedConfiguration,
} from '../src/features/landing/compatibility';
import { PROTECTION_STATUS_LABELS } from '../../desktop/src/shared/privacy/status';
import {
  CAVEAT,
  MACOS_WARNING,
  REQUEST_STATES,
  REQUIRED_SENTENCE,
  VERIFICATION_STATES,
} from '../src/features/landing/copy';
import { buildLabel, formatBytes } from '../src/features/landing/downloads';
import { ApiSection } from '../src/features/landing/sections/ApiSection';
import { Faq } from '../src/features/landing/sections/Faq';
import { HistoryShowcase } from '../src/features/landing/sections/History';
import { Platforms } from '../src/features/landing/sections/Platforms';
import { Presenter } from '../src/features/landing/sections/Presenter';
import { Product } from '../src/features/landing/sections/Product';
import { Reliability } from '../src/features/landing/sections/Reliability';
import { Security } from '../src/features/landing/sections/Security';
import { Sessions } from '../src/features/landing/sections/Sessions';
import {
  parseReadingMode,
  resetReadingModeCacheForTests,
  useReadingMode,
} from '../src/lib/readingMode';
import { useWakeLock, type WakeLockStatus } from '../src/lib/wakeLock';

const html = (source: string): string =>
  renderToStaticMarkup(
    <>
      {renderMarkdown(source, {
        resolveLink: (href) =>
          /^https?:/.test(href) ? { kind: 'external', href } : { kind: 'none' },
      })}
    </>,
  );

describe('markdown renderer', () => {
  it('shows raw HTML as text and never creates an element from it', () => {
    const out = html('<script>alert(1)</script>\n\nA <img src=x onerror=alert(1)> b <b>bold</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('never makes a link of a javascript:, data: or vbscript: address', () => {
    for (const href of ['javascript:alert(1)', 'JaVa\nScRiPt:alert(1)', 'data:text/html,x']) {
      const out = renderToStaticMarkup(
        <>
          {renderMarkdown(`[click](${href.replace('\n', '')})`, {
            // Even if a caller wrongly allowed it.
            resolveLink: (target) => ({ kind: 'external', href: target }),
          })}
        </>,
      );
      expect(out, href).not.toContain('<a');
      expect(out).toContain('click');
    }
  });

  it('opens web links in a new tab without an opener', () => {
    expect(html('[x](https://example.com/a)')).toContain(
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('renders headings with anchors, tables, code and lists', () => {
    const out = html(
      '# Hello World\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```\nx < y\n```\n\n- one\n- two',
    );
    expect(out).toContain('id="hello-world"');
    expect(out).toContain('<table>');
    expect(out).toContain('x &lt; y');
    expect(out).toContain('<ul>');
  });
});

describe('bundled documents', () => {
  it('finds the four documents by slug, with or without .md, in any case', () => {
    for (const name of ['readme', 'README.md', 'Windows-Client', 'macos-client.MD', 'security']) {
      expect(findDocument(name), name).not.toBeNull();
    }
    for (const name of ['nope', 'readme.txt', '', 'docs/security', undefined]) {
      expect(findDocument(name), String(name)).toBeNull();
    }
  });

  it('resolves links relative to the file they are written in', () => {
    const from = (file: string, href: string) => resolveDocumentLink(file, 'x', href);
    expect(from('README.md', 'docs/security.md#desktop-app')).toEqual({
      kind: 'internal',
      to: '/guides/security#desktop-app',
    });
    expect(from('docs/windows-client.md', 'security.md')).toEqual({
      kind: 'internal',
      to: '/guides/security',
    });
    expect(from('docs/security.md', '../README.md')).toEqual({
      kind: 'internal',
      to: '/guides/readme',
    });
    expect(from('docs/security.md', '../deploy/README.md')).toEqual({ kind: 'none' });
    expect(from('docs/security.md', 'testing.md')).toEqual({ kind: 'none' });
    expect(from('README.md', '#top')).toEqual({ kind: 'internal', to: '/guides/x#top' });
    expect(from('README.md', 'https://example.com')).toEqual({
      kind: 'external',
      href: 'https://example.com',
    });
    expect(from('README.md', 'javascript:alert(1)')).toEqual({ kind: 'none' });
  });
});

describe('download sizes', () => {
  it('formats sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(512_000)).toBe('512 KB');
    expect(formatBytes(84_300_000)).toBe('84.3 MB');
  });
});

describe('reading mode store', () => {
  it('validates what was stored', () => {
    expect(parseReadingMode(null)).toEqual({ enabled: false, fontScale: 1.4, light: false });
    expect(parseReadingMode({ enabled: true, fontScale: 9, light: true })).toEqual({
      enabled: true,
      fontScale: 1.8,
      light: true,
    });
    expect(parseReadingMode({ enabled: 'yes', fontScale: 'big' }).enabled).toBe(false);
  });
});

/* ------------------------------------------------------------ hooks */

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  resetReadingModeCacheForTests();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, 'wakeLock');
});

function mount(node: ReactNode): void {
  act(() => root.render(node));
}

describe('useReadingMode', () => {
  it('persists to localStorage and survives a reload of the store', () => {
    let controls!: ReturnType<typeof useReadingMode>;
    function Probe() {
      controls = useReadingMode();
      return null;
    }
    mount(<Probe />);
    act(() => controls.update({ enabled: true, fontScale: 1.63 }));
    expect(controls.reading).toEqual({ enabled: true, fontScale: 1.6, light: false });
    expect(JSON.parse(window.localStorage.getItem('rd.reading.v1') ?? 'null')).toEqual(
      controls.reading,
    );
    resetReadingModeCacheForTests();
    expect(
      parseReadingMode(JSON.parse(window.localStorage.getItem('rd.reading.v1') ?? 'null')).enabled,
    ).toBe(true);
    act(() => controls.update({ enabled: false, fontScale: 1.4 }));
    expect(window.localStorage.getItem('rd.reading.v1')).toBeNull();
  });

  it('keeps working when storage throws', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      let controls!: ReturnType<typeof useReadingMode>;
      function Probe() {
        controls = useReadingMode();
        return null;
      }
      mount(<Probe />);
      act(() => controls.update({ enabled: true }));
      expect(controls.reading.enabled).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('useWakeLock', () => {
  function Probe({ active, out }: { active: boolean; out: { status: WakeLockStatus } }) {
    out.status = useWakeLock(active);
    return null;
  }

  it('reports unsupported when the API is missing', () => {
    const out = { status: 'off' as WakeLockStatus };
    mount(<Probe active out={out} />);
    expect(out.status).toBe('unsupported');
  });

  it('acquires, releases when switched off, and releases when unmounted', async () => {
    let requests = 0;
    let releases = 0;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => {
          requests += 1;
          const sentinel = new EventTarget() as EventTarget & { release: () => Promise<void> };
          sentinel.release = () => {
            releases += 1;
            return Promise.resolve();
          };
          return Promise.resolve(sentinel);
        },
      },
    });
    const out = { status: 'off' as WakeLockStatus };
    mount(<Probe active out={out} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests).toBe(1);
    expect(out.status).toBe('active');
    mount(<Probe active={false} out={out} />);
    expect(releases).toBe(1);
    expect(out.status).toBe('off');
    mount(<Probe active out={out} />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => root.unmount());
    expect(releases).toBe(2);
    root = createRoot(container);
  });

  it('reports denied when the browser refuses', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: () => Promise.reject(new Error('NotAllowedError')) },
    });
    const out = { status: 'off' as WakeLockStatus };
    mount(<Probe active out={out} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(out.status).toBe('denied');
  });
});

describe('compatibility matrix', () => {
  const markup = (entries: readonly VerifiedConfiguration[]): string =>
    renderToStaticMarkup(<CompatibilityMatrix entries={entries} />);
  const count = (text: string, part: string): number => text.split(part).length - 1;

  it('an empty file renders no verified cell: 48 cells, all "Not tested"', () => {
    const out = markup([]);
    expect(count(out, 'data-testid="matrix-cell"')).toBe(2 * 6 * 4);
    expect(count(out, 'data-verified')).toBe(0);
    expect(count(out, 'Not tested')).toBe(48);
    expect(out).not.toMatch(/[✓✔☑]/);
  });

  it('the shipped file is a list of complete records, and an empty one today', () => {
    expect(Array.isArray(VERIFIED_CONFIGURATIONS)).toBe(true);
    expect(VERIFIED_CONFIGURATIONS).toHaveLength(0);
  });

  const entry: VerifiedConfiguration = {
    platform: 'windows',
    osVersion: 'Windows 11 23H2 (22631.3007)',
    meetingApp: 'zoom',
    client: 'Zoom desktop 6.1',
    captureMode: 'window',
    monitors: 2,
    protectionEnabled: true,
    outcome: 'Panel not visible to the second participant',
    testedAt: '2026-12-01',
    appVersion: '0.1.0',
    evidence: 'docs/capture-compatibility.md#windows-zoom-window',
  };

  it('shows a result only in the cell that was tested, with its evidence', () => {
    const out = markup([entry]);
    expect(count(out, 'data-verified="true"')).toBe(1);
    expect(count(out, 'Not tested')).toBe(47);
    expect(out).toContain('Panel not visible to the second participant');
    expect(out).toContain('private mode on');
    expect(out).toContain('docs/capture-compatibility.md#windows-zoom-window');
  });

  it('ignores records that are incomplete or malformed', () => {
    const broken = { ...entry, evidence: '' };
    expect(isVerifiedConfiguration(broken)).toBe(false);
    expect(isVerifiedConfiguration({ ...entry, captureMode: 'screen' })).toBe(false);
    expect(isVerifiedConfiguration(null)).toBe(false);
    expect(isVerifiedConfiguration(entry)).toBe(true);
  });
});

describe('desktop builds', () => {
  it('names a build by platform, architecture and format', () => {
    expect(buildLabel({ platform: 'windows', arch: 'arm64', format: 'zip' })).toBe(
      'Windows Arm (arm64) — ZIP archive',
    );
    expect(buildLabel({ platform: 'macos', arch: 'x64', format: 'dmg' })).toBe(
      'macOS Intel (x64) — Disk image (.dmg)',
    );
    expect(buildLabel({ platform: 'linux', arch: 'x64', format: 'appimage' })).toBe(
      'Linux 64-bit (x64) — AppImage',
    );
  });
});

describe('landing wording', () => {
  const page = renderToStaticMarkup(
    <MemoryRouter>
      <Product />
      <Presenter />
      <Sessions />
      <HistoryShowcase />
      <ApiSection />
      <Security />
      <Reliability />
      <Platforms />
      <Faq />
    </MemoryRouter>,
  );
  const text = page.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’');

  it('uses the protection vocabulary of the desktop app and no other status words', () => {
    const labels = Object.values(PROTECTION_STATUS_LABELS);
    for (const state of [...REQUEST_STATES, ...VERIFICATION_STATES]) {
      expect(labels).toContain(state);
    }
    // Every label of the desktop vocabulary is shown on the page.
    for (const label of labels) expect(page).toContain(label);
  });

  it('states the required caveat exactly and keeps the owner’s sentences', () => {
    expect(REQUIRED_SENTENCE).toBe(
      'OS-assisted capture exclusion. Verify your exact meeting and capture setup before relying on it.',
    );
    expect(CAVEAT).toContain('Verify your setup before relying on it.');
    expect(MACOS_WARNING).toContain('Whole-display capture may include RealtimeDocs');
  });

  it('never makes a claim it cannot keep', () => {
    const lower = text.toLowerCase();
    for (const word of [
      'undetect',
      'invisib',
      'guaranteed',
      '100%',
      'bypass',
      'proctor',
      'cannot be recorded',
      'works with every',
    ]) {
      expect(lower, word).not.toContain(word);
    }
    expect(text).toContain('We make no claim about detection.');
    expect(text).toContain('No combination of meeting app and capture mode has been tested');
  });

  it('quotes no performance figures and says why', () => {
    expect(text).not.toMatch(/\d+\s?(ms|concurrent|users|editors)/i);
    expect(text).toContain('no load-test report is published');
  });

  it('shows a copyable request taken from the interview-session contract', () => {
    expect(page).toContain('/api/v1/interview-sessions');
    for (const field of ['candidate', 'interviewers', 'companyName', 'scheduledAt', 'expiresAt']) {
      expect(page).toContain(`&quot;${field}&quot;`);
    }
    expect(page).toContain('Copy request');
  });
});
