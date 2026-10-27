// Downloads every filter list named in lists.json into tools/cache/.
// Lists that fail to download keep their previous cached copy, if any.
import https from 'node:https';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIncludes } from './lib/preprocess.mjs';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(TOOLS_DIR, 'cache');
const TIMEOUT_MS = 60_000;

export async function loadListConfig() {
  return JSON.parse(await readFile(join(TOOLS_DIR, 'lists.json'), 'utf8'));
}

export function cacheFileFor(url) {
  const name = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/gi, '_');
  return join(CACHE_DIR, name);
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

// Uses node:https rather than fetch(): Node 24's undici fetch hit an internal
// assertion (and killed the process) on one of the list hosts.
function httpGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS, headers: { 'user-agent': 'adblock-extension-build' } }, res => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirectsLeft === 0) return reject(new Error('too many redirects'));
        return resolve(httpGet(new URL(headers.location, url).href, redirectsLeft - 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode}`));
      }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

async function fetchText(url) {
  const text = await httpGet(url);
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('got an HTML page, not a filter list');
  return text;
}

export async function downloadAll({ offline = false } = {}) {
  const config = await loadListConfig();
  await mkdir(CACHE_DIR, { recursive: true });
  const urls = [...new Set(Object.values(config.rulesets).flatMap(r => r.lists))];
  const queued = new Set(urls);
  const report = [];
  // One at a time, so a slow host can't stall the others into a timeout.
  // `urls` grows while looping as `!#include` targets are discovered.
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const file = cacheFileFor(url);
    if (offline) {
      report.push({ url, status: (await exists(file)) ? 'cached' : 'missing' });
      continue;
    }
    try {
      const text = await fetchText(url);
      await writeFile(file, text);
      report.push({ url, status: 'downloaded', lines: text.split('\n').length });
      for (const child of findIncludes(text, url)) {
        if (!queued.has(child)) { queued.add(child); urls.push(child); }
      }
    } catch (err) {
      const fallback = (await exists(file)) ? 'kept old copy' : 'MISSING';
      report.push({ url, status: `failed (${err.message}); ${fallback}` });
    }
  }
  return { config, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { report } = await downloadAll();
  for (const r of report) console.log(`${r.status.padEnd(12)} ${r.lines ?? ''}\t${r.url}`);
}
