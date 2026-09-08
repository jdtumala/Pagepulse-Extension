/* Shared between the content script (isolated world) and the popup.
   Exposes a single PP namespace; touches nothing else. */
var PP = (function () {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    startExpanded: false,
    // Milliseconds. value <= good -> green, <= ok -> orange, else red.
    thresholds: {
      lcp: { good: 2500, ok: 4000 },
      ttfb: { good: 800, ok: 1800 },
      dcl: { good: 1800, ok: 3500 },
      load: { good: 2500, ok: 5000 }
    },
    // Share of the overall score each metric carries.
    weights: { lcp: 40, load: 25, ttfb: 20, dcl: 15 },
    // Overall score bands, 0-100.
    bands: { good: 80, ok: 50 }
  };

  const METRICS = [
    { key: "lcp", name: "Largest Contentful Paint", short: "LCP" },
    { key: "ttfb", name: "Time to first byte", short: "TTFB" },
    { key: "dcl", name: "DOM content loaded", short: "DOM ready" },
    { key: "load", name: "Page load", short: "Load" }
  ];

  const STATUS_WORD = {
    good: "Fast",
    ok: "Moderate",
    poor: "Slow",
    unknown: "No data"
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function merge(stored) {
    const s = stored || {};
    const out = clone(DEFAULTS);
    out.enabled = s.enabled !== false;
    out.startExpanded = s.startExpanded === true;
    METRICS.forEach(function (m) {
      const t = s.thresholds && s.thresholds[m.key];
      if (t && t.good > 0 && t.ok > 0) {
        out.thresholds[m.key] = { good: t.good, ok: Math.max(t.ok, t.good) };
      }
      const w = s.weights && s.weights[m.key];
      if (typeof w === "number" && w >= 0) out.weights[m.key] = w;
    });
    if (s.bands && s.bands.good > 0 && s.bands.ok >= 0) {
      out.bands = { good: s.bands.good, ok: Math.min(s.bands.ok, s.bands.good) };
    }
    return out;
  }

  function rate(value, t) {
    if (value == null || !t) return null;
    if (value <= t.good) return "good";
    if (value <= t.ok) return "ok";
    return "poor";
  }

  function splitTime(ms) {
    if (ms == null) return { num: "—", unit: "" };
    if (ms < 1000) return { num: String(Math.round(ms)), unit: "ms" };
    return { num: (ms / 1000).toFixed(ms < 10000 ? 2 : 1), unit: "s" };
  }

  function timeText(ms) {
    const t = splitTime(ms);
    return t.unit ? t.num + " " + t.unit : t.num;
  }

  function bytesText(bytes) {
    if (!bytes) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1048576).toFixed(bytes < 10485760 ? 2 : 1) + " MB";
  }

  // A zoned bar: green/orange/red widths come from the thresholds themselves,
  // and the tick shows where this page landed.
  function trackHTML(value, t, rating) {
    const max = t.ok * 1.6;
    const good = Math.max(2, (t.good / max) * 100);
    const ok = Math.max(2, (t.ok / max) * 100 - good);
    const poor = Math.max(0, 100 - good - ok);
    const pos = value == null ? 0 : Math.min(99, (value / max) * 100);
    return (
      '<div class="track">' +
      '<i class="z-good" style="width:' + good.toFixed(1) + '%"></i>' +
      '<i class="z-ok" style="width:' + ok.toFixed(1) + '%"></i>' +
      '<i class="z-poor" style="width:' + poor.toFixed(1) + '%"></i>' +
      (rating === "none" || value == null
        ? ""
        : '<b style="left:' + pos.toFixed(1) + '%"></b>') +
      "</div>"
    );
  }

  function rowsHTML(report, settings, running) {
    return METRICS.map(function (m) {
      const value = report[m.key];
      const rating = (report.ratings && report.ratings[m.key]) || "none";
      const th = settings.thresholds[m.key];
      const unsupported = m.key === "lcp" && report.lcpSupported === false;
      const label = unsupported ? m.short + " (not supported)" : m.name;
      const text =
        value == null ? (running ? "pending" : "—") : timeText(value);
      return (
        '<div class="row" data-rate="' + rating + '">' +
        '<div class="line"><span class="key">' + label + "</span>" +
        '<span class="val">' + text + "</span></div>" +
        trackHTML(value, th, rating) +
        "</div>"
      );
    }).join("");
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function factsHTML(report) {
    const facts = [
      ["Requests", String(report.requests || 0)],
      ["Transferred", bytesText(report.transferred)],
      ["First paint", report.fcp == null ? "—" : timeText(report.fcp)],
      ["Protocol", report.protocol ? esc(report.protocol) : "—"]
    ];
    return facts
      .map(function (f) {
        return '<div class="fact">' + f[0] + "<span>" + f[1] + "</span></div>";
      })
      .join("");
  }

  function noteText(report) {
    const notes = [];
    if (report.opaqueRequests > 0) {
      notes.push(
        report.opaqueRequests +
          " cross-origin " +
          (report.opaqueRequests === 1 ? "request hides" : "requests hide") +
          " its size, so transferred is a floor, not a total."
      );
    }
    if (report.cached) notes.push("This document came from cache.");
    return notes.join(" ");
  }

  return {
    DEFAULTS: DEFAULTS,
    METRICS: METRICS,
    STATUS_WORD: STATUS_WORD,
    clone: clone,
    merge: merge,
    rate: rate,
    splitTime: splitTime,
    timeText: timeText,
    bytesText: bytesText,
    esc: esc,
    trackHTML: trackHTML,
    rowsHTML: rowsHTML,
    factsHTML: factsHTML,
    noteText: noteText
  };
})();
