// Makes the store screenshots and promo tiles in store/screenshots/.
// 1. Serves store/src/demo-news.html (a made-up news page) as hillside-courier.example.
//    Chrome maps every hostname to this local server, so the page's ad and
//    tracker URLs are answered with harmless stand-ins and nothing leaves the PC.
// 2. Captures it without Clearpane (before) and with it (after), plus the real popup.
// 3. Screenshots each layout in store/src/frames.html at its exact store size.
// Usage: node store-shots.mjs
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = resolve(HERE, '..', '..');
const SRC = join(EXT, 'store', 'src');
const SHOTS = join(SRC, 'shots');
const OUT = join(EXT, 'store', 'screenshots');
const PORT = 8765;
const HOST = 'hillside-courier.example';
const DEMO = `http://${HOST}:${PORT}/demo-news.html`;
const PAGE_VIEW = { width: 1000, height: 700, deviceScaleFactor: 2 };
const FRAMES = ['shot-1', 'shot-2', 'shot-3', 'shot-4', 'promo-small', 'promo-marquee'];
const FRAME_FILES = {
  'shot-1': '1-popup.png', 'shot-2': '2-before-after.png', 'shot-3': '3-site-switch.png',
  'shot-4': '4-privacy.png', 'promo-small': 'promo-small-440x280.png', 'promo-marquee': 'promo-marquee-1400x560.png',
};
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript', '.gif': 'image/gif' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

// The fake ad picture: a loud original graphic, served for any ad image path.
const AD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 92"><rect width="92" height="92" fill="#f97316"/><circle cx="46" cy="40" r="22" fill="#fde047"/><text x="46" y="82" font-family="sans-serif" font-weight="900" font-size="16" text-anchor="middle" fill="#fff">CLICK!</text></svg>`;

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  const file = join(SRC, path);
  if (!file.startsWith(SRC)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    // Anything else is a fake ad or tracker: an ad picture, or an empty script.
    if (/\.(png|gif|jpg)$|^(p|tr|action)/.test(path)) res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(AD_SVG);
    else res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
}).listen(PORT, '127.0.0.1');

const launch = withExt => puppeteer.launch({
  executablePath: CHROME, headless: true, pipe: true,
  ...(withExt ? { enableExtensions: [EXT] } : {}),
  userDataDir: mkdtempSync(join(tmpdir(), 'shots-')),
  // Every hostname resolves to the local server: the page's ad and tracker
  // URLs never reach the real services.
  args: ['--host-resolver-rules=MAP * 127.0.0.1'],
});

async function capturePage(browser, name) {
  const page = await browser.newPage();
  await page.setViewport(PAGE_VIEW);
  await page.goto(DEMO, { waitUntil: 'networkidle0' });
  await sleep(1200);
  await page.screenshot({ path: join(SHOTS, name) });
  return page;
}

async function capturePopup(browser, page, name) {
  const [ext] = (await browser.extensions()).values();
  await page.bringToFront();
  await ext.triggerAction(page);
  const target = await browser.waitForTarget(t => t.url().includes('/popup/popup.html'), { timeout: 10000 });
  const popup = await target.asPage();
  await popup.setViewport({ width: 300, height: 327, deviceScaleFactor: 2 });
  await sleep(2800); // let the entrance and count-up finish
  await popup.screenshot({ path: join(SHOTS, name) });
  await popup.close();
}

try {
  const plain = await launch(false);
  await capturePage(plain, 'before.png');

  const withExt = await launch(true);
  await withExt.waitForTarget(t => t.type() === 'service_worker');
  await sleep(3000);
  const page = await capturePage(withExt, 'after.png');
  const blocked = await page.evaluate(() => ({
    hidden: ['ad_leaderboard', 'sidebar-ad', 'gdpr-banner'].map(id => getComputedStyle(document.getElementById(id)).display === 'none'),
    banner: getComputedStyle(document.querySelector('.banner-ad')).display === 'none',
  }));
  console.log('hidden on the demo page:', JSON.stringify(blocked));
  await capturePopup(withExt, page, 'popup-on.png');

  const sw = await withExt.waitForTarget(t => t.type() === 'service_worker');
  const extId = new URL(sw.url()).host;
  const settings = await withExt.newPage();
  await settings.goto(`chrome-extension://${extId}/popup/popup.html`);
  const setAllowed = allowed => settings.evaluate((host, a) => chrome.runtime.sendMessage({ type: 'popup:setSiteAllowed', host, allowed: a }), HOST, allowed);
  await setAllowed(true);
  await settings.close();
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);
  await capturePopup(withExt, page, 'popup-paused.png');
  await withExt.close();

  const frames = await plain.newPage();
  await frames.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
  await frames.goto(`http://127.0.0.1:${PORT}/frames.html`, { waitUntil: 'networkidle0' });
  for (const id of FRAMES) {
    const el = await frames.$(`#${id}`);
    await el.screenshot({ path: join(OUT, FRAME_FILES[id]) });
  }
  await plain.close();
  console.log(`store images -> ${OUT}`);
} finally {
  server.close();
}
