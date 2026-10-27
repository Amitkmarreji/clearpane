// Exercises the popup controls: per-site allowlist, global switch, counter.
// Usage: node controls.mjs [outDir] [extensionDir]   (extensionDir: e.g. an unzipped store package)
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = resolve(process.argv[3] || join(HERE, '..', '..'));

const OUT = process.argv[2] || join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const URL_UNDER_TEST = 'https://adblock-tester.com/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({
  executablePath: CHROME, headless: true, pipe: true,
  enableExtensions: [EXT], userDataDir: mkdtempSync(join(tmpdir(), 'ctl-')),
  defaultViewport: { width: 1280, height: 900 },
});
const sw = await b.waitForTarget(t => t.type() === 'service_worker');
const extId = new URL(sw.url()).host;
await sleep(4000);

const site = await b.newPage();
let blocked = 0;
site.on('requestfailed', r => { if ((r.failure()?.errorText || '').includes('BLOCKED_BY_CLIENT')) blocked++; });
const load = async () => { blocked = 0; await site.goto(URL_UNDER_TEST, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}); await sleep(3000); return blocked; };

const popup = await b.newPage();
await popup.setViewport({ width: 300, height: 330 });
// Find the site tab's id from inside the extension.
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
const send = msg => popup.evaluate(m => chrome.runtime.sendMessage(m), msg);
const results = {};
results.normal = await load();
const siteTabId = await popup.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u)?.id, URL_UNDER_TEST);
results.siteTabId = siteTabId;
// Open the real toolbar popup on the site, as a user would; that grants activeTab.
const [ext] = (await b.extensions()).values();
await site.bringToFront();
await ext.triggerAction(site);
const realPopup = await (await b.waitForTarget(t => t.url().includes('/popup/popup.html?') === false && t.url().endsWith('/popup/popup.html') && t !== popup.target(), { timeout: 10000 })).asPage();
await sleep(2800);
results.realPopupShows = await realPopup.$eval('#tab-count', el => el.textContent);
await realPopup.screenshot({ path: join(OUT, 'popup.png') });
await realPopup.close();
results.popupInfo = await send({ type: 'popup:get', tabId: siteTabId, url: URL_UNDER_TEST });

await send({ type: 'popup:setSiteAllowed', host: 'adblock-tester.com', allowed: true });
results.siteAllowlisted = await load();
await send({ type: 'popup:setSiteAllowed', host: 'adblock-tester.com', allowed: false });
results.siteBackOn = await load();
await send({ type: 'popup:setEnabled', enabled: false });
results.globalOff = await load();
await send({ type: 'popup:setEnabled', enabled: true });
results.globalBackOn = await load();
results.finalInfo = await send({ type: 'popup:get', tabId: siteTabId, url: URL_UNDER_TEST });

// A web page must not be able to change settings through the content-script channel.
results.pageCannotMessage = await site.evaluate(() => typeof chrome === 'undefined' || !chrome.runtime?.sendMessage);
writeFileSync(join(OUT, 'controls.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
const checks = {
  'blocks on the test site': results.normal > 0,
  'real popup shows a count': /^\d[\d,]*$/.test(results.realPopupShows) && results.realPopupShows !== '0',
  'popup:get reports blocked': results.popupInfo.blocked > 0,
  'site switch off stops blocking': results.siteAllowlisted === 0,
  'site switch on restores blocking': results.siteBackOn > 0,
  'global off stops blocking': results.globalOff === 0,
  'global on restores blocking': results.globalBackOn > 0,
  'no setup errors': (results.finalInfo.errors || []).length === 0,
  'page cannot message the extension': results.pageCannotMessage,
};
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
await b.close();
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
