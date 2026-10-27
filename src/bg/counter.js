// Blocked-request count for the popup. The toolbar badge is Chrome's own
// per-tab action count (setExtensionActionOptions). The popup's number comes
// from getMatchedRules(), which the activeTab grant from opening the popup
// allows without the "read your browsing history" feedback permission.
// tools/build.mjs numbers each ruleset's rules block-first, so a rule id at
// or below lastBlockId is a block or surrogate redirect, not an exception.
import { REGEX_ID_BASE } from './regex-rules.js';

const DYNAMIC = '_dynamic';
let lastBlockIds = null;

async function blockLimits() {
  if (!lastBlockIds) {
    const meta = await (await fetch(chrome.runtime.getURL('data/meta.json'))).json();
    lastBlockIds = Object.fromEntries(Object.entries(meta.rulesets).map(([id, r]) => [id, r.lastBlockId]));
    lastBlockIds[DYNAMIC] = REGEX_ID_BASE + meta.regex.lastBlockIndex;
  }
  return lastBlockIds;
}

// Dynamic rules: id 1 is the user allowlist, ids above REGEX_ID_BASE are list regexes.
function isBlockRule(limits, rulesetId, ruleId) {
  if (!(rulesetId in limits) || ruleId > limits[rulesetId]) return false;
  return rulesetId !== DYNAMIC || ruleId > REGEX_ID_BASE;
}

export function showBadgeCounts() {
  return chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
}

/** Requests blocked on the tab's current page, or null if Chrome won't say. */
export async function blockedOnTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  try {
    const [limits, { rulesMatchedInfo }] = await Promise.all([
      blockLimits(),
      chrome.declarativeNetRequest.getMatchedRules({ tabId }),
    ]);
    return rulesMatchedInfo.filter(m => isBlockRule(limits, m.rule.rulesetId, m.rule.ruleId)).length;
  } catch {
    // No activeTab grant for this tab (e.g. a chrome:// page) or the call quota was hit.
    return null;
  }
}
