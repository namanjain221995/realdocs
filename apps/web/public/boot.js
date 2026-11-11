/* global document, matchMedia */
// Runs before the application bundle. It is an external classic script because
// the Content-Security-Policy allows no inline scripts, and it must stay tiny:
// the page does not paint until it has run.
(function boot() {
  // Apply the saved theme before first paint, so a light-theme reader never
  // sees a dark flash. Mirrors ThemeProvider in @realtimedocs/ui: the choice is
  // stored under "rd.theme" as "dark", "light" or "system"; dark is the default.
  try {
    const stored = localStorage.getItem('rd.theme');
    let theme = 'dark';
    if (stored === 'light') {
      theme = 'light';
    } else if (stored === 'system') {
      theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // Storage is unavailable: the default theme from the markup stays.
  }
})();
