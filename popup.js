"use strict";

const $ = function (id) {
  return document.getElementById(id);
};

let settings = PP.clone(PP.DEFAULTS);
let saveTimer = null;
let pollTimer = null;
let tabId = null;

/* -------------------------------------------------------------------- *
 * Live readings                                                         *
 * -------------------------------------------------------------------- */

function askTab() {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: "PP_GET_REPORT" }, function (res) {
    if (chrome.runtime.lastError || !res || !res.ok) {
      showUnavailable();
      return;
    }
    renderReport(res.report, res.state === "running");
    if (res.state === "done") {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
}

function showUnavailable() {
  clearInterval(pollTimer);
  pollTimer = null;
  $("live").hidden = true;
  $("unavailable").hidden = false;
  $("host").textContent = "No readings for this tab";
  $("score").innerHTML = "—<small>/100</small>";
}

function renderReport(report, running) {
  $("unavailable").hidden = true;
  $("live").hidden = false;
  $("live").dataset.status = report.status;
  $("host").textContent = report.host || "";
  $("score").innerHTML =
    (report.score == null ? "—" : report.score) + "<small>/100</small>";
  $("score").style.color = "var(--" + statusVar(report.status) + ")";
  $("verdict").textContent = running
    ? "Measuring"
    : PP.STATUS_WORD[report.status];
  $("spinner").hidden = !running;
  $("rows").innerHTML = PP.rowsHTML(report, settings, running);
  $("facts").innerHTML = PP.factsHTML(report);
  const note = PP.noteText(report);
  $("note").hidden = !note;
  $("note").textContent = note;
}

function statusVar(status) {
  if (status === "good") return "good";
  if (status === "ok") return "ok";
  if (status === "poor") return "poor";
  return "muted";
}

/* -------------------------------------------------------------------- *
 * Settings form                                                         *
 * -------------------------------------------------------------------- */

function buildThresholdRows() {
  $("thresholds").innerHTML = PP.METRICS.map(function (m) {
    return (
      '<span class="label">' + m.short + "</span>" +
      '<input type="number" min="1" step="50" data-field="good" data-metric="' + m.key + '" />' +
      '<input type="number" min="1" step="50" data-field="ok" data-metric="' + m.key + '" />' +
      '<input type="number" min="0" max="100" step="5" data-field="weight" data-metric="' + m.key + '" />'
    );
  }).join("");
}

function fillForm() {
  $("enabled").checked = settings.enabled;
  $("startExpanded").checked = settings.startExpanded;
  $("bandGood").value = settings.bands.good;
  $("bandOk").value = settings.bands.ok;
  document.querySelectorAll("#thresholds input").forEach(function (input) {
    const key = input.dataset.metric;
    if (input.dataset.field === "weight") input.value = settings.weights[key];
    else input.value = settings.thresholds[key][input.dataset.field];
  });
}

function readForm() {
  const next = PP.clone(settings);
  next.enabled = $("enabled").checked;
  next.startExpanded = $("startExpanded").checked;

  const bandGood = Number($("bandGood").value);
  const bandOk = Number($("bandOk").value);
  if (bandGood > 0) next.bands.good = bandGood;
  if (bandOk >= 0) next.bands.ok = Math.min(bandOk, next.bands.good);

  document.querySelectorAll("#thresholds input").forEach(function (input) {
    const key = input.dataset.metric;
    const value = Number(input.value);
    if (input.dataset.field === "weight") {
      if (value >= 0) next.weights[key] = value;
    } else if (value > 0) {
      next.thresholds[key][input.dataset.field] = value;
    }
  });
  // Orange can never sit below green.
  PP.METRICS.forEach(function (m) {
    const t = next.thresholds[m.key];
    t.ok = Math.max(t.ok, t.good);
  });
  return next;
}

function save() {
  settings = readForm();
  chrome.storage.sync.set(settings, function () {
    flashSaved();
    askTab(); // re-render with the new bands
  });
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
}

function flashSaved() {
  const badge = $("saved");
  badge.textContent = "Saved";
  badge.classList.add("show");
  setTimeout(function () {
    badge.classList.remove("show");
  }, 1100);
}

/* -------------------------------------------------------------------- *
 * Start                                                                 *
 * -------------------------------------------------------------------- */

buildThresholdRows();

chrome.storage.sync.get(null, function (stored) {
  settings = PP.merge(stored);
  fillForm();

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const tab = tabs && tabs[0];
    // tab.url is only present once activeTab is granted. When it is missing we
    // still try the tab: the message either answers or fails, and the failure
    // path already explains itself.
    if (!tab || !tab.id || (tab.url && !/^https?:/.test(tab.url))) {
      showUnavailable();
      return;
    }
    tabId = tab.id;
    askTab();
    pollTimer = setInterval(askTab, 400);
  });
});

$("enabled").addEventListener("change", save);
$("startExpanded").addEventListener("change", save);
document.querySelectorAll('input[type="number"]').forEach(function (input) {
  input.addEventListener("input", queueSave);
  input.addEventListener("change", function () {
    save();
    fillForm(); // reflect any clamping back into the fields
  });
});

$("reload").addEventListener("click", function () {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: "PP_RELOAD" }, function () {
    void chrome.runtime.lastError;
    window.close();
  });
});

$("reset").addEventListener("click", function () {
  settings = PP.clone(PP.DEFAULTS);
  chrome.storage.sync.set(settings, function () {
    fillForm();
    flashSaved();
    askTab();
  });
});

window.addEventListener("unload", function () {
  clearInterval(pollTimer);
});
