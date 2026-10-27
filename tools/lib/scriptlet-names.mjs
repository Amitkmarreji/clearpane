// uBO scriptlet names and aliases -> the canonical names implemented in
// src/scriptlets/lib.js. Unlisted scriptlets are skipped at build time.
const ALIASES = {
  'set-constant': ['set'],
  'abort-on-property-read': ['aopr'],
  'abort-on-property-write': ['aopw'],
  'abort-current-script': ['acs', 'abort-current-inline-script', 'acis'],
  'abort-on-stack-trace': ['aost'],
  'no-setTimeout-if': ['nostif', 'prevent-setTimeout', 'setTimeout-defuser'],
  'no-setInterval-if': ['nosiif', 'prevent-setInterval', 'setInterval-defuser'],
  'nano-setInterval-booster': ['nano-sib'],
  'nano-setTimeout-booster': ['nano-stb'],
  'window.open-defuser': ['nowoif', 'no-window-open-if', 'prevent-window-open'],
  'addEventListener-defuser': ['aeld', 'prevent-addEventListener'],
  'no-fetch-if': ['prevent-fetch'],
  'no-xhr-if': ['prevent-xhr'],
  'noeval-if': ['prevent-eval-if'],
  'noeval': ['silent-noeval', 'noeval-silent'],
  'json-prune': [],
  'remove-node-text': ['rmnt'],
  'remove-attr': ['ra'],
  'remove-class': ['rc'],
  'set-cookie': [],
  'trusted-set-cookie': [],
  'remove-cookie': ['cookie-remover'],
  'set-local-storage-item': [],
  'trusted-set-local-storage-item': [],
  'set-session-storage-item': [],
  'trusted-click-element': [],
  'nowebrtc': [],
  'no-requestAnimationFrame-if': ['norafif', 'prevent-requestAnimationFrame'],
};

const LOOKUP = new Map();
for (const [canonical, aliases] of Object.entries(ALIASES)) {
  for (const name of [canonical, ...aliases]) {
    LOOKUP.set(name, canonical);
    LOOKUP.set(`${name}.js`, canonical);
  }
}

export function canonicalScriptlet(name) {
  return LOOKUP.get((name || '').trim()) || null;
}
