// Surrogate for adsbygoogle.js: accepts pushes so page code doesn't throw,
// and loads no ads.
(function () {
  'use strict';
  const queue = { loaded: true, push: function () { return 0; } };
  const existing = window.adsbygoogle;
  window.adsbygoogle = queue;
  if (Array.isArray(existing)) existing.length = 0;
})();
