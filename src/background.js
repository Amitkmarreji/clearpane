// Service worker: wires settings, cosmetic filtering and the counter to
// Chrome's events and to messages from the content script and popup.
import { getState, setEnabled, setSiteAllowed, applyState } from './bg/state.js';
import { handleInit, handleTokens } from './bg/cosmetic.js';
import { blockedOnTab, showBadgeCounts } from './bg/counter.js';
import { hostnameOf, isAllowlisted, siteKey } from './shared/hosts.js';

chrome.runtime.onInstalled.addListener(async () => {
  const errors = await applyState(await getState());
  await chrome.storage.local.set({ lastApplyErrors: errors });
  await showBadgeCounts();
});

chrome.runtime.onStartup.addListener(async () => {
  await applyState(await getState());
});

/** Filtering applies to a frame unless blocking is off globally or for the top-level site. */
async function filteringOn(sender) {
  const state = await getState();
  if (!state.enabled) return false;
  return !isAllowlisted(hostnameOf(sender.tab?.url || ''), state.allowlist);
}

/** The frame's host; about:blank and similar frames inherit the tab's host. */
function frameHost(sender) {
  return hostnameOf(sender.url || '') || hostnameOf(sender.origin || '') || hostnameOf(sender.tab?.url || '');
}

async function handlePopup(msg) {
  switch (msg.type) {
    case 'popup:get': {
      const state = await getState();
      const host = hostnameOf(msg.url || '');
      const blocked = await blockedOnTab(msg.tabId);
      const meta = await (await fetch(chrome.runtime.getURL('data/meta.json'))).json();
      const { lastApplyErrors = [], regexStatus } = await chrome.storage.local.get(['lastApplyErrors', 'regexStatus']);
      return {
        enabled: state.enabled,
        host,
        site: host ? siteKey(host) : '',
        siteAllowed: isAllowlisted(host, state.allowlist),
        blocked,
        builtAt: meta.builtAt,
        rules: meta.enabledStaticRules + (regexStatus?.added || 0),
        errors: lastApplyErrors,
      };
    }
    case 'popup:setEnabled':
      await setEnabled(msg.enabled);
      return { ok: true };
    case 'popup:setSiteAllowed':
      if (!msg.host) return { ok: false };
      await setSiteAllowed(msg.host, msg.allowed);
      return { ok: true };
    default:
      return { ok: false, error: `unknown message ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const work = (async () => {
    if (msg?.type?.startsWith('popup:')) {
      // Only this extension's own pages may change settings; content scripts
      // report the web page's URL here, so they can't pass this check.
      const fromOwnPage = sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL(''));
      if (!fromOwnPage) return { ok: false, error: 'not allowed' };
      return handlePopup(msg);
    }
    if (!sender.tab) return null;
    if (!(await filteringOn(sender))) return { generic: false };
    if (msg?.type === 'cosmetic:init') return handleInit(frameHost(sender), sender);
    if (msg?.type === 'cosmetic:tokens') {
      await handleTokens(frameHost(sender), msg, sender);
      return null;
    }
    return null;
  })();
  work.then(sendResponse, err => {
    console.error('Clearpane: message failed', err);
    sendResponse(null);
  });
  return true;
});
