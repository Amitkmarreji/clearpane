# Store listing: Clearpane 1.0.0

Copy-ready text and answers for the Chrome Web Store developer dashboard.
The same text works for Microsoft Edge Add-ons. Nothing here has been
submitted. The source is at https://github.com/Amitkmarreji/clearpane.

## Package

- Upload: `dist/clearpane-1.0.0.zip`, made by `node tools/package.mjs`.
- Store icon (128x128): `icons/icon128.png`.

## Store listing tab

**Name:** Clearpane

**Summary** (the store allows 132 characters; this is 130, the same as the manifest description):

> Free, open-source ad and tracker blocker. Blocks ads, trackers, malware sites and cookie pop-ups. No accounts, no data collection.

**Category:** Privacy & Security (Edge: Productivity is not right; use "Privacy and security" if offered)

**Language:** English

**Description:**

```text
Clearpane is a free, open-source ad and tracker blocker. It makes pages cleaner, faster and more private, and it asks nothing in return: no account, no sign-up, no "acceptable ads" deals, no paid tier and no data collection.

WHAT IT BLOCKS
• Ads, including video ads and pop-ups
• Trackers and analytics scripts that follow you between sites
• Known malware and phishing sites
• Cookie-consent banners

HOW IT WORKS
Clearpane uses well-known community filter lists (EasyList, EasyPrivacy, the uBlock Origin filter lists, Brave's lists and the URLhaus malware list) and turns them into rules for Chrome's built-in blocking engine. Requests for ads and trackers are stopped before they load, so pages load faster and use less data. Leftover empty ad boxes are hidden, and small site-specific fixes from the filter lists deal with anti-adblock walls.

SIMPLE CONTROLS
• One switch to turn blocking on or off everywhere
• One switch per site: if a site doesn't work properly, turn Clearpane off for just that site
• A live count of how many ads and trackers were blocked on the page you're on

PRIVATE BY DESIGN
Everything happens inside your browser. Clearpane has no servers, no analytics and no remote code. It never reads, stores or sends your browsing history. Your two settings (on/off and the list of sites you've switched off) stay on your computer.

FREE AND OPEN SOURCE
Clearpane is released under the GNU GPL v3. The full source code, the build script that converts the filter lists, and the test results are public, so anyone can check exactly what it does.

Clearpane is an independent project. It is not affiliated with or endorsed by the maintainers of the filter lists it uses. Thank you to every volunteer who keeps those lists up to date.
```

**Graphic assets** (all in `store/screenshots/`):

| Store slot | File | Size |
|---|---|---|
| Screenshot 1 | `1-popup.png` | 1280x800 |
| Screenshot 2 | `2-before-after.png` | 1280x800 |
| Screenshot 3 | `3-site-switch.png` | 1280x800 |
| Screenshot 4 | `4-privacy.png` | 1280x800 |
| Small promo tile | `promo-small-440x280.png` | 440x280 |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` | 1400x560 |

**Official URL:** none (no verified site yet).
**Homepage URL:** `https://github.com/Amitkmarreji/clearpane`
**Support URL:** `https://github.com/Amitkmarreji/clearpane/issues`

## Privacy practices tab

**Single purpose:**

> Clearpane blocks ads, trackers, malware sites and cookie-consent pop-ups on web pages, with an on/off switch for each site.

**Permission justifications:**

| Permission | Justification to paste |
|---|---|
| `declarativeNetRequest` | Blocks requests to ad, tracker and malware servers using Chrome's built-in rule engine, from filter lists shipped inside the extension. |
| `scripting` | Hides leftover ad boxes with CSS, and runs small site-specific fixes from the filter lists that stop anti-adblock walls. All code ships inside the extension package. |
| `storage` | Saves the user's two settings on their own computer: whether blocking is on, and the list of sites where they turned it off. |
| `activeTab` | Lets the popup show how many requests were blocked on the tab the user is looking at, only when they open the popup. |
| Host permission `<all_urls>` | Ads and trackers appear on any website, so the blocking rules and ad-hiding CSS must be able to apply on every site the user visits. No page content is read, stored or sent anywhere. |

**Are you using remote code?** No, I am not using remote code. All
JavaScript, CSS and rules are inside the package. The filter lists are
downloaded only at build time, on the developer's machine, and converted into
static files; the extension never fetches code or rules at run time.

**Data usage:** tick **none** of the data types. Clearpane does not collect
or transmit personally identifiable information, health, financial,
authentication, personal communications, location, web history, user
activity or website content.

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://github.com/Amitkmarreji/clearpane/blob/main/PRIVACY.md`

## Distribution tab

- **Visibility:** Public (or Unlisted for a quiet first release that only
  people with the link can find).
- **Regions:** All regions.
- **Price:** Free. No in-app purchases.

## Before submitting (checklist)

- [x] Create the GitHub repository (https://github.com/Amitkmarreji/clearpane).
- [ ] Register a Chrome Web Store developer account (one-off US$5 fee) and verify the contact email.
- [ ] Run `node tools/build.mjs` for fresh lists, then `node tools/package.mjs`.
- [ ] Bump `version` in `manifest.json` for every later upload.
- [ ] Upload the zip, paste the text above, add the images, submit for review.
- [ ] Edge Add-ons: the same zip and text work; Edge needs a free Partner Center account.

## Updating the lists after release

Chrome Web Store extensions can't download new rules at run time without
counting as remote code, so list updates ship as new versions. A monthly
release (rebuild, bump the version, upload) keeps the lists fresh.
