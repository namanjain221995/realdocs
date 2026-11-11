/** Entry point of the delay proxies (separate process so Playwright's event loop cannot disturb them). */
import { CONDITIONS, PORTS } from './common';
import { startDelayProxy } from './proxy';

for (const condition of [CONDITIONS.rtt10, CONDITIONS.rtt50]) {
  startDelayProxy({
    listenPort: condition.port,
    targetPort: PORTS.server,
    oneWayMs: condition.addedOneWayMs,
  });
}
process.stdout.write('delay proxies up\n');
