#!/usr/bin/env node
/* global document, location */
// Opens the public address in headless Chromium and reports what a visitor's
// browser gets: status, what is rendered, console errors, blocked or failed
// requests and cookies. It does not sign in and sends nothing but page loads.
//
//   . scripts/dev-env.sh; node deploy/checks/browser-check.mjs [public origin] [screenshot.png]
//
// The public origin defaults to https://realdocs.techsarasolutions.com.
// Exit status 0 when the page answers 200, the application renders and no
// script error or failed request of the site itself is seen; 1 otherwise.
// Console messages are listed in any case (see the README about the Cloudflare
// analytics script that the page's Content-Security-Policy refuses).
//
// Uses the Playwright package of this repository and its Chromium
// (`pnpm exec playwright install chromium` when that is missing). To use another
// Chromium build instead, give its path in RD_CHECK_BROWSER (exit status 2 when
// no browser can be started).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('@playwright/test');

const origin = (process.argv[2] ?? 'https://realdocs.techsarasolutions.com').replace(/\/+$/, '');
const screenshotPath = process.argv[3];

async function launch() {
  const executablePath = process.env.RD_CHECK_BROWSER;
  if (executablePath) return chromium.launch({ executablePath });
  try {
    return await chromium.launch();
  } catch (error) {
    if (!/Executable doesn't exist/.test(error.message)) throw error;
    console.error(
      "Playwright's Chromium is not installed. Run `pnpm exec playwright install chromium`, or set RD_CHECK_BROWSER to the path of a Chromium build.",
    );
    process.exit(2);
  }
}

/** Loads the page once, prints the findings and returns whether it looked right. */
async function check(browser) {
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const sockets = [];
  const hosts = new Map();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const host = new URL(request.url()).host;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'failed'})`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('websocket', (socket) => sockets.push(socket.url()));

  const startedAt = Date.now();
  const response = await page.goto(`${origin}/`, { waitUntil: 'networkidle', timeout: 45_000 });
  const loadMs = Date.now() - startedAt;
  // Give the client-side router a moment to settle on its first screen.
  await page.waitForTimeout(1_500);

  // This function runs inside the page.
  const view = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    rootChildren: document.getElementById('root')?.childElementCount ?? 0,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    passwordFields: document.querySelectorAll('input[type="password"]').length,
    scripts: [...document.scripts].map((script) => script.src || '(inline)'),
  }));
  const cookies = await context.cookies();
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: false });

  const siteHost = new URL(origin).host;
  const ownFailures = failedRequests.filter((line) => line.includes(`//${siteHost}/`));
  const ownServerErrors = badResponses.filter(
    (line) => /^5\d\d /.test(line) && line.includes(`//${siteHost}/`),
  );

  console.log(`Browser check of ${origin}/ at ${new Date().toISOString()}`);
  console.log(`  browser              Chromium ${browser.version()} (headless)`);
  console.log(`  answer               ${response?.status() ?? 'none'} in ${loadMs} ms`);
  console.log(`  final address        ${view.url}`);
  console.log(`  title                ${view.title}`);
  console.log(`  application rendered ${view.rootChildren > 0 ? 'yes' : 'NO'}`);
  console.log(`  password fields      ${view.passwordFields}`);
  console.log(`  visible text         ${view.text || '(none)'}`);
  console.log(`  script elements      ${view.scripts.length}`);
  for (const script of view.scripts) console.log(`    ${script}`);
  console.log(`  requests by host`);
  for (const [host, count] of hosts) console.log(`    ${host}: ${count}`);
  console.log(`  WebSockets opened    ${sockets.length}`);
  for (const socket of sockets) console.log(`    ${socket}`);
  console.log(`  cookies              ${cookies.length}`);
  for (const cookie of cookies) {
    // Names and flags only; values are never printed.
    console.log(
      `    ${cookie.name} (domain ${cookie.domain}, path ${cookie.path}, secure=${cookie.secure}, httpOnly=${cookie.httpOnly}, sameSite=${cookie.sameSite})`,
    );
  }
  console.log(`  script errors        ${pageErrors.length}`);
  for (const line of pageErrors) console.log(`    ${line}`);
  console.log(`  failed requests      ${failedRequests.length}`);
  for (const line of failedRequests) console.log(`    ${line}`);
  console.log(`  answers of 400+      ${badResponses.length}`);
  for (const line of badResponses) console.log(`    ${line}`);
  console.log(`  console errors and warnings ${consoleMessages.length}`);
  for (const line of consoleMessages) console.log(`    ${line}`);

  const ok =
    response?.status() === 200 &&
    view.rootChildren > 0 &&
    pageErrors.length === 0 &&
    ownFailures.length === 0 &&
    ownServerErrors.length === 0;
  console.log('');
  console.log(ok ? 'The page loads and the application renders.' : 'NOT as expected: see above.');
  return ok;
}

const browser = await launch();
const ok = await check(browser).finally(() => browser.close());
process.exit(ok ? 0 : 1);
