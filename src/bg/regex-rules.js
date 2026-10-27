// Regex filters are added as dynamic rules after Chrome confirms it can
// compile each one (isRegexSupported). Chrome caps RE2 programs at a size
// that can't be predicted at build time, and an unsupported regex in a static
// ruleset would make the whole extension fail to load.

export const REGEX_ID_BASE = 100_000;
const MAX_DYNAMIC_REGEX = 1000;

async function loadRegexRules() {
  const res = await fetch(chrome.runtime.getURL('data/regex-rules.json'));
  return res.json();
}

async function supported(rule) {
  try {
    const r = await chrome.declarativeNetRequest.isRegexSupported({
      regex: rule.condition.regexFilter,
      isCaseSensitive: Boolean(rule.condition.isUrlFilterCaseSensitive),
    });
    return r.isSupported;
  } catch {
    return false;
  }
}

/** Replaces the dynamic regex rules; returns how many were usable. */
export async function applyRegexRules(enabled) {
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = current.map(r => r.id).filter(id => id > REGEX_ID_BASE);
  if (!enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    return { added: 0, rejected: 0 };
  }
  const rules = await loadRegexRules();
  const verdicts = await Promise.all(rules.map(supported));
  // Ids keep the build's position (index + 1), so the counter can tell
  // block rules (index < lastBlockIndex) from exceptions.
  const addRules = rules
    .map((rule, i) => ({ id: REGEX_ID_BASE + i + 1, ...rule }))
    .filter((_, i) => verdicts[i])
    .slice(0, MAX_DYNAMIC_REGEX);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  await chrome.storage.local.set({ regexStatus: { added: addRules.length, rejected: rules.length - addRules.length } });
  return { added: addRules.length, rejected: rules.length - addRules.length };
}
