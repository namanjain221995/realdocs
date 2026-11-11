/**
 * The panel's editor session: one `CollabSession` per credential the main
 * process is using, created here so it outlives the collapsed state of the
 * panel and is shared by the header and the document area.
 *
 * What this page holds is a typed API client for the configured server and
 * the session built on it. Neither contains a credential: requests are sent
 * without cookies, the main process adds the document-scoped bearer token to
 * API requests on their way out, and the WebSocket is authorised by a
 * single-use collaboration ticket that lives for 60 seconds.
 */
import {
  createApiClient,
  type ApiClient,
  type ConnectionState,
  type SaveState,
} from '@realtimedocs/contracts';
import { createCollabSession, type CollabSession } from '@realtimedocs/editor';
import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../shared/state';
import { desktop, onAppEvent } from '../shared/desktop';

export interface LiveDocument {
  /** Changes with the server, the document or the credential (`session.sequence`). */
  key: string;
  api: ApiClient;
  session: CollabSession;
  documentId: string;
  accountId: string | null;
  sequence: number;
}

/**
 * "Saved" is passed on once it has held this long. While someone types, the
 * true state alternates between saving and saved several times a second; the
 * delay only ever shows "Saving…" a little longer, never "Saved" early.
 * Same value as the editor's own indicator.
 */
const SAVED_SETTLE_MS = 400;

function sessionKey(origin: string, documentId: string, sequence: number): string {
  return `${origin}|${documentId}|${sequence}`;
}

/** Creates, replaces and destroys the editor session as the main-process state changes. */
export function useDocumentSession(state: AppState | null): LiveDocument | null {
  const origin = state?.connection.server.origin ?? null;
  const info = state?.connection.session ?? null;
  const documentId = info?.documentId ?? null;
  const accountId = info?.accountId ?? null;
  const sequence = info?.sequence ?? null;
  const title = info?.title;
  const titleRef = useRef(title);
  titleRef.current = title;

  const [live, setLive] = useState<LiveDocument | null>(null);

  useEffect(() => {
    if (!origin || !documentId || sequence === null) return undefined;
    const api = createApiClient({ baseUrl: origin, credentials: 'omit' });
    const session = createCollabSession({
      api,
      documentId,
      // Signed-in editors keep unsent changes on this device; share-link guests keep nothing.
      accountId,
      ...(titleRef.current ? { documentTitle: titleRef.current } : {}),
    });
    setLive({
      key: sessionKey(origin, documentId, sequence),
      api,
      session,
      documentId,
      accountId,
      sequence,
    });
    return () => session.destroy();
  }, [origin, documentId, accountId, sequence]);

  // Never hand out a session that belongs to an earlier credential or was destroyed.
  if (!live || !origin || !documentId || sequence === null) return null;
  return live.key === sessionKey(origin, documentId, sequence) ? live : null;
}

/**
 * Feeds the header: connection, save state, role and title go to the main
 * process, which publishes them to every window, the tray and the menus.
 * Also reconnects at once when the computer wakes up.
 */
export function useSessionReporting(live: LiveDocument | null): void {
  useEffect(() => {
    if (!live || !desktop) return undefined;
    const bridge = desktop;
    const { session, api, sequence } = live;
    let disposed = false;
    let title: string | null = null;
    let sent = '';
    let sentSave: SaveState | null = null;
    let sentConnection: ConnectionState | null = null;
    let seenConnection: ConnectionState | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const send = (): void => {
      if (disposed) return;
      const status = session.getStatus();
      const report = {
        sequence,
        connection: status.connection,
        save: status.save,
        role: status.role,
        title,
      };
      const signature = JSON.stringify(report);
      if (signature === sent) return;
      sent = signature;
      sentSave = status.save;
      sentConnection = status.connection;
      void bridge.connection.reportSession(report);
    };

    const refreshTitle = (): void => {
      // The title can change while the app is away; ask again on every (re)connect.
      api.desktop.session().then(
        (current) => {
          if (disposed || current.title === title) return;
          title = current.title;
          send();
        },
        () => undefined,
      );
    };

    const onChange = (): void => {
      const status = session.getStatus();
      if (status.connection === 'live' && seenConnection !== 'live') refreshTitle();
      seenConnection = status.connection;
      const settling =
        sentSave === 'saving' && status.save === 'saved' && status.connection === sentConnection;
      if (settling) {
        settle ??= setTimeout(() => {
          settle = null;
          send();
        }, SAVED_SETTLE_MS);
        return;
      }
      if (settle !== null) {
        clearTimeout(settle);
        settle = null;
      }
      send();
    };

    onChange();
    const stop = session.subscribe(onChange);
    const stopEvents = onAppEvent((event) => {
      if (event.type === 'system-resume') session.retryNow();
    });
    return () => {
      disposed = true;
      if (settle !== null) clearTimeout(settle);
      stop();
      stopEvents();
    };
  }, [live]);
}
