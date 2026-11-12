/**
 * A second collaborator for the real-stack tests: a plain Node.js client on
 * `@hocuspocus/provider` and Yjs, speaking the server's protocol the way the
 * editor does (a ticket per connection, `mark` answered by `saved` once the
 * change is durable). It edits the shared Yjs document directly, so a test
 * can say exactly where a remote change lands.
 *
 * The three libraries are dependencies of the server package, which uses the
 * same kind of client in its own integration tests; they are not dependencies
 * of the desktop app. They are resolved from there, so this helper adds
 * nothing to the desktop's dependency list and nothing is installed for it.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  COLLAB_PROTOCOL_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  Y_FRAGMENT_FIELD,
  type ApiClient,
  type CollabTicketResponse,
} from '@realtimedocs/contracts';

// ── The few parts of Yjs and the provider this client uses ─────────────────

interface YXmlText {
  insert(index: number, text: string): void;
}
interface YXmlElement {
  insert(index: number, content: unknown[]): void;
  getAttribute?(name: string): unknown;
  setAttribute?(name: string, value: unknown): void;
}
interface YXmlFragment {
  readonly length: number;
  get(index: number): YXmlElement | undefined;
  push(content: unknown[]): void;
  insert(index: number, content: unknown[]): void;
  delete(index: number, length: number): void;
  toString(): string;
}
interface YDoc {
  readonly clientID: number;
  getXmlFragment(name: string): YXmlFragment;
  getMap(name: string): { get(key: string): unknown; set(key: string, value: unknown): void };
  transact(change: () => void): void;
  destroy(): void;
}
interface YModule {
  Doc: new () => YDoc;
  XmlElement: new (name: string) => YXmlElement;
  XmlText: new () => YXmlText;
}
interface Provider {
  on(event: string, listener: (payload: never) => void): void;
  attach(): void;
  sendStateless(payload: string): void;
  destroy(): void;
}
interface ProviderSocket {
  destroy(): void;
}
interface ProviderModule {
  HocuspocusProvider: new (options: Record<string, unknown>) => Provider;
  HocuspocusProviderWebsocket: new (options: Record<string, unknown>) => ProviderSocket;
}
type WebSocketClass = new (
  url: string | URL,
  protocols?: string | string[],
  options?: Record<string, unknown>,
) => { on(event: 'close', listener: (code: number, reason: Buffer) => void): void };

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const requireFromServer = createRequire(path.join(repoRoot, 'apps', 'server', 'package.json'));
const Y = requireFromServer('yjs') as YModule;
const { HocuspocusProvider, HocuspocusProviderWebsocket } = requireFromServer(
  '@hocuspocus/provider',
) as ProviderModule;
const WebSocket = requireFromServer('ws') as WebSocketClass;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(
  read: () => T | null | undefined | false,
  what: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

interface ServerMessage {
  t: string;
  n?: number;
  [key: string]: unknown;
}

export class RemoteClient {
  /** Local transactions so far (the `n` of the acknowledgement protocol). */
  private n = 0;
  private synced = false;
  readonly messages: ServerMessage[] = [];

  private constructor(
    private readonly doc: YDoc,
    private readonly provider: Provider,
    private readonly socket: ProviderSocket,
    readonly ticket: CollabTicketResponse,
    /** Close events of the WebSocket, as the server sent them. */
    readonly closes: { code: number; reason: string }[],
  ) {}

  /** Connects as whoever `api` is signed in as and waits for the first sync. */
  static async connect(api: ApiClient, documentId: string, origin: string): Promise<RemoteClient> {
    const doc = new Y.Doc();
    const ticket = await api.collab.ticket(documentId, {
      clientId: doc.clientID,
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
    });
    const closes: { code: number; reason: string }[] = [];
    // The server checks the Origin of the WebSocket handshake, like a browser sends it.
    class OriginSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { origin });
        this.on('close', (code, reason) => closes.push({ code, reason: reason.toString('utf8') }));
      }
    }
    const socket = new HocuspocusProviderWebsocket({
      url: api.collabUrl(),
      WebSocketPolyfill: OriginSocket,
      // The tests decide when to reconnect.
      maxAttempts: 1,
      delay: 3_600_000,
      messageReconnectTimeout: 30_000,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: ticket.documentName,
      document: doc,
      awareness: null,
      token: ticket.ticket,
    });
    const client = new RemoteClient(doc, provider, socket, ticket, closes);
    provider.on('synced', () => {
      client.synced = true;
    });
    provider.on('stateless', ({ payload }: { payload: string }) => {
      client.messages.push(JSON.parse(payload) as ServerMessage);
    });
    provider.attach();
    await until(() => client.synced, 'the remote client to sync');
    return client;
  }

  private get fragment(): YXmlFragment {
    return this.doc.getXmlFragment(Y_FRAGMENT_FIELD);
  }

  /** One value of the shared page settings (Y.Map `page`), as stored. */
  pageSetting(key: string): unknown {
    return this.doc.getMap('page').get(key);
  }

  /** Writes one shared page setting, as another editor would. */
  setPageSetting(key: string, value: number): void {
    this.doc.getMap('page').set(key, value);
  }

  /** One attribute of the top-level block at `index`, as stored (undefined when absent). */
  blockAttribute(index: number, name: string): unknown {
    return this.fragment.get(index)?.getAttribute?.(name);
  }

  /** Writes one attribute of the top-level block at `index`, as another editor would. */
  setBlockAttribute(index: number, name: string, value: number): void {
    this.edit(() => this.fragment.get(index)?.setAttribute?.(name, value));
  }

  /** Number of top-level blocks. */
  get blockCount(): number {
    return this.fragment.length;
  }

  /** Node names used anywhere in the document (`paragraph`, `image`, `attachment`, …). */
  blockNames(): string[] {
    const names = new Set<string>();
    for (const match of this.fragment.toString().matchAll(/<([a-zA-Z][a-zA-Z0-9]*)[\s>/]/g)) {
      if (match[1]) names.add(match[1]);
    }
    return [...names];
  }

  /** The `assetId` of every node called `node` (`image`, `attachment`) in the shared document. */
  assetIds(node: 'image' | 'attachment'): string[] {
    const ids: string[] = [];
    for (const match of this.fragment.toString().matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\s([^>]*)>/g)) {
      if (match[1] !== node) continue;
      const id = /\bassetId="([0-9a-f-]{36})"/.exec(match[2] ?? '')?.[1];
      if (id) ids.push(id);
    }
    return ids;
  }

  /** The document's text, block after block, without markup. */
  text(): string {
    return this.fragment
      .toString()
      .replace(/<\/(paragraph|heading|listItem|tableCell|tableHeader|codeBlock)>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  private edit(change: () => void): void {
    this.doc.transact(change);
    this.n += 1;
  }

  private paragraph(text: string): YXmlElement {
    const paragraph = new Y.XmlElement('paragraph');
    const content = new Y.XmlText();
    content.insert(0, text);
    paragraph.insert(0, [content]);
    return paragraph;
  }

  /** One paragraph at the end of the document (one transaction, like one edit in an editor). */
  appendParagraph(text: string): void {
    this.edit(() => this.fragment.push([this.paragraph(text)]));
  }

  /** One paragraph before the block at `index` (0 = the very top). */
  insertParagraph(index: number, text: string): void {
    this.edit(() => this.fragment.insert(index, [this.paragraph(text)]));
  }

  /** Many paragraphs at the end, in one transaction. */
  appendParagraphs(texts: string[]): void {
    this.edit(() => this.fragment.push(texts.map((text) => this.paragraph(text))));
  }

  /** Resolves once the server has stored every change made so far. */
  async saved(timeoutMs = 15_000): Promise<void> {
    const n = this.n;
    const from = this.messages.length;
    this.provider.sendStateless(JSON.stringify({ t: 'mark', n }));
    await until(
      () =>
        this.messages
          .slice(from)
          .some((message) => message.t === 'saved' && (message.n ?? -1) >= n),
      `the server to confirm change ${n}`,
      timeoutMs,
    );
  }

  /** Resolves when the shared document contains `needle`. */
  async waitForText(needle: string, timeoutMs = 15_000): Promise<void> {
    await until(
      () => this.text().includes(needle),
      `"${needle}" in the shared document`,
      timeoutMs,
    );
  }

  /** Resolves with the close code and reason once the server ended the connection. */
  closed(timeoutMs = 15_000): Promise<{ code: number; reason: string }> {
    return until(() => this.closes[0], 'the connection to close', timeoutMs);
  }

  destroy(): void {
    this.provider.destroy();
    this.socket.destroy();
    this.doc.destroy();
  }
}
