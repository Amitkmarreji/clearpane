// Runs Brave's own QA pages (dev-pages.brave.software/filtering) with and
// without the extension and reads their pass/fail state.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = resolve(HERE, '..', '..');

const OUT = process.argv[2] || join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const BASE = 'https://dev-pages.brave.software/filtering/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const launch = withExt => puppeteer.launch({
  executablePath: CHROME, headless: true, pipe: true, enableExtensions: withExt ? [EXT] : false,
  userDataDir: mkdtempSync(join(tmpdir(), 'brave-qa-')), defaultViewport: { width: 1280, height: 2400 },
});

async function cosmetic(page) {
  await page.goto(`${BASE}cosmetic-filtering.html`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !document.getElementById('button-start-test').disabled, { timeout: 15000 });
  await page.evaluate(() => {
    const ta = document.getElementById('css-ids-text-area');
    // Keep the run short: the first 40 ids of the page's own list.
    ta.value = ta.value.trim().split('\n').slice(0, 40).join('\n');
    document.getElementById('button-start-test').click();
  });
  await sleep(40 * 300 + 4000);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const hidden = rows.filter(r => {
      const div = r.querySelector('td:last-child div');
      return div && (getComputedStyle(div).display === 'none' || div.getBoundingClientRect().height === 0);
    });
    return { injected: rows.length, hidden: hidden.length };
  });
}

async function tableText(page, file, wait = 6000) {
  await page.goto(`${BASE}${file}`, { waitUntil: 'networkidle2' });
  await sleep(wait);
  return page.evaluate(() => [...document.querySelectorAll('table tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
}

async function images(page, file) {
  await page.goto(`${BASE}${file}`, { waitUntil: 'networkidle2' });
  await sleep(4000);
  return page.evaluate(() => [...document.querySelectorAll('.border img, .col img')].map(img => ({
    src: img.getAttribute('src')?.slice(0, 70), loaded: img.complete && img.naturalWidth > 0,
  })));
}

async function textAds(page) {
  await page.goto(`${BASE}text-ads.html`, { waitUntil: 'networkidle2' });
  await sleep(4000);
  return page.evaluate(() => [...document.querySelectorAll('[class^="ad--"], [class*=" ad--"]')].map(el => ({
    cls: el.className, visible: el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none',
  })));
}

const result = {};
for (const withExt of [false, true]) {
  const b = await launch(withExt);
  if (withExt) await sleep(4000); // let the service worker register scriptlets and regex rules
  const page = await b.newPage();
  const key = withExt ? 'shields' : 'baseline';
  result[key] = {
    cosmetic: await cosmetic(page).catch(e => ({ error: e.message })),
    scriptlets: await tableText(page, 'scriptlets.html').catch(e => ({ error: e.message })),
    network: await images(page, 'network-requests.html').catch(e => ({ error: e.message })),
    textAds: await textAds(page).catch(e => ({ error: e.message })),
  };
  await page.screenshot({ path: join(OUT, `brave-qa-text-ads_${key}.png`), fullPage: false });
  await b.close();
}
writeFileSync(join(OUT, 'brave-qa.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
