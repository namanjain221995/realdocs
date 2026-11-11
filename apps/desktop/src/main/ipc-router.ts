/**
 * IPC dispatch without Electron: sender validation, input validation and the
 * per-window allow-list. `ipc.ts` adapts Electron's events to `SenderInfo`
 * and registers one `ipcMain.handle` per channel declared here.
 *
 * A message is acted on only if
 * 1. the channel has a declared handler (there is no generic channel),
 * 2. it came from the main frame of one of this app's own windows,
 * 3. that frame is showing the packaged page for its window kind
 *    (`app://realtimedocs/<kind>.html`),
 * 4. the window kind is allowed to use the channel, and
 * 5. the single argument matches the channel's schema.
 */
import type { z } from 'zod';
import type { RendererWindowKind } from '../shared/csp';
import type { IpcResult } from '../shared/ipc-schemas';
import { APP_HOST, APP_SCHEME, ENTRY_POINTS } from './protocol-resolve';

export type WindowKind = RendererWindowKind;

export interface SenderInfo {
  /** Null when `event.senderFrame` is null (frame navigated or destroyed). */
  frame: { url: string; isMainFrame: boolean } | null;
  /** Kind registered for the sending `webContents`; null for anything that is not our window. */
  windowKind: WindowKind | null;
}

export type SenderRejection =
  'no_frame' | 'not_main_frame' | 'foreign_origin' | 'unknown_window' | 'page_mismatch';

export type SenderCheck =
  { ok: true; windowKind: WindowKind } | { ok: false; reason: SenderRejection };

export function validateSender(sender: SenderInfo): SenderCheck {
  if (!sender.frame) return { ok: false, reason: 'no_frame' };
  if (!sender.frame.isMainFrame) return { ok: false, reason: 'not_main_frame' };
  let url: URL;
  try {
    url = new URL(sender.frame.url);
  } catch {
    return { ok: false, reason: 'foreign_origin' };
  }
  if (
    url.protocol !== `${APP_SCHEME}:` ||
    url.hostname !== APP_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return { ok: false, reason: 'foreign_origin' };
  }
  if (!sender.windowKind) return { ok: false, reason: 'unknown_window' };
  if (ENTRY_POINTS[url.pathname] !== sender.windowKind) {
    return { ok: false, reason: 'page_mismatch' };
  }
  return { ok: true, windowKind: sender.windowKind };
}

/** Thrown by handlers to return a specific, displayable error. */
export class IpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

export interface HandlerContext {
  windowKind: WindowKind;
}

export interface HandlerSpec<Schema extends z.ZodType = z.ZodType> {
  channel: string;
  schema: Schema;
  /** Window kinds that may call this channel. */
  allowed: readonly WindowKind[];
  handle: (input: z.output<Schema>, context: HandlerContext) => unknown;
}

/** Keeps the schema/handler types connected when declaring a spec. */
export function defineHandler<Schema extends z.ZodType>(spec: HandlerSpec<Schema>): HandlerSpec {
  return spec as unknown as HandlerSpec;
}

export interface IpcRouter {
  channels: readonly string[];
  dispatch(
    channel: string,
    sender: SenderInfo,
    args: readonly unknown[],
  ): Promise<IpcResult<unknown>>;
}

export interface RouterOptions {
  /** Called for rejected or failed messages. Receives no message payload. */
  onReject?: (info: { channel: string; code: string; detail: string }) => void;
}

function failure(code: string, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * IPC arguments are structured clones, so legitimate input is always plain
 * data: primitives, arrays and objects whose prototype is `Object.prototype`.
 * Schema validation reads inherited properties too, so anything else (class
 * instances, objects with a crafted prototype, functions) is refused first.
 */
function isPlainData(value: unknown, depth: number): boolean {
  if (value === null || value === undefined) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  if (type !== 'object' || depth > 6) return false;
  if (Array.isArray(value)) return value.every((entry) => isPlainData(entry, depth + 1));
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every((entry) =>
    isPlainData(entry, depth + 1),
  );
}

export function createIpcRouter(
  specs: readonly HandlerSpec[],
  options: RouterOptions = {},
): IpcRouter {
  const byChannel = new Map<string, HandlerSpec>();
  for (const spec of specs) {
    if (byChannel.has(spec.channel)) throw new Error(`Duplicate IPC channel: ${spec.channel}`);
    byChannel.set(spec.channel, spec);
  }
  const reject = (channel: string, code: string, detail: string) =>
    options.onReject?.({ channel, code, detail });

  return {
    channels: [...byChannel.keys()],
    async dispatch(channel, sender, args) {
      const spec = byChannel.get(channel);
      if (!spec) {
        reject(channel, 'unknown_channel', '');
        return failure('unknown_channel', 'This action is not available.');
      }
      const check = validateSender(sender);
      if (!check.ok) {
        reject(channel, 'forbidden_sender', check.reason);
        return failure('forbidden_sender', 'This action is not allowed from here.');
      }
      if (!spec.allowed.includes(check.windowKind)) {
        reject(channel, 'forbidden_window', check.windowKind);
        return failure('forbidden_window', 'This action is not allowed from this window.');
      }
      if (args.length > 1) {
        reject(channel, 'invalid_input', 'too many arguments');
        return failure('invalid_input', 'The request was not understood.');
      }
      if (!isPlainData(args[0], 0)) {
        reject(channel, 'invalid_input', 'not plain data');
        return failure('invalid_input', 'The request was not understood.');
      }
      const parsed = spec.schema.safeParse(args[0]);
      if (!parsed.success) {
        // Issue paths only: never echo the offending values.
        const detail = parsed.error.issues
          .slice(0, 3)
          .map((issue) => issue.path.join('.') || '(root)')
          .join(',');
        reject(channel, 'invalid_input', detail);
        return failure('invalid_input', 'The request was not understood.');
      }
      try {
        const data = await spec.handle(parsed.data, { windowKind: check.windowKind });
        return { ok: true, data: data === undefined ? null : data };
      } catch (error) {
        if (error instanceof IpcError) return failure(error.code, error.message);
        reject(channel, 'internal', error instanceof Error ? error.name : 'unknown');
        return failure('internal', 'Something went wrong. Please try again.');
      }
    },
  };
}
