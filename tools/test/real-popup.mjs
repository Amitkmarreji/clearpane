// Opens the real action popup (with its activeTab grant) on a test site and captures its animation.
// Usage: node real-popup.mjs [outDir]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = resolve(HERE, '..', '..');
const OUT = process.argv[2] || join(HERE, 'out', 'real-popup');
mkdirSync(OUT, { recursive: true });
const SITE = 'https://adblock-tester.com/';
const FRAMES_MS = [150, 500, 900, 1300, 1700, 2300];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({
  executablePath: CHROME, headless: true, pipe: true,
  enableExtensions: [EXT], userDataDir: mkdtempSync(join(tmpdir(), 'rp-')),
});
await b.waitForTarget(t => t.type() === 'service_worker');
await sleep(3000);
const site = await b.newPage();
await site.goto(SITE, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
await sleep(2000);
const [ext] = (await b.extensions()).values();
await site.bringToFront();
await ext.triggerAction(site);
const target = await b.waitForTarget(t => t.url().includes('/popup/popup.html'), { timeout: 10000 });
const popup = await target.asPage();
const t0 = Date.now();
for (const ms of FRAMES_MS) {
  await sleep(Math.max(0, ms - (Date.now() - t0)));
  await popup.screenshot({ path: join(OUT, `real-${String(ms).padStart(4, '0')}.png`) });
}
const value = await popup.$eval('#tab-count', el => el.dataset.value);
console.log(`blocked shown in real popup: ${value}`);
await b.close();
