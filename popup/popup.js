// Popup: global on/off, per-site blocking toggle (the allowlist) and counters.
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString();
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Colours of the little "ads" that fly into the window.
const BIT_COLOURS = ['#f97316', '#ef4444', '#eab308', '#8b5cf6', '#06b6d4', '#ec4899'];
const MAX_BITS = 10;
const BIT_START_MS = 60;
const BIT_STAGGER_MS = 55;
const BIT_FLIGHT_MS = 700;
const landingMs = n => BIT_START_MS + (Math.min(MAX_BITS, n) - 1) * BIT_STAGGER_MS + BIT_FLIGHT_MS;

async function activeTab() {
  // popup.html?tabId=N shows the popup for a given tab (used when testing it in a tab).
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const send = msg => chrome.runtime.sendMessage(msg);

/** Counts a number up from its current value with an ease-out; the final value is kept in data-value. */
function countTo(el, target, duration = 600) {
  const from = Number(el.dataset.value) || 0;
  el.dataset.value = String(target);
  if (calm || from === target) {
    el.textContent = fmt(target);
    return;
  }
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(from + (target - from) * eased));
    if (t < 1 && el.dataset.value === String(target)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Sends blocked "ads" flying into the window graphic, then pulses it. */
function flyBits(count) {
  if (calm || count <= 0) return;
  const bits = $('bits');
  bits.replaceChildren();
  const n = Math.min(MAX_BITS, count);
  for (let i = 0; i < n; i++) {
    const bit = document.createElement('span');
    const angle = Math.PI * (0.15 + Math.random() * 1.2) - Math.PI / 2; // mostly from the right
    const dist = 90 + Math.random() * 70;
    bit.className = 'bit';
    bit.style.setProperty('--x', `${Math.cos(angle) * dist}px`);
    bit.style.setProperty('--y', `${Math.sin(angle) * dist * 0.5}px`);
    bit.style.setProperty('--r', `${Math.round(Math.random() * 180 - 90)}deg`);
    bit.style.setProperty('--d', `${BIT_START_MS + i * BIT_STAGGER_MS}ms`);
    bit.style.setProperty('--c', BIT_COLOURS[i % BIT_COLOURS.length]);
    bits.append(bit);
  }
  setTimeout(() => {
    const ring = $('ring');
    const wrap = ring.parentElement;
    for (const el of [ring, wrap]) el.classList.remove('go', 'bump');
    void ring.offsetWidth; // restart the animations
    ring.classList.add('go');
    wrap.classList.add('bump');
  }, landingMs(n) - 80);
}

function render(info) {
  const paused = !info.enabled || info.siteAllowed || !info.site;
  document.body.classList.toggle('disabled', !info.enabled);
  document.body.classList.toggle('paused', paused);
  $('global').checked = info.enabled;
  $('global-label').textContent = info.enabled ? 'On' : 'Off';
  $('host').textContent = info.site || 'This page can’t be filtered';
  $('site').disabled = !info.site;
  $('site').checked = !info.siteAllowed;
  $('site-label').textContent = info.siteAllowed ? 'Blocking is off for this site' : 'Blocking is on for this site';
  $('status-text').textContent = !info.enabled ? 'Paused' : !info.site ? 'Idle' : info.siteAllowed ? 'Paused here' : 'Protected';

  const tabCount = $('tab-count');
  if (info.blocked === null) {
    tabCount.dataset.value = '';
    tabCount.textContent = '–';
  } else {
    const added = info.blocked - (Number(tabCount.dataset.value) || 0);
    const flying = !paused && added > 0;
    countTo(tabCount, info.blocked, flying ? landingMs(added) : 600);
    if (flying) flyBits(added);
  }
  countTo($('rule-count'), info.rules, 900);

  const notes = [];
  if (info.errors?.length) notes.push(`Setup problem: ${info.errors.join('; ')}`);
  $('note').hidden = notes.length === 0;
  $('note').textContent = notes.join(' ');
  const built = info.builtAt ? new Date(info.builtAt).toLocaleDateString() : 'unknown';
  $('footer').textContent = `Filter lists updated ${built} · free and open source`;
}

async function refresh(tab) {
  const info = await send({ type: 'popup:get', tabId: tab.id, url: tab.url });
  render(info);
  return info;
}

async function main() {
  const tab = await activeTab();
  let info = await refresh(tab);

  $('global').addEventListener('change', async e => {
    await send({ type: 'popup:setEnabled', enabled: e.target.checked });
    info = await refresh(tab);
    chrome.tabs.reload(tab.id);
  });

  $('site').addEventListener('change', async e => {
    await send({ type: 'popup:setSiteAllowed', host: info.host, allowed: !e.target.checked });
    info = await refresh(tab);
    chrome.tabs.reload(tab.id);
  });
}

main().catch(err => {
  $('note').hidden = false;
  $('note').textContent = `Could not load: ${err.message}`;
});
