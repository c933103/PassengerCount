import test from "node:test";
import assert from "node:assert/strict";
import { importNativeTrack, mergeNativeTrack } from "../native-track.js";
import { makeGpx, validTrackInterruptions } from "../fieldkit.js";

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

const interruption = (id = 'denied-1', time = '2026-10-15T09:09:43.160Z') => ({
  nativeId: id, event: 'foreground_start_denied', timestamp: Date.parse(time),
});
test('interruption evidence is durable and replay-idempotent without inventing a GPS fix', () => {
  const s = survey(), reader = bridge({ one: [point('before'), interruption()] }, 1);
  let saved;
  assert.equal(importNativeTrack(s, reader, () => { saved = JSON.stringify(s); return true; }), true);
  assert.equal(s.track.length, 1);
  assert.deepEqual(s.trackInterruptions, [{ nativeId: 'denied-1', reason: 'foreground_start_denied', observedAt: '2026-10-15T09:09:43.160Z' }]);
  const restarted = JSON.parse(saved);
  restarted.nativeTrackCursor = '';
  importNativeTrack(restarted, reader, () => true);
  assert.deepEqual(restarted.trackInterruptions, s.trackInterruptions);
  assert.equal(restarted.track.length, 1);
});
test('failed workspace write rolls back interruption, point and shared journal cursor together', () => {
  const s = survey(), reader = bridge({ one: [point('before'), interruption()] });
  const before = JSON.stringify(s);
  assert.equal(importNativeTrack(s, reader, () => false), false);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => importNativeTrack(s, reader, () => { throw Error('storage unavailable'); }), /storage unavailable/);
  assert.equal(JSON.stringify(s), before);
  assert.equal(importNativeTrack(s, reader, () => true), true);
  assert.equal(s.nativeTrackCursor, '2');
  assert.equal(s.trackInterruptions.length, 1);
});
test('malformed interruption cannot be silently consumed by a new cursor', () => {
  for (const invalid of [{ ...interruption(), timestamp: null }, { ...interruption(), timestamp: 1e100 }, { ...interruption(), nativeId: '' }]) {
    const s = survey();
    assert.throws(() => importNativeTrack(s, bridge({ one: [invalid] }), () => assert.fail('must not persist')), /Invalid native tracking interruption/);
    assert.equal(s.nativeTrackCursor, undefined);
    assert.equal(s.trackInterruptions, undefined);
  }
});
test('later native fixes preserve the historical denial instead of claiming its missing interval', () => {
  const s = survey(), journal = [interruption()], reader = bridge({ one: journal });
  importNativeTrack(s, reader, () => true);
  journal.push(point('after', 0, { time: '2026-10-15T09:20:00Z' }));
  importNativeTrack(s, reader, () => true);
  assert.equal(s.trackInterruptions.length, 1);
  assert.equal(s.trackInterruptions[0].resumedAt, undefined);
  assert.equal(s.trackInterruptions[0].startedAt, undefined);
  assert.equal(s.track.length, 1);
});
test('GPX exposes denial evidence and separates points across the observation without synthetic coordinates', () => {
  const s = survey(), reader = bridge({ one: [point('before', 0, { time: '2026-10-15T09:09:00Z' }), interruption(), point('after', 0, { time: '2026-10-15T09:20:00Z' })] });
  importNativeTrack(s, reader, () => true);
  const gpx = makeGpx(s);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
  assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
  assert.match(gpx, /<pc:tracking_interruption observed_at="2026-10-15T09:09:43.160Z">foreground_start_denied<\/pc:tracking_interruption>/);
  assert.doesNotMatch(gpx, /resumed_at|gap_start/);
});


test('malformed stored interruption metadata cannot block valid journal points or GPX', () => {
  for (const previous of [{ unexpected: true }, null, "invalid", [null, 7, {}, { reason: 'foreground_start_denied', observedAt: null }]]) {
    const s = survey(), original = structuredClone(previous);
    s.trackInterruptions = previous;
    s.track = [point('before', 0, { time: '2026-10-15T09:09:00Z' })];
    assert.equal((makeGpx(s).match(/<trkpt /g) || []).length, 1);
    assert.deepEqual(s.trackInterruptions, original, 'export does not mutate malformed evidence');
    importNativeTrack(s, bridge({ one: [interruption(), point('after', 0, { time: '2026-10-15T09:20:00Z' })] }), () => true);
    assert.equal(s.track.length, 2);
    assert.equal(s.nativeTrackCursor, '2');
    assert.equal(validTrackInterruptions(s).length, 1);
    assert.deepEqual(s.trackInterruptions.slice(0, -1), Array.isArray(original) ? original : [original], 'structured evidence remains available');
    const gpx = makeGpx(s);
    assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
    assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
    assert.equal((gpx.match(/<pc:tracking_interruption /g) || []).length, 1);
    importNativeTrack(s, bridge({ one: [interruption()] }), () => true);
    assert.equal(validTrackInterruptions(s).length, 1, 'valid denial remains replay-idempotent');
  }
});


test('partial and impossible retained timestamps never determine GPX interruption placement', () => {
  for (const invalid of ['not-a-timestamp', '2027', '2026-02-30', '2027-02-30T09:10:00Z', '2026-10-15T25:00:00Z']) {
    const s = survey();
    s.track = [point('before', 0, { time: '2026-10-15T17:09:00+08:00' }),
      point('invalid', 1, { time: invalid }),
      point('after', 2, { time: '2026-10-15T09:20:00.123456789Z' })];
    s.trackInterruptions = [{ nativeId: 'denied', reason: 'foreground_start_denied', observedAt: '2026-10-15T09:09:43.160Z' }];
    const before = JSON.stringify(s), gpx = makeGpx(s);
    assert.equal((gpx.match(/<trkpt /g) || []).length, 3, 'all existing coordinate evidence is retained');
    assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
    assert.match(gpx, /<\/trkseg><trkseg><trkpt lat="22.0002000"/, 'only the valid post-denial fix places the boundary');
    assert.equal(JSON.stringify(s), before, 'export cannot rewrite source timestamps');
  }
});

test('partial or impossible historical observation dates cannot suppress a valid journal receipt', () => {
  for (const invalid of ['2027', '2026-02-30T10:00:00Z']) {
    const s = survey();
    const old = { nativeId: 'denied-1', reason: 'foreground_start_denied', observedAt: invalid };
    s.trackInterruptions = [old];
    assert.equal(validTrackInterruptions(s).length, 0);
    importNativeTrack(s, bridge({ one: [interruption()] }), () => true);
    assert.deepEqual(s.trackInterruptions[0], old, 'malformed original remains in structured evidence');
    assert.equal(validTrackInterruptions(s).length, 1, 'valid journal observation remains importable');
    assert.equal(s.nativeTrackCursor, '1');
  }
});

test('valid leap-day, timezone offsets and fractional seconds retain their original GPX spelling', () => {
  for (const after of ['2024-02-29T03:00:01-05:00', '2024-02-29T13:30:01.1+05:30', '2024-02-29T08:00:01.123456Z', '2024-02-29T08:00:01.123456789Z', '2024-02-29T08:00:01.1234567890Z', '2024-02-29T13:30:01.12345678901234567890+05:30']) {
    const s = survey();
    s.track = [point('before', 0, { time: '2024-02-29T16:00:00+08:00' }), point('after', 1, { time: after })];
    s.trackInterruptions = [{ nativeId: 'denied', reason: 'foreground_start_denied', observedAt: '2024-02-29T08:00:00.500Z' }];
    const before = JSON.stringify(s), gpx = makeGpx(s);
    assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
    assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
    assert.ok(gpx.includes(`<time>${after}</time>`));
    assert.ok(gpx.includes('<time>2024-02-29T16:00:00+08:00</time>'));
    assert.equal(JSON.stringify(s), before);
  }
});


test('long fractional observation timestamps remain visible and split valid points without rewriting evidence', () => {
  for (const observedAt of ['2024-02-29T08:00:00.5001234567Z', '2024-02-29T13:30:00.50012345678901234567+05:30']) {
    const s = survey();
    s.track = [point('before', 0, { time: '2024-02-29T08:00:00Z' }), point('after', 1, { time: '2024-02-29T08:00:01.1234567890123Z' })];
    s.trackInterruptions = [{ nativeId: 'denied', reason: 'foreground_start_denied', observedAt }];
    const before = JSON.stringify(s), gpx = makeGpx(s);
    assert.equal(validTrackInterruptions(s).length, 1);
    assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
    assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
    assert.ok(gpx.includes(`observed_at="${observedAt}"`));
    assert.equal(JSON.stringify(s), before);
  }
});


test('GPX compares sub-millisecond instants exactly across offsets, arbitrary fractions and equality', () => {
  const cases = [
    // Same second and millisecond: the accepted fractional tail determines order.
    ['2024-02-29T08:00:00.5001234566Z', '2024-02-29T08:00:00.5001234567Z', '2024-02-29T08:00:00.5001234568Z', 2],
    ['2024-02-29T16:00:00.5001234566+08:00', '2024-02-29T03:00:00.5001234567-05:00', '2024-02-29T13:30:00.5001234568+05:30', 2],
    // Exact event equality at the later point splits; equality at the prior point does not.
    ['2024-02-29T08:00:00.5Z', '2024-02-29T08:00:00.5000000001Z', '2024-02-29T16:00:00.5000000001000+08:00', 2],
    ['2024-02-29T16:00:00.5000+08:00', '2024-02-29T03:00:00.5-05:00', '2024-02-29T08:00:00.5000000001Z', 1],
    ['2024-02-29T08:00:00Z', '2024-02-29T08:00:00.0000Z', '2024-02-29T08:00:00.0001Z', 1],
    ['2024-02-29T08:00:00.5000000001Z', '2024-02-29T08:00:00.5000000002Z', '2024-02-29T08:00:00.50000000015Z', 1],
    // Whole-second comparison also works before epoch and across calendar/offset rollover.
    ['1969-12-31T23:59:59.999999999Z', '1970-01-01T00:00:00Z', '1970-01-01T05:30:00.000000001+05:30', 2],
  ];
  for (const length of [1, 3, 10, 20, 100, 1000]) {
    const tail = '0'.repeat(length);
    cases.push([`2024-02-29T08:00:00.${tail}1Z`, `2024-02-29T08:00:00.${tail}2Z`, `2024-02-29T08:00:00.${tail}3Z`, 2]);
  }
  for (const [beforeTime, observedAt, afterTime, segments] of cases) {
    const s = survey();
    s.track = [point('before', 0, { time: beforeTime }), point('after', 1, { time: afterTime })];
    s.trackInterruptions = [{ nativeId: 'denied', reason: 'foreground_start_denied', observedAt }];
    const before = JSON.stringify(s), gpx = makeGpx(s);
    assert.equal(validTrackInterruptions(s).length, 1);
    assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
    assert.equal((gpx.match(/<trkseg>/g) || []).length, segments, JSON.stringify([beforeTime, observedAt, afterTime]));
    assert.ok(gpx.includes(`<time>${beforeTime}</time>`));
    assert.ok(gpx.includes(`<time>${afterTime}</time>`));
    assert.ok(gpx.includes(`observed_at="${observedAt}"`));
    assert.equal(JSON.stringify(s), before);
  }
});
