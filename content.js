/* PagePulse — on-page load performance readout.
   Runs at document_start in the top frame only. Reads the browser's own
   Performance timeline; never patches page APIs or mutates page state
   beyond appending one shadow-DOM host element. */
(function () {
  "use strict";

  if (window.top !== window.self) return;
  if (window.__pagePulseLoaded) return;
  window.__pagePulseLoaded = true;

  const SETTLE_AFTER_LOAD = 1200; // let late LCP candidates land
  const HARD_STOP = 20000;
  const HOST_ID = "pagepulse-host-4f81c";

  let settings = PP.clone(PP.DEFAULTS);
  let lcpValue = null;
  let lcpObserver = null;
  let state = "running"; // running | done
  let report = null;
  let finalizeTimer = null;
  let tickTimer = null;

  /* ------------------------------------------------------------------ *
   * Measurement                                                         *
   * ------------------------------------------------------------------ */

  try {
    performance.setResourceTimingBufferSize(600);
  } catch (e) {
    /* older Chrome: keep the default buffer */
  }

  try {
    lcpObserver = new PerformanceObserver(function (list) {
      const entries = list.getEntries();
      if (entries.length) lcpValue = entries[entries.length - 1].startTime;
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {
    lcpObserver = null; // LCP not available in this engine
  }

  function nonZero(v) {
    return typeof v === "number" && v > 0 ? v : null;
  }

  function readMetrics() {
    const nav = performance.getEntriesByType("navigation")[0] || null;
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find(function (p) {
      return p.name === "first-contentful-paint";
    });
    const resources = performance.getEntriesByType("resource");

    let transferred = nav && nav.transferSize ? nav.transferSize : 0;
    let opaque = 0;
    for (let i = 0; i < resources.length; i++) {
      const size = resources[i].transferSize;
      if (typeof size === "number" && size > 0) transferred += size;
      else opaque++;
    }

    return {
      url: location.href,
      host: location.host,
      ts: Date.now(),
      ttfb: nav ? nonZero(nav.responseStart) : null,
      dcl: nav ? nonZero(nav.domContentLoadedEventEnd) : null,
      load: nav ? nonZero(nav.loadEventEnd) : null,
      fcp: fcp ? fcp.startTime : null,
      lcp: lcpValue,
      requests: resources.length + (nav ? 1 : 0),
      transferred: transferred,
      opaqueRequests: opaque,
      protocol: nav && nav.nextHopProtocol ? nav.nextHopProtocol : null,
      cached: !!(nav && nav.transferSize === 0 && nav.decodedBodySize > 0),
      lcpSupported: !!lcpObserver
    };
  }

  function scoreOf(metrics) {
    const points = { good: 100, ok: 55, poor: 15 };
    const ratings = {};
    let sum = 0;
    let weight = 0;

    PP.METRICS.forEach(function (m) {
      const r = PP.rate(metrics[m.key], settings.thresholds[m.key]);
      ratings[m.key] = r;
      if (r) {
        const w = settings.weights[m.key] || 0;
        sum += points[r] * w;
        weight += w;
      }
    });

    const score = weight ? Math.round(sum / weight) : null;
    let status = "unknown";
    if (score != null) {
      status =
        score >= settings.bands.good
          ? "good"
          : score >= settings.bands.ok
            ? "ok"
            : "poor";
    }
    return { score: score, status: status, ratings: ratings };
  }

  function buildReport() {
    const metrics = readMetrics();
    return Object.assign({}, metrics, scoreOf(metrics), {
      complete: state === "done",
      settings: settings
    });
  }

  function refresh() {
    report = buildReport();
    render();
  }

  function finalize() {
    if (state === "done") return;
    state = "done";
    clearTimeout(finalizeTimer);
    clearInterval(tickTimer);
    if (lcpObserver) {
      try {
        lcpObserver.takeRecords();
        lcpObserver.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    refresh();
  }

  function startMeasuring() {
    state = "running";
    refresh();
    tickTimer = setInterval(refresh, 300);

    const settle = function () {
      clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(finalize, SETTLE_AFTER_LOAD);
    };
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
    setTimeout(finalize, HARD_STOP);

    // Interaction freezes the LCP candidate, so there is nothing left to wait for.
    ["keydown", "pointerdown"].forEach(function (type) {
      window.addEventListener(
        type,
        function () {
          if (document.readyState === "complete") finalize();
        },
        { once: true, capture: true, passive: true }
      );
    });
  }

  /* ------------------------------------------------------------------ *
   * Widget                                                              *
   * ------------------------------------------------------------------ */

  const CSS = `
:host {
  all: initial;
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 2147483600;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-variant-numeric: tabular-nums;
  color: #E9F1F5;
  direction: ltr;
  text-align: left;
}
* { box-sizing: border-box; }
.wrap {
  --ink: #0C1922;
  --ink-2: #12232F;
  --rule: rgba(233, 241, 245, .14);
  --muted: #8CA6B4;
  --good: #2FBE6C;
  --ok: #EFA135;
  --poor: #E5514A;
  --dim: rgba(140, 166, 180, .22);
  --accent: var(--muted);
  width: max-content;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.wrap[data-status="good"] { --accent: var(--good); }
.wrap[data-status="ok"] { --accent: var(--ok); }
.wrap[data-status="poor"] { --accent: var(--poor); }

.pill {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  padding: 0 11px 0 9px;
  margin: 0;
  border: 1px solid var(--rule);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  background: var(--ink);
  box-shadow: 0 6px 20px rgba(4, 12, 18, .34);
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease;
}
.pill:hover { background: var(--ink-2); }
.pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.mark { width: 14px; height: 14px; flex: none; display: block; }
.mark .ring { stroke: var(--dim); }
.mark .arc { stroke: var(--accent); }
.wrap[data-state="running"] .mark { animation: pp-spin 900ms linear infinite; }
.wrap[data-state="done"] .mark .arc { stroke-dasharray: 38 0; }
@keyframes pp-spin { to { transform: rotate(360deg); } }

.readout { display: flex; align-items: baseline; gap: 3px; }
.readout .num { font-size: 15px; font-weight: 620; letter-spacing: -.01em; }
.readout .unit { font-size: 11px; color: var(--muted); }
.caption { font-size: 11px; color: var(--muted); }
.chev { width: 9px; height: 9px; stroke: var(--muted); fill: none; stroke-width: 1.6; }
.wrap[data-open="true"] .chev { transform: rotate(180deg); }

.panel {
  width: 270px;
  border: 1px solid var(--rule);
  border-radius: 5px;
  background: var(--ink);
  box-shadow: 0 12px 34px rgba(4, 12, 18, .42);
  overflow: hidden;
}
.panel[hidden] { display: none; }

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px 10px;
  border-bottom: 1px solid var(--rule);
}
.verdict { font-size: 16px; font-weight: 640; color: var(--accent); line-height: 1.1; }
.origin { font-size: 11px; color: var(--muted); margin-top: 3px; max-width: 168px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.score { font-size: 22px; font-weight: 640; line-height: 1; color: var(--accent); }
.score small { font-size: 10px; font-weight: 500; color: var(--muted); margin-left: 1px; }

.rows { padding: 4px 12px 8px; }
.row { padding: 7px 0 8px; border-bottom: 1px solid rgba(233, 241, 245, .07); }
.row:last-child { border-bottom: 0; }
.row .line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.row .key { font-size: 12px; color: #C8D8E1; }
.row .val { font-size: 12.5px; font-weight: 600; }
.row[data-rate="good"] .val { color: var(--good); }
.row[data-rate="ok"] .val { color: var(--ok); }
.row[data-rate="poor"] .val { color: var(--poor); }
.row[data-rate="none"] .val { color: var(--muted); font-weight: 500; }

.track { position: relative; height: 5px; margin-top: 6px; border-radius: 1px; display: flex; overflow: hidden; }
.track i { display: block; height: 100%; }
.track i.z-good { background: rgba(47, 190, 108, .30); }
.track i.z-ok { background: rgba(239, 161, 53, .30); }
.track i.z-poor { background: rgba(229, 81, 74, .28); }
.track b { position: absolute; top: -2px; width: 2px; height: 9px; background: #E9F1F5; border-radius: 1px; transition: left 220ms ease; }

.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 10px; padding: 9px 12px 10px; border-top: 1px solid var(--rule); }
.fact { font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 6px; padding: 2px 0; }
.fact span { color: #D6E4EC; font-weight: 560; }
.note { padding: 0 12px 10px; font-size: 10.5px; color: var(--muted); line-height: 1.35; }
.note[hidden] { display: none; }

.acts { display: flex; border-top: 1px solid var(--rule); }
.acts button {
  flex: 1; margin: 0; padding: 9px 8px;
  background: transparent; border: 0; border-right: 1px solid var(--rule);
  color: #C8D8E1; font: inherit; font-size: 11.5px; cursor: pointer;
}
.acts button:last-child { border-right: 0; color: var(--muted); }
.acts button:hover { background: var(--ink-2); color: #fff; }
.acts button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

@media (prefers-reduced-motion: reduce) {
  .wrap[data-state="running"] .mark { animation-duration: 2.4s; }
  .track b, .pill { transition: none; }
}
`;

  let root = null;
  let el = {};
  let expanded = false;
  let dismissed = false;

  function mount() {
    if (root || dismissed) return;
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = CSS;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.setAttribute("data-state", state);
    wrap.setAttribute("data-status", "unknown");
    wrap.setAttribute("data-open", "false");
    wrap.innerHTML = [
      '<button class="pill" type="button" aria-expanded="false" title="PagePulse — page load readings">',
      '  <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">',
      '    <circle class="ring" cx="8" cy="8" r="6" fill="none" stroke-width="2"></circle>',
      '    <circle class="arc" cx="8" cy="8" r="6" fill="none" stroke-width="2"',
      '            stroke-linecap="round" stroke-dasharray="11 27" transform="rotate(-90 8 8)"></circle>',
      "  </svg>",
      '  <span class="readout"><span class="num">—</span><span class="unit"></span></span>',
      '  <span class="caption">measuring</span>',
      '  <svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5"/></svg>',
      "</button>",
      '<div class="panel" hidden role="region" aria-label="Page load readings">',
      '  <div class="head">',
      "    <div>",
      '      <div class="verdict" aria-live="polite">Measuring</div>',
      '      <div class="origin"></div>',
      "    </div>",
      '    <div class="score">—<small>/100</small></div>',
      "  </div>",
      '  <div class="rows"></div>',
      '  <div class="facts"></div>',
      '  <div class="note" hidden></div>',
      '  <div class="acts">',
      '    <button type="button" data-act="reload">Reload and measure</button>',
      '    <button type="button" data-act="hide">Hide here</button>',
      "  </div>",
      "</div>"
    ].join("\n");

    shadow.append(style, wrap);
    document.documentElement.appendChild(host);

    root = host;
    el = {
      wrap: wrap,
      pill: wrap.querySelector(".pill"),
      num: wrap.querySelector(".readout .num"),
      unit: wrap.querySelector(".readout .unit"),
      caption: wrap.querySelector(".caption"),
      panel: wrap.querySelector(".panel"),
      verdict: wrap.querySelector(".verdict"),
      origin: wrap.querySelector(".origin"),
      score: wrap.querySelector(".score"),
      rows: wrap.querySelector(".rows"),
      facts: wrap.querySelector(".facts"),
      note: wrap.querySelector(".note")
    };

    el.pill.addEventListener("click", function () {
      setExpanded(!expanded);
    });
    wrap.querySelector('[data-act="reload"]').addEventListener("click", function () {
      location.reload();
    });
    wrap.querySelector('[data-act="hide"]').addEventListener("click", function () {
      dismissed = true;
      unmount();
    });

    if (settings.startExpanded) setExpanded(true);
    render();
  }

  function unmount() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    el = {};
    expanded = false;
  }

  function setExpanded(next) {
    expanded = next;
    if (!el.panel) return;
    el.panel.hidden = !next;
    el.pill.setAttribute("aria-expanded", String(next));
    el.wrap.setAttribute("data-open", String(next));
    if (next) render();
  }

  function render() {
    if (!root || !report) return;

    const running = state === "running";
    const r = report;

    el.wrap.setAttribute("data-state", state);
    el.wrap.setAttribute("data-status", r.status);

    const headline = r.load != null ? r.load : r.dcl != null ? r.dcl : r.ttfb;
    const t = PP.splitTime(headline);
    el.num.textContent = t.num;
    el.unit.textContent = t.unit;
    el.caption.textContent = running
      ? "measuring"
      : PP.STATUS_WORD[r.status].toLowerCase();

    el.verdict.textContent = running ? "Measuring" : PP.STATUS_WORD[r.status];
    el.origin.textContent = r.host || "";
    el.score.innerHTML = (r.score == null ? "—" : r.score) + "<small>/100</small>";

    if (!expanded) return;

    el.rows.innerHTML = PP.rowsHTML(r, settings, running);
    el.facts.innerHTML = PP.factsHTML(r);
    const note = PP.noteText(r);
    el.note.hidden = !note;
    el.note.textContent = note;
  }

  /* ------------------------------------------------------------------ *
   * Wiring                                                              *
   * ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener(function (msg, _sender, respond) {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "PP_GET_REPORT") {
      respond({
        ok: true,
        state: state,
        report: report || buildReport(),
        widgetVisible: !!root
      });
      return true;
    }
    if (msg.type === "PP_RELOAD") {
      respond({ ok: true });
      location.reload();
      return true;
    }
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync") return;
    chrome.storage.sync.get(null, function (stored) {
      const wasEnabled = settings.enabled;
      settings = PP.merge(stored);
      refresh();
      if (settings.enabled) {
        if (!wasEnabled) dismissed = false; // a fresh opt-in un-hides it
        mount();
      } else {
        unmount();
      }
    });
  });

  chrome.storage.sync.get(null, function (stored) {
    settings = PP.merge(stored);
    startMeasuring();
    if (settings.enabled) mount();
  });
})();
