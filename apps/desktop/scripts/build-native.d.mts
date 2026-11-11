export const ELECTRON_TARGET: string;
export const ELECTRON_HEADERS: string;
export function planBuild(options: {
  hostPlatform: string;
  hostArch: string;
  argv: readonly string[];
}): { ok: false; message: string } | { ok: true; arch: string; args: string[] };
