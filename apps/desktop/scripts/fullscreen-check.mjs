#!/usr/bin/env node
// Windows only: does the pinned panel stay in front of a full-screen browser?
//
//   node scripts/fullscreen-check.mjs [--arch x64] [--seconds 12]
//
// Starts the packaged app with a fresh profile (Presenter Mode, pinned: the defaults), then starts
// Microsoft Edge in kiosk (full-screen) mode, waits, and reads the system's window stacking order
// (EnumWindows lists top-level windows from front to back). A pass means: the panel window is
// visible, carries the topmost style, and is in front of the full-screen Edge window after Edge
// took the screen. It says nothing about meeting applications, exclusive-fullscreen games, or
// capture exclusion, and nothing about macOS.
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
    seconds: { type: 'string', default: '12' },
    out: { type: 'string', default: path.resolve(here, '../out') },
  },
});

function fail(message) {
  console.error(`fullscreen-check: ${message}`);
  process.exit(1);
}
if (process.platform !== 'win32') fail('this check runs on Windows only.');
if (values.arch !== process.arch) fail(`this host is ${process.arch}, not ${values.arch}.`);

const executable = path.join(values.out, `RealtimeDocs-win32-${values.arch}`, 'RealtimeDocs.exe');
if (!fs.existsSync(executable)) fail(`no executable at ${executable}`);
const edge = [
  path.join(
    process.env['ProgramFiles(x86)'] ?? '',
    'Microsoft',
    'Edge',
    'Application',
    'msedge.exe',
  ),
  path.join(process.env.ProgramFiles ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((candidate) => fs.existsSync(candidate));
if (!edge) fail('Microsoft Edge was not found; nothing was checked.');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = Number(values.seconds);
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-fs-app-'));
const edgeData = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-fs-edge-'));

// Top-level windows from front to back, with what is needed to tell them apart.
const LIST_WINDOWS = `
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public struct R { public int L, T, Rr, B; }
  public static List<string> All() {
    var list = new List<string>(); int z = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var s = new StringBuilder(256); GetWindowText(h, s, 256);
      uint pid; GetWindowThreadProcessId(h, out pid); R r; GetWindowRect(h, out r);
      int ex = GetWindowLong(h, -20);
      list.Add(String.Join("|", new object[] { z++, pid, (ex & 8) != 0, IsIconic(h), r.L, r.T, r.Rr - r.L, r.B - r.T, s.ToString().Replace("|", " ") }));
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
$screen = "{0}x{1}" -f [W]::GetSystemMetrics(0), [W]::GetSystemMetrics(1)
"SCREEN|$screen"
foreach ($line in [W]::All()) {
  $pid2 = [int]($line.Split('|')[1])
  $name = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName
  "WIN|$name|$line"
}
`;

function listWindows() {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', LIST_WINDOWS],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) fail(`could not list windows: ${result.stderr.slice(0, 400)}`);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const screen = (lines.find((line) => line.startsWith('SCREEN|')) ?? 'SCREEN|0x0').split('|')[1];
  const [screenWidth, screenHeight] = screen.split('x').map(Number);
  const windows = lines
    .filter((line) => line.startsWith('WIN|'))
    .map((line) => {
      const [, name, z, pid, topmost, minimized, left, top, width, height, ...title] =
        line.split('|');
      return {
        name,
        z: Number(z),
        pid: Number(pid),
        topmost: topmost === 'True',
        minimized: minimized === 'True',
        left: Number(left),
        top: Number(top),
        width: Number(width),
        height: Number(height),
        title: title.join('|'),
      };
    });
  return { screenWidth, screenHeight, windows };
}

function describe(window) {
  return `z=${window.z} ${window.name} "${window.title}" ${window.width}x${window.height}@${window.left},${window.top}${window.topmost ? ' topmost' : ''}${window.minimized ? ' minimized' : ''}`;
}

const children = [];
function stopAll() {
  for (const child of children) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

let ok = false;
try {
  console.log(`Starting ${executable}`);
  children.push(spawn(executable, [`--user-data-dir=${appData}`], { stdio: 'ignore' }));
  await wait(seconds * 1000);

  const before = listWindows();
  const panelBefore = before.windows.find(
    (window) =>
      window.name === 'RealtimeDocs' &&
      window.width > 100 &&
      window.height > 60 &&
      !window.minimized,
  );
  console.log(`Screen ${before.screenWidth}x${before.screenHeight}`);
  console.log(
    `Before Edge: ${panelBefore ? describe(panelBefore) : 'NO VISIBLE RealtimeDocs WINDOW'}`,
  );
  if (!panelBefore) {
    for (const window of before.windows.slice(0, 15)) console.log(`  ${describe(window)}`);
    fail('the app showed no window on a fresh start, so the stacking order cannot be checked.');
  }

  console.log('Starting Microsoft Edge in kiosk (full-screen) mode');
  children.push(
    spawn(
      edge,
      [
        '--kiosk',
        'about:blank',
        '--edge-kiosk-type=fullscreen',
        '--no-first-run',
        `--user-data-dir=${edgeData}`,
      ],
      { stdio: 'ignore' },
    ),
  );

  // Checked several times: the panel must still be in front well after Edge took the screen.
  const results = [];
  for (let round = 1; round <= 3; round += 1) {
    await wait(5000);
    const now = listWindows();
    const panel = now.windows.find(
      (window) =>
        window.name === 'RealtimeDocs' &&
        window.width > 100 &&
        window.height > 60 &&
        !window.minimized,
    );
    const browser = now.windows.find(
      (window) =>
        window.name === 'msedge' &&
        window.width >= now.screenWidth &&
        window.height >= now.screenHeight - 2,
    );
    console.log(`Round ${round}:`);
    console.log(`  panel:   ${panel ? describe(panel) : 'not visible'}`);
    console.log(`  browser: ${browser ? describe(browser) : 'no full-screen Edge window found'}`);
    results.push({ panel, browser });
  }
  const last = results[results.length - 1];
  if (!results.some((result) => result.browser)) {
    for (const window of listWindows().windows.slice(0, 15)) console.log(`  ${describe(window)}`);
    fail('Edge did not produce a full-screen window; the result is inconclusive.');
  }
  ok = results.every(
    (result) =>
      !result.browser ||
      (result.panel && result.panel.topmost && result.panel.z < result.browser.z),
  );
  if (ok && last.panel && last.browser) {
    console.log(
      'RESULT: the pinned panel is topmost and in front of the full-screen browser window in every round.',
    );
  } else {
    console.log('RESULT: THE PANEL WAS NOT IN FRONT of the full-screen browser window.');
  }
} finally {
  stopAll();
  await wait(1500);
  for (const directory of [appData, edgeData]) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}
process.exit(ok ? 0 : 1);
