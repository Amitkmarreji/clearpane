// Content script (isolated world, document_start, every frame).
// Reports class and id names to the background, which injects the matching
// hiding CSS - the approach adblock-rust uses for generic cosmetic filters.
(() => {
  const FIRST_FLUSH_MS = 0;
  const FLUSH_MS = 100;
  const MAX_TOKEN_LENGTH = 100;
  const seenClasses = new Set();
  const seenIds = new Set();
  let newClasses = [];
  let newIds = [];
  let timer = null;
  let flushedOnce = false;

  const send = msg => chrome.runtime.sendMessage(msg).catch(() => null);

  function noteElement(el) {
    const id = el.id;
    if (id && typeof id === 'string' && id.length <= MAX_TOKEN_LENGTH && !seenIds.has(id)) {
      seenIds.add(id);
      newIds.push(id);
    }
    const list = el.classList;
    if (!list) return;
    for (const c of list) {
      if (c.length <= MAX_TOKEN_LENGTH && !seenClasses.has(c)) {
        seenClasses.add(c);
        newClasses.push(c);
      }
    }
  }

  function scan(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    noteElement(root);
    for (const el of root.querySelectorAll('[id],[class]')) noteElement(el);
  }

  function flush() {
    timer = null;
    if (!newClasses.length && !newIds.length) return;
    const msg = { type: 'cosmetic:tokens', classes: newClasses, ids: newIds };
    newClasses = [];
    newIds = [];
    send(msg);
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, flushedOnce ? FLUSH_MS : FIRST_FLUSH_MS);
    flushedOnce = true;
  }

  function startGeneric() {
    if (document.documentElement) scan(document.documentElement);
    schedule();
    new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'attributes') noteElement(m.target);
        else for (const node of m.addedNodes) scan(node);
      }
      if (newClasses.length || newIds.length) schedule();
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'id'] });
  }

  send({ type: 'cosmetic:init' }).then(res => {
    if (res && res.generic) startGeneric();
  });
})();
