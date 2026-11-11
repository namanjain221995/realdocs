/**
 * Private Presenter Mode around the panel: taskbar/Dock omission and its
 * recovery invariant, the Safe Share Guide, the surfaces that the operating
 * system draws outside the window, the fail-safe for a disconnected display,
 * minimal permissions, and the wording rules for every protection-related
 * string.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { neutralFileName } from '../../src/main/asset-download';
import { hardenSession } from '../../src/main/session-security';
import {
  BLACK_AREA_DETAIL,
  FALLBACK_ADVICE,
  MACOS_SINGLE_DISPLAY_WARNING,
  MACOS_WHOLE_DISPLAY_WARNING,
  OS_SURFACES_WARNING,
  SCOPE_WARNING,
  VERIFY_WARNING,
  WINDOWS_COMPOSITION_WARNING,
  captureChip,
  captureTrayLines,
  computeCaptureStatus,
  summarizeVerification,
  type CaptureStatusInput,
  type WindowProtectionResult,
} from '../../src/shared/capture';
import { decideDisplayChange, type DisplayInfo, type Rect } from '../../src/shared/geometry';
import {
  PRESENCE_SCOPE_NOTE,
  computePresence,
  hasPresenceRecovery,
} from '../../src/shared/presence';
import {
  FORBIDDEN_PROTECTION_WORDS,
  MACOS_WHOLE_DISPLAY_WARNING as CONTRACT_MACOS_WARNING,
  PROTECTION_STATUS_LABELS,
  RETURN_TO_INTERACTIVE_LABEL,
  SAFE_SHARE_GUIDE_STEPS,
} from '../../src/shared/privacy/status';
import {
  PARKED_NOTICE,
  PARKED_STRIP_NOTICE,
  SAFE_SHARE_GUIDE_TITLE,
  buildShareGuide,
} from '../../src/shared/share-guide';
import type { DesktopPlatform } from '../../src/shared/shortcuts';
import {
  NEUTRAL_TITLE,
  opensSelectPopup,
  panelWindowTitle,
  removeNativeTooltip,
} from '../../src/shared/surfaces';

const platforms: DesktopPlatform[] = ['win32', 'darwin', 'linux'];

describe('taskbar and Dock omission', () => {
  it('is on by default wherever there is a way back that needs neither the taskbar nor the Dock', () => {
    const windows = computePresence({
      platform: 'win32',
      showInTaskbar: false,
      trayAvailable: true,
      shortcutAvailable: true,
    });
    expect(windows).toMatchObject({ omitted: true, blocked: null, activationPolicy: null });
    const mac = computePresence({
      platform: 'darwin',
      showInTaskbar: false,
      trayAvailable: true,
      shortcutAvailable: false,
    });
    expect(mac).toMatchObject({ omitted: true, activationPolicy: 'accessory' });
  });

  it('opting back in lists the app again, on every platform that can', () => {
    expect(
      computePresence({
        platform: 'win32',
        showInTaskbar: true,
        trayAvailable: true,
        shortcutAvailable: true,
      }),
    ).toMatchObject({ omitted: false, blocked: null });
    expect(
      computePresence({
        platform: 'darwin',
        showInTaskbar: true,
        trayAvailable: true,
        shortcutAvailable: true,
      }),
    ).toMatchObject({ omitted: false, activationPolicy: 'regular' });
  });

  // The invariant: no working tray / menu-bar item AND no shortcut means no omission.
  it.each([
    ['win32', false, false, false],
    ['win32', true, false, true],
    ['win32', false, true, true],
    ['win32', true, true, true],
    // Without a Dock icon macOS shows no application menu: only the menu-bar item reaches Settings and Quit.
    ['darwin', false, false, false],
    ['darwin', false, true, false],
    ['darwin', true, false, true],
    ['darwin', true, true, true],
  ] as const)(
    '%s, tray %s, shortcut %s: omitted %s',
    (platform, trayAvailable, shortcutAvailable, omitted) => {
      const presence = computePresence({
        platform,
        showInTaskbar: false,
        trayAvailable,
        shortcutAvailable,
      });
      expect(presence.omitted).toBe(omitted);
      expect(hasPresenceRecovery({ platform, trayAvailable, shortcutAvailable })).toBe(omitted);
      if (!omitted) {
        expect(presence.blocked).toBe('no_recovery_path');
        if (platform === 'darwin') expect(presence.activationPolicy).toBe('regular');
        expect(presence.detail.length).toBeGreaterThan(40);
      }
    },
  );

  it('is never in effect on Linux, and says so', () => {
    const linux = computePresence({
      platform: 'linux',
      showInTaskbar: false,
      trayAvailable: true,
      shortcutAvailable: true,
    });
    expect(linux).toMatchObject({ omitted: false, supported: false, activationPolicy: null });
    expect(linux.label).toBe('Not available on Linux');
  });

  it('stays apart from private mode in its wording', () => {
    expect(PRESENCE_SCOPE_NOTE).toContain('does not change what a screen share');
    for (const platform of platforms) {
      for (const showInTaskbar of [true, false]) {
        const presence = computePresence({
          platform,
          showInTaskbar,
          trayAvailable: true,
          shortcutAvailable: true,
        });
        expect(`${presence.title} ${presence.label} ${presence.detail}`).not.toMatch(
          /private|capture|screen share|protect/i,
        );
      }
    }
  });
});

describe('Safe Share Guide', () => {
  const status = (overrides: Partial<CaptureStatusInput>) =>
    computeCaptureStatus({
      mode: 'desktop',
      platform: 'win32',
      systemVersion: '10.0.22631',
      requested: true,
      results: [],
      ...overrides,
    });

  it('has the contract’s numbered steps verbatim, step 4 linking to the Privacy Test Center', () => {
    const guide = buildShareGuide('win32', status({}));
    expect(guide.title).toBe(SAFE_SHARE_GUIDE_TITLE);
    expect(guide.steps.map((step) => step.text)).toEqual([...SAFE_SHARE_GUIDE_STEPS]);
    expect(guide.steps.map((step) => step.number)).toEqual([1, 2, 3, 4]);
    expect(guide.steps.slice(0, 3).every((step) => step.link === null)).toBe(true);
    expect(guide.steps[3]?.link).toEqual({
      label: 'Open the Privacy Test Center',
      tab: 'privacy-test-center',
    });
  });

  it('then one paragraph for the platform', () => {
    const windows = buildShareGuide('win32', status({}));
    expect(windows.platform.paragraphs).toHaveLength(1);
    expect(windows.platform.paragraphs[0]).toContain('OS protection is requested');
    expect(windows.platform.paragraphs[0]).toContain('Windows 10 version 2004');
    expect(windows.platform.paragraphs[0]).toContain('usually omit the panel');
    expect(windows.platform.paragraphs[0]).toMatch(/verify/i);
    expect(buildShareGuide('win32', status({ requested: false })).platform.paragraphs[0]).toContain(
      'Private mode is off',
    );
    expect(
      buildShareGuide('win32', status({ systemVersion: '10.0.18363' })).platform.paragraphs[0],
    ).toContain('black area');
    const mac = buildShareGuide(
      'darwin',
      status({ platform: 'darwin', systemVersion: '15.1', displayCount: 2 }),
    );
    expect(mac.platform.paragraphs).toEqual([CONTRACT_MACOS_WARNING]);
    const macOneDisplay = buildShareGuide(
      'darwin',
      status({ platform: 'darwin', systemVersion: '15.1', displayCount: 1 }),
    );
    expect(macOneDisplay.platform.paragraphs).toEqual([
      CONTRACT_MACOS_WARNING,
      MACOS_SINGLE_DISPLAY_WARNING,
    ]);
    const linux = buildShareGuide('linux', status({ platform: 'linux', systemVersion: '6.8' }));
    expect(linux.platform.paragraphs[0]).toContain('no documented control');
  });

  it('keeps the facts of the earlier card: own screenshots, camera, OS-drawn surfaces', () => {
    const notes = buildShareGuide('win32', status({})).notes.join(' ');
    expect(notes).toContain('own screenshots and recordings');
    expect(notes).toContain('camera');
    expect(notes).toContain(OS_SURFACES_WARNING);
  });
});

describe('surfaces drawn by the operating system', () => {
  it('names the document in the native window title only with private mode off', () => {
    expect(panelWindowTitle({ documentTitle: 'Salary review', privateMode: true })).toBe(
      NEUTRAL_TITLE,
    );
    expect(panelWindowTitle({ documentTitle: 'Salary review', privateMode: false })).toBe(
      'Salary review — RealtimeDocs',
    );
    expect(panelWindowTitle({ documentTitle: '  ', privateMode: false })).toBe(NEUTRAL_TITLE);
    expect(panelWindowTitle({ documentTitle: null, privateMode: false })).toBe(NEUTRAL_TITLE);
  });

  it('removes native tooltips and keeps the accessible name', () => {
    const element = (attributes: Record<string, string>, text = '') => {
      const store = new Map(Object.entries(attributes));
      return {
        store,
        textContent: text,
        getAttribute: (name: string) => store.get(name) ?? null,
        setAttribute: (name: string, value: string) => void store.set(name, value),
        removeAttribute: (name: string) => void store.delete(name),
      };
    };
    const iconOnly = element({ title: 'Bold' });
    expect(removeNativeTooltip(iconOnly)).toBe(true);
    expect([...iconOnly.store]).toEqual([['aria-label', 'Bold']]);
    const named = element({ title: 'Secret document text', 'aria-label': 'Link' });
    removeNativeTooltip(named);
    expect([...named.store]).toEqual([['aria-label', 'Link']]);
    const withText = element({ title: 'Secret' }, 'Visible text');
    removeNativeTooltip(withText);
    expect(withText.store.size).toBe(0);
    expect(removeNativeTooltip(element({}))).toBe(false);
  });

  it('recognises every key that opens a native select popup', () => {
    const key = (
      name: string,
      modifiers: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {},
    ) => ({
      key: name,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...modifiers,
    });
    for (const name of [' ', 'Enter', 'F4', 'ArrowDown', 'ArrowUp']) {
      expect(opensSelectPopup(key(name)), name).toBe(true);
      expect(opensSelectPopup(key(name, { altKey: true })), name).toBe(true);
    }
    expect(opensSelectPopup(key('a'))).toBe(false);
    expect(opensSelectPopup(key('ArrowDown', { ctrlKey: true }))).toBe(false);
  });

  it('proposes a neutral file name in the save dialog while private mode is on', () => {
    expect(neutralFileName('Q3 layoffs.xlsx')).toBe('attachment.xlsx');
    expect(neutralFileName('notes')).toBe('attachment');
    expect(neutralFileName('archive.tar.gz')).toBe('attachment.gz');
    expect(neutralFileName('weird.<script>')).toBe('attachment');
  });

  it('keeps the parked notices free of document content', () => {
    expect(PARKED_NOTICE).toBe(
      'Notes display disconnected — panel hidden so it is not shared. Click to show.',
    );
    expect(PARKED_STRIP_NOTICE).toContain('Notes display disconnected');
  });
});

describe('a disconnected display while private mode is on', () => {
  function display(id: number, bounds: Rect, primary = false): DisplayInfo {
    return {
      id,
      bounds,
      workArea: { ...bounds, height: bounds.height - 40 },
      scaleFactor: 1,
      primary,
    };
  }
  const laptop = display(1, { x: 0, y: 0, width: 1440, height: 900 }, true);
  const external = display(2, { x: 1440, y: 0, width: 2560, height: 1440 });
  const onExternal = { x: 1800, y: 100, width: 720, height: 460 };
  const previous = { id: external.id, bounds: external.bounds };

  it('parks the panel instead of moving it onto another display', () => {
    // The external display was unplugged; the window is still where it was.
    expect(
      decideDisplayChange({ current: onExternal, previous, displays: [laptop], protect: true })
        .action,
    ).toBe('park');
    // The operating system already moved it onto the laptop's display: still parked.
    expect(
      decideDisplayChange({
        current: { x: 300, y: 100, width: 720, height: 460 },
        previous,
        displays: [laptop],
        protect: true,
      }).action,
    ).toBe('park');
  });

  it('moves it back as before when private mode is off', () => {
    const decision = decideDisplayChange({
      current: onExternal,
      previous,
      displays: [laptop],
      protect: false,
    });
    expect(decision.action).toBe('move');
    if (decision.action === 'move') expect(decision.placement.displayId).toBe(laptop.id);
  });

  it('keeps or adjusts it on the same display, also when the display was renumbered', () => {
    expect(
      decideDisplayChange({
        current: onExternal,
        previous,
        displays: [laptop, external],
        protect: true,
      }).action,
    ).toBe('keep');
    const renumbered = { ...external, id: 99 };
    expect(
      decideDisplayChange({
        current: onExternal,
        previous,
        displays: [laptop, renumbered],
        protect: true,
      }).action,
    ).toBe('keep');
    // A lower resolution on the same display: corrected there, never parked.
    const smaller = display(2, { x: 1440, y: 0, width: 1280, height: 720 });
    expect(
      decideDisplayChange({
        current: { x: 2400, y: 100, width: 720, height: 460 },
        previous,
        displays: [laptop, smaller],
        protect: true,
      }).action,
    ).toBe('adjust');
  });

  it('does nothing special without a record of where the panel was', () => {
    expect(
      decideDisplayChange({
        current: onExternal,
        previous: null,
        displays: [laptop],
        protect: true,
      }).action,
    ).toBe('adjust');
  });
});

describe('minimal permissions', () => {
  it('denies every permission request, check, device and display-media request', () => {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {};
    const fakeSession = {
      setPermissionRequestHandler: (handler: (...args: unknown[]) => unknown) => {
        handlers.request = handler;
      },
      setPermissionCheckHandler: (handler: (...args: unknown[]) => unknown) => {
        handlers.check = handler;
      },
      setDevicePermissionHandler: (handler: (...args: unknown[]) => unknown) => {
        handlers.device = handler;
      },
      setDisplayMediaRequestHandler: (handler: (...args: unknown[]) => unknown) => {
        handlers.display = handler;
      },
      webRequest: {
        onBeforeRedirect: () => undefined,
        onCompleted: () => undefined,
        onErrorOccurred: () => undefined,
        onBeforeSendHeaders: () => undefined,
      },
      on: () => undefined,
    };
    hardenSession(fakeSession as never, {
      getAuthContext: () => ({ serverOrigin: null, token: null }),
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as never,
    });
    for (const permission of [
      'media',
      'display-capture',
      'notifications',
      'geolocation',
      'clipboard-read',
      'pointerLock',
      'fullscreen',
      'openExternal',
      'window-management',
    ]) {
      const callback = vi.fn();
      handlers.request?.(null, permission, callback, {});
      expect(callback, permission).toHaveBeenCalledExactlyOnceWith(false);
      expect(handlers.check?.(null, permission, 'app://realtimedocs', {}), permission).toBe(false);
    }
    expect(handlers.device?.({ deviceType: 'usb' })).toBe(false);
    const display = vi.fn();
    handlers.display?.({}, display);
    expect(display).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('asks the operating system for nothing: no media, screen, accessibility or input-monitoring API in the source', () => {
    const root = path.resolve(__dirname, '../../src');
    const files = (directory: string): string[] =>
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return files(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const forbidden =
      /askForMediaAccess|getMediaAccessStatus|isTrustedAccessibilityClient|desktopCapturer|getUserMedia|getDisplayMedia|requestPermission|systemPreferences|setLoginItemSettings|runAsAdmin|requireAdministrator/;
    const offenders = files(root).filter((file) =>
      forbidden.test(
        fs
          .readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ),
    );
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
});

describe('protection-related wording', () => {
  // Every string a person can read about protection, from the pure modules.
  function protectionStrings(): string[] {
    const results = (overrides: Partial<WindowProtectionResult> = {}): WindowProtectionResult[] => [
      {
        window: 'panel',
        requested: true,
        attempted: true,
        error: null,
        readBack: true,
        affinity: null,
        pendingComposition: false,
        composedAt: null,
        at: '2026-11-10T10:00:00.000Z',
        ...overrides,
      },
    ];
    const inputs: CaptureStatusInput[] = [];
    for (const platform of platforms) {
      for (const systemVersion of ['10.0.22631', '10.0.18363', '', '15.1', '6.8']) {
        for (const requested of [true, false]) {
          for (const result of [
            results(),
            results({ pendingComposition: true }),
            results({ readBack: false }),
            results({ error: 'boom', readBack: null }),
            results({ affinity: 'monitor' }),
          ]) {
            for (const displayCount of [1, 2]) {
              inputs.push({
                mode: 'desktop',
                platform,
                systemVersion,
                requested,
                results: result,
                displayCount,
              });
            }
          }
        }
      }
    }
    inputs.push({
      mode: 'browser',
      platform: 'linux',
      systemVersion: '',
      requested: true,
      results: [],
    });
    const strings: string[] = [];
    for (const value of inputs) {
      const status = computeCaptureStatus(value);
      const chip = captureChip(status);
      strings.push(status.label, status.detail, ...status.warnings, ...captureTrayLines(status));
      strings.push(chip.label, ...chip.explanation);
      for (const platform of platforms) {
        const guide = buildShareGuide(platform, status);
        strings.push(
          guide.title,
          ...guide.steps.map((step) => step.text),
          ...guide.platform.paragraphs,
          ...guide.notes,
        );
        for (const step of guide.steps) if (step.link) strings.push(step.link.label);
      }
    }
    const verification = summarizeVerification(
      [],
      {
        appVersion: '0.1.0',
        electronVersion: '45.2.3',
        platform: 'win32',
        osVersion: '10.0.22631',
        displayCount: 2,
      },
      new Date(),
    );
    strings.push(verification.line, ...verification.warnings);
    for (const platform of platforms) {
      for (const showInTaskbar of [true, false]) {
        for (const trayAvailable of [true, false]) {
          const presence = computePresence({
            platform,
            showInTaskbar,
            trayAvailable,
            shortcutAvailable: false,
          });
          strings.push(presence.title, presence.label, presence.detail);
        }
      }
    }
    strings.push(
      PRESENCE_SCOPE_NOTE,
      PARKED_NOTICE,
      PARKED_STRIP_NOTICE,
      MACOS_WHOLE_DISPLAY_WARNING,
      MACOS_SINGLE_DISPLAY_WARNING,
      OS_SURFACES_WARNING,
      FALLBACK_ADVICE,
      SCOPE_WARNING,
      VERIFY_WARNING,
      WINDOWS_COMPOSITION_WARNING,
      BLACK_AREA_DETAIL,
      RETURN_TO_INTERACTIVE_LABEL,
      ...Object.values(PROTECTION_STATUS_LABELS),
    );
    return strings;
  }

  /** The renderer and menu sources that show protection: their literal text. */
  function protectionSourceText(): string {
    const root = path.resolve(__dirname, '../../src');
    return [
      'renderer/panel/PanelHeader.tsx',
      'renderer/panel/PanelApp.tsx',
      'renderer/panel/ClickThroughBadge.tsx',
      'renderer/shared/ShareGuideView.tsx',
      'renderer/settings/PrivacyTab.tsx',
      'renderer/settings/PrivacyTestCenterTab.tsx',
      'renderer/settings/BehaviourTab.tsx',
      'renderer/settings/DiagnosticsTab.tsx',
      'renderer/privacy/PrivacyTestCenter.tsx',
      'main/menu-model.ts',
      'main/controller.ts',
    ]
      .map((file) =>
        fs
          .readFileSync(path.join(root, file), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      )
      .join('\n');
  }

  it('never uses a word from FORBIDDEN_PROTECTION_WORDS', () => {
    const text = [...protectionStrings(), protectionSourceText()].join('\n').toLowerCase();
    for (const word of FORBIDDEN_PROTECTION_WORDS) {
      expect(text.includes(word.toLowerCase()), word).toBe(false);
    }
  });

  it('covers a meaningful set of strings', () => {
    const strings = new Set(protectionStrings());
    expect(strings.size).toBeGreaterThan(50);
    for (const label of Object.values(PROTECTION_STATUS_LABELS))
      expect(strings.has(label)).toBe(true);
  });
});
