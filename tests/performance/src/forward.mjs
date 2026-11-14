// TCP forwarder for the two-machine topology: listens on ONE given address (the direct link to the
// other machine, never 0.0.0.0) and forwards to the test stack's proxy on loopback.
//   node forward.mjs <listen address> <listen port> <target port>
import net from 'node:net';

const [address, port, target] = process.argv.slice(2);
if (!address || address === '0.0.0.0' || address === '::') {
  throw new Error('a specific listen address is required');
}
const server = net.createServer((client) => {
  const upstream = net.connect({ host: '127.0.0.1', port: Number(target) });
  client.setNoDelay(true);
  upstream.setNoDelay(true);
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
  client.on('close', close);
  upstream.on('close', close);
});
server.listen(Number(port), address, () => console.log(`forwarding ${address}:${port}`));
