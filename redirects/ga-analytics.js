// Surrogate for Google Analytics / Tag Manager: keeps page code that calls
// ga(), gtag() or dataLayer.push() from throwing, and runs hitCallback so
// links that wait on analytics still work. Sends nothing.
(function () {
  'use strict';
  const noop = function () {};
  const runCallbacks = function (args) {
    for (const a of args) {
      if (a && typeof a === 'object') {
        const cb = a.hitCallback || a.event_callback || a.eventCallback;
        if (typeof cb === 'function') setTimeout(cb, 1);
      }
    }
  };
  const ga = function () { runCallbacks(arguments); };
  ga.create = function () { return { get: noop, set: noop, send: noop }; };
  ga.getAll = function () { return []; };
  ga.getByName = function () { return null; };
  ga.loaded = true;
  ga.q = [];
  const name = window.GoogleAnalyticsObject || 'ga';
  const queued = window[name] && window[name].q;
  window[name] = ga;
  if (Array.isArray(queued)) queued.forEach(args => runCallbacks(args));
  window.gtag = window.gtag || function () { runCallbacks(arguments); };
  const dl = window.dataLayer = window.dataLayer || [];
  dl.hide = undefined;
  if (typeof dl.push === 'function') {
    const push = dl.push.bind(dl);
    dl.push = function () { runCallbacks(arguments); return push.apply(null, arguments); };
  }
  window.google_tag_manager = window.google_tag_manager || {};
})();
