import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stateFile = fileURLToPath(new URL('../../.stage/real/state.json', import.meta.url));

/** Fails fast, with the fix, when the real stack is not running. */
export default async function globalSetup(): Promise<void> {
  if (!existsSync(stateFile)) {
    throw new Error(
      'The real stack is not running. Start it first: node apps/web/test-real/stack.mjs up',
    );
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { baseUrl: string };
  const response = await fetch(`${state.baseUrl}/api/ready`).catch(() => null);
  if (!response?.ok) {
    throw new Error(`The real server at ${state.baseUrl} is not ready (GET /api/ready).`);
  }
}
