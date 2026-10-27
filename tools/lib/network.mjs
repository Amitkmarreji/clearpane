// Converts ABP / uBO network filters into declarativeNetRequest rules.
// Covers the syntax used by EasyList, EasyPrivacy, uBO and Brave lists;
// anything DNR can't express is counted as skipped, not approximated.
import { domainToASCII } from 'node:url';

export const PRIORITY = {
  removeparam: 5,     // loses to any block or exception
  block: 10,
  redirect: 11,       // $redirect = block with a surrogate, so it must beat block
  allow: 20,          // @@ exceptions
  allowDocument: 25,  // @@...$document
  important: 30,      // $important beats exceptions
};

const TYPE_MAP = {
  script: ['script'], image: ['image'], stylesheet: ['stylesheet'], css: ['stylesheet'],
  object: ['object'], 'object-subrequest': ['object'], xmlhttprequest: ['xmlhttprequest'],
  xhr: ['xmlhttprequest'], subdocument: ['sub_frame'], frame: ['sub_frame'],
  ping: ['ping'], beacon: ['ping'], media: ['media'], font: ['font'],
  websocket: ['websocket'], other: ['other'],
  document: ['main_frame'], doc: ['main_frame'],
};
const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'media', 'websocket', 'other'];
const METHODS = new Set(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other']);

// Options that don't change what we generate.
const IGNORED_OPTIONS = new Set(['_', '__', 'reason', 'stealth', 'cookie', 'tag']);
// Options DNR can't express; a filter using one is skipped.
const UNSUPPORTED = new Set(['popup', 'popunder', 'csp', 'permissions', 'header', 'replace',
  'urlskip', 'uritransform', 'urltransform', 'cname', 'genericblock', 'inline-script',
  'inline-font', 'webrtc', 'ipaddress', 'redirect-rule', 'strict1p', 'strict3p', 'responseheader', 'mp4', 'rewrite']);
const COSMETIC_EXCEPTIONS = { elemhide: 'all', ehide: 'all', generichide: 'generic', ghide: 'generic',
  specifichide: 'specific', shide: 'specific' };

// uBO redirect resource names -> files shipped in redirects/.
export const REDIRECTS = {
  'noop.js': 'noop.js', noopjs: 'noop.js', 'noop.txt': 'noop.txt', nooptext: 'noop.txt',
  empty: 'noop.txt', 'noop.html': 'noop.html', noopframe: 'noop.html', 'noop.css': 'noop.css',
  'noop.json': 'noop.json', noopjson: 'noop.json', '1x1.gif': '1x1.gif', '1x1-transparent.gif': '1x1.gif',
  '2x2.png': '2x2.png', '2x2-transparent.png': '2x2.png', '3x2.png': '2x2.png', '32x32.png': '2x2.png',
  '32x32-transparent.png': '2x2.png', 'noop-0.1s.mp3': 'noop-0.1s.mp3', 'noopmp3-0.1s': 'noop-0.1s.mp3',
  'noop-0.5s.mp3': 'noop-0.1s.mp3', 'noop-1s.mp4': 'noop-1s.mp4', 'noopmp4-1s': 'noop-1s.mp4',
  'google-analytics_analytics.js': 'ga-analytics.js', 'google-analytics.com/analytics.js': 'ga-analytics.js',
  'googletagmanager_gtm.js': 'ga-analytics.js', 'googletagmanager.com/gtm.js': 'ga-analytics.js',
  'google-analytics_ga.js': 'ga-analytics.js', 'google-analytics.com/ga.js': 'ga-analytics.js',
  'googlesyndication_adsbygoogle.js': 'adsbygoogle.js', 'googlesyndication.com/adsbygoogle.js': 'adsbygoogle.js',
  'googletagservices_gpt.js': 'noop.js', 'doubleclick_instream_ad_status.js': 'noop.js',
  'amazon_apstag.js': 'noop.js', 'amazon_ads.js': 'noop.js',
};

function toAsciiDomain(d) {
  const lower = d.toLowerCase();
  if (/^[a-z0-9.-]+$/.test(lower)) return lower;
  const ascii = domainToASCII(lower);
  return ascii || null;
}

/** Splits a `domain=a.com|~b.com` value; entities (example.*) and regexes are dropped. */
function splitDomains(value) {
  const include = [];
  const exclude = [];
  let dropped = 0;
  for (let d of value.split('|')) {
    d = d.trim();
    const negated = d.startsWith('~');
    if (negated) d = d.slice(1);
    if (!d || d.endsWith('.*') || d.startsWith('/')) { dropped++; continue; }
    const ascii = toAsciiDomain(d);
    if (!ascii) { dropped++; continue; }
    (negated ? exclude : include).push(ascii);
  }
  return { include, exclude, dropped };
}

function findOptionsStart(text) {
  if (text.startsWith('/')) {
    const end = text.lastIndexOf('/$');
    return end > 0 ? end + 1 : -1;
  }
  return text.lastIndexOf('$');
}

/**
 * Parses one network filter line into a structured filter.
 * Returns { skip: reason } when it can't be represented.
 */
export function parseNetworkFilter(line) {
  let text = line;
  const exception = text.startsWith('@@');
  if (exception) text = text.slice(2);

  // hosts-file syntax: "0.0.0.0 example.com"
  const hosts = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+)$/i.exec(text);
  if (hosts) text = `||${hosts[1]}^`;

  let pattern = text;
  let optionText = '';
  const optStart = findOptionsStart(text);
  if (optStart >= 0) {
    const candidate = text.slice(optStart + 1);
    if (/^[\w~-]+(=|,|$)/.test(candidate)) {
      pattern = text.slice(0, optStart);
      optionText = candidate;
    }
  }

  const f = { exception, pattern, types: new Set(), excludedTypes: new Set(), cosmetic: null };
  for (const raw of optionText ? optionText.split(',') : []) {
    const eq = raw.indexOf('=');
    const name = (eq >= 0 ? raw.slice(0, eq) : raw).trim().toLowerCase();
    const value = eq >= 0 ? raw.slice(eq + 1) : '';
    const negated = name.startsWith('~');
    const bare = negated ? name.slice(1) : name;

    if (IGNORED_OPTIONS.has(bare)) continue;
    if (UNSUPPORTED.has(bare)) return { skip: bare };
    if (TYPE_MAP[bare]) {
      for (const t of TYPE_MAP[bare]) (negated ? f.excludedTypes : f.types).add(t);
      continue;
    }
    if (bare in COSMETIC_EXCEPTIONS) { f.cosmetic = COSMETIC_EXCEPTIONS[bare]; continue; }
    switch (bare) {
      case 'third-party': case '3p': f.party = negated ? 'firstParty' : 'thirdParty'; break;
      case 'first-party': case '1p': f.party = negated ? 'thirdParty' : 'firstParty'; break;
      case 'all': ALL_TYPES.forEach(t => f.types.add(t)); break;
      case 'important': f.important = true; break;
      case 'match-case': f.matchCase = true; break;
      case 'badfilter': f.badfilter = true; break;
      case 'domain': case 'from': f.domains = splitDomains(value); break;
      case 'to': f.to = splitDomains(value); break;
      case 'denyallow': f.denyallow = splitDomains(value); break;
      case 'method': f.methods = value.toLowerCase().split('|'); break;
      case 'redirect': f.redirect = value.split(':')[0]; break;
      case 'removeparam': f.removeparam = value; break;
      default: return { skip: `option:${bare}` };
    }
  }
  return f;
}

/** Turns a filter pattern into urlFilter / regexFilter / requestDomains. */
function convertPattern(pattern) {
  if (pattern === '' || pattern === '*' || pattern === '|' || pattern === '||') return {};
  const host = /^\|\|([a-z0-9.-]+\.[a-z0-9-]+)\^\|?$/i.exec(pattern);
  if (host) return { requestDomains: [host[1].toLowerCase()] };
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    const regex = pattern.slice(1, -1);
    // RE2 (used by DNR) has no lookaround or backreferences.
    // Chrome also rejects programs over its RE2 memory cap; that can't be
    // predicted here, so regex rules are checked with isRegexSupported() at
    // install time instead (see src/bg/regex-rules.js).
    if (/\(\?[=!<]|\\[1-9]/.test(regex) || regex.length > 300) return { skip: 'regex' };
    return { regexFilter: regex };
  }
  let p = pattern;
  if (/[^\x20-\x7e]/.test(p)) return { skip: 'non-ascii' };
  if (!p.startsWith('|')) p = p.replace(/^\*+/, '');
  if (!p.endsWith('|')) p = p.replace(/\*+$/, '');
  if (p.startsWith('||*')) p = p.slice(2);
  if (p === '' || p === '|' || p === '||') return {};
  return { urlFilter: p };
}

/** Builds a DNR rule (without id) from a parsed filter, or { skip }. */
export function filterToRule(f) {
  if (f.cosmetic) return { skip: 'cosmetic-exception' };
  const pat = convertPattern(f.pattern);
  if (pat.skip) return pat;

  const condition = {};
  if (pat.urlFilter) condition.urlFilter = pat.urlFilter;
  if (pat.regexFilter) condition.regexFilter = pat.regexFilter;
  if (pat.requestDomains) condition.requestDomains = pat.requestDomains;

  if (f.domains) {
    // If every positive domain was an entity we dropped, keeping the
    // exclusions alone would turn a site-specific filter into a global one.
    if (f.domains.include.length) condition.initiatorDomains = f.domains.include;
    else if (f.domains.dropped) return { skip: 'entity-domain' };
    if (f.domains.exclude.length) condition.excludedInitiatorDomains = f.domains.exclude;
  }
  if (f.to) {
    // requestDomains is an OR list, so it can't also carry the pattern's host.
    if (f.to.include.length && condition.requestDomains) return { skip: 'to-with-host' };
    if (f.to.include.length) condition.requestDomains = [...(condition.requestDomains || []), ...f.to.include];
    else if (f.to.dropped) return { skip: 'entity-domain' };
    if (f.to.exclude.length) condition.excludedRequestDomains = f.to.exclude;
  }
  if (f.denyallow?.include.length) {
    condition.excludedRequestDomains = [...(condition.excludedRequestDomains || []), ...f.denyallow.include];
  }
  if (f.methods) {
    const inc = f.methods.filter(m => !m.startsWith('~') && METHODS.has(m));
    const exc = f.methods.filter(m => m.startsWith('~')).map(m => m.slice(1)).filter(m => METHODS.has(m));
    if (inc.length) condition.requestMethods = inc;
    if (exc.length) condition.excludedRequestMethods = exc;
  }
  if (f.party) condition.domainType = f.party;
  if (f.matchCase) condition.isUrlFilterCaseSensitive = true;

  if (f.types.size) {
    condition.resourceTypes = [...f.types];
  } else if (f.excludedTypes.size) {
    condition.excludedResourceTypes = [...f.excludedTypes];
  }

  const broad = !condition.urlFilter && !condition.regexFilter && !condition.requestDomains
    && !condition.initiatorDomains;
  let action;
  let priority;
  if (f.exception) {
    if (f.removeparam !== undefined) return { skip: 'removeparam-exception' };
    const docOnly = f.types.has('main_frame') && [...f.types].every(t => t === 'main_frame' || t === 'sub_frame');
    if (docOnly) {
      action = { type: 'allowAllRequests' };
      priority = PRIORITY.allowDocument;
    } else {
      action = { type: 'allow' };
      priority = PRIORITY.allow;
    }
    if (broad) return { skip: 'too-broad' };
  } else if (f.removeparam !== undefined) {
    const name = f.removeparam;
    if (!name || name.startsWith('/') || name.startsWith('~') || /[|=]/.test(name)) return { skip: 'removeparam-complex' };
    action = { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: [name] } } } };
    priority = PRIORITY.removeparam;
    if (!condition.resourceTypes) condition.resourceTypes = ['main_frame', 'sub_frame', 'xmlhttprequest'];
  } else {
    if (broad) return { skip: 'too-broad' };
    const file = f.redirect !== undefined ? REDIRECTS[f.redirect] : undefined;
    if (file) {
      action = { type: 'redirect', redirect: { extensionPath: `/redirects/${file}` } };
      priority = f.important ? PRIORITY.important : PRIORITY.redirect;
    } else {
      action = { type: 'block' };
      priority = f.important ? PRIORITY.important : PRIORITY.block;
    }
  }
  return { rule: { priority, action, condition } };
}

/** Kind used for id ordering and the blocked-request counter. */
export function ruleKind(rule) {
  const t = rule.action.type;
  if (t === 'block') return 'block';
  if (t === 'redirect') return rule.action.redirect.extensionPath ? 'block' : 'modify';
  return 'allow';
}

/**
 * Merges rules that differ only in requestDomains (the `||host^` case),
 * which is how uBO Lite keeps big host lists under the static rule limit.
 */
export function mergeHostRules(rules) {
  const merged = new Map();
  const rest = [];
  for (const rule of rules) {
    const c = rule.condition;
    if (!c.requestDomains || c.urlFilter || c.regexFilter) { rest.push(rule); continue; }
    const { requestDomains, ...others } = c;
    const key = JSON.stringify([rule.priority, rule.action, others]);
    const entry = merged.get(key);
    if (entry) requestDomains.forEach(d => entry.domains.add(d));
    else merged.set(key, { rule, others, domains: new Set(requestDomains) });
  }
  for (const { rule, others, domains } of merged.values()) {
    rest.push({ priority: rule.priority, action: rule.action, condition: { ...others, requestDomains: [...domains].sort() } });
  }
  return rest;
}
