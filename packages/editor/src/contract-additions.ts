/**
 * Pieces that belong in `@realtimedocs/contracts` (owned by the lead) but are
 * needed by the editor. Listed in docs/notes/editor.md for merging.
 *
 * 1. zod and a strict Content-Security-Policy
 *    zod 4 probes for `new Function` support when the first object schema is
 *    CONSTRUCTED (not when it first parses). Under a policy without
 *    `unsafe-eval` — the web app and the desktop renderer — the probe is
 *    caught, but the browser still reports a `script-src` violation. zod's
 *    `jitless` switch skips the probe; the JIT could not be used there anyway.
 *
 *    Because the probe runs at schema construction, this only helps if it is
 *    evaluated before `@realtimedocs/contracts`. Importing the editor first
 *    achieves that; the robust fix is the same call as the first statement of
 *    the contracts package itself (guarded to browsers, so the server keeps
 *    the JIT).
 */
import { config } from 'zod';

if (typeof document !== 'undefined') config({ jitless: true });
