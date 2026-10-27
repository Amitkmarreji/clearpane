// Collects element-hiding (cosmetic) filters and scriptlet filters into the
// lookup tables used at runtime, following adblock-rust's split between
// class/id-keyed generic selectors, always-on generic selectors and
// hostname-specific selectors.
import { domainToASCII } from 'node:url';
import { canonicalScriptlet } from './scriptlet-names.mjs';

// uBO / AdGuard procedural operators that plain CSS can't express.
const PROCEDURAL = /:(has-text|upward|xpath|matches-css|matches-css-before|matches-css-after|min-text-length|watch-attr|others|matches-path|matches-attr|matches-prop|matches-media|nth-ancestor|spath|remove-attr|remove-class|contains|-abp-|if|if-not|shadow)\(/;
const TOKEN = /^([.#])((?:[\w-]|\\[^0-9a-fA-F\s])+)(?=$|[\s.#[:>+~])/;

export class CosmeticCollector {
  constructor() {
    this.genericHide = new Set();
    this.genericExceptions = new Set();
    this.specific = new Map();          // host -> Set(selector)
    this.styles = new Map();            // host -> Map(selector -> declarations)
    this.exceptions = new Map();        // host -> Set(selector)
    this.scriptlets = new Map();        // host -> Map(key -> [name, ...args])
    this.scriptletExceptions = new Map(); // host -> Set(key | '*')
    this.disabled = { all: new Set(), generic: new Set(), specific: new Set() };
    this.skipped = {};
  }

  skip(reason) { this.skipped[reason] = (this.skipped[reason] || 0) + 1; }

  /** Returns true if the line was a cosmetic/scriptlet filter (handled or skipped). */
  add(line) {
    const m = /^([^#]*?)(#@?[$?%]?#[@^+]?)(.*)$/.exec(line);
    if (!m || m[3] === '' || line.startsWith('||') || line.startsWith('@@')) return false;
    const [, domainPart, sep, body] = m;
    if (sep.includes('$') || sep.includes('?') || sep.includes('%') || sep.endsWith('^')) {
      this.skip('adguard/abp-extended or html filter');
      return true;
    }
    const exception = sep.startsWith('#@');
    const domains = parseDomains(domainPart);
    if (!domains) { this.skip('bad-domain'); return true; }
    if (sep.endsWith('+')) {
      this.addScriptlet(domains, body, exception);
      return true;
    }
    this.addHide(domains, body.trim(), exception);
    return true;
  }

  addHide(domains, rawSelector, exception) {
    let selector = rawSelector;
    let style = null;
    const styleMatch = /^(.*?):style\((.+)\)$/.exec(selector);
    if (styleMatch) {
      [, selector, style] = styleMatch;
      if (/url\(|[{}]|\\/i.test(style)) { this.skip('unsafe-style'); return; }
    }
    if (selector.endsWith(':remove()')) selector = selector.slice(0, -9);
    if (!selector || /[{}]/.test(selector)) { this.skip('bad-selector'); return; }
    if (PROCEDURAL.test(selector)) { this.skip('procedural'); return; }

    const { include, exclude } = domains;
    if (exception) {
      if (!include.length) this.genericExceptions.add(selector);
      for (const host of include) addTo(this.exceptions, host, selector);
      return;
    }
    if (style) {
      if (!include.length) { this.skip('generic-style'); return; }
      for (const host of include) mapTo(this.styles, host).set(selector, style);
      for (const host of exclude) addTo(this.exceptions, host, selector);
      return;
    }
    if (!include.length) this.genericHide.add(selector);
    for (const host of include) addTo(this.specific, host, selector);
    for (const host of exclude) addTo(this.exceptions, host, selector);
  }

  addScriptlet(domains, body, exception) {
    const inner = /^js\((.*)\)$/.exec(body.trim());
    if (!inner) { this.skip('not-js-scriptlet'); return; }
    const args = splitArgs(inner[1]);
    const { include, exclude } = domains;
    if (exception) {
      const key = args.length && args[0] ? scriptletKey(args) : '*';
      for (const host of include) addTo(this.scriptletExceptions, host, key);
      return;
    }
    const name = canonicalScriptlet(args[0]);
    if (!name) { this.skip(`scriptlet:${args[0]}`); return; }
    if (!include.length) { this.skip('generic-scriptlet'); return; }
    const call = [name, ...args.slice(1)];
    const key = scriptletKey(call);
    for (const host of include) mapTo(this.scriptlets, host).set(key, call);
    for (const host of exclude) addTo(this.scriptletExceptions, host, key);
  }

  /** `@@||host^$elemhide|generichide|specifichide` from the network lists. */
  addDisabled(kind, pattern) {
    const host = /^\|\|([a-z0-9.-]+)\^?$/i.exec(pattern);
    if (!host) { this.skip('cosmetic-exception-pattern'); return; }
    this.disabled[kind].add(host[1].toLowerCase());
  }

  /** Builds the JSON tables shipped with the extension. */
  finish() {
    const classes = {};
    const ids = {};
    const misc = [];
    for (const sel of this.genericHide) {
      if (this.genericExceptions.has(sel)) continue;
      const t = TOKEN.exec(sel);
      if (!t || sel.includes(',')) { misc.push(sel); continue; }
      const name = t[2].replace(/\\(.)/g, '$1');
      (t[1] === '.' ? classes : ids)[name] ??= [];
      (t[1] === '.' ? classes : ids)[name].push(sel);
    }
    const scriptlets = {};
    for (const [host, calls] of this.scriptlets) scriptlets[host] = [...calls.values()];
    return {
      cosmetic: {
        generic: { classes, ids, misc },
        specific: setMapToObject(this.specific),
        styles: Object.fromEntries([...this.styles].map(([h, m]) => [h, [...m]])),
        exceptions: setMapToObject(this.exceptions),
        disabled: Object.fromEntries(Object.entries(this.disabled).map(([k, s]) => [k, [...s].sort()])),
      },
      scriptlets,
      scriptletExceptions: setMapToObject(this.scriptletExceptions),
      stats: {
        genericKeyed: Object.keys(classes).length + Object.keys(ids).length,
        genericMisc: misc.length,
        specificHosts: this.specific.size,
        scriptletHosts: this.scriptlets.size,
        skipped: this.skipped,
      },
    };
  }
}

function parseDomains(text) {
  const include = [];
  const exclude = [];
  for (let d of text.split(',')) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    const negated = d.startsWith('~');
    if (negated) d = d.slice(1);
    if (d.startsWith('/')) return null; // regex hostnames aren't supported
    const ascii = /^[a-z0-9.*-]+$/.test(d) ? d : domainToASCII(d);
    if (!ascii) return null;
    (negated ? exclude : include).push(ascii);
  }
  return { include, exclude };
}

/** Splits scriptlet arguments on unescaped commas, removing wrapping quotes. */
export function splitArgs(text) {
  const args = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === ',') { cur += ','; i++; continue; }
    if (ch === ',') { args.push(cur); cur = ''; continue; }
    cur += ch;
  }
  args.push(cur);
  return args.map(a => {
    const t = a.trim();
    const q = t[0];
    if ((q === '"' || q === "'" || q === '`') && t.length > 1 && t.endsWith(q)) return t.slice(1, -1);
    return t;
  });
}

function scriptletKey(call) {
  const name = canonicalScriptlet(call[0]) || call[0];
  return JSON.stringify([name, ...call.slice(1)]);
}

function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function mapTo(map, key) {
  if (!map.has(key)) map.set(key, new Map());
  return map.get(key);
}

function setMapToObject(map) {
  const out = {};
  for (const [k, s] of map) out[k] = [...s];
  return out;
}
