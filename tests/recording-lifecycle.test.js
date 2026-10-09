import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { importNativeTrack } from "../native-track.js";
import { emptyRow, migrateSurvey, recordStop, completeSurvey, reopenSurvey } from "../survey.js";
import { hkTimestamp, makeGpx, tripMetrics } from "../fieldkit.js";
import { hkClock } from "../core.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const functions = ["syncNativeTrack", "stopNativeTracking", "startNativeTracking", "pause", "complete", "goHome", "reconcileSavedNativeTracks", "downloadGpx"];
const handlers = functions.map(name => {
  const body = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(body, `actual app handler ${name} exists`);
  return body[0];
}).join("\n");
const point = (id, second) => ({ nativeId: id, lat: 22.3 + second / 1000, lng: 114.1,
  time: `2026-10-09T00:00:0${second}Z`, source: "gps" });
function fixture({ failStop = false, failSave = false } = {}) {
  const s = migrateSurvey({ id: "A", status: "in_progress", route: { route: "1" },
    stops: [{ id: "stop", name: { en: "Stop" } }], rows: [emptyRow()], startIndex: 0, activeIndex: 0, track: [] });
  const state = { currentId: s.id, surveys: [s] }, journals = { A: [point("early", 0)] };
  const calls = []; let durable, exported, error;
  const bridge = {
    startTracking(id) { calls.push(`start:${id}`); },
    stopTrackingAndDrain(id) {
      calls.push(`stop:${id}`);
      if (failStop) return false;
      if (!journals.A.some(p => p.nativeId === "tail")) journals.A.push(point("tail", 1));
      return true;
    },
    getTrackPage(id, cursor) {
      calls.push(`read:${id}`);
      const points = journals[id] || [];
      return JSON.stringify({ points: points.slice(Number(cursor || 0)), cursor: String(points.length), more: false });
    },
    saveGpx(gpx) { exported = gpx; },
  };
  const context = vm.createContext({ state, cur: () => state.surveys.find(s => s.id === state.currentId),
    window: { PassengerCountAndroid: bridge }, importNativeTrack, recordStop, completeSurvey,
    hkClock, hkTimestamp, tripMetrics, makeGpx, data: null,
    persist: () => { calls.push("save"); if (failSave) return false; durable = JSON.stringify(state); return true; },
    error: value => { error = value; }, t: value => value, renderCount() {},
    showScreen(screen) { state.screen = screen; durable = JSON.stringify(state); },
    exportFilename: () => "fixture.gpx", $: () => ({}), exportResult: value => { error = value; },
  });
  vm.runInContext(handlers, context);
  return { s, state, journals, calls, bridge, run: code => vm.runInContext(code, context),
    saved: () => JSON.parse(durable), exported: () => exported, error: () => error,
    allowSave: () => { failSave = false; }, allowStop: () => { failStop = false; } };
}
for (const status of ["paused", "aborted", "completed"]) {
  test(`actual ${status} handler drains acknowledged background tail before Home`, () => {
    const f = fixture();
    f.run(status === "completed" ? "complete()" : `pause("${status}")`);
    assert.equal(f.state.currentId, null);
    assert.equal(f.saved().surveys[0].status, status);
    assert.deepEqual(f.saved().surveys[0].track.map(p => p.nativeId), ["early", "tail"]);
    assert.equal(f.calls[0], "stop:A");
    assert.ok(f.calls.indexOf("read:A") > f.calls.indexOf("stop:A"));
    assert.equal(f.calls.some(c => c.startsWith("start:")), false);
    f.state.currentId = "A";
    f.run("downloadGpx()");
    assert.equal((f.exported().match(/<trkpt /g) || []).length, 2);
    assert.equal(f.s.status, status);
    assert.deepEqual(f.journals.A.map(p => p.nativeId), ["early", "tail"], "journal untouched by import/export");
  });
}
test("actual completion waits for stop acknowledgement and retry does not restart", () => {
  const f = fixture({ failStop: true });
  f.run("complete()");
  assert.equal(f.state.currentId, "A");
  assert.equal(f.error(), "recordFailed");
  assert.equal(f.calls.includes("read:A"), false);
  f.allowStop();
  f.run("complete()");
  assert.equal(f.state.currentId, null);
  assert.equal(f.saved().surveys[0].track.length, 2);
  assert.equal(f.calls.some(c => c.startsWith("start:")), false);
});
test("failed final storage commit keeps the journal/cursor retryable and blocks export", () => {
  const f = fixture({ failSave: true });
  f.run("complete(); downloadGpx()");
  assert.equal(f.state.currentId, "A");
  assert.equal(f.s.nativeTrackCursor, undefined);
  assert.deepEqual(f.s.track, []);
  assert.equal(f.exported(), undefined);
  assert.equal(f.journals.A.length, 2);
  f.allowSave(); f.run("complete()");
  assert.equal(f.saved().surveys[0].track.length, 2);
});
test("cold/foreground recovery imports completed survey A without starting or altering B", () => {
  const f = fixture();
  f.s.status = "completed";
  f.state.surveys.push({ id: "B", status: "in_progress", track: [] });
  f.state.currentId = "B";
  f.journals.B = [point("B-point", 2)];
  f.run("reconcileSavedNativeTracks()");
  assert.deepEqual(f.s.track.map(p => p.nativeId), ["early"]);
  assert.deepEqual(f.state.surveys[1].track.map(p => p.nativeId), ["B-point"]);
  assert.equal(f.state.currentId, "B");
  assert.equal(f.s.status, "completed");
  assert.equal(f.calls.some(c => /^(start|stop):/.test(c)), false);
});
test("only explicit reopen restarts a completed survey and preserves the drained track", () => {
  const f = fixture(); f.run("complete()");
  f.state.currentId = "A";
  f.run("startNativeTracking()");
  assert.equal(f.calls.includes("start:A"), false);
  reopenSurvey(f.s);
  f.run("startNativeTracking()");
  assert.equal(f.calls.at(-1), "start:A");
  assert.deepEqual(f.s.track.map(p => p.nativeId), ["early", "tail"]);
});
test("older APK remains compatible and drains after best-effort stop", () => {
  const f = fixture();
  f.bridge.stopTracking = f.bridge.stopTrackingAndDrain;
  delete f.bridge.stopTrackingAndDrain;
  f.run('pause("paused")');
  assert.deepEqual(f.saved().surveys[0].track.map(p => p.nativeId), ["early", "tail"]);
});
