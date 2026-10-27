// Expands `!#include` and evaluates uBO's `!#if` preprocessor directives,
// as uBlock Origin Lite does for Chromium MV3 builds.
import { readFile } from 'node:fs/promises';

// Tokens are true for uBO Lite on Chromium; anything unlisted is false.
const ENV = new Set(['env_chromium', 'env_mv3', 'ext_ubol']);

function evalCondition(expr) {
  // Expressions use !, && and || over plain tokens (no parentheses in practice).
  return expr.split('||').some(orPart =>
    orPart.split('&&').every(term => {
      const t = term.trim();
      return t.startsWith('!') ? !ENV.has(t.slice(1).trim()) : ENV.has(t);
    }));
}

/**
 * Returns the effective filter lines of a list, with includes inlined.
 * @param {string} url  the list's source URL (includes resolve against it)
 * @param {(url: string) => string} cachePath  maps a URL to its cached file
 * @param {Set<string>} seen  URLs already expanded in this ruleset
 */
export async function expandList(url, cachePath, seen) {
  if (seen.has(url)) return [];
  seen.add(url);
  let text;
  try {
    text = await readFile(cachePath(url), 'utf8');
  } catch {
    console.warn(`  ! missing cached list ${url}`);
    return [];
  }
  const out = [];
  const stack = []; // one { active } per open !#if block
  const active = () => stack.every(s => s.active);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('!#if ')) {
      stack.push({ active: evalCondition(line.slice(5)) });
      continue;
    }
    if (line.startsWith('!#else')) {
      if (stack.length) stack[stack.length - 1].active = !stack[stack.length - 1].active;
      continue;
    }
    if (line.startsWith('!#endif')) {
      stack.pop();
      continue;
    }
    if (!active()) continue;
    if (line.startsWith('!#include ')) {
      const child = new URL(line.slice(10).trim(), url).href;
      out.push(...await expandList(child, cachePath, seen));
      continue;
    }
    if (line === '' || line.startsWith('!') || line.startsWith('[Adblock')) continue;
    out.push(line);
  }
  return out;
}

/** Finds `!#include` targets so the downloader can fetch them too. */
export function findIncludes(text, baseUrl) {
  const found = [];
  for (const m of text.matchAll(/^!#include\s+(\S+)/gm)) found.push(new URL(m[1], baseUrl).href);
  return found;
}
