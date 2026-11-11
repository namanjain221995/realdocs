/** Hardware, software and load facts for the report. Everything is read from this host, nothing assumed. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { HOST, PORTS, readState } from './common';

const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
};

export async function envInfo() {
  const lscpu = sh('lscpu', []);
  const pick = (key: string) =>
    lscpu
      .split('\n')
      .find((l) => l.startsWith(`${key}:`))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim() ?? 'unknown';
  const mem = readFileSync('/proc/meminfo', 'utf8');
  const memLine = (k: string) =>
    mem
      .split('\n')
      .find((l) => l.startsWith(k))
      ?.replace(/\s+/g, ' ') ?? '';
  const meta: unknown = await fetch(`http://${HOST}:${PORTS.server}/api/meta`)
    .then((r) => r.json())
    .catch(() => null);
  const state = readState();
  return {
    capturedAt: new Date().toISOString(),
    cpuModel: [
      ...new Set(
        lscpu
          .split('\n')
          .filter((l) => l.startsWith('Model name:'))
          .map((l) => l.split(':')[1]?.trim()),
      ),
    ].join(' + '),
    cpuCoreClasses: sh('sh', [
      '-c',
      'lscpu -e=CPU,MAXMHZ | awk \'NR>1{c[$2]++} END{for(k in c) print c[k]" cores at max "k" MHz"}\'',
    ]),
    cpuCoresLogical: os.cpus().length,
    cpuTopology: `${pick('Thread(s) per core')} thread(s)/core, ${pick('Core(s) per socket')} core(s)/socket (+ cluster layout: ${pick('Socket(s)')} socket)`,
    lscpuHead: lscpu.split('\n').slice(0, 14).join('\n'),
    memTotal: memLine('MemTotal'),
    memAvailable: memLine('MemAvailable'),
    kernel: sh('uname', ['-srm']),
    os: sh('sh', ['-c', '. /etc/os-release; echo "$PRETTY_NAME"']),
    node: process.version,
    docker: sh('docker', ['--version']),
    postgres: sh('docker', ['exec', 'rd-perf-pg', 'postgres', '--version']),
    playwrightImage: 'mcr.microsoft.com/playwright:v1.64.1-noble',
    loadavg: os.loadavg(),
    serverMeta: meta,
    serverSettings: state.serverSettings,
    serverNode: sh('sh', ['-c', `cat /proc/${state.serverPid}/cmdline | tr '\\0' ' '`]),
    docs:
      state.docs.small && state.docs.large
        ? {
            small: { ...state.docs.small, viewerShare: undefined },
            large: { ...state.docs.large, viewerShare: undefined },
          }
        : state.docs,
    topCpuAtStart: sh('sh', ['-c', 'ps -eo pcpu,comm --sort=-pcpu | head -8']),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(await envInfo(), null, 2)}\n`);
}
