import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CH } from '../../src/shared/channels';
import { WINDOW_ACTIONS } from '../../src/shared/ipc-schemas';
import { PRIVACY_CH } from '../../src/shared/privacy/ipc';
import { initialUpdateSnapshot } from '../../src/shared/updates';
import {
  PANEL_ACTIVATION_REQUIRED,
  decidePanelRequest,
  type PanelCondition,
  type PanelRequest,
} from '../../src/shared/panel-requests';
import { buildInvokeHandlers, buildSendHandlers, type MainApi } from '../../src/main/ipc-handlers';
import {
  IpcError,
  createIpcRouter,
  defineHandler,
  validateSender,
  type SenderInfo,
  type WindowKind,
} from '../../src/main/ipc-router';

function sender(kind: WindowKind | null, url?: string, isMainFrame = true): SenderInfo {
  return {
    frame: { url: url ?? `app://realtimedocs/${kind ?? 'panel'}.html`, isMainFrame },
    windowKind: kind,
  };
}

/**
 * A `MainApi` whose every method is a spy. The panel is visible, expanded and
 * interactive unless a test says otherwise (`panelCondition`).
 */
function fakeApi(
  condition: PanelCondition = { visible: true, collapsed: false, clickThrough: false },
): MainApi & Record<string, ReturnType<typeof vi.fn>> {
  const state = { revision: 1 };
  const target: Record<string, ReturnType<typeof vi.fn>> = {};
  return new Proxy(target, {
    get(store, property: string) {
      store[property] ??= vi.fn(() => {
        if (property === 'getState') return state;
        if (property === 'panelCondition') return condition;
        return undefined;
      });
      return store[property];
    },
  }) as MainApi & Record<string, ReturnType<typeof vi.fn>>;
}

/** Calls of every API method except the read-only `panelCondition`. */
function actingCalls(api: MainApi & Record<string, ReturnType<typeof vi.fn>>): number {
  return Object.entries(api)
    .filter(([name]) => name !== 'panelCondition')
    .reduce((sum, [, spy]) => sum + spy.mock.calls.length, 0);
}

/** The spy behind one method of a fake API. */
function spyOf(api: MainApi, method: keyof MainApi): ReturnType<typeof vi.fn> {
  return (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method] as ReturnType<
    typeof vi.fn
  >;
}

describe('sender validation', () => {
  it('accepts the main frame of a known window showing its own packaged page', () => {
    expect(validateSender(sender('panel'))).toEqual({ ok: true, windowKind: 'panel' });
    expect(
      validateSender(sender('settings', 'app://realtimedocs/settings.html?tab=privacy#x')),
    ).toEqual({
      ok: true,
      windowKind: 'settings',
    });
  });

  it.each([
    ['a destroyed or navigated frame', { frame: null, windowKind: 'panel' as const }, 'no_frame'],
    ['a sub-frame', sender('panel', undefined, false), 'not_main_frame'],
    ['a web page', sender('panel', 'https://docs.example.com/panel.html'), 'foreign_origin'],
    ['another app host', sender('panel', 'app://evil/panel.html'), 'foreign_origin'],
    ['a look-alike host', sender('panel', 'app://realtimedocs.evil/panel.html'), 'foreign_origin'],
    ['a host with port', sender('panel', 'app://realtimedocs:8080/panel.html'), 'foreign_origin'],
    [
      'a host with credentials',
      sender('panel', 'app://user@realtimedocs/panel.html'),
      'foreign_origin',
    ],
    ['a file URL', sender('panel', 'file:///tmp/panel.html'), 'foreign_origin'],
    ['a data URL', sender('panel', 'data:text/html,<script>1</script>'), 'foreign_origin'],
    ['about:blank', sender('panel', 'about:blank'), 'foreign_origin'],
    ['garbage', sender('panel', 'not a url'), 'foreign_origin'],
    ['an unregistered webContents', sender(null), 'unknown_window'],
    [
      'the panel window showing the settings page',
      sender('panel', 'app://realtimedocs/settings.html'),
      'page_mismatch',
    ],
    ['an unknown page', sender('panel', 'app://realtimedocs/assets/x.html'), 'page_mismatch'],
  ])('rejects %s', (_name, info, reason) => {
    expect(validateSender(info)).toEqual({ ok: false, reason });
  });
});

describe('what the panel may ask for in each state', () => {
  const visible: PanelCondition = { visible: true, collapsed: false, clickThrough: false };
  const requests: PanelRequest[] = [
    ...WINDOW_ACTIONS.map((action) => ({ kind: 'window-action' as const, action })),
    { kind: 'set-bounds' },
    { kind: 'preset' },
    { kind: 'nudge' },
    { kind: 'resize-start' },
    { kind: 'click-through', enabled: true },
    { kind: 'click-through', enabled: false },
    { kind: 'open-share-link' },
    { kind: 'disconnect' },
    { kind: 'revalidate' },
    { kind: 'dismiss-notice' },
    { kind: 'external-open' },
  ];

  it('allows everything while the panel is on screen, expanded and interactive', () => {
    for (const request of requests) expect(decidePanelRequest(request, visible).ok).toBe(true);
  });

  it('allows nothing while the panel is hidden, not even showing itself', () => {
    for (const request of requests) {
      expect(decidePanelRequest(request, { ...visible, visible: false })).toMatchObject({
        ok: false,
        code: 'panel_hidden',
      });
    }
  });

  it('allows only leaving click-through while click-through is on', () => {
    const allowed = requests.filter(
      (request) => decidePanelRequest(request, { ...visible, clickThrough: true }).ok,
    );
    expect(allowed).toEqual([{ kind: 'click-through', enabled: false }]);
  });

  it('refuses what lives in the document area while the panel is collapsed', () => {
    const refused = requests
      .filter((request) => !decidePanelRequest(request, { ...visible, collapsed: true }).ok)
      .map((request) => request.kind);
    expect(refused).toEqual(['open-share-link', 'dismiss-notice', 'external-open']);
  });
});

describe('router', () => {
  const handle = vi.fn((input: { value: number }) => input.value * 2);
  const rejections: string[] = [];
  const router = createIpcRouter(
    [
      defineHandler({
        channel: 'test:double',
        schema: z.strictObject({ value: z.number().min(0).max(10) }),
        allowed: ['settings'],
        handle,
      }),
      defineHandler({
        channel: 'test:fail',
        schema: z.undefined(),
        allowed: ['settings'],
        handle: () => {
          throw new IpcError('nope', 'Not possible.');
        },
      }),
      defineHandler({
        channel: 'test:crash',
        schema: z.undefined(),
        allowed: ['settings'],
        handle: () => {
          throw new Error('secret internal detail');
        },
      }),
    ],
    { onReject: (info) => rejections.push(`${info.channel}:${info.code}:${info.detail}`) },
  );

  it('runs a valid request', async () => {
    expect(await router.dispatch('test:double', sender('settings'), [{ value: 4 }])).toEqual({
      ok: true,
      data: 8,
    });
  });

  it('has no generic channel', async () => {
    const result = await router.dispatch('test:anything', sender('settings'), [{ value: 4 }]);
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel' } });
  });

  it('does not call the handler for a forbidden sender, window or malformed input', async () => {
    handle.mockClear();
    const cases: [SenderInfo, unknown[]][] = [
      [sender('settings', 'https://evil.example/settings.html'), [{ value: 1 }]],
      [sender('panel'), [{ value: 1 }]],
      [sender('settings'), []],
      [sender('settings'), [{ value: 11 }]],
      [sender('settings'), [{ value: '4' }]],
      [sender('settings'), [{ value: 4, extra: true }]],
      [sender('settings'), [{ value: Number.NaN }]],
      [sender('settings'), [null]],
      [sender('settings'), [{ value: 1 }, { value: 2 }]],
      [sender('settings'), [{ __proto__: { value: 1 } }]],
    ];
    for (const [from, args] of cases) {
      const result = await router.dispatch('test:double', from, args);
      expect(result.ok).toBe(false);
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('reports rejections without echoing the offending values', async () => {
    rejections.length = 0;
    await router.dispatch('test:double', sender('settings'), [{ value: 'attack-payload-123' }]);
    expect(rejections).toEqual(['test:double:invalid_input:value']);
    expect(rejections.join()).not.toContain('attack-payload');
  });

  it('returns handler errors as codes and hides unexpected ones', async () => {
    expect(await router.dispatch('test:fail', sender('settings'), [])).toEqual({
      ok: false,
      error: { code: 'nope', message: 'Not possible.' },
    });
    const crashed = await router.dispatch('test:crash', sender('settings'), []);
    expect(crashed).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(crashed)).not.toContain('secret internal detail');
  });

  it('refuses duplicate channel declarations', () => {
    const spec = defineHandler({
      channel: 'x',
      schema: z.undefined(),
      allowed: ['panel'],
      handle: () => 1,
    });
    expect(() => createIpcRouter([spec, spec])).toThrow(/Duplicate/);
  });
});

describe('declared actions', () => {
  it('covers exactly the declared channels (no extras, no gaps)', () => {
    const api = fakeApi();
    const declared = [...buildInvokeHandlers(api), ...buildSendHandlers(api)]
      .map((spec) => spec.channel)
      .sort();
    const mainToRenderer: string[] = [CH.stateChanged, CH.event, CH.frameRequest];
    const rendererToMain = Object.values(CH)
      .filter((channel) => !mainToRenderer.includes(channel))
      .sort();
    expect(declared).toEqual(rendererToMain);
  });

  it('keeps configuration away from the panel, which renders other people’s content', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    const settingsOnly: [string, unknown][] = [
      [CH.connectionSetServer, { origin: 'https://evil.example' }],
      [CH.connectionSetOptions, { allowInsecureLan: true }],
      [CH.connectionCheck, undefined],
      [CH.captureSetEnabled, { enabled: false }],
      [CH.privacySnapshot, undefined],
      [CH.privacyRemove, { id: '00000000-0000-4000-8000-000000000001' }],
      [CH.privacyExport, { format: 'markdown' }],
      [CH.windowWorkspace, { showInTaskbar: true }],
      [CH.shortcutsSet, { action: 'returnToInteractive', accelerator: 'Control+Alt+Shift+Z' }],
      [CH.shortcutsReset, {}],
      [CH.shortcutsRecording, { active: true }],
      [CH.windowWorkspace, { pinLevel: 'screen-saver' }],
      [CH.diagnosticsGet, undefined],
      [CH.probeOpen, undefined],
    ];
    for (const [channel, input] of settingsOnly) {
      const args = input === undefined ? [] : [input];
      const fromPanel = await router.dispatch(channel, sender('panel'), args);
      expect(fromPanel).toMatchObject({ ok: false, error: { code: 'forbidden_window' } });
      const fromSettings = await router.dispatch(channel, sender('settings'), args);
      expect(fromSettings.ok).toBe(true);
    }
    expect(api.setServer).toHaveBeenCalledTimes(1);
    expect(api.setServer).toHaveBeenCalledWith('https://evil.example');
  });

  it('has no channel through which a window could confirm a change of server', async () => {
    const api = fakeApi();
    const routers = [
      createIpcRouter(buildInvokeHandlers(api)),
      createIpcRouter(buildSendHandlers(api)),
    ];
    // The channel an earlier version had, and a few guesses.
    const guesses = [
      'rd:connection:confirm',
      'rd:connection:confirm-pending',
      'rd:connection:accept',
      'rd:connection:switch-server',
    ];
    for (const channel of guesses) {
      for (const kind of ['panel', 'settings', 'probe'] as const) {
        for (const router of routers) {
          expect(
            await router.dispatch(channel, sender(kind), [{ id: 'abcdef123456', accept: true }]),
          ).toMatchObject({ ok: false, error: { code: 'unknown_channel' } });
        }
      }
    }
    // Nothing declared, under any name, answers a question.
    expect(Object.keys(CH).filter((name) => /confirm|accept|approve|answer/i.test(name))).toEqual(
      [],
    );
    expect(Object.values(CH).filter((channel) => /confirm|accept|approve/.test(channel))).toEqual(
      [],
    );
    expect(Object.values(api).every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('refuses a panel sender on the confirm channel: there is no such channel to call', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    const result = await router.dispatch('rd:connection:confirm', sender('panel'), [
      { id: 'abcdef123456', accept: true },
    ]);
    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown_channel', message: 'This action is not available.' },
    });
    // The question is answered in the main process's own dialog; the panel can
    // at most cause it to be asked (and only while no document is open).
    expect(actingCalls(api)).toBe(0);
  });

  it('refuses from the panel what the reader could not have asked for in its current state', async () => {
    const acting: [string, unknown][] = [
      [CH.windowAction, { action: 'show' }],
      [CH.windowAction, { action: 'expand' }],
      [CH.windowAction, { action: 'open-settings' }],
      [CH.windowSetBounds, { x: 4000, y: 0 }],
      [CH.windowPreset, { preset: 'large' }],
      [CH.windowNudge, { deltaX: 500 }],
      [CH.windowResizeStart, { edge: 'se' }],
      [CH.windowClickThrough, { enabled: true }],
      [CH.connectionOpenShareLink, { link: 'https://other.example/s/x#y' }],
      [CH.connectionDisconnect, undefined],
      [CH.connectionRevalidate, undefined],
      [CH.connectionDismissNotice, { id: 'abcdef123456' }],
      [CH.externalOpen, { url: 'https://example.com/' }],
    ];
    // Hidden: nothing in it can be clicked, so nothing it asks for can be the reader's doing.
    const hidden = fakeApi({ visible: false, collapsed: false, clickThrough: false });
    const hiddenRouter = createIpcRouter(buildInvokeHandlers(hidden));
    for (const [channel, input] of acting) {
      const args = input === undefined ? [] : [input];
      expect(await hiddenRouter.dispatch(channel, sender('panel'), args), channel).toMatchObject({
        ok: false,
        error: { code: 'panel_hidden' },
      });
    }
    expect(actingCalls(hidden)).toBe(0);
    // The same requests from the settings window are not the panel's and pass.
    for (const [channel, input] of acting.filter(([channel]) => channel !== CH.windowResizeStart)) {
      const args = input === undefined ? [] : [input];
      expect((await hiddenRouter.dispatch(channel, sender('settings'), args)).ok, channel).toBe(
        true,
      );
    }

    // Click-through: only the badge that ends it can be clicked.
    const through = fakeApi({ visible: true, collapsed: false, clickThrough: true });
    const throughRouter = createIpcRouter(buildInvokeHandlers(through));
    for (const [channel, input] of acting) {
      const args = input === undefined ? [] : [input];
      expect(await throughRouter.dispatch(channel, sender('panel'), args), channel).toMatchObject({
        ok: false,
        error: { code: 'click_through' },
      });
    }
    expect(
      await throughRouter.dispatch(CH.windowClickThrough, sender('panel'), [{ enabled: false }]),
    ).toEqual({ ok: true, data: null });
    expect(spyOf(through, 'setClickThrough').mock.calls).toEqual([[false]]);

    // Collapsed: the title strip is there, the document area is not.
    const collapsed = fakeApi({ visible: true, collapsed: true, clickThrough: false });
    const collapsedRouter = createIpcRouter(buildInvokeHandlers(collapsed));
    for (const [channel, input] of [
      [CH.connectionOpenShareLink, { link: 'https://other.example/s/x#y' }],
      [CH.connectionDismissNotice, { id: 'abcdef123456' }],
      [CH.externalOpen, { url: 'https://example.com/' }],
    ] as const) {
      expect(await collapsedRouter.dispatch(channel, sender('panel'), [input])).toMatchObject({
        ok: false,
        error: { code: 'panel_collapsed' },
      });
    }
    expect(
      (await collapsedRouter.dispatch(CH.windowAction, sender('panel'), [{ action: 'expand' }])).ok,
    ).toBe(true);
    expect(spyOf(collapsed, 'openShareLink')).not.toHaveBeenCalled();
    expect(spyOf(collapsed, 'openExternal')).not.toHaveBeenCalled();
  });

  it('lets the preload send acting panel requests only with user activation', () => {
    const preload = fs.readFileSync(path.join(__dirname, '../../src/preload/preload.ts'), 'utf8');
    // Every listed bridge method is wrapped in `act(…)`; the passive ones are not.
    const methodNames = PANEL_ACTIVATION_REQUIRED.map((name) => name.split('.').at(-1) ?? name);
    for (const method of methodNames) {
      expect(preload, method).toMatch(new RegExp(`\\b${method}: \\([^)]*\\) =>\\s*act\\(`));
    }
    for (const passive of ['reportSession', 'resizeMove', 'setClickThroughHover', 'update']) {
      expect(preload, passive).not.toMatch(new RegExp(`\\b${passive}: \\([^)]*\\) =>\\s*act\\(`));
    }
    expect(preload).toMatch(/navigator\.userActivation\.isActive/);
    expect(preload).toMatch(/pathname === '\/panel\.html'/);
  });

  it('lists exactly what the panel, which shows other people’s content, may ask for', () => {
    const api = fakeApi();
    const allowedForPanel = [...buildInvokeHandlers(api), ...buildSendHandlers(api)]
      .filter((spec) => spec.allowed.includes('panel'))
      .map((spec) => spec.channel)
      .sort();
    // Adding a channel for the panel means answering, in ipc-handlers.ts, what
    // hostile content could do with it. This list makes that a deliberate step.
    expect(allowedForPanel).toEqual(
      [
        CH.stateGet,
        CH.prefsUpdate,
        CH.windowAction,
        CH.windowSetBounds,
        CH.windowPreset,
        CH.windowNudge,
        CH.windowResizeStart,
        CH.windowResizeEnd,
        CH.windowResizeMove,
        CH.windowClickThrough,
        CH.windowClickThroughHover,
        CH.connectionOpenShareLink,
        CH.connectionDisconnect,
        CH.connectionRevalidate,
        CH.connectionDismissNotice,
        // Closing the "Updated to…" notice the panel shows; it starts nothing.
        CH.updatesDismissNotice,
        CH.sessionReport,
        CH.externalOpen,
        CH.policyViolation,
        CH.frameAck,
      ].sort(),
    );
  });

  it('keeps the Privacy Test Center records away from the panel and the probe', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    const channels: [string, unknown][] = [
      [CH.privacySnapshot, undefined],
      [CH.privacyRemove, { id: '00000000-0000-4000-8000-000000000001' }],
      [CH.privacyExport, { format: 'json' }],
    ];
    for (const kind of ['panel', 'probe'] as const) {
      for (const [channel, input] of channels) {
        const args = input === undefined ? [] : [input];
        expect(await router.dispatch(channel, sender(kind), args)).toMatchObject({
          ok: false,
          error: { code: 'forbidden_window' },
        });
      }
    }
    expect(actingCalls(api)).toBe(0);
    // The same names as the contract of the Test Center (channels.ts imports nothing).
    expect([CH.privacySnapshot, CH.privacySave, CH.privacyRemove, CH.privacyExport]).toEqual([
      PRIVACY_CH.snapshot,
      PRIVACY_CH.save,
      PRIVACY_CH.remove,
      PRIVACY_CH.export,
    ]);
  });

  it('accepts a frame answer from any app window, with nothing but its nonce', async () => {
    const api = fakeApi();
    const send = createIpcRouter(buildSendHandlers(api));
    expect(
      (await send.dispatch(CH.frameAck, sender('settings'), [{ nonce: 'abcdef123456' }])).ok,
    ).toBe(true);
    expect(spyOf(api, 'frameAck').mock.calls).toEqual([['settings', 'abcdef123456']]);
    for (const bad of [
      { nonce: 'x' },
      { nonce: 'abcdef123456', window: 'panel' },
      'abcdef123456',
    ]) {
      expect((await send.dispatch(CH.frameAck, sender('panel'), [bad])).ok).toBe(false);
    }
  });

  it('decides by the sending window, not by the message, how far a request may go', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    const link = 'https://docs.example.com/s/x#y';
    await router.dispatch(CH.connectionOpenShareLink, sender('panel'), [{ link }]);
    await router.dispatch(CH.connectionOpenShareLink, sender('settings'), [{ link }]);
    expect(spyOf(api, 'openShareLink').mock.calls).toEqual([
      [link, 'panel'],
      [link, 'settings'],
    ]);

    // Closing from the panel never removes what the account kept on this computer.
    await router.dispatch(CH.connectionDisconnect, sender('panel'), []);
    await router.dispatch(CH.connectionDisconnect, sender('settings'), []);
    expect(spyOf(api, 'disconnect').mock.calls).toEqual([[{ forget: false }], [{ forget: true }]]);
    expect(
      await router.dispatch(CH.connectionDisconnect, sender('panel'), [{ forget: true }]),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.disconnect).toHaveBeenCalledTimes(2);

    const url = 'https://example.com/';
    await router.dispatch(CH.externalOpen, sender('panel'), [{ url }]);
    await router.dispatch(CH.externalOpen, sender('settings'), [{ url }]);
    expect(spyOf(api, 'openExternal').mock.calls).toEqual([
      [url, 'panel'],
      [url, 'settings'],
    ]);
  });

  it('gives the panel a copy of the state without what it does not display', async () => {
    const api = fakeApi();
    const full = {
      revision: 7,
      connection: { session: { documentId: 'doc' } },
      capture: {
        requested: true,
        status: { label: 'OS protection accepted' },
        native: { present: true, sha256Prefix: 'private0hash', affinity: 'exclude_from_capture' },
      },
      displays: [{ id: 1, bounds: { x: 0, y: 0, width: 3840, height: 2160 } }],
      probe: { open: false, record: { result: 'works', notes: 'a note the user wrote' } },
      updates: initialUpdateSnapshot('1.0.0'),
    };
    spyOf(api, 'getState').mockReturnValue(full);
    const router = createIpcRouter(buildInvokeHandlers(api));

    const forSettings = await router.dispatch(CH.stateGet, sender('settings'), []);
    expect(forSettings).toEqual({ ok: true, data: full });

    const forPanel = await router.dispatch(CH.stateGet, sender('panel'), []);
    expect(forPanel).toEqual({
      ok: true,
      data: {
        revision: 7,
        connection: { session: { documentId: 'doc' } },
        capture: { requested: true, status: { label: 'OS protection accepted' }, native: null },
        displays: [],
        probe: { open: false, record: null },
        updates: initialUpdateSnapshot('1.0.0'),
      },
    });
    expect(JSON.stringify(forPanel)).not.toMatch(/private0hash|a note the user wrote|3840/);
  });

  it('lets only the settings window use the update actions, with validated input', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    for (const [channel, arg] of [
      [CH.updatesCheck, []],
      [CH.updatesDownload, []],
      [CH.updatesInstall, []],
      [CH.updatesDefer, []],
      [CH.updatesOpen, [{ action: 'open-installer' }]],
    ] as const) {
      expect(await router.dispatch(channel, sender('panel'), arg)).toMatchObject({
        ok: false,
        error: { code: 'forbidden_window' },
      });
      expect(await router.dispatch(channel, sender('probe'), arg)).toMatchObject({
        ok: false,
        error: { code: 'forbidden_window' },
      });
      expect((await router.dispatch(channel, sender('settings'), arg)).ok).toBe(true);
    }
    // No path, URL or other free-form input reaches the handler.
    for (const bad of [{ action: 'run' }, { action: 'open-installer', path: '/etc/passwd' }, {}]) {
      expect(await router.dispatch(CH.updatesOpen, sender('settings'), [bad])).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
    expect(spyOf(api, 'openUpdate').mock.calls).toEqual([['open-installer']]);
  });

  it('lets only the panel drive the resize drag and report its session', async () => {
    const api = fakeApi();
    const invoke = createIpcRouter(buildInvokeHandlers(api));
    const send = createIpcRouter(buildSendHandlers(api));
    expect(
      (await invoke.dispatch(CH.windowResizeStart, sender('settings'), [{ edge: 'se' }])).ok,
    ).toBe(false);
    expect(
      (await invoke.dispatch(CH.windowResizeStart, sender('panel'), [{ edge: 'se' }])).ok,
    ).toBe(true);
    expect(
      (await send.dispatch(CH.windowResizeMove, sender('settings'), [{ dx: 1, dy: 1 }])).ok,
    ).toBe(false);
    expect(
      (await send.dispatch(CH.windowResizeMove, sender('panel'), [{ dx: 12, dy: -3 }])).ok,
    ).toBe(true);
    expect(api.resizeMove).toHaveBeenCalledWith(12, -3);
    const report = {
      sequence: 3,
      connection: 'live',
      save: 'saved',
      role: 'viewer',
      title: 'Notes',
    };
    expect((await invoke.dispatch(CH.sessionReport, sender('settings'), [report])).ok).toBe(false);
    expect((await invoke.dispatch(CH.sessionReport, sender('panel'), [report])).ok).toBe(true);
    // The report says which credential it is about; one without that is refused.
    for (const bad of [
      { connection: 'live', save: 'saved', role: 'viewer', title: 'Notes' },
      { ...report, sequence: -1 },
      { ...report, sequence: 1.5 },
      { ...report, sequence: '3' },
      { ...report, token: 'anything' },
    ]) {
      expect((await invoke.dispatch(CH.sessionReport, sender('panel'), [bad])).ok).toBe(false);
    }
  });

  it('accepts a policy-violation summary from any app window and nothing more than a summary', async () => {
    const api = fakeApi();
    const send = createIpcRouter(buildSendHandlers(api));
    const report = { directive: 'script-src', blocked: 'eval', source: 'panel-abc.js', line: 12 };
    for (const kind of ['panel', 'settings', 'probe'] as const) {
      expect((await send.dispatch(CH.policyViolation, sender(kind), [report])).ok).toBe(true);
    }
    expect(api.reportPolicyViolation).toHaveBeenCalledTimes(3);
    expect(api.reportPolicyViolation).toHaveBeenCalledWith('settings', report);

    for (const bad of [
      { ...report, directive: 'script-src; evil' },
      { ...report, directive: 'SCRIPT-SRC' },
      { ...report, blocked: 'x'.repeat(300) },
      { ...report, line: -1 },
      { ...report, line: 1.5 },
      { ...report, sample: 'document text that must never be accepted' },
      { directive: 'script-src' },
      'script-src',
    ]) {
      expect(await send.dispatch(CH.policyViolation, sender('panel'), [bad])).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
    expect(api.reportPolicyViolation).toHaveBeenCalledTimes(3);
    // Not from a foreign page.
    expect(
      (
        await send.dispatch(
          CH.policyViolation,
          sender('panel', 'https://evil.example/panel.html'),
          [report],
        )
      ).ok,
    ).toBe(false);
  });

  it('gives the probe window nothing but its own state, close and record', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    const probe = sender('probe');
    expect((await router.dispatch(CH.stateGet, probe, [])).ok).toBe(true);
    expect((await router.dispatch(CH.probeClose, probe, [])).ok).toBe(true);
    expect(
      (await router.dispatch(CH.probeRecord, probe, [{ result: 'works', notes: '' }])).ok,
    ).toBe(true);
    for (const [channel, input] of [
      [CH.connectionOpenShareLink, { link: 'https://docs.example.com/s/x#y' }],
      [CH.windowAction, { action: 'hide' }],
      [CH.externalOpen, { url: 'https://example.com' }],
      [CH.prefsUpdate, { appearance: { fontScale: 1 } }],
    ] as const) {
      expect(await router.dispatch(channel, probe, [input])).toMatchObject({
        ok: false,
        error: { code: 'forbidden_window' },
      });
    }
  });

  const malformed: [string, string, unknown][] = [
    ['unknown window action', CH.windowAction, { action: 'exec' }],
    ['window action with extra key', CH.windowAction, { action: 'hide', command: 'calc.exe' }],
    [
      'settings tab outside the list',
      CH.windowAction,
      { action: 'open-settings', tab: '../../etc' },
    ],
    ['non-numeric bounds', CH.windowSetBounds, { x: '10' }],
    ['infinite bounds', CH.windowSetBounds, { width: Number.POSITIVE_INFINITY }],
    ['NaN bounds', CH.windowSetBounds, { y: Number.NaN }],
    ['absurd bounds', CH.windowSetBounds, { width: 1e9 }],
    ['negative size', CH.windowSetBounds, { height: -5 }],
    ['empty bounds', CH.windowSetBounds, {}],
    ['unknown preset', CH.windowPreset, { preset: 'fullscreen' }],
    ['unknown edge', CH.windowResizeStart, { edge: 'center' }],
    ['click-through as string', CH.windowClickThrough, { enabled: 'true' }],
    ['alpha above 1', CH.prefsUpdate, { appearance: { backgroundAlpha: 2 } }],
    ['unknown appearance key', CH.prefsUpdate, { appearance: { css: 'body{}' } }],
    [
      'prefs touching connection',
      CH.prefsUpdate,
      { connection: { serverOrigin: 'https://evil.example' } },
    ],
    ['empty prefs patch', CH.prefsUpdate, {}],
    ['share link too long', CH.connectionOpenShareLink, { link: 'x'.repeat(3000) }],
    ['share link not a string', CH.connectionOpenShareLink, { link: ['https://a'] }],
    [
      'a share link that names the window it claims to come from',
      CH.connectionOpenShareLink,
      { link: 'https://docs.example.com/s/x#y', source: 'settings' },
    ],
    [
      'unknown connection state',
      CH.sessionReport,
      { connection: 'hacked', save: 'saved', role: null, title: null },
    ],
    [
      'role escalation value',
      CH.sessionReport,
      { connection: 'live', save: 'saved', role: 'root', title: null },
    ],
    ['external open with object', CH.externalOpen, { url: { href: 'https://a' } }],
    ['external open too long', CH.externalOpen, { url: `https://a/${'x'.repeat(3000)}` }],
    ['nudge with string', CH.windowNudge, { deltaWidth: '24' }],
    ['argument where none is expected', CH.stateGet, { anything: true }],
  ];
  it.each(malformed)('rejects %s', async (_name, channel, input) => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    const result = await router.dispatch(channel, sender('panel'), [input]);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    // Only the proxy's own bookkeeping may have been touched: no API method ran.
    expect(Object.values(api).every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('rejects malformed settings-only input as well', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    const cases: [string, unknown][] = [
      [CH.connectionSetServer, { origin: 5 }],
      [CH.connectionSetServer, { origin: 'x'.repeat(400) }],
      [CH.connectionSetOptions, {}],
      [CH.connectionSetOptions, { acceptedLinkOrigin: 'https://evil.example' }],
      [CH.shortcutsSet, { action: 'quit', accelerator: 'Control+Q' }],
      [CH.shortcutsSet, { action: 'returnToInteractive', accelerator: '' }],
      // A Privacy Test Center record must be a complete, valid record; nothing else.
      [CH.privacySave, { record: { id: 'not-a-uuid' } }],
      [CH.privacySave, { record: { remote: { outcome: 'omitted' } } }],
      [CH.privacySave, { record: null }],
      [CH.privacyRemove, { id: '../../etc/passwd' }],
      [CH.privacyExport, { format: 'html' }],
      [CH.privacyExport, { format: 'json', path: '/tmp/x' }],
      [CH.windowWorkspace, { showInTaskbar: 'yes' }],
      [CH.probeRecord, { result: 'perfect', notes: '' }],
      [CH.windowWorkspace, { pinLevel: 'kernel' }],
    ];
    for (const [channel, input] of cases) {
      expect(await router.dispatch(channel, sender('settings'), [input])).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
    expect(Object.values(api).every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('passes validated, defaulted input to the API', async () => {
    const api = fakeApi();
    const router = createIpcRouter(buildInvokeHandlers(api));
    await router.dispatch(CH.windowNudge, sender('panel'), [{ deltaWidth: 24 }]);
    expect(api.nudgePanel).toHaveBeenCalledWith({
      deltaWidth: 24,
      deltaHeight: 0,
      deltaX: 0,
      deltaY: 0,
    });
    await router.dispatch(CH.prefsUpdate, sender('panel'), [
      { appearance: { backgroundAlpha: 0.4 } },
    ]);
    expect(api.updatePreferences).toHaveBeenCalledWith({ appearance: { backgroundAlpha: 0.4 } });
    await router.dispatch(CH.windowAction, sender('panel'), [
      { action: 'open-settings', tab: 'privacy' },
    ]);
    // Where a request came from is the router's knowledge, never the message's.
    expect(api.windowAction).toHaveBeenCalledWith('open-settings', {
      tab: 'privacy',
      source: 'panel',
    });
    await router.dispatch(CH.windowSetBounds, sender('settings'), [{ x: 10 }]);
    await router.dispatch(CH.windowSetBounds, sender('panel'), [{ x: 20 }]);
    expect(spyOf(api, 'setPanelBounds').mock.calls).toEqual([
      [{ x: 10 }, 'settings'],
      [{ x: 20 }, 'panel'],
    ]);
    const state = await router.dispatch(CH.stateGet, sender('probe'), []);
    expect(state).toEqual({ ok: true, data: { revision: 1 } });
  });
});
