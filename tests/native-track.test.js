import test from "node:test";
import assert from "node:assert/strict";
import { importNativeTrack, mergeNativeTrack } from "../native-track.js";
import { makeGpx } from "../fieldkit.js";

const point = (id, n = 0, extra = {}) => ({ nativeId: id, lat: 22 + n / 10000, lng: 114,
  time: new Date(1700000000000 + n * 1000).toISOString(), accuracy: 4, speed: 2,
  heading: 30, source: "gps", ...extra });
const survey = (id = "one") => ({ id, status: "in_progress", track: [] });
function bridge(journals, size = 256) {
  const calls = [];
  return { calls, getTrackPage(id, cursor) {
    calls.push({ id, cursor });
    const points = journals[id];
    const start = Number(cursor || 0), end = Math.min(points.length, start + size);
    return JSON.stringify({ points: points.slice(start, end).map((p, i) => ({ ...p, nativeOrder: start + i })), cursor: String(end), more: end < points.length });
  } };
}
test("repeated View/export imports and cold restart keep A,B exactly once", () => {
  let s = survey(), durable;
  const b = bridge({ one: [point("A"), point("B", 1)] });
  const save = () => { durable = JSON.stringify(s); return true; };
  for (let i = 0; i < 4; i++) importNativeTrack(s, b, save);
  assert.deepEqual(s.track.map((p) => p.nativeId), ["A", "B"]);
  const gpx = makeGpx(s);
  s = JSON.parse(durable);
  importNativeTrack(s, b, save);
  assert.equal(makeGpx(s), gpx);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
  assert.equal(b.calls.at(-1).cursor, "2");
});
test("same-time fixes and exact repeat records have distinct journal identity", () => {
  const a = point("A"), b = { ...a, nativeId: "B" }, c = { ...a, nativeId: "C", accuracy: 5 };
  const result = mergeNativeTrack([], [a, b, c]);
  assert.deepEqual(result.map((p) => p.nativeId), ["A", "B", "C"]);
  assert.deepEqual(mergeNativeTrack(result, [a, b, c]), result);
});
test("overlapping foreground points are claimed once, distinct evidence preserved in time order", () => {
  const a = point("A"), b = point("B", 1), c = point("C", 2);
  const { nativeId, ...foregroundA } = a;
  const result = mergeNativeTrack([foregroundA, c], [a, b, { ...b, nativeId: "B2", speed: 3 }]);
  assert.deepEqual(result.map((p) => p.nativeId), ["A", "B", "B2", "C"]);
});
test("same clock time and location with distinct speed/heading/source is retained", () => {
  const a = point("A");
  const records = [a, { ...a, nativeId: "B", speed: 3 }, { ...a, nativeId: "C", heading: 40 },
    { ...a, nativeId: "D", source: "estimated" }];
  assert.equal(mergeNativeTrack([], records).length, 4);
});
test("independent survey cursors cannot consume another journal", () => {
  const a = survey(), b = survey("two"), reader = bridge({ one: [point("A")], two: [point("B")] });
  importNativeTrack(a, reader, () => true);
  importNativeTrack(b, reader, () => true);
  assert.equal(a.track[0].nativeId, "A");
  assert.equal(b.track[0].nativeId, "B");
  assert.deepEqual(reader.calls.map((c) => c.cursor), ["", ""]);
});
test("20,000-point truncation does not cause replay or block newer journal rows", () => {
  const points = Array.from({ length: 20003 }, (_, i) => point(String(i), i));
  const s = survey(), reader = bridge({ one: points }, 1000);
  importNativeTrack(s, reader, () => true);
  assert.equal(s.track.length, 20000);
  assert.equal(s.track[0].nativeId, "3");
  assert.equal(s.track.at(-1).nativeId, "20002");
  const before = JSON.stringify(s);
  importNativeTrack(s, reader, () => true);
  assert.equal(JSON.stringify(s), before);
  points.push(point("20003", 20003));
  importNativeTrack(s, reader, () => true);
  assert.equal(s.track[0].nativeId, "4");
  assert.equal(s.track.at(-1).nativeId, "20003");
});
test("a reset/truncated journal may replay retained IDs without duplicating them", () => {
  const s = survey(), a = point("A"), b = point("B", 1);
  s.track = mergeNativeTrack([], [a, b]);
  s.nativeTrackCursor = "stale";
  importNativeTrack(s, { getTrackPage: () => JSON.stringify({ points: [a, b, point("C", 2)], cursor: "new", more: false }) }, () => true);
  assert.deepEqual(s.track.map((p) => p.nativeId), ["A", "B", "C"]);
});
test("failed persistence rolls back both track and cursor before retry", () => {
  const s = survey(), reader = bridge({ one: [point("A"), point("B", 1)] }, 1);
  const original = JSON.stringify(s);
  importNativeTrack(s, reader, () => false);
  assert.equal(JSON.stringify(s), original);
  assert.throws(() => importNativeTrack(s, reader, () => { throw Error("disk full"); }), /disk full/);
  assert.equal(JSON.stringify(s), original);
  importNativeTrack(s, reader, () => true);
  assert.deepEqual(s.track.map((p) => p.nativeId), ["A", "B"]);
});
test("older APK full snapshots are idempotent and keep duplicate occurrence counts", () => {
  const a = point("A"), b = point("B", 1);
  delete a.nativeId; delete b.nativeId;
  const s = survey(), reader = { getTrack: () => JSON.stringify([a, b, b]) };
  for (let i = 0; i < 3; i++) importNativeTrack(s, reader, () => true);
  assert.equal(s.track.length, 3);
});
test("invalid input does not consume cursor", () => {
  const s = survey();
  importNativeTrack(s, { getTrackPage: () => "{}" }, () => assert.fail());
  assert.equal(s.nativeTrackCursor, undefined);
});
test("cursor replay preserves journal occurrence order across equal-time cap boundary", () => {
  const points = Array.from({ length: 20003 }, (_, i) => point(String(i), i, {
    nativeOrder: i,
    ...(i < 6 ? { time: "2026-10-09T00:00:00Z" } : { time: new Date(Date.parse("2026-10-09T00:00:01Z") + i * 1000).toISOString() }),
  }));
  const s = survey(), reader = bridge({ one: points });
  importNativeTrack(s, reader, () => true);
  const expected = s.track.map((p) => p.nativeId);
  assert.deepEqual(expected, points.slice(3).map((p) => p.nativeId));
  delete s.nativeTrackCursor; // Simulate missing/invalidated anchor after restart.
  importNativeTrack(s, reader, () => true);
  assert.deepEqual(s.track.map((p) => p.nativeId), expected);
});

for (const status of ["paused", "aborted", "completed"]) {
  test(`${status} records reconcile native tails without restarting recording`, () => {
    const s = { ...survey(), status }, journal = [point("A"), point("B", 1)];
    const reader = { ...bridge({ one: journal }, 1), startTracking: () => assert.fail("read must not start") };
    let saved;
    assert.equal(importNativeTrack(s, reader, () => { saved = JSON.stringify(s); return true; }), true);
    assert.equal(s.status, status);
    assert.deepEqual(s.track.map(p => p.nativeId), ["A", "B"]);
    const restarted = JSON.parse(saved);
    journal.push(point("C", 2));
    importNativeTrack(restarted, reader, () => true);
    assert.deepEqual(restarted.track.map(p => p.nativeId), ["A", "B", "C"]);
    assert.equal((makeGpx(restarted).match(/<trkpt /g) || []).length, 3);
  });
}
test("failed final drain keeps its cursor retryable and reports failure", () => {
  const s = { ...survey(), status: "completed" }, reader = bridge({ one: [point("A")] });
  assert.equal(importNativeTrack(s, reader, () => false), false);
  assert.equal(s.nativeTrackCursor, undefined);
  assert.deepEqual(s.track, []);
  assert.equal(importNativeTrack(s, reader, () => true), true);
  assert.equal(s.track[0].nativeId, "A");
});
