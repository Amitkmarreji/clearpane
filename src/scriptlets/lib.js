// Scriptlet library, run in the page's MAIN world at document_start.
// These are small, original implementations of the most-used uBO scriptlets,
// written from uBO's public documentation (github.com/gorhill/uBlock/wiki).
// tools/lib/scriptlet-shards.mjs wraps this file and a data shard in an IIFE.
/* exported runShard */
function runShard(data) {
  'use strict';
  const MAGIC = `sl${Math.random().toString(36).slice(2)}`;
  const win = window;
  const noop = () => {};
  const { defineProperty, getOwnPropertyDescriptor } = Object;

  // ---- helpers -----------------------------------------------------------
  function toMatcher(pattern) {
    let p = pattern || '';
    let negate = false;
    if (p.startsWith('!')) { negate = true; p = p.slice(1); }
    let test;
    if (p === '') test = () => true;
    else {
      const re = /^\/(.+)\/([gimsu]*)$/.exec(p);
      if (re) {
        let regex;
        try { regex = new RegExp(re[1], re[2]); } catch { regex = null; }
        test = s => regex !== null && regex.test(s);
      } else test = s => s.includes(p);
    }
    return s => test(String(s)) !== negate;
  }

  function parseConstant(raw, trusted) {
    const table = {
      undefined: undefined, false: false, true: true, null: null, '': '', "''": '',
      noopFunc: noop, trueFunc: () => true, falseFunc: () => false,
      throwFunc: () => { throw new Error(MAGIC); }, noopCallbackFunc: () => noop,
      emptyArr: [], '[]': [], emptyObj: {}, '{}': {}, NaN: NaN, Infinity: Infinity,
      yes: 'yes', no: 'no', on: 'on', off: 'off', accept: 'accept', reject: 'reject',
    };
    if (Object.prototype.hasOwnProperty.call(table, raw)) {
      const v = table[raw];
      return Array.isArray(v) ? [] : (v && typeof v === 'object' ? {} : v);
    }
    if (/^-?\d+$/.test(raw) && Math.abs(Number(raw)) <= 0x7fff) return Number(raw);
    if (trusted) return raw;
    return MAGIC; // not an allowed value
  }

  // Walks `a.b.c`, waiting for missing links to be assigned, then calls
  // onLeaf(owner, prop) once the owner of the last property exists.
  function trapChain(chain, onLeaf, owner = win) {
    const dot = chain.indexOf('.');
    if (dot === -1) { onLeaf(owner, chain); return; }
    const prop = chain.slice(0, dot);
    const rest = chain.slice(dot + 1);
    const current = owner[prop];
    if (current !== null && (typeof current === 'object' || typeof current === 'function')) {
      trapChain(rest, onLeaf, current);
      return;
    }
    const desc = getOwnPropertyDescriptor(owner, prop);
    if (desc && !desc.configurable) return;
    let value = current;
    defineProperty(owner, prop, {
      configurable: true,
      get() { return value; },
      set(v) {
        value = v;
        if (v !== null && (typeof v === 'object' || typeof v === 'function')) trapChain(rest, onLeaf, v);
      },
    });
  }

  // Finds a property's descriptor on the object or its prototypes, so that
  // accessors such as document.cookie keep working through our wrapper.
  function findDescriptor(owner, prop) {
    for (let o = owner; o; o = Object.getPrototypeOf(o)) {
      const d = getOwnPropertyDescriptor(o, prop);
      if (d) return d;
    }
    return undefined;
  }

  // Wraps owner[prop] so check() runs on every read and write.
  function guardProperty(owner, prop, check, { blockWrites = false } = {}) {
    const own = getOwnPropertyDescriptor(owner, prop);
    if (own && !own.configurable) return;
    const desc = findDescriptor(owner, prop);
    let value = desc && 'value' in desc ? desc.value : undefined;
    defineProperty(owner, prop, {
      configurable: true,
      get() { check(); return desc?.get ? desc.get.call(this) : value; },
      set(v) {
        if (blockWrites) throw abortError();
        check();
        if (desc?.set) desc.set.call(this, v); else value = v;
      },
    });
  }

  function abortError() { return new ReferenceError(MAGIC); }
  win.addEventListener('error', e => {
    if (String(e.message).includes(MAGIC)) e.preventDefault();
  }, true);

  function onDom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function observe(fn, timeoutMs = 0) {
    onDom(fn);
    const mo = new MutationObserver(() => fn());
    const start = () => mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    if (document.documentElement) start(); else onDom(start);
    if (timeoutMs) setTimeout(() => mo.disconnect(), timeoutMs);
    return mo;
  }

  function delayMatches(delayArg, actual) {
    if (delayArg === undefined || delayArg === '') return true;
    const neg = delayArg.startsWith('!');
    const n = Number(neg ? delayArg.slice(1) : delayArg);
    if (Number.isNaN(n)) return true;
    return (Number(actual) === n) !== neg;
  }

  function cookieExpiry(offset) {
    if (!offset) return '';
    const units = { '1day': 86400, '1year': 31536000 };
    const secs = units[offset] ?? Number(offset);
    if (!Number.isFinite(secs)) return '';
    return `; expires=${new Date(Date.now() + secs * 1000).toUTCString()}`;
  }

  function expandDynamic(value) {
    return value.replace('$now$', String(Date.now()))
      .replace('$currentDate$', new Date().toUTCString())
      .replace('$currentISODate$', new Date().toISOString());
  }

  function pruneJson(obj, paths) {
    const prunePath = (target, parts) => {
      if (target === null || typeof target !== 'object') return;
      const [head, ...rest] = parts;
      const keys = head === '[]' || head === '*' ? Object.keys(target) : [head];
      for (const key of keys) {
        if (!(key in target)) continue;
        if (rest.length === 0) delete target[key];
        else prunePath(target[key], rest);
      }
    };
    for (const path of paths) prunePath(obj, path.split('.'));
  }

  function hasPath(obj, path) {
    let cur = obj;
    for (const part of path.split('.')) {
      if (cur === null || typeof cur !== 'object' || !(part in cur)) return false;
      cur = cur[part];
    }
    return true;
  }

  // ---- scriptlets --------------------------------------------------------
  const S = {
    'set-constant'(chain, raw) {
      const value = parseConstant(raw, false);
      if (value === MAGIC) return;
      trapChain(chain, (owner, prop) => {
        const desc = getOwnPropertyDescriptor(owner, prop);
        if (desc && !desc.configurable) return;
        defineProperty(owner, prop, { configurable: false, get: () => value, set: noop });
      });
    },
    'abort-on-property-read'(chain) {
      trapChain(chain, (owner, prop) => {
        defineProperty(owner, prop, { configurable: true, get() { throw abortError(); }, set: noop });
      });
    },
    'abort-on-property-write'(chain) {
      trapChain(chain, (owner, prop) => guardProperty(owner, prop, noop, { blockWrites: true }));
    },
    'abort-current-script'(chain, needle = '', context = '') {
      const matchText = toMatcher(needle);
      const matchCtx = toMatcher(context);
      const check = () => {
        const s = document.currentScript;
        if (!(s instanceof HTMLScriptElement)) return;
        const text = s.src || s.textContent;
        if (matchText(text) && matchCtx(s.src || text)) throw abortError();
      };
      trapChain(chain, (owner, prop) => guardProperty(owner, prop, check));
    },
    'abort-on-stack-trace'(chain, needle = '') {
      const match = toMatcher(needle);
      const check = () => { if (match(new Error().stack || '')) throw abortError(); };
      trapChain(chain, (owner, prop) => guardProperty(owner, prop, check));
    },
    'no-setTimeout-if'(needle, delay) { wrapTimer('setTimeout', needle, delay); },
    'no-setInterval-if'(needle, delay) { wrapTimer('setInterval', needle, delay); },
    'nano-setTimeout-booster'(needle, delay, boost) { boostTimer('setTimeout', needle, delay, boost); },
    'nano-setInterval-booster'(needle, delay, boost) { boostTimer('setInterval', needle, delay, boost); },
    'no-requestAnimationFrame-if'(needle) {
      const match = toMatcher(needle);
      const orig = win.requestAnimationFrame;
      win.requestAnimationFrame = new Proxy(orig, {
        apply(target, self, args) {
          if (match(args[0])) return Reflect.apply(target, self, [noop]);
          return Reflect.apply(target, self, args);
        },
      });
    },
    'window.open-defuser'(pattern = '') {
      const legacy = { 0: '!', 1: '' };
      const match = toMatcher(pattern in legacy ? legacy[pattern] : pattern);
      win.open = new Proxy(win.open, {
        apply(target, self, args) {
          if (!match(args[0] ?? '')) return Reflect.apply(target, self, args);
          return { closed: false, close: noop, focus: noop, blur: noop, postMessage: noop, document: null, location: {} };
        },
      });
    },
    'addEventListener-defuser'(type = '', handler = '') {
      const matchType = toMatcher(type);
      const matchHandler = toMatcher(handler);
      const proto = EventTarget.prototype;
      proto.addEventListener = new Proxy(proto.addEventListener, {
        apply(target, self, args) {
          let text = '';
          try { text = String(args[1]); } catch { /* exotic handler */ }
          if (matchType(args[0]) && matchHandler(text)) return undefined;
          return Reflect.apply(target, self, args);
        },
      });
    },
    'no-fetch-if'(props = '') {
      const tests = propertyTests(props);
      if (!tests) return;
      win.fetch = new Proxy(win.fetch, {
        apply(target, self, args) {
          const [input, init] = args;
          const details = { url: typeof input === 'string' ? input : input?.url || String(input), method: init?.method || input?.method || 'GET' };
          if (tests(details)) return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
          return Reflect.apply(target, self, args);
        },
      });
    },
    'no-xhr-if'(props = '') {
      const tests = propertyTests(props);
      if (!tests) return;
      const XHR = win.XMLHttpRequest.prototype;
      const blocked = new WeakSet();
      XHR.open = new Proxy(XHR.open, {
        apply(target, self, args) {
          if (tests({ method: args[0], url: String(args[1]) })) blocked.add(self);
          return Reflect.apply(target, self, args);
        },
      });
      XHR.send = new Proxy(XHR.send, {
        apply(target, self, args) {
          if (!blocked.has(self)) return Reflect.apply(target, self, args);
          for (const [k, v] of [['readyState', 4], ['status', 200], ['statusText', 'OK'], ['response', ''], ['responseText', '']]) {
            defineProperty(self, k, { value: v, configurable: true });
          }
          setTimeout(() => {
            for (const type of ['readystatechange', 'load', 'loadend']) self.dispatchEvent(new Event(type));
          }, 1);
          return undefined;
        },
      });
    },
    'noeval-if'(needle = '') {
      const match = toMatcher(needle);
      win.eval = new Proxy(win.eval, {
        apply(target, self, args) {
          if (match(args[0])) return undefined;
          return Reflect.apply(target, self, args);
        },
      });
    },
    'noeval'() { win.eval = new Proxy(win.eval, { apply: () => undefined }); },
    'json-prune'(remove = '', required = '') {
      const removePaths = remove.split(/\s+/).filter(Boolean);
      const requiredPaths = required.split(/\s+/).filter(Boolean);
      if (!removePaths.length) return;
      const prune = obj => {
        if (requiredPaths.every(p => hasPath(obj, p))) pruneJson(obj, removePaths);
        return obj;
      };
      JSON.parse = new Proxy(JSON.parse, {
        apply(target, self, args) { return prune(Reflect.apply(target, self, args)); },
      });
      Response.prototype.json = new Proxy(Response.prototype.json, {
        apply(target, self, args) { return Reflect.apply(target, self, args).then(prune); },
      });
    },
    'remove-node-text'(nodeName = '', needle = '', ...extra) {
      const name = nodeName.toLowerCase();
      const match = toMatcher(needle);
      // Optional key/value pairs narrow the match: includes/condition, excludes.
      const conditions = [match];
      for (let i = 0; i + 1 < extra.length; i += 2) {
        const [key, value] = [extra[i], extra[i + 1]];
        if (key === 'includes' || key === 'condition') conditions.push(toMatcher(value));
        else if (key === 'excludes') { const m = toMatcher(value); conditions.push(s => !m(s)); }
        else if (key !== 'stay') return; // unknown option: do nothing rather than over-remove
      }
      const scan = () => {
        const walker = document.createTreeWalker(document.documentElement || document, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.nodeName.toLowerCase() !== name || n.textContent === '') continue;
          const text = n.textContent;
          if (conditions.every(test => test(text))) n.textContent = '';
        }
      };
      observe(scan, 20000);
    },
    'remove-attr'(attrs = '', selector = '') {
      const list = attrs.split('|').map(a => a.trim()).filter(Boolean);
      const sel = selector || list.map(a => `[${CSS.escape(a)}]`).join(',');
      observe(() => {
        try { document.querySelectorAll(sel).forEach(el => list.forEach(a => el.removeAttribute(a))); } catch { /* bad selector */ }
      }, 20000);
    },
    'remove-class'(classes = '', selector = '') {
      const list = classes.split('|').map(c => c.trim()).filter(Boolean);
      const sel = selector || list.map(c => `.${CSS.escape(c)}`).join(',');
      observe(() => {
        // Only touch elements that still have a class: classList.remove() always
        // queues a mutation, which would re-trigger this observer forever.
        try {
          document.querySelectorAll(sel).forEach(el => {
            const present = list.filter(c => el.classList.contains(c));
            if (present.length) el.classList.remove(...present);
          });
        } catch { /* bad selector */ }
      }, 20000);
    },
    'set-cookie'(name, value, path = '/') {
      const v = parseConstant(value, false);
      if (v === MAGIC || !name) return;
      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(String(v))}; path=${path || '/'}`;
    },
    'trusted-set-cookie'(name, value = '', offset = '', path = '/') {
      if (!name) return;
      document.cookie = `${name}=${expandDynamic(value)}${cookieExpiry(offset)}; path=${path || '/'}`;
    },
    'remove-cookie'(needle = '') {
      const match = toMatcher(needle);
      const remove = () => {
        for (const part of document.cookie.split(';')) {
          const name = part.split('=')[0].trim();
          if (!name || !match(name)) continue;
          const host = location.hostname;
          for (const domain of ['', `; domain=${host}`, `; domain=.${host}`]) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
          }
        }
      };
      remove();
      win.addEventListener('beforeunload', remove);
    },
    'set-local-storage-item'(key, value) { setStorage(win.localStorage, key, value, false); },
    'trusted-set-local-storage-item'(key, value) { setStorage(win.localStorage, key, value, true); },
    'set-session-storage-item'(key, value) { setStorage(win.sessionStorage, key, value, false); },
    'trusted-click-element'(selectors = '', extraMatch = '', delay = '') {
      if (extraMatch && !extraMatchOk(extraMatch)) return;
      const queue = selectors.split(/\s*,\s+/).filter(Boolean);
      const wait = Math.max(0, Number(delay) || 0);
      const deadline = Date.now() + 10000;
      let mo = null;
      const step = () => {
        if (!queue.length || Date.now() > deadline) { mo?.disconnect(); return; }
        let el = null;
        try { el = document.querySelector(queue[0]); } catch { queue.shift(); }
        if (!el) return;
        queue.shift();
        setTimeout(() => { el.click(); step(); }, wait);
      };
      mo = observe(step, 10000);
    },
    'nowebrtc'() {
      class FakePeer {
        close() {}
        createDataChannel() { return { close: noop }; }
        createOffer() { return Promise.resolve({}); }
        setLocalDescription() { return Promise.resolve(); }
        setRemoteDescription() { return Promise.resolve(); }
        addEventListener() {}
        removeEventListener() {}
      }
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
        if (win[name]) win[name] = FakePeer;
      }
    },
  };

  function wrapTimer(name, needle = '', delay) {
    const match = toMatcher(needle);
    win[name] = new Proxy(win[name], {
      apply(target, self, args) {
        const [fn, ms] = args;
        if (match(String(fn)) && delayMatches(delay, ms)) return Reflect.apply(target, self, [noop, ms]);
        return Reflect.apply(target, self, args);
      },
    });
  }

  function boostTimer(name, needle = '', delay = '1000', boost = '0.05') {
    const match = toMatcher(needle);
    const wanted = Number(delay) || 1000;
    const factor = Math.min(Math.max(Number(boost) || 0.05, 0.001), 50);
    win[name] = new Proxy(win[name], {
      apply(target, self, args) {
        if (match(String(args[0])) && Number(args[1]) === wanted) args[1] = wanted * factor;
        return Reflect.apply(target, self, args);
      },
    });
  }

  // "ads" or "url:/x/ method:POST" -> predicate over { url, method }
  function propertyTests(props) {
    if (props === '') return null;
    const tests = [];
    for (const part of props.split(/\s+/).filter(Boolean)) {
      const m = /^(\w+):(.*)$/.exec(part);
      const [key, val] = m ? [m[1], m[2]] : ['url', part];
      const match = toMatcher(val);
      tests.push(d => d[key] !== undefined && match(d[key]));
    }
    return d => tests.every(t => t(d));
  }

  function setStorage(storage, key, value, trusted) {
    if (!key) return;
    try {
      if (value === '$remove$') { storage.removeItem(key); return; }
      const v = trusted ? expandDynamic(value) : parseConstant(value, false);
      if (v === MAGIC) return;
      storage.setItem(key, String(v === undefined ? 'undefined' : v));
    } catch { /* storage blocked */ }
  }

  function extraMatchOk(spec) {
    return spec.split(/\s*,\s*/).every(cond => {
      const neg = cond.startsWith('!');
      const [kind, name] = (neg ? cond.slice(1) : cond).split(':');
      let present = true;
      if (kind === 'cookie') present = document.cookie.split(';').some(c => c.trim().startsWith(`${name}=`));
      else if (kind === 'localStorageItem') present = win.localStorage.getItem(name) !== null;
      return present !== neg;
    });
  }

  // ---- dispatch ----------------------------------------------------------
  const host = location.hostname || (() => { try { return win.top.location.hostname; } catch { return ''; } })();
  if (!host) return;
  const labels = host.split('.');
  const keys = [];
  for (let i = 0; i < labels.length; i++) {
    keys.push(labels.slice(i).join('.'));
    for (const k of [1, 2]) {
      if (labels.length - i - k >= 1) keys.push(`${labels.slice(i, labels.length - k).join('.')}.*`);
    }
  }
  const exceptions = new Set();
  const own = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : []);
  for (const key of keys) for (const e of own(data.e, key)) exceptions.add(e);
  if (exceptions.has('*')) return;
  const done = new Set();
  for (const key of keys) {
    for (const call of own(data.s, key)) {
      const id = JSON.stringify(call);
      if (done.has(id) || exceptions.has(id)) continue;
      done.add(id);
      try { S[call[0]]?.(...call.slice(1)); } catch { /* one broken scriptlet must not stop the rest */ }
    }
  }
}
