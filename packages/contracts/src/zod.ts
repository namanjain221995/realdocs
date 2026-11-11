/**
 * The one place the contracts import zod from.
 *
 * zod 4 probes for `new Function` support when the first object schema is
 * constructed (not when it first parses). Under a Content-Security-Policy
 * without `unsafe-eval`, which is what the web app and the desktop renderer
 * run under, the probe is caught but the browser still reports a `script-src`
 * violation. zod's `jitless` switch skips the probe; the compiled fast path
 * could not be used there anyway.
 *
 * Every contract module takes `z` from this file, so the switch is evaluated
 * before any schema is built, whatever the import order of the application
 * and however a bundler prunes the package. Servers (no `document`) keep the
 * compiled validators.
 */
import { config, z } from 'zod';

if (typeof document !== 'undefined') config({ jitless: true });

export { z };
