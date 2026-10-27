# Clearpane: developer guide

How the extension is built, how to refresh its filter lists, how it was tested, and where it falls short of Brave Shields. For what it is and how to install it, see the [README](../README.md).

## Run from source (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the repository folder (the one with
   `manifest.json` in it).

Chrome may show a "Disable developer mode extensions" bubble at startup. That is
normal for unpacked extensions.

## Package for the stores

```bash
node tools/package.mjs
```

This writes `dist/clearpane-<version>.zip` with only the files the
extension needs at runtime: no build tools, list cache, docs or tests.
Upload that zip to the Chrome Web Store or Edge Add-ons. The copy-ready
listing text, permission justifications and privacy answers are in
[`store/listing.md`](../store/listing.md).

### Store images

```bash
cd tools/test
node store-shots.mjs
```

This rebuilds everything in `store/screenshots/` (four 1280x800 screenshots
and the 440x280 and 1400x560 promo tiles). It serves a made-up news page,
`store/src/demo-news.html`, captures it with and without Clearpane and opens
the real toolbar popup on it, then screenshots each layout in
`store/src/frames.html`. Chrome is started with every hostname mapped to the
local server, so the page's ad and tracker URLs never reach the real services;
the screenshots show only what the real filter lists do.

## Refresh the filter lists

Lists are baked into the extension at build time (MV3 has no remote rule
updates). To refresh them, needing only Node.js 18+ and no npm packages:

```bash
cd clearpane
node tools/build.mjs
```

Then click the reload arrow on the extension card in `chrome://extensions`.
`node tools/build.mjs --offline` rebuilds from the copies already in
`tools/cache/` without downloading. The `_metadata/` folder is Chrome's own
cache of the indexed rulesets. Chrome rebuilds it on reload, so you can
ignore it.

To add or remove lists, edit `tools/lists.json`. Each key there becomes one
ruleset. The build prints the rule count and warns when the enabled total gets
near Chrome's guaranteed 30,000 static rules.

## What's inside

| Part | File(s) | How it works |
|---|---|---|
| Lists | `tools/lists.json` | Brave's default-on groups from [`brave/adblock-resources` list_catalog.json](https://github.com/brave/adblock-resources/blob/master/filter_lists/list_catalog.json): uBO filters (all years), EasyList, EasyPrivacy, uBO privacy, badware, URLhaus, Brave Unbreak/Specific/First-party, and the cookie-notice lists. Brave's mobile- and iOS-only lists are skipped. |
| Converter | `tools/build.mjs`, `tools/lib/*.mjs` | Reads ABP/uBO syntax, including `!#if`/`!#include` (evaluated as uBO Lite on Chromium) and `$badfilter`. Converts network filters to `declarativeNetRequest` rules. `\|\|host^` filters that share options are merged into one rule with a `requestDomains` list, the way uBO Lite does, so ~205k list lines (network plus cosmetic) become ~23k network rules. |
| Network blocking | `rulesets/*.json` | Static DNR rulesets: `ads`, `privacy`, `malware`, `cookies`. Priorities mirror uBO: block 10 < redirect 11 < `@@` exception 20 < `@@$document` 25 < `$important` 30 < your allowlist 1000. |
| Regex filters | `data/regex-rules.json`, `src/bg/regex-rules.js` | Added as dynamic rules at install, only after Chrome's `isRegexSupported()` accepts each one. Chrome's RE2 size cap can't be predicted offline, and a single rejected regex in a static ruleset stops the whole extension from loading. |
| Surrogates | `redirects/` | Small files that `$redirect=` filters swap in: noop JS/HTML/JSON/CSS, a transparent GIF/PNG, silent MP3/MP4, and stubs for Google Analytics/GTM and adsbygoogle. |
| Cosmetic hiding | `src/content/cosmetic.js`, `src/bg/cosmetic.js`, `data/cosmetic.json` | Brave's approach: the content script reports class and id names it sees (and keeps watching the DOM). The background looks up the generic selectors keyed by those names, adds the site-specific selectors, and injects them as **user-origin** CSS, which page styles can't override. |
| Scriptlets | `src/scriptlets/lib.js`, `scriptlets/shard-*.js` | 28 of the most-used uBO scriptlets (`set-constant`, `abort-on-property-read`, `abort-current-script`, `no-setTimeout-if`, `json-prune`, `window.open-defuser`, `trusted-click-element`, …), written fresh for this project. They run in the page's MAIN world at `document_start`, registered only on the sites that need them (16 shards), as uBO Lite does. |
| Popup | `popup/` | Global toggle, per-site allowlist, counters. |

## Known limits compared with Brave Shields

Brave runs adblock-rust inside the browser. A Chrome MV3 extension has to work
through `declarativeNetRequest` and content scripts, so:

* **Behaves like Brave's "aggressive" mode for network rules.** In its default
  "standard" mode Brave doesn't block first-party subrequests even when a list
  says to. This extension, like uBlock Origin, blocks them. If a site breaks,
  turn blocking off for it from the popup.
* **Rule budget.** About 23k network rules fit under Chrome's guaranteed 30k.
  Brave has no such cap. The build drops what DNR can't express; the counts are
  in `data/meta.json` under `skipped`.
* **Not convertible to DNR:** `$popup`/`$popunder` (~3,000 filters), `$csp`,
  `$header`, `$permissions`, `$replace`, `$urlskip`, `$redirect-rule`, `$cname`
  (Brave uncloaks CNAMEs through DNS, which extensions can't do), `$strict1p`
  and `$strict3p`, entity domains such as `domain=example.*`, regexes that RE2
  rejects, and complex `$removeparam`.
* **Procedural cosmetic filters** (`:has-text()`, `:upward()`, `:xpath()`,
  `:matches-css()`…) and HTML filtering (`##^`) are skipped. Plain CSS
  (including native `:has()`), `:style()` and `:remove()` (treated as hide) work.
* **Scriptlets:** 28 are implemented. 62 rarer ones (about 940 filters, roughly
  8% of scriptlet filters) are skipped (`trusted-replace-*`, `json-edit*`, `xml-prune`, `m3u-prune`,
  `href-sanitizer`, Brave's own `brave-*` fixes…). Entity rules
  (`example.*##+js`) only load on 30 common TLDs.
* **Timing.** Brave applies cosmetic CSS from inside the renderer. Here the
  first CSS arrives after a message round-trip to the service worker, so an ad
  can occasionally flash for a moment before it hides.
* **No fingerprinting or cookie protections** (Brave's farbling, storage
  partitioning, referrer trimming, CNAME uncloaking, "aggressive" mode, YouTube
  ad handling). Those are browser features, not filter lists.
* **List updates are manual.** Rerun the build. Brave updates its lists in the
  background.
* **Counting is per page only.** The toolbar badge is Chrome's own per-tab count,
  and the popup's number comes from `getMatchedRules()` under the `activeTab`
  grant. There is no all-time total, because that would need the
  `declarativeNetRequestFeedback` permission, which shows users a "read your
  browsing history" warning.

## Test results (27 Oct 2026, Chrome 156, headless, fresh profile)

Each page was loaded with and without the extension. "Blocked" counts requests
that failed with `ERR_BLOCKED_BY_CLIENT`. REA's `inspect-web-page` was also run
on the same tabs as an independent check of the DOM.

| Page | Without | With Clearpane |
|---|---|---|
| adblock-tester.com score | 46 / 100 | **95 / 100** (one script-execution check only "most likely passed") |
| adblock-tester.com | 69 requests, 6 ad iframes | 41 requests, 21 blocked (Yandex Metrica/ads, Hotjar, Sentry, test banners), 0 iframes |
| canyoublockit.com/extreme-test | 144 requests, 7 iframes | 90 requests, 10 blocked (popunder/ad networks, Cloudflare Insights), 0 iframes |
| edition.cnn.com | 144 requests, 9 visible ad slots | 95 requests, 6 blocked (ad pings, Optimizely, IMA ad SDK), 0 visible ad slots |
| theguardian.com/uk | 11 visible ad slots | 19 blocked (Ophan analytics, Sourcepoint), 0 visible ad slots |
| independent.co.uk | 105 requests | 27 blocked (Chartbeat, Permutive, DoubleVerify, CrazyEgg, ad tags) |
| Brave QA: cosmetic (dynamic ids) | 0 / 24 hidden | 20 / 24 hidden. The other 4 ids aren't in today's lists. |
| Brave QA: scriptlets | fails | passes in the page, a same-origin frame and a cross-origin frame |
| Brave QA: network requests | both test images load | both blocked (Brave *standard* would let the first-party one through) |
| Controls (packed store zip) | — | 21 blocked; real toolbar popup shows 26; allowlist → 0, back on and global on/off all pass (9/9 checks) |
| `chrome://extensions` (Developer mode) | — | loads with no manifest errors, runtime errors or warnings |

What still gets through: the 4 dynamic test ids above, sites whose ads are
served first-party from the same domain, anything that needs a skipped filter
type (see the limits above), and `d3ward.github.io/toolz/adblock`, which can't
be scored any more because that project has been archived and its test no
longer runs. The Daily Mail and Forbes served bot walls to headless Chrome, so
they gave no result.

### Rerun the tests

Optional. This needs `puppeteer-core`, which drives your installed Chrome with
a throwaway profile, so your own profile is never touched:

```bash
cd tools/test
npm install
npm test
node controls.mjs                      # popup switches and counter (9 checks)
node controls.mjs out/packed <unzipped dist zip>   # the same, on the store package
node real-popup.mjs                    # frames of the popup's animation
```

Results and screenshots go to `tools/test/out/`. Chrome 137+ ignores
`--load-extension`, so the scripts load the extension through the DevTools
pipe (`Extensions.loadUnpacked`). Set `CHROME_PATH` if Chrome is installed
somewhere else.

## Licences

The extension code here is written for this project. The filter lists keep their own licences:
EasyList/EasyPrivacy (GPLv3 / CC BY-SA 3.0), uBlock Origin uAssets (GPLv3),
Brave adblock-lists (MPL-2.0), URLhaus filter (MIT / CC0), Fanboy (CC BY 3.0).
Conversion approach modelled on uBlock Origin Lite (GPLv3) and adblock-rust
(MPL-2.0); no code was copied from either.
