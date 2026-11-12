#!/usr/bin/env node
// macOS only: is the pinned panel still on screen while another application is in full screen?
//
//   node scripts/fullscreen-check-mac.mjs [--arch arm64|x64]
//
// Starts the packaged app with a fresh profile, reads the panel's window level, puts Safari into
// native full screen (its own Space) with a keystroke sent through System Events, and asks the
// window server which windows are on screen. A pass means the panel window is listed on screen,
// at a level above normal windows, while Safari's full-screen window is on screen too. When the
// runner does not allow the keystroke (no accessibility permission) the result is INCONCLUSIVE
// and the script exits 0 after saying so: it never reports a pass it did not observe.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    arch: { type: 'string', default: process.arch },
    out: { type: 'string', default: path.resolve(here, '../out') },
  },
});
function fail(message) {
  console.error(`fullscreen-check-mac: ${message}`);
  process.exit(1);
}
if (process.platform !== 'darwin') fail('this check runs on macOS only.');
const executable = path.join(
  values.out,
  `RealtimeDocs-darwin-${values.arch}`,
  'RealtimeDocs.app',
  'Contents',
  'MacOS',
  'RealtimeDocs',
);
if (!fs.existsSync(executable)) fail(`no executable at ${executable}`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SWIFT = `
import CoreGraphics
import Foundation
let options: CGWindowListOption = [.optionOnScreenOnly]
let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = (b["Width"] as? NSNumber)?.intValue ?? 0
  let height = (b["Height"] as? NSNumber)?.intValue ?? 0
  print("WIN|\\(owner)|\\(layer)|\\(width)|\\(height)")
}
let main = CGDisplayBounds(CGMainDisplayID())
print("SCREEN|\\(Int(main.width))|\\(Int(main.height))")
`;
const swiftFile = path.join(os.tmpdir(), `rd-windows-${process.pid}.swift`);
fs.writeFileSync(swiftFile, SWIFT);

function onScreen() {
  const result = spawnSync('swift', [swiftFile], { encoding: 'utf8' });
  if (result.status !== 0) fail(`could not list windows: ${result.stderr.slice(0, 400)}`);
  const lines = result.stdout.split('\n').filter(Boolean);
  const screen = (lines.find((line) => line.startsWith('SCREEN|')) ?? 'SCREEN|0|0').split('|');
  const windows = lines
    .filter((line) => line.startsWith('WIN|'))
    .map((line) => {
      const [, owner, layer, width, height] = line.split('|');
      return { owner, layer: Number(layer), width: Number(width), height: Number(height) };
    });
  return { width: Number(screen[1]), height: Number(screen[2]), windows };
}
const panelOf = (state) =>
  state.windows.find((w) => w.owner === 'RealtimeDocs' && w.width > 100 && w.height > 60);

const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-fs-app-'));
const app = spawn(executable, [`--user-data-dir=${appData}`], { stdio: 'ignore' });
let code = 0;
try {
  await wait(12000);
  const before = onScreen();
  const panelBefore = panelOf(before);
  console.log(`Screen ${before.width}x${before.height}`);
  console.log(
    `Before: ${panelBefore ? `panel ${panelBefore.width}x${panelBefore.height} at window level ${panelBefore.layer}` : 'NO RealtimeDocs WINDOW ON SCREEN'}`,
  );
  if (!panelBefore) fail('the app showed no window on a fresh start.');
  if (panelBefore.layer <= 0) {
    console.log('RESULT: THE PANEL IS AT THE NORMAL WINDOW LEVEL, not above other windows.');
    code = 1;
  } else {
    console.log(
      `The panel is above normal windows (level ${panelBefore.layer}; screen-saver level is 1000).`,
    );
    spawnSync('open', ['-a', 'Safari', 'about:blank']);
    await wait(6000);
    const key = spawnSync(
      'osascript',
      [
        '-e',
        'tell application "Safari" to activate',
        '-e',
        'delay 1',
        '-e',
        'tell application "System Events" to keystroke "f" using {control down, command down}',
      ],
      { encoding: 'utf8' },
    );
    await wait(8000);
    const after = onScreen();
    const safari = after.windows.find(
      (w) => w.owner === 'Safari' && w.width >= after.width && w.height >= after.height - 2,
    );
    const panelAfter = panelOf(after);
    console.log(
      `Keystroke: exit ${key.status}${key.stderr ? ` (${key.stderr.trim().slice(0, 200)})` : ''}`,
    );
    console.log(`Safari full screen on screen: ${safari ? 'yes' : 'no'}`);
    console.log(
      `Panel on screen afterwards: ${panelAfter ? `yes, level ${panelAfter.layer}` : 'no'}`,
    );
    if (!safari) {
      console.log(
        'RESULT: INCONCLUSIVE. Safari did not enter full screen on this runner, so the full-screen case was not observed. Only the window level was checked.',
      );
    } else if (panelAfter) {
      console.log(
        'RESULT: the pinned panel is on screen together with the full-screen Safari window.',
      );
    } else {
      console.log('RESULT: THE PANEL IS NOT ON SCREEN while Safari is in full screen.');
      code = 1;
    }
  }
} finally {
  spawnSync('osascript', ['-e', 'tell application "Safari" to quit'], { stdio: 'ignore' });
  app.kill();
  await wait(1500);
  app.kill('SIGKILL');
  fs.rmSync(appData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  fs.rmSync(swiftFile, { force: true });
}
process.exit(code);
