// Loads the extension into the installed Chrome (throwaway profile), checks it
// started cleanly, and compares test pages with and without it.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = resolve(HERE, '..', '..');
const USE_REA = process.env.USE_REA === '1';

const OUT = process.argv[2] || join(HERE, 'out');
const PAGES = (process.argv[3] || 'https://d3ward.github.io/toolz/adblock.html,https://adblock-tester.com/,https://www.dailymail.co.uk/home/index.html,https://edition.cnn.com/').split(',');
mkdirSync(OUT, { recursive: true });

const PORTS = { true: 9333, false: 9334 };
async function launch(withExt) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true,
    enableExtensions: withExt ? [EXT] : false,
    userDataDir: mkdtempSync(join(tmpdir(), 'shields-test-')),
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', '--lang=en-GB', `-remote-debugging-port=${PORTS[withExt]}`, '-remote-allow-origins=*'],
  });
}

async function extensionWorker(browser) {
  const target = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 });
  return { worker: await target.worker(), id: new URL(target.url()).host };
}

const AD_SELECTORS = ['ins.adsbygoogle', '[id^="google_ads"]', '[id^="div-gpt-ad"]', 'iframe[src*="doubleclick"]',
  'iframe[id^="google_ads_iframe"]', '[class*="ad-slot"]', '[data-ad]', '.ad', '.ads', '#ad', '[id*="taboola"]', '[class*="taboola"]', '[id*="outbrain"]', '.OUTBRAIN'];

async function visit(browser, url, label) {
  const page = await browser.newPage();
  const stats = { requests: 0, blocked: 0, failed: 0, blockedHosts: {} };
  page.on('request', () => { stats.requests++; });
  page.on('requestfailed', req => {
    const err = req.failure()?.errorText || '';
    if (err.includes('ERR_BLOCKED_BY_CLIENT')) {
      stats.blocked++;
      const h = new URL(req.url()).hostname;
      stats.blockedHosts[h] = (stats.blockedHosts[h] || 0) + 1;
    } else stats.failed++;
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  } catch (e) { stats.gotoError = e.message.split('\n')[0]; }
  await new Promise(r => setTimeout(r, 6000));
  stats.visibleAds = await page.evaluate(sels => {
    const out = {};
    for (const s of sels) {
      let n = 0;
      for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden') n++;
      }
      if (n) out[s] = n;
    }
    return out;
  }, AD_SELECTORS).catch(e => ({ error: e.message }));
  stats.text = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).slice(0, 3000);
  const safe = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  await page.screenshot({ path: join(OUT, `${safe}_${label}.png`) }).catch(() => {});
  if (USE_REA) stats.rea = await reaInspect(page, label === 'shields', join(OUT, `${safe}_${label}_rea.json`));
  await page.close();
  return stats;
}

function reaInspect(page, withExt, outFile) {
  const targetId = page.target()._targetId;
  const endpoint = `http://127.0.0.1:${PORTS[withExt]}`;
  return new Promise(resolve => {
    execFile('npx', ['-y', 'rea-agents@latest', 'inspect-web-page', endpoint, targetId, '--observation-ms', '3000', '--format', 'json'],
      { shell: true, cwd: process.env.REA_CWD, maxBuffer: 64 * 1024 * 1024, timeout: 180000 }, (err, stdout, stderr) => {
        writeFileSync(outFile, stdout || '');
        resolve({ ok: !err, bytes: (stdout || '').length, error: err ? (stderr || err.message).slice(-400) : undefined });
      });
  });
}

async function checkExtensionsPage(browser, id) {
  const page = await browser.newPage();
  await page.goto('chrome://extensions');
  await new Promise(r => setTimeout(r, 1500));
  // Turn on Developer mode in this throwaway profile so the Errors button would show.
  const info = await page.evaluate(async extId => {
    const mgr = document.querySelector('extensions-manager');
    const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
    const toggle = toolbar.shadowRoot.querySelector('#devMode');
    if (toggle && !toggle.checked) toggle.click();
    await new Promise(r => setTimeout(r, 1000));
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    const item = list.shadowRoot.querySelector(`extensions-item#${extId}`);
    if (!item) return { found: false };
    const errBtn = item.shadowRoot.querySelector('#errors-button');
    const name = item.shadowRoot.querySelector('#name')?.textContent.trim();
    const warn = [...item.shadowRoot.querySelectorAll('.message, #warnings, .warning')].map(e => e.textContent.trim()).filter(Boolean);
    return { found: true, name, devMode: toggle?.checked, errorsButtonVisible: Boolean(errBtn && !errBtn.hidden && errBtn.offsetParent !== null), warnings: warn };
  }, id);
  const errors = await page.evaluate(extId => new Promise(res => chrome.developerPrivate.getExtensionInfo(extId, i => res({
    manifestErrors: i.manifestErrors?.map(e => e.message), runtimeErrors: i.runtimeErrors?.map(e => e.message), installWarnings: i.installWarnings,
  }))), id).catch(e => ({ error: e.message }));
  await page.screenshot({ path: join(OUT, 'chrome_extensions.png') });
  await page.close();
  return { ...info, ...errors };
}

const report = { pages: {} };
const ext = await launch(true);
const { worker, id } = await extensionWorker(ext);
const swLogs = [];
worker.on('console', m => swLogs.push(`${m.type()}: ${m.text()}`));
await new Promise(r => setTimeout(r, 4000));
report.extension = await worker.evaluate(async () => ({
  enabledRulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
  availableStaticRules: await chrome.declarativeNetRequest.getAvailableStaticRuleCount(),
  scriptletScripts: (await chrome.scripting.getRegisteredContentScripts()).length,
  applyErrors: (await chrome.storage.local.get('lastApplyErrors')).lastApplyErrors,
}));
report.extension.id = id;
const base = await launch(false);
for (const url of PAGES) {
  const withExt = await visit(ext, url, 'shields');
  const without = await visit(base, url, 'baseline');
  report.pages[url] = { withExt, without };
  console.log(`${url}\n  baseline: ${without.requests} requests, ads visible ${JSON.stringify(without.visibleAds)}\n  shields : ${withExt.requests} requests, ${withExt.blocked} blocked, ads visible ${JSON.stringify(withExt.visibleAds)}`);
}
report.counter = await worker.evaluate(async () => (await chrome.storage.local.get('totalBlocked')).totalBlocked).catch(e => e.message);
report.extensionsPage = await checkExtensionsPage(ext, id);
report.swLogs = swLogs;
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ extension: report.extension, counter: report.counter, extensionsPage: report.extensionsPage, swLogs }, null, 2));
await ext.close();
await base.close();
