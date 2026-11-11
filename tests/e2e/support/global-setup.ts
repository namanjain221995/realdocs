import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stateFile = fileURLToPath(new URL('../.stage/state.json', import.meta.url));

/** Fails fast, with the fix, when the stack is not running. */
export default async function globalSetup(): Promise<void> {
  if (!existsSync(stateFile)) {
    throw new Error(
      'The e2e stack is not running. Use `pnpm test:e2e`, or start it: node tests/e2e/stack.mjs up',
    );
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { baseUrl: string };
  const response = await fetch(`${state.baseUrl}/api/ready`).catch(() => null);
  if (!response?.ok)
    throw new Error(`The server at ${state.baseUrl} is not ready (GET /api/ready).`);
}
