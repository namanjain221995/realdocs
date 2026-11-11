import { clearLocalDataForAccount } from '@realtimedocs/editor';
import { Banner, Button, EmptyState, Spinner, cx, useToast } from '@realtimedocs/ui';
import { useCallback, useEffect, type CSSProperties } from 'react';
import { panelWindowTitle } from '../../shared/surfaces';
import { matchWindowCommand } from '../../shared/window-commands';
import { attempt, desktop, onAppEvent, useAppState } from '../shared/desktop';
import { ShareGuideView } from '../shared/ShareGuideView';
import { ClickThroughBadge } from './ClickThroughBadge';
import { DocumentHost } from './DocumentHost';
import { PanelHeader } from './PanelHeader';
import { ResizeGrips } from './ResizeGrips';
import { useDocumentSession, useSessionReporting } from './useDocumentSession';

/** Runs a bridge action and shows its error, if any, as a toast. */
export function useAction(): (action: Promise<unknown> | undefined) => void {
  const toast = useToast();
  return useCallback(
    (action) => {
      void attempt(action as Parameters<typeof attempt>[0]).then((error) => {
        if (error) toast.show({ title: error, tone: 'danger', durationMs: 6000 });
      });
    },
    [toast],
  );
}

export function PanelApp() {
  const state = useAppState();
  const run = useAction();

  // The editor session lives here, above the collapsible document area, so a
  // collapsed (or hidden, or click-through) panel stays connected.
  const live = useDocumentSession(state);
  useSessionReporting(live);

  // "Reconnect" from the tray / menu-bar menu.
  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.type === 'panel-command' && event.command === 'reconnect') {
          live?.session.retryNow();
        }
      }),
    [live],
  );

  // "Close document and forget session" in Settings is the desktop app's
  // sign-out: unsent changes and recovery drafts of that account are removed
  // from this computer. (Closing from the panel's own menu keeps them.)
  const toast = useToast();
  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.type === 'session-forgotten' && event.accountId) {
          void clearLocalDataForAccount(event.accountId).catch(() => undefined);
        }
        if (event.type === 'message') {
          toast.show({
            title: event.title,
            ...(event.description ? { description: event.description } : {}),
            tone: event.tone,
            durationMs: event.tone === 'danger' ? 9000 : 5000,
          });
        }
      }),
    [toast],
  );

  const theme = state?.appearance.foreground === 'dark' ? 'light' : 'dark';
  useEffect(() => {
    // `foreground: light` means light text, i.e. the dark theme of the UI kit.
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The page title never names the document while private mode is on (the
  // main process decides the native window title the same way).
  const title = state?.connection.report?.title ?? state?.connection.session?.title;
  const privateMode = state?.capture.requested ?? true;
  useEffect(() => {
    document.title = panelWindowTitle({ documentTitle: title, privateMode });
  }, [title, privateMode]);

  // Panel keyboard commands (resize, presets, collapse). Capture phase, so they
  // work wherever the focus is inside the panel, including the document.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = matchWindowCommand({
        type: 'keyDown',
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
        composing: event.isComposing,
      });
      if (!command || !desktop) return;
      event.preventDefault();
      event.stopPropagation();
      if (command.kind === 'nudge-size') {
        void desktop.window.nudge({
          deltaWidth: command.deltaWidth,
          deltaHeight: command.deltaHeight,
        });
      } else if (command.kind === 'preset') {
        void desktop.window.preset(command.preset);
      } else if (command.kind === 'reset-position') {
        void desktop.window.action('reset-position');
      } else {
        void desktop.window.action('toggle-collapse');
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  if (!desktop) {
    return (
      <div className="rdp-root rdp-root--standalone" data-testid="rd-panel">
        <EmptyState
          title="Desktop app required"
          description="This page is the RealtimeDocs desktop panel. Browser mode: capture exclusion unavailable, and window controls only work inside the desktop app."
        />
      </div>
    );
  }

  if (!state) {
    return (
      <div className="rdp-root rdp-root--loading" data-testid="rd-panel">
        <Spinner />
      </div>
    );
  }

  const { appearance, panel, connection } = state;
  const presenter = panel.mode === 'presenter';
  // The ordinary window is opaque; only the presenter panel is see-through.
  const alpha = presenter ? appearance.backgroundAlpha : 1;
  const style = { '--rdp-alpha': String(alpha) } as CSSProperties;

  return (
    <div
      className={cx('rdp-root', presenter && 'rd-translucent')}
      style={style}
      data-testid="rd-panel"
      data-mode={panel.mode}
      data-collapsed={panel.collapsed}
      data-click-through={panel.clickThrough}
      data-pinned={panel.pinned}
      data-parked={panel.parked ?? ''}
      data-readability={appearance.readability}
      data-density={appearance.density}
      data-low-alpha={alpha < 0.45}
    >
      <PanelHeader state={state} live={live} />

      {!panel.collapsed && state.guide.open && (
        <div className="rdp-guide-card" data-testid="rd-share-guide-card">
          <ShareGuideView state={state} headingLevel={2} />
          <div className="rdp-guide-actions">
            <Button
              size="sm"
              variant="primary"
              data-testid="rd-share-guide-dismiss"
              onClick={() => run(desktop?.window.action('dismiss-share-guide'))}
            >
              Got it
            </Button>
          </div>
        </div>
      )}

      {!panel.collapsed && (
        <div className="rdp-notices">
          {connection.notice && (
            <Banner
              tone={connection.notice.tone}
              data-testid="rd-notice"
              data-code={connection.notice.code}
              onDismiss={() => {
                const id = connection.notice?.id;
                if (id) run(desktop?.connection.dismissNotice(id));
              }}
            >
              {connection.notice.message}
            </Banner>
          )}
        </div>
      )}

      {/* Hidden, not unmounted, while collapsed: the document keeps receiving changes. */}
      <main className="rdp-main" data-testid="rd-panel-main" hidden={panel.collapsed}>
        <DocumentHost state={state} live={live} />
      </main>

      {panel.clickThrough && <ClickThroughBadge state={state} />}
      {presenter && !panel.clickThrough && <ResizeGrips collapsed={panel.collapsed} />}
    </div>
  );
}
