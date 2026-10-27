// Captures the popup's animation as a series of frames (light and dark, on and paused).
// Usage: node popup-preview.mjs [outDir]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = resolve(HERE, '..', '..');
const OUT = process.argv[2] || join(HERE, 'out', 'popup-frames');
mkdirSync(OUT, { recursive: true });
const SITE = 'https://adblock-tester.com/';
const FRAMES_MS = [0, 200, 450, 700, 1000, 1400, 2200];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({
  executablePath: CHROME, headless: true, pipe: true,
  enableExtensions: [EXT], userDataDir: mkdtempSync(join(tmpdir(), 'pv-')),
});
const sw = await b.waitForTarget(t => t.type() === 'service_worker');
const extId = new URL(sw.url()).host;
await sleep(3000);
const site = await b.newPage();
await site.goto(SITE, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
await sleep(2000);

const popup = await b.newPage();
await popup.setViewport({ width: 300, height: 340, deviceScaleFactor: 2 });
const tabId = await (async () => {
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  return popup.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url?.startsWith(u))?.id, SITE);
})();
const url = `chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`;

for (const scheme of ['light', 'dark']) {
  await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await popup.goto(url);
  const t0 = Date.now();
  for (const ms of FRAMES_MS) {
    await sleep(Math.max(0, ms - (Date.now() - t0)));
    await popup.screenshot({ path: join(OUT, `${scheme}-${String(ms).padStart(4, '0')}.png`) });
  }
}
// Paused for this site.
await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'popup:setSiteAllowed', host: 'adblock-tester.com', allowed: true }));
await popup.goto(url);
await sleep(1500);
await popup.screenshot({ path: join(OUT, 'light-paused.png') });
await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'popup:setSiteAllowed', host: 'adblock-tester.com', allowed: false }));
console.log(`frames -> ${OUT}`);
await b.close();
