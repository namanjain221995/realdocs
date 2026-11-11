/**
 * Content-Security-Policy for the packaged renderer.
 *
 * The policy is generated per response by the `app://` protocol handler. Only
 * the panel window is given network access, and only to the configured server
 * origin (HTTP(S) for the API and assets, WS(S) for collaboration). The
 * settings and probe windows cannot reach the network at all.
 */
import { isCanonicalHttpOrigin } from './server-origin';

export type RendererWindowKind = 'panel' | 'settings' | 'probe';

/** `https://host` → `wss://host`, `http://host` → `ws://host`. */
export function websocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http/, 'ws');
}

export interface CspInput {
  windowKind: RendererWindowKind;
  /** Configured server origin, or null when none is set. */
  serverOrigin: string | null;
}

export function buildContentSecurityPolicy(input: CspInput): string {
  // The origin is interpolated into a header, so it must be a canonical origin
  // (no spaces, semicolons, quotes or paths). Anything else is treated as "no server".
  const server =
    input.windowKind === 'panel' && isCanonicalHttpOrigin(input.serverOrigin)
      ? input.serverOrigin
      : null;

  const imgSrc = ["'self'", 'data:', 'blob:'];
  const connectSrc: string[] = [];
  if (server) {
    imgSrc.push(server);
    connectSrc.push(server, websocketOrigin(server));
  }

  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(' ')}`,
    "font-src 'self'",
    `connect-src ${connectSrc.length > 0 ? connectSrc.join(' ') : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
