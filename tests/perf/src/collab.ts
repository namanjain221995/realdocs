/** Node collaboration client on @hocuspocus/provider + yjs + ws, authenticated with a ticket. */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  COLLAB_PROTOCOL_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  Y_FRAGMENT_FIELD,
  type CollabTicketResponse,
  type ServerStateless,
} from '@realtimedocs/contracts';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HOST } from './common';
import type { Api } from './http';

export class PerfClient {
  n = 0;
  synced = false;
  role = '';
  private readonly socket: HocuspocusProviderWebsocket;
  readonly provider: HocuspocusProvider;
  private readonly listeners = new Set<(m: ServerStateless) => void>();

  private constructor(
    readonly doc: Y.Doc,
    readonly ticket: CollabTicketResponse,
    port: number,
    origin: string,
  ) {
    class OriginSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { origin });
      }
    }
    this.socket = new HocuspocusProviderWebsocket({
      url: `ws://${HOST}:${port}/collab`,
      WebSocketPolyfill: OriginSocket,
      maxAttempts: 1,
      delay: 3_600_000,
    });
    this.provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: ticket.documentName,
      document: this.doc,
      awareness: null,
      token: ticket.ticket,
    });
    this.role = ticket.role;
    this.provider.on('synced', () => {
      this.synced = true;
    });
    this.provider.on('stateless', ({ payload }: { payload: string }) => {
      const message = JSON.parse(payload) as ServerStateless;
      for (const listener of this.listeners) listener(message);
    });
    this.provider.attach();
  }

  static async connect(api: Api, documentId: string): Promise<PerfClient> {
    const doc = new Y.Doc();
    const ticket = await api.ok<CollabTicketResponse>(
      'POST',
      `/api/documents/${documentId}/collab-ticket`,
      {
        clientId: doc.clientID,
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        protocolVersion: COLLAB_PROTOCOL_VERSION,
      },
    );
    // The ticket is bound to the client id of the Y.Doc that uses it: reuse the id we asked for.
    const client = new PerfClient(doc, ticket, api.port, api.origin);
    await client.waitSynced();
    // What the editor does after every (re)connect: prove the local state with `hello`.
    await client.hello();
    return client;
  }

  get fragment(): Y.XmlFragment {
    return this.doc.getXmlFragment(Y_FRAGMENT_FIELD);
  }

  onStateless(listener: (m: ServerStateless) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitSynced(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.synced) {
      if (Date.now() > deadline) throw new Error('sync timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  hello(timeoutMs = 20_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('hello was not acknowledged'));
      }, timeoutMs);
      const off = this.onStateless((m) => {
        if (m.t === 'saved') {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
      this.provider.sendStateless(
        JSON.stringify({
          t: 'hello',
          n: this.n,
          snapshot: Buffer.from(Y.encodeSnapshot(Y.snapshot(this.doc))).toString('base64'),
        }),
      );
    });
  }

  /** Sends `mark` for the current change count and resolves at the matching `saved`. */
  save(timeoutMs = 20_000): Promise<void> {
    const n = this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`saved ${n} timed out`));
      }, timeoutMs);
      const off = this.onStateless((m) => {
        if (m.t === 'saved' && m.n >= n) {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
      this.provider.sendStateless(JSON.stringify({ t: 'mark', n }));
    });
  }

  edit(change: () => void): void {
    this.doc.transact(change);
    this.n += 1;
  }

  destroy(): void {
    this.provider.destroy();
    this.socket.destroy();
  }
}
