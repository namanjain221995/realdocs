// Runs before the application bundle on every desktop page (panel, settings,
// resize probe). It is an external classic script because the
// Content-Security-Policy allows no inline scripts, and it has to run before
// any module is evaluated, so it cannot be part of the bundle.
//
// It tells zod not to compile validators with `new Function`. Under a policy
// without 'unsafe-eval' zod would fall back by itself, but only after probing,
// and Chromium reports that probe as a policy violation. The probe happens
// when the first object schema is built, which is at import time of the API
// contracts. zod reads its configuration from this global.
(function boot() {
  globalThis.__zod_globalConfig = Object.assign(globalThis.__zod_globalConfig || {}, {
    jitless: true,
  });
})();
