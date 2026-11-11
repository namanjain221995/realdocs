/**
 * The privileged `app://realtimedocs` scheme the packaged renderer is served
 * from (Electron security checklist: prefer a custom protocol over `file://`).
 *
 * `registerAppScheme` must run before `app` is ready. `installAppProtocol`
 * attaches the handler to the app's session; path checks are in
 * `protocol-resolve.ts` and the CSP is generated per response in `csp.ts`.
 */
import fs from 'node:fs/promises';
import { protocol, type Session } from 'electron';
import { DESKTOP_APP_ORIGIN } from '@realtimedocs/contracts';
import { buildContentSecurityPolicy } from '../shared/csp';
import type { Logger } from './logger';
import { APP_SCHEME, appResponseHeaders, resolveAppRequest } from './protocol-resolve';

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        // Standard + secure: a real origin (app://realtimedocs), relative URLs,
        // storage APIs and a secure context. Deliberately NOT bypassCSP,
        // corsEnabled, allowServiceWorkers or allowExtensions.
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
      },
    },
  ]);
}

export interface AppProtocolOptions {
  rendererRoot: string;
  getServerOrigin: () => string | null;
  logger: Logger;
}

function refusal(status: number): Response {
  return new Response(status === 405 ? 'Method not allowed' : 'Not found', {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

export function installAppProtocol(session: Session, options: AppProtocolOptions): void {
  session.protocol.handle(APP_SCHEME, async (request) => {
    // Set by Electron (not by the page) when web content issued the request.
    const initiator = (request as Request & { initiatorOrigin?: string | null }).initiatorOrigin;
    if (initiator !== undefined && initiator !== DESKTOP_APP_ORIGIN) {
      options.logger.warn('app_protocol.foreign_initiator', {});
      return refusal(403);
    }

    const resolution = resolveAppRequest(request.url, request.method, options.rendererRoot);
    if (!resolution.ok) {
      options.logger.warn('app_protocol.refused', { reason: resolution.reason });
      return refusal(resolution.status);
    }

    // Documents get the policy for their window kind. Sub-resources are not
    // documents; they carry the strictest policy (no network) for good measure.
    const policy = buildContentSecurityPolicy({
      windowKind: resolution.windowKind ?? 'settings',
      serverOrigin: options.getServerOrigin(),
    });

    try {
      const body = await fs.readFile(resolution.filePath);
      return new Response(request.method.toUpperCase() === 'HEAD' ? null : body, {
        status: 200,
        headers: appResponseHeaders(resolution, policy),
      });
    } catch {
      return refusal(404);
    }
  });
}
