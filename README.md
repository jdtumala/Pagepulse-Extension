# PagePulse

A Chrome extension that measures how fast the page you're on actually loaded,
and shows the result in the top-right corner while you browse. No external
speed-test tool, no second tab.

## Install

1. Unzip the folder if you haven't already.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick this folder (the one holding `manifest.json`).
5. Open any http or https page. A small readout appears in the top-right corner.

## What you see

**Collapsed pill** — a spinner while measuring, then the page's load time and a
one-word verdict. The left edge is green, orange, or red.

**Click the pill** to expand the report:

- Overall verdict and a 0–100 score
- Largest Contentful Paint, time to first byte, DOM content loaded, page load
- Requests, total transferred, first contentful paint, HTTP protocol
- Under each metric, a bar showing the green / orange / red zones with a tick
  where this page landed, so you can see *how close* a value is to the next band

**Extension icon** opens the popup: the same report for the current tab, plus
settings.

## Settings

Everything lives in the popup and is stored with `chrome.storage.sync`, so it
follows your Chrome profile.

- **Show the readout on pages** — off means no widget on any site; the popup
  keeps working.
- **Open it expanded** — skip the collapsed pill.
- **Thresholds** — per metric: the green ceiling, the orange ceiling, and how
  much that metric weighs in the score. Orange is clamped so it can never fall
  below green.
- **Overall score** — the score each colour band starts at.
- **Reset to defaults** returns everything to the values below.

| Metric    | Green ≤ | Orange ≤ | Weight |
| --------- | ------- | -------- | ------ |
| LCP       | 2500 ms | 4000 ms  | 40     |
| Load      | 2500 ms | 5000 ms  | 25     |
| TTFB      | 800 ms  | 1800 ms  | 20     |
| DOM ready | 1800 ms | 3500 ms  | 15     |

Score bands: green from 80, orange from 50, red below. Each metric scores 100
green / 55 orange / 15 red; the score is the weighted average of whichever
metrics the browser reported.

## How it measures

All values come from the browser's own Performance timeline. Nothing is
patched, proxied, or timed by hand:

- `PerformanceNavigationTiming` → `responseStart` (TTFB),
  `domContentLoadedEventEnd`, `loadEventEnd`, `nextHopProtocol`, `transferSize`
- `PerformanceObserver` on `largest-contentful-paint`, buffered so candidates
  from before the script ran are included
- `performance.getEntriesByType('resource')` → request count and transfer size
- Paint timing → first contentful paint

The readout refreshes every 300 ms while measuring. It settles 1.2 s after the
`load` event — LCP can still change until then — or immediately on your first
click or keypress, since interaction freezes the LCP candidate anyway. A 20 s
cap stops the spinner on pages that never finish loading.

## Impact on the page being measured

- The widget lives in a **closed-off shadow DOM** on one element appended to
  `<html>`, so site CSS can't reach in and its own styles can't leak out.
- Top frame only, no iframes.
- No network requests, no remote fonts, no bundled libraries.
- Reading the performance timeline is passive; the extension never patches page
  APIs or writes to page storage.
- It does add its own element and a 300 ms interval during measurement, so
  treat readings as "this page in this browser with this extension on", the same
  caveat any in-page monitor carries.

## Known limits

- **Transferred size is a floor.** Cross-origin responses report
  `transferSize: 0` unless they send `Timing-Allow-Origin`. The report says how
  many requests were opaque so you know when the number is understated.
- **LCP is Chromium-only.** On engines without it, the row reads
  "not supported" and the score is computed from the rest.
- **Cached documents** score very well, which is accurate but not comparable to
  a first visit. The report flags a cache hit; use **Reload and measure** for a
  fresh navigation.
- **Chrome pages are off limits.** `chrome://`, the Web Store, and other
  extensions' pages can't be measured; the popup says so.
- Single-page apps report the *initial* navigation. Later route changes don't
  produce new navigation timings, so the numbers stay put until a real reload.
- **Hide here** hides the widget for the current page only. Use the setting to
  turn it off everywhere.
- Resource buffer is raised to 600 entries; pages with more requests than that
  will undercount.

## Files

| File | Role |
| ---- | ---- |
| `manifest.json` | MV3 manifest. Permissions: `storage`, `activeTab` |
| `shared.js` | Defaults, thresholds, formatting, row/track rendering |
| `content.js` | Measurement, scoring, shadow-DOM widget, messaging |
| `popup.html` / `popup.css` / `popup.js` | Report and settings for the current tab |
| `icons/` | 16 / 32 / 48 / 128 px icons |

There is no background service worker: measurement belongs to the page and
settings live in `chrome.storage`, so nothing needs to run between page loads.
