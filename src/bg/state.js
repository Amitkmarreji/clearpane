// Settings (global on/off and the per-site allowlist) and applying them to
// the declarativeNetRequest rulesets, dynamic rules and scriptlet scripts.
import { siteKey, hostAndParents } from '../shared/hosts.js';
import { applyRegexRules } from './regex-rules.js';

const DEFAULTS = { enabled: true, allowlist: [] };
const ALLOWLIST_RULE_ID = 1;
// Beats every list rule, including $important (priority 30).
const ALLOWLIST_PRIORITY = 1000;
const SCRIPTLET_PREFIX = 'scriptlets-';

let cached = null;

export async function getState() {
  if (!cached) {
    const stored = await chrome.storage.local.get(['enabled', 'allowlist']);
    cached = { ...DEFAULTS, ...stored };
  }
  return cached;
}

async function saveState(next) {
  cached = next;
  await chrome.storage.local.set({ enabled: next.enabled, allowlist: next.allowlist });
  await applyState(next);
  return next;
}

export async function setEnabled(enabled) {
  return saveState({ ...(await getState()), enabled: Boolean(enabled) });
}

export async function setSiteAllowed(host, allowed) {
  const state = await getState();
  const site = siteKey(host);
  // Turning blocking back on must also drop a parent-domain entry that covers this host.
  const covering = new Set([site, ...hostAndParents(host)]);
  const others = state.allowlist.filter(s => allowed ? s !== site : !covering.has(s));
  const allowlist = allowed ? [...others, site].sort() : others;
  return saveState({ ...state, allowlist });
}

let manifestRulesets = null;
function defaultRulesetIds() {
  manifestRulesets ??= chrome.runtime.getManifest().declarative_net_request.rule_resources;
  return {
    on: manifestRulesets.filter(r => r.enabled).map(r => r.id),
    all: manifestRulesets.map(r => r.id),
  };
}

async function applyRulesets(state) {
  const { on, all } = defaultRulesetIds();
  if (state.enabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: on });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: all });
  }
}

async function applyAllowlist(state) {
  const addRules = state.allowlist.length ? [{
    id: ALLOWLIST_RULE_ID,
    priority: ALLOWLIST_PRIORITY,
    action: { type: 'allowAllRequests' },
    condition: { requestDomains: state.allowlist, resourceTypes: ['main_frame', 'sub_frame'] },
  }] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ALLOWLIST_RULE_ID], addRules });
}

async function applyScriptlets(state) {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ids = registered.map(s => s.id).filter(id => id.startsWith(SCRIPTLET_PREFIX));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  if (!state.enabled) return;
  const res = await fetch(chrome.runtime.getURL('data/scriptlets.json'));
  const shards = await res.json();
  const excludeMatches = state.allowlist.flatMap(site => [`*://${site}/*`, `*://*.${site}/*`]);
  await chrome.scripting.registerContentScripts(shards.map(shard => ({
    id: shard.id,
    js: shard.js,
    matches: shard.matches,
    excludeMatches,
    runAt: 'document_start',
    world: 'MAIN',
    allFrames: true,
    persistAcrossSessions: true,
  })));
}

/** Pushes the state into Chrome. Each part is independent, so one failure doesn't block the others. */
export async function applyState(state) {
  const parts = {
    rulesets: applyRulesets,
    regex: s => applyRegexRules(s.enabled),
    allowlist: applyAllowlist,
    scriptlets: applyScriptlets,
  };
  const errors = [];
  for (const [name, fn] of Object.entries(parts)) {
    try {
      await fn(state);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      console.error(`Clearpane: applying ${name} failed`, err);
    }
  }
  return errors;
}
