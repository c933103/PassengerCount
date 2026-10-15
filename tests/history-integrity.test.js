import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as surveyModel from "../survey.js";
const { emptyRow, migrateSurvey, recordStop, completeSurvey, reopenSurvey, appendSection, insertStop } = surveyModel;
// Optional only for running this same suite as a behavioral baseline control.
const stopReference = surveyModel.stopReference || (() => null);
const reconcileEvidenceStops = surveyModel.reconcileEvidenceStops || (() => {});
import { load, save } from "../storage.js";
import { uploadReceiptStatus } from "../upload.js";
import { importNativeTrack } from "../native-track.js";
import { hkTimestamp, makeGpx, tripMetrics } from "../fieldkit.js";
import { hkClock, validPassengerCount } from "../core.js";
import { makeExportBundle } from "../export.js";

// Exercise production event handlers with synthetic storage and bridge commands.
// These are deterministic host regressions, not Android device validation.
const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const functions = [...(source.includes("function historySnapshot(") ? ["historySnapshot"] : []), "renderUploadStatus", "updateHistoryButtons", "resetHistory", "restoreHistory", "undo", "redo", "edit", "persist", "appendTrackPoint", "syncNativeTrack", "startNativeTracking", "stopNativeTracking", "showScreen", "openSurvey", "active", "pause", "complete", "goHome", "joinSection", "changeWeather", "captureStartEnvironment", "captureEta", "setCount", "enterKey"];
const handlers = functions.map(name => {
  const body = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(body, `actual app handler ${name} exists`);
  return body[0];
}).join("\n");
const point = (second, native = false) => ({ lat: 0.1 + second / 1000, lng: 0.2,
  time: `2026-10-11T00:00:${String(second).padStart(2, "0")}Z`, source: "gps",
  ...(native ? { nativeId: `synthetic-${second}`, nativeOrder: second } : {}) });
function fixture({ status = "in_progress", failSave = false, failStop = false } = {}) {
  const s = migrateSurvey({ id: "synthetic-A", status, route: { key: "A", route: "Synthetic", dest: {} },
    stops: ["a", "b", "c"].map(id => ({ id, name: { en: id } })), rows: [emptyRow(), emptyRow(), emptyRow()],
    startIndex: status === "draft" ? null : 0, pendingStart: 0, activeIndex: 0, track: [] });
  if (status === "completed") Object.assign(s, { endIndex: 0, completedAt: "2026-10-11T00:00:00Z" });
  const state = { currentId: s.id, surveys: [s] }, disk = new Map(), calls = [], journal = [];
  let nativeId = status === "in_progress" ? s.id : null, lastError;
  globalThis.localStorage = { getItem: key => disk.get(key) ?? null, setItem: (key, value) => {
    if (failSave) throw Error("Synthetic storage failure"); disk.set(key, value);
  } };
  const bridge = {
    startTracking(id) { calls.push(`start:${id}`); nativeId = id; },
    stopTrackingAndDrain(id) { calls.push(`stop:${id}`); if (failStop) return false; if (!id || nativeId === id) nativeId = null; return true; },
    getTrackPage(id, cursor) {
      calls.push(`read:${id}:${cursor}`);
      return JSON.stringify({ points: journal.slice(Number(cursor || 0)), cursor: String(journal.length), more: false });
    },
  };
  const noop = () => {}, elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: "0", disabled: false, hidden: false, open: false, append: noop, close() { this.open = false; } });
    return elements.get(id);
  };
  const context = vm.createContext({ state, cur: () => state.surveys.find(x => x.id === state.currentId),
    clone: value => JSON.parse(JSON.stringify(value)), undoStack: [], redoStack: [], historyCurrent: null, historyId: null,
    $, screen: status === "completed" ? "record" : "count", map: null, watch: undefined, markers: [],
    selectedRecordIds: new Set(), deleteMode: false, target: { index: 0, field: "boarding" }, replaceOnDigit: true, nearestIndex: null,
    document: { body: { dataset: {}, classList: { remove: noop } } }, navigator: {}, window: { PassengerCountAndroid: bridge, scrollTo: noop },
    setFollow: noop, renderHome: noop, locate: noop, requestAnimationFrame: noop, measureDock: noop,
    buildStopOptions: noop, buildTable: noop, renderSetup: noop, renderCount: noop, renderRecord: noop, setupMap: noop,
    t: value => value, error: value => { lastError = value; }, hkClock, hkTimestamp, tripMetrics, data: null,
    uploadReceiptStatus, deleting: id => state.deletingIds?.includes(id) === true,
    save, recordStop, completeSurvey, reopenSurvey, appendSection, insertStop, importNativeTrack,
    stopReference, reconcileEvidenceStops, validPassengerCount,
    schoolHolidayRanges: () => [],
    fetchCalendarContext: async () => ({ synthetic: true }),
    fetchWeatherSnapshot: async () => ({ synthetic: true }),
    fetchEtaEvidence: async (survey, index) => ({ currentStop: index, results:
      survey.stops.slice(index).map((stop, offset) => ({ stopIndex: index + offset, stopId: stop.id, available: true })) }),
    sectionOptions: [{ key: "B", route: "Synthetic B", dest: {} }], sectionStops: [{ id: "d", name: { en: "d" } }],
  });
  vm.runInContext(handlers, context);
  for (const id of ["confirm", "resume", "continueRecord", "setupHome"])
    vm.runInContext(source.match(new RegExp(`\\$\\("${id}"\\).onclick = \\(\\) => \\{[^]*?\\n\\};`))[0], context);
  vm.runInContext("resetHistory(); persist();", context);
  return { s, state, calls, journal, context, $, run: code => vm.runInContext(code, context), click: id => $(id).onclick(),
    saved: () => load(), nativeId: () => nativeId, error: () => lastError,
    failSave: value => { failSave = value; }, failStop: value => { failStop = value; } };
}
function countEdit(f, count = "3") { f.s.rows[f.s.activeIndex].boarding = count; f.run("edit()"); }
function assertTrack(f, expected) {
  assert.deepEqual(f.s.track.map(p => p.time), expected.map(p => p.time));
  const saved = f.saved().surveys[0];
  assert.deepEqual(saved.track.map(p => p.time), expected.map(p => p.time));
  assert.equal((makeGpx(saved).match(/<trkpt /g) || []).length, expected.length);
}

test("GPS fixes before/after edits, Undo and Redo survive actual save/load and GPX", () => {
  const f = fixture(), original = f.s;
  f.context.p = point(1); f.run("appendTrackPoint(cur(), p); persist()");
  countEdit(f);
  f.context.p = point(2); f.run("appendTrackPoint(cur(), p); persist(); undo()");
  assert.equal(f.s.rows[0].boarding, ""); assertTrack(f, [point(1), point(2)]);
  f.context.p = point(3); f.run("appendTrackPoint(cur(), p); persist(); redo()");
  assert.equal(f.s.rows[0].boarding, "3"); assertTrack(f, [point(1), point(2), point(3)]);
  assert.equal(f.state.surveys[0], original, "pending callbacks retain the persisted survey identity");
});

test("native import cursor and same-time distinct occurrences never roll back or duplicate", () => {
  const f = fixture(); countEdit(f);
  f.journal.push(point(1, true), { ...point(1, true), nativeId: "same-time-second", nativeOrder: 2 });
  f.run("syncNativeTrack(); undo(); syncNativeTrack(); redo(); syncNativeTrack()");
  assert.equal(f.s.nativeTrackCursor, "2"); assert.equal(f.s.track.length, 2);
  assert.deepEqual(f.s.track.map(p => p.nativeId), ["synthetic-1", "same-time-second"]);
  assert.equal(f.saved().surveys[0].nativeTrackCursor, "2");
  assert.ok(f.calls.filter(c => c.startsWith("read:")).slice(1).every(c => c.endsWith(":2")));
});

test("passive environment evidence and upload checkpoints survive history with live identity", () => {
  const f = fixture(); countEdit(f);
  const weather = { kind: "start", snapshot: null };
  f.s.weatherHistory.push(weather); f.s.etaSnapshots.push({ stopIndex: 0, results: [] });
  f.s.calendarContext = { synthetic: true }; f.s.upload = { headerId: 7, done: true };
  f.run("persist(); undo()"); weather.snapshot = { synthetic: true }; f.s.upload.done = false;
  f.run("persist(); redo()");
  assert.equal(f.s.weatherHistory[0], weather); assert.equal(f.s.upload.headerId, 7);
  assert.deepEqual(f.saved().surveys[0].weatherHistory[0].snapshot, { synthetic: true });
  assert.deepEqual(f.saved().surveys[0].calendarContext, { synthetic: true });
  assert.equal(f.saved().surveys[0].etaSnapshots.length, 1);
});

test("passive changes and updated timestamps cannot manufacture edits or consume Redo", () => {
  const f = fixture(); countEdit(f); f.run("undo()");
  f.context.p = point(1); f.run("appendTrackPoint(cur(), p); edit(); edit()");
  assert.equal(f.$("undo").disabled, true); assert.equal(f.$("redo").disabled, false);
  f.run("redo()"); assert.equal(f.s.rows[0].boarding, "3"); assertTrack(f, [point(1)]);
});

for (const status of ["draft", "paused", "aborted", "completed"]) {
  test(`${status} start/resume establishes a new count-history boundary`, () => {
    const f = fixture({ status }); countEdit(f, "1");
    if (status === "draft") f.click("confirm");
    else if (status === "completed") f.click("continueRecord");
    else f.run('openSurvey("synthetic-A", "resume")');
    const index = f.s.activeIndex; assert.equal(f.$("undo").disabled, true);
    countEdit(f, "2"); f.run("undo(); redo(); undo()");
    assert.equal(f.s.status, "in_progress"); assert.equal(f.s.completedAt ?? null, null);
    assert.equal(f.s.endIndex, null); assert.equal(f.nativeId(), f.s.id);
    assert.equal(f.s.rows[index].boarding, status === "completed" ? "" : "1");
    assert.equal(f.saved().surveys[0].status, "in_progress");
  });
}

test("setup Resume and setup Home also establish lifecycle boundaries", () => {
  const f = fixture({ status: "paused" }); countEdit(f); f.click("resume");
  countEdit(f, "4"); f.run("undo()"); assert.equal(f.s.status, "in_progress");
  f.click("setupHome"); assert.equal(f.s.status, "paused"); assert.equal(f.nativeId(), null);
  assert.equal(f.$("undo").disabled, true);
});

for (const status of ["paused", "aborted", "completed"]) {
  test(`${status} with failed stop/save cannot be reversed through count history`, () => {
    const f = fixture(); countEdit(f); f.failStop(true);
    f.run(status === "completed" ? "complete()" : `pause("${status}")`);
    f.run("undo(); redo()"); assert.equal(f.s.status, status); assert.equal(f.$("undo").disabled, true);
    assert.equal(f.error(), "recordFailed");
    f.failStop(false); f.failSave(true);
    f.run(status === "completed" ? "complete()" : `pause("${status}")`);
    assert.equal(f.state.currentId, f.s.id); assert.equal(f.s.status, status);
    f.failSave(false);
    f.run(status === "completed" ? "complete()" : `pause("${status}")`);
    assert.equal(f.state.currentId, null); assert.equal(f.nativeId(), null);
    assert.equal(f.saved().surveys[0].status, status);
  });
}

test("repeated completion/continuation retains evidence and never restores a former end", () => {
  const f = fixture();
  for (let cycle = 0; cycle < 3; cycle++) {
    countEdit(f, String(cycle + 1)); f.context.p = point(cycle); f.run("appendTrackPoint(cur(), p); complete()");
    f.run('openSurvey("synthetic-A", "record")');
    f.s.finalOnboard = String(cycle + 4); f.run("edit()"); f.click("continueRecord");
    assert.equal(f.s.finalOnboard, ""); assert.equal(f.s.endIndex, null);
    const before = f.s.rows[f.s.activeIndex].boarding;
    countEdit(f, "9"); f.run("undo(); redo(); undo()");
    assert.equal(f.s.rows[f.s.activeIndex].boarding, before);
    assert.equal(f.s.status, "in_progress"); assert.equal(f.nativeId(), f.s.id);
    assert.equal(f.s.track.length, cycle + 1); assert.equal(f.saved().surveys[0].track.length, cycle + 1);
  }
});

test("failed save after Undo retains evidence and the next successful save is recoverable", () => {
  const f = fixture(); countEdit(f); f.context.p = point(1); f.run("appendTrackPoint(cur(), p); persist()");
  f.failSave(true); f.run("undo()"); assert.equal(f.error(), "saveError");
  assert.equal(f.s.track.length, 1); assert.equal(f.saved().surveys[0].rows[0].boarding, "3");
  f.failSave(false); f.run("edit()"); assertTrack(f, [point(1)]);
  assert.equal(f.saved().surveys[0].rows[0].boarding, "");
  f.run("redo()"); assert.equal(f.s.rows[0].boarding, "3");
});

for (const status of ["completed", "paused", "aborted"]) {
  test(`joining a ${status} journey rebases history and starts the explicit continuation`, () => {
    const f = fixture({ status }); countEdit(f); f.run("joinSection()");
    assert.equal(f.s.stops.length, 4); assert.equal(f.$("undo").disabled, true);
    countEdit(f, "7"); f.run("undo(); redo(); undo()");
    assert.equal(f.s.stops.length, 4); assert.equal(f.s.status, "in_progress");
    assert.equal(f.s.endIndex, null); assert.equal(f.nativeId(), f.s.id);
  });
}

test("active section joins and stop insertion remain undoable while fresh evidence survives", () => {
  const f = fixture(); f.run("joinSection()"); assert.equal(f.s.stops.length, 4);
  f.context.p = point(1); f.run("appendTrackPoint(cur(), p); undo()");
  assert.equal(f.s.stops.length, 3); assertTrack(f, [point(1)]);
  f.run("redo(); insertStop(cur(), 0, { id: 'custom', name: { en: 'Custom' } }); edit(); undo()");
  assert.equal(f.s.stops.length, 4); assert.equal(f.s.startIndex, 0);
  f.run("redo()"); assert.equal(f.s.startIndex, 1); assert.equal(f.s.track.length, 1);
});

test("conflicting section join is a complete no-op, keeps the dialog open and reports correction", () => {
  const f = fixture({ status: "completed" }); f.s.finalOnboard = "5"; f.s.rows[0].onboard = "3";
  f.$("sectionDialog").open = true; f.run("resetHistory(); persist()");
  const before = JSON.stringify(f.s), saved = JSON.stringify(f.saved());
  f.run("joinSection()");
  assert.equal(JSON.stringify(f.s), before); assert.equal(JSON.stringify(f.saved()), saved);
  assert.equal(f.error(), "continueConflict"); assert.equal(f.$("sectionDialog").open, true);
  assert.equal(f.calls.length, 0); assert.equal(f.$("undo").disabled, true);
});


test("cold-restored active survey can undo its first edit without losing recovered evidence", () => {
  const f = fixture(); f.s.rows[0].boarding = "2";
  f.s.track.push(point(1)); f.s.nativeTrackCursor = "1"; f.run("persist()");
  f.context.initialScreen = "count";
  f.run("historyCurrent = null; historyId = null; undoStack = []; redoStack = [];");
  const bootstrap = source.match(/if \(cur\(\)\) \{\n  target =[^]*?\n\} else showScreen\("home"\);/);
  assert.ok(bootstrap, "actual restored-survey bootstrap exists");
  f.run(bootstrap[0]); countEdit(f, "3"); f.run("undo()");
  assert.equal(f.s.rows[0].boarding, "2");
  assert.equal(f.s.status, "in_progress");
  assert.equal(f.s.nativeTrackCursor, "1");
  assertTrack(f, [point(1)]);
});


const exportedSurvey = f => JSON.parse(makeExportBundle(f.s, null).json).survey;
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };

test("weather Undo/Redo toggles the intentional event while retaining late fetched evidence", async () => {
  const f = fixture(); f.s.weatherEmoji = "☀️"; f.run("resetHistory()");
  const pending = deferred(); f.context.fetchWeatherSnapshot = () => pending.promise;
  const capture = f.run('changeWeather("🌧️")'); f.run("undo()");
  assert.equal(f.s.weatherEmoji, "☀️");
  assert.equal(f.s.weatherHistory[0].undone, true);
  pending.resolve({ synthetic: "late weather" }); await capture;
  let exported = exportedSurvey(f);
  assert.equal(exported.weatherHistory[0].undone, true);
  assert.deepEqual(exported.weatherHistory[0].snapshot, { synthetic: "late weather" });
  f.run("redo()"); exported = exportedSurvey(f);
  assert.equal(exported.weatherEmoji, "🌧️"); assert.equal(exported.weatherHistory[0].undone, undefined);
  assert.deepEqual(exported.weatherHistory[0].snapshot, { synthetic: "late weather" });
  f.run("undo()"); await f.run('changeWeather("☁️")');
  assert.equal(f.s.weatherHistory.length, 2); assert.equal(f.s.weatherHistory[0].undone, true);
  assert.equal(f.s.weatherHistory[1].undone, undefined); assert.equal(f.$("redo").disabled, true);
});

test("late start weather and downstream ETA retain distinct repeated stop occurrences across Undo/Redo", async () => {
  const f = fixture(); f.s.stops[2].id = "a"; f.s.stops[2].name.en = "a repeat";
  const originalIds = f.s.stops.map(stop => stop.occurrenceId);
  f.s.weatherEmoji = "☀️"; f.run("resetHistory(); insertStop(cur(), 0, { id: 'custom', name: { en: 'Custom' } }); edit()");
  const weather = deferred(), eta = deferred();
  f.context.fetchWeatherSnapshot = () => weather.promise;
  f.context.fetchEtaEvidence = () => eta.promise;
  const startCapture = f.run("captureStartEnvironment(cur())"), etaCapture = f.run("captureEta(cur(), 1)");
  f.run("undo()"); f.s.weatherEmoji = "🌧️";
  weather.resolve({ synthetic: "late start" });
  eta.resolve({ currentStop: 1, results: [
    { stopIndex: 1, stopId: "a", available: true },
    { available: false, reason: "operator-not-supported" },
    { stopIndex: 3, stopId: "a", available: true },
  ] });
  await Promise.all([startCapture, etaCapture]);
  let exported = exportedSurvey(f), start = exported.weatherHistory[0], evidence = exported.etaSnapshots[0];
  assert.equal(start.kind, "start"); assert.equal(start.undone, undefined); assert.equal(start.emoji, "☀️");
  assert.equal(start.stopIndex, 0); assert.equal(start.stopRef.index, 1);
  assert.equal(start.stopRef.occurrenceId, originalIds[0]);
  assert.equal(evidence.currentStop, 0); assert.equal(evidence.currentStopRef.occurrenceId, originalIds[0]);
  assert.deepEqual(evidence.results.map(result => result.stopIndex), [0, 1, 2]);
  assert.deepEqual(evidence.results.map(result => result.stopRef.occurrenceId), originalIds);
  assert.notEqual(evidence.results[0].stopRef.occurrenceId, evidence.results[2].stopRef.occurrenceId);
  f.run("redo()"); exported = exportedSurvey(f); evidence = exported.etaSnapshots[0];
  assert.equal(exported.weatherHistory[0].stopIndex, 1);
  assert.deepEqual(evidence.results.map(result => result.stopIndex), [1, 2, 3]);
  assert.deepEqual(evidence.results.map(result => result.stopRef.occurrenceId), originalIds);
  assert.deepEqual(f.saved().surveys[0].etaSnapshots, exported.etaSnapshots);
});

test("evidence for an undone custom occurrence stays archived and reattaches only to that occurrence", async () => {
  const f = fixture(); f.run("insertStop(cur(), 0, { id: 'a', name: { en: 'Custom A' } }); edit()");
  const customId = f.s.stops[0].occurrenceId;
  await f.run("captureEta(cur(), 0)");
  f.run("undo()");
  let evidence = exportedSurvey(f).etaSnapshots[0];
  assert.equal(evidence.currentStop, null); assert.equal(evidence.currentStopRef.occurrenceId, customId);
  assert.equal(evidence.results[0].stopIndex, null); assert.equal(evidence.results[0].stopRef.stop.name.en, "Custom A");
  f.run("redo()"); assert.equal(exportedSurvey(f).etaSnapshots[0].currentStop, 0);
  f.run("undo(); insertStop(cur(), 0, { id: 'a', name: { en: 'Different A' } }); edit()");
  assert.notEqual(f.s.stops[0].occurrenceId, customId);
  assert.equal(exportedSurvey(f).etaSnapshots[0].currentStop, null);
  const restored = migrateSurvey(structuredClone(f.saved().surveys[0]));
  insertStop(restored, 0, { id: "a", name: { en: "After reload A" } });
  assert.notEqual(restored.stops[0].occurrenceId, customId);
  assert.equal(restored.etaSnapshots[0].currentStop, null);
});

test("existing captured evidence follows a later insertion and its Undo/Redo", async () => {
  const f = fixture(); await f.run("captureStartEnvironment(cur()); captureEta(cur(), 1)");
  await Promise.resolve();
  const reference = f.s.etaSnapshots[0].currentStopRef.occurrenceId;
  f.run("insertStop(cur(), 0, { id: 'custom', name: { en: 'Custom' } }); edit()");
  assert.equal(f.s.etaSnapshots[0].currentStop, 2);
  assert.equal(f.s.etaSnapshots[0].currentStopRef.occurrenceId, reference);
  f.run("undo(); redo()"); assert.equal(f.saved().surveys[0].etaSnapshots[0].currentStop, 2);
});

test("restored visible stop, keypad target and replacement buffer agree before the next digit", () => {
  const f = fixture(); f.run('setCount(0, "boarding", "3"); active(1); setCount(1, "boarding", "5"); undo(); enterKey("9")');
  assert.equal(f.s.activeIndex, 0); assert.equal(f.context.target.index, 0);
  assert.equal(f.s.rows[0].boarding, "9"); assert.equal(f.s.rows[1].boarding, "");
  f.run("undo(); redo(); enterKey('4')");
  assert.equal(f.s.rows[0].boarding, "4"); assert.equal(f.s.rows[1].boarding, "");
});


test("legacy index-only evidence is retained as unverified instead of assigning an occurrence", () => {
  const f = fixture();
  const legacy = structuredClone(f.s);
  legacy.stops[2].id = "a";
  legacy.weatherHistory = [{ kind: "start", stopIndex: 1, snapshot: { synthetic: true } }];
  legacy.etaSnapshots = [{ currentStop: 2, results: [{ stopIndex: 2, stopId: "a", available: true }] }];
  migrateSurvey(legacy);
  assert.equal(legacy.weatherHistory[0].stopIndex, null);
  assert.deepEqual(legacy.weatherHistory[0].stopRef, { occurrenceId: null, index: 1,
    stop: null, providerStopId: null, association: "unverified-legacy-index" });
  assert.equal(legacy.etaSnapshots[0].currentStop, null);
  assert.equal(legacy.etaSnapshots[0].results[0].stopIndex, null);
  assert.equal(legacy.etaSnapshots[0].results[0].stopRef.index, 2);
  assert.equal(legacy.etaSnapshots[0].results[0].stopRef.providerStopId, "a");
  assert.equal(legacy.etaSnapshots[0].results[0].stopRef.occurrenceId, null);
  insertStop(legacy, 0, { id: "a", name: { en: "Another A" } });
  assert.equal(legacy.etaSnapshots[0].results[0].stopIndex, null);
  assert.deepEqual(legacy.weatherHistory[0].snapshot, { synthetic: true });
});

test("denied-restart evidence survives edits, Undo/Redo, save/load and structured export", () => {
  const f = fixture();
  countEdit(f);
  f.journal.push({ nativeId: "synthetic-denial", event: "foreground_start_denied", timestamp: Date.parse("2026-10-15T09:09:43.160Z") });
  f.run("syncNativeTrack(); undo(); redo()");
  const expected = [{ nativeId: "synthetic-denial", reason: "foreground_start_denied", observedAt: "2026-10-15T09:09:43.160Z" }];
  assert.deepEqual(f.saved().surveys[0].trackInterruptions, expected);
  assert.deepEqual(exportedSurvey(f).trackInterruptions, expected);
  assert.equal(f.saved().surveys[0].nativeTrackCursor, "1");
  assert.equal(f.s.track.length, 0, "interruption is never a synthetic fix");
  assert.match(makeExportBundle(f.s, null).gpx, /tracking_interruption/);
});


test("view preserves active tracking and does not restart a denied service; resume requests tracking", () => {
  for (const running of [true, false]) {
    const f = fixture();
    if (!running) f.run('window.PassengerCountAndroid.stopTrackingAndDrain(state.currentId)');
    f.calls.length = 0;
    f.run('openSurvey(state.currentId, "record")');
    assert.equal(f.calls.some(call => call.startsWith("start:") || call.startsWith("stop:")), false);
    assert.equal(f.nativeId(), running ? f.s.id : null, "view leaves native session state untouched");
    assert.equal(f.s.status, "in_progress", "view does not rewrite survey status");
    f.run('openSurvey(state.currentId, "resume")');
    assert.equal(f.calls.filter(call => call === "start:synthetic-A").length, 1);
  }
});
