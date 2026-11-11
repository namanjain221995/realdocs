import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Directory that relative paths in the configuration are resolved against:
 * the workspace root when running from a checkout (source or `dist/`),
 * otherwise the current working directory (container image).
 */
export function projectRoot(): string {
  let dir = here;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Finds a file or directory shipped next to the server code (for example
 * `migrations` or `assets/realtimedocs-demo.png`). Works from `src/**` (tsx),
 * from the bundled `dist/` and from the container layout where those
 * directories sit beside `dist/`.
 */
export function serverResource(relativePath: string): string {
  let dir = here;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Server resource "${relativePath}" was not found next to the server code.`);
}

/** Loads the workspace `.env` file when it exists. Real environment variables win. */
export function loadEnvFile(): void {
  const explicit = process.env.RD_ENV_FILE;
  const file = explicit ?? path.join(projectRoot(), '.env');
  if (!existsSync(file)) {
    if (explicit) throw new Error(`RD_ENV_FILE points to a file that does not exist: ${explicit}`);
    return;
  }
  process.loadEnvFile(file);
}
