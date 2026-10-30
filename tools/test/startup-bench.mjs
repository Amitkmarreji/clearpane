// Measures how long the browser takes to start and open a page with the
// extension loaded the way Clearpane Browser loads it (--load-extension),
// and how responsive the browser UI thread stays meanwhile.
// Usage: node startup-bench.mjs <outFile.json> [extDir,extDir2|none] [runs]
//   CHROME_PATH  the engine to test (default: the installed Clearpane Browser engine)
// Each run uses a fresh throwaway profile and launches it twice (cold, then warm).
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || join(process.env.LOCALAPPDATA, 'Programs/Clearpane Browser/engine/chrome.exe');
const OUT = process.argv[2] || 'startup-bench.json';
const EXTS = (process.argv[3] || 'none') === 'none' ? [] : process.argv[3].split(',');
const RUNS = Number(process.argv[4] || 1);
const PORT = 9420;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A local page with a realistic number of class and id names, an ad slot and two frames.
function testPage() {
  const words = ['card', 'nav', 'item', 'title', 'teaser', 'promo', 'grid', 'col', 'row', 'media', 'thumb', 'link'];
  const rows = [];
  for (let i = 0; i < 1500; i++) {
    const c = `${words[i % words.length]}-${i % 300} ${words[(i * 7) % words.length]}`;
    rows.push(`<div class="${c}" id="n${i}"><span class="t-${i % 97}">row ${i}</span></div>`);
  }
  return `<!doctype html><title>bench</title><div class="ad-slot adsbygoogle" id="div-gpt-ad-1">AD</div>
<iframe src="/frame"></iframe><iframe src="/frame"></iframe>${rows.join('')}`;
}

function serve() {
  const page = testPage();
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/frame' ? '<div class="banner-ad sidebar">frame</div>' : page);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function waitForCdp(t0) {
  for (;;) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      return { ms: Date.now() - t0, ws: v.webSocketDebuggerUrl };
    } catch { await sleep(20); }
  }
}

/** Pings the browser process over CDP and records the round-trip latency (UI thread busy = slow ping). */
function probeUi(session, t0) {
  const samples = [];
  const slow = [];
  let on = true;
  const loop = (async () => {
    while (on) {
      const t = performance.now();
      await session.send('Browser.getVersion').catch(() => {});
      const ms = performance.now() - t;
      samples.push(ms);
      if (ms > 250) slow.push({ atMs: Date.now() - t0 - Math.round(ms), ms: Math.round(ms) });
      await sleep(50);
    }
  })();
  return async () => {
    on = false;
    await loop;
    const sorted = [...samples].sort((a, b) => a - b);
    const pct = p => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0);
    return { pings: samples.length, p50: pct(0.5), p95: pct(0.95), max: Math.round(sorted.at(-1) || 0), slow };
  };
}

async function launchOnce(profile, url) {
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    '--disable-search-engine-collection', '--window-size=1280,900', 'about:blank'];
  if (EXTS.length) args.unshift(`--load-extension=${EXTS.join(',')}`);
  const t0 = Date.now();
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  const cdp = await waitForCdp(t0);
  const browser = await puppeteer.connect({ browserWSEndpoint: cdp.ws, defaultViewport: null });
  await browser.waitForTarget(t => t.type() === 'page', { timeout: 60000 });
  const firstWindow = Date.now() - t0;
  const session = await browser.target().createCDPSession();
  const stopProbe = probeUi(session, t0);

  const tTab = Date.now();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const tabLoad = Date.now() - tTab;
  // How long until the ad slot on the page is hidden (cosmetic filtering done).
  const tHide = Date.now();
  const hidden = await page.waitForFunction(() => getComputedStyle(document.getElementById('div-gpt-ad-1')).display === 'none', { timeout: 30000, polling: 50 })
    .then(() => Date.now() - tHide).catch(() => null);
  // Keep watching the UI thread for the rest of the first 30 s.
  await sleep(Math.max(0, 30000 - (Date.now() - t0)));
  const ui = await stopProbe();
  await browser.close().catch(() => {});
  await new Promise(r => (proc.exitCode !== null ? r() : proc.once('exit', r)));
  return { cdpMs: cdp.ms, firstWindowMs: firstWindow, tabLoadMs: tabLoad, adHiddenAfterLoadMs: hidden, ui };
}

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const results = [];
for (let i = 0; i < RUNS; i++) {
  // BENCH_PROFILE reuses an existing throwaway profile (e.g. one an older build left behind).
  const profile = process.env.BENCH_PROFILE || mkdtempSync(join(tmpdir(), 'cp-bench-'));
  const cold = await launchOnce(profile, url);
  await sleep(1500);
  const warm = await launchOnce(profile, url);
  results.push({ profile, cold, warm });
  console.log(JSON.stringify({ run: i, cold, warm }));
}
server.close();
writeFileSync(OUT, JSON.stringify({ chrome: CHROME, extensions: EXTS, results }, null, 2));
