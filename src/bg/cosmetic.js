// Cosmetic filtering, done the way Brave Shields does it: the content script
// reports the classes and ids present on the page, and this module answers
// with the matching generic selectors plus the hostname-specific ones,
// injected as user-origin CSS so pages can't override them.
import { lookupKeys } from '../shared/hosts.js';

let tablesPromise = null;
function tables() {
  tablesPromise ??= fetch(chrome.runtime.getURL('data/cosmetic.json'))
    .then(r => r.json())
    .catch(err => { tablesPromise = null; throw err; });
  return tablesPromise;
}

// Lookups by page-supplied names ("constructor", "__proto__") must not reach Object.prototype.
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : []);

const HIDE = '{display:none!important}';
const hostCache = new Map();
const HOST_CACHE_MAX = 200;

/** Per-host view: which kinds are disabled, exceptions, and the specific CSS. */
async function hostView(host) {
  const hit = hostCache.get(host);
  if (hit) return hit;
  const t = await tables();
  const keys = lookupKeys(host);
  const keySet = new Set(keys);
  const off = kind => t.disabled[kind].some(h => keySet.has(h));
  const exceptions = new Set();
  for (const k of keys) for (const sel of own(t.exceptions, k)) exceptions.add(sel);

  const hide = new Set();
  const styles = new Map();
  for (const k of keys) {
    for (const sel of own(t.specific, k)) if (!exceptions.has(sel)) hide.add(sel);
    for (const [sel, decl] of own(t.styles, k)) if (!exceptions.has(sel)) styles.set(sel, decl);
  }
  const view = {
    all: off('all'),
    generic: !off('all') && !off('generic'),
    specific: !off('all') && !off('specific'),
    exceptions,
    specificCss: [...[...hide].map(sel => sel + HIDE), ...[...styles].map(([s, d]) => `${s}{${d}}`)].join('\n'),
  };
  if (hostCache.size >= HOST_CACHE_MAX) hostCache.delete(hostCache.keys().next().value);
  hostCache.set(host, view);
  return view;
}

async function inject(sender, css) {
  if (!css || sender.tab?.id === undefined) return;
  // documentIds pins the CSS to the document that asked, even if the frame navigates meanwhile.
  const target = sender.documentId
    ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
    : { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] };
  try {
    await chrome.scripting.insertCSS({
      target,
      css,
      origin: 'USER',
    });
  } catch {
    // The frame navigated away or was removed before injection; nothing to hide.
  }
}

/** First message from a frame: injects specific + always-on generic CSS. */
export async function handleInit(host, sender) {
  if (!host) return { generic: false };
  const view = await hostView(host);
  if (view.all) return { generic: false };
  const parts = [];
  if (view.specific) parts.push(view.specificCss);
  if (view.generic) {
    const t = await tables();
    parts.push(t.generic.misc.filter(sel => !view.exceptions.has(sel)).map(sel => sel + HIDE).join('\n'));
  }
  await inject(sender, parts.filter(Boolean).join('\n'));
  return { generic: view.generic };
}

/** Later messages: newly seen class and id names on the page. */
export async function handleTokens(host, { classes = [], ids = [] }, sender) {
  if (!host) return;
  const view = await hostView(host);
  if (!view.generic) return;
  const t = await tables();
  const out = [];
  for (const name of classes) for (const sel of own(t.generic.classes, name)) if (!view.exceptions.has(sel)) out.push(sel + HIDE);
  for (const name of ids) for (const sel of own(t.generic.ids, name)) if (!view.exceptions.has(sel)) out.push(sel + HIDE);
  await inject(sender, out.join('\n'));
}
