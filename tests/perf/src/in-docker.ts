/** Runs one browser scenario script inside the pinned Playwright image (host network, uid 1000). */
import { spawnSync } from 'node:child_process';
import { repoRoot, runDir } from './common';

export const PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';
let counter = 0;

export function runInDocker(
  script: string,
  args: string[],
  dir: string,
): { code: number; stdout: string } {
  counter += 1;
  const name = `rd-perf-pw-${process.pid}-${counter}`;
  const rel = dir.startsWith(repoRoot) ? dir.slice(repoRoot.length) : dir;
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      name,
      '--user',
      '1000:1000',
      '-e',
      'HOME=/tmp',
      '--network',
      'host',
      '--ipc=host',
      '-e',
      `PERF_RUN_DIR=/work${rel}`,
      '-v',
      `${repoRoot}:/work`,
      '-w',
      '/work/tests/perf',
      PLAYWRIGHT_IMAGE,
      'node',
      '--import',
      'tsx',
      script,
      ...args,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  process.stdout.write(result.stdout ?? '');
  if (result.stderr) process.stderr.write(result.stderr);
  return { code: result.status ?? -1, stdout: result.stdout ?? '' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [script, ...args] = process.argv.slice(2);
  if (!script) throw new Error('usage: in-docker.ts <script> [args]');
  const dir = runDir();
  const { code } = runInDocker(script, args, dir);
  process.exit(code);
}
