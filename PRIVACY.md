# Privacy policy: Clearpane

_Last updated: 27 October 2026_

**Clearpane collects no data.** It has no accounts, no analytics, no
telemetry, no ads and no servers.

## What stays on your computer

- **Your settings:** whether blocking is on, and the sites you've turned
  Clearpane off for. These are stored with `chrome.storage.local` in your own
  browser profile and are never sent anywhere.
- **The filter rules:** shipped inside the extension. Clearpane does not
  download anything while you browse. New lists arrive only when the extension
  itself updates through the Chrome Web Store.

## Why it asks for its permissions

| Permission | Why it's needed |
|---|---|
| Read and change your data on all websites (`<all_urls>`) | To hide ad elements on the pages you visit, and to run the small fix-up scripts some filters need. All of this runs locally in your browser. |
| Block content on any page (`declarativeNetRequest`) | To block requests to ad, tracker and malware servers, using Chrome's built-in blocking engine. Chrome does the matching; the extension never sees your browsing. |
| `scripting` | To add the hiding styles and filter scripts to pages. |
| `storage` | To remember your on/off setting and your list of allowed sites. |
| `activeTab` | When you open the popup, to count how many requests were blocked on the page you're looking at. |

## Contact

Questions or concerns: open an issue on the project's GitHub page.
