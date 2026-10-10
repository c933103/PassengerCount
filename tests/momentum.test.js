import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { hkTimestamp, makeGpx, projectMomentum } from "../fieldkit.js";

const now = 1_791_529_200_000;
const fix = Object.freeze({ lat: 22.3, lng: 114.17, accuracy: 8, speed: 10,
  heading: 90, timestamp: now - 20_000, source: "gps" });
const invalid = [null, undefined, "", " ", "invalid", "0", "10", false, true,
  [], {}, NaN, Infinity, -Infinity];

for (const field of ["heading", "speed", "timestamp"]) {
  test(`momentum rejects absent, coerced and nonfinite ${field}`, () => {
    for (const value of [...invalid, String(fix[field])]) {
      assert.equal(projectMomentum({ ...fix, [field]: value }, now), null,
        `${field}=${typeof value}:${String(value)} must not be a measurement`);
    }
  });
}

test("momentum requires a finite numeric projection time", () => {
  // Undefined intentionally selects the function's default clock.
  for (const value of [...invalid, String(now)].filter(value => value !== undefined)) {
    assert.equal(projectMomentum(fix, value), null, `now=${String(value)}`);
  }
});

test("momentum preserves true north and zero speed without inventing movement", () => {
  const north = projectMomentum({ ...fix, heading: 0 }, now);
  assert.equal(north.heading, 0);
  assert.equal(north.source, "estimated");
  assert.ok(Math.abs((north.lat - fix.lat) * 111320 - 200) < 1e-8);
  assert.equal(north.lng, fix.lng);
  assert.equal(projectMomentum({ ...fix, speed: 0, heading: 0 }, now), null);
  assert.equal(projectMomentum({ ...fix, speed: -1 }, now), null);
  assert.equal(projectMomentum({ ...fix, speed: 0.499 }, now), null);
  assert.ok(projectMomentum({ ...fix, speed: 0.5 }, now));
});

test("momentum keeps the inclusive 12–120 second window and never chains estimates", () => {
  for (const age of [-1, 0, 11_999, 120_001]) {
    assert.equal(projectMomentum({ ...fix, timestamp: now - age }, now), null);
  }
  for (const age of [12_000, 120_000]) {
    const projected = projectMomentum({ ...fix, timestamp: now - age }, now);
    assert.equal(projected.timestamp, now);
    assert.equal(projected.source, "estimated");
    assert.ok(projected.accuracy > fix.accuracy);
    assert.equal(projectMomentum(projected, now + 20_000), null);
  }
  assert.ok(projectMomentum({ ...fix, timestamp: 0 }, 20_000), "epoch zero is a valid timestamp");
  assert.equal(projectMomentum(null, now), null);
});

test("momentum retains the speed cap without modifying measured evidence", () => {
  const measured = Object.freeze({ ...fix, speed: 100, heading: 0 });
  const projected = projectMomentum(measured, now);
  assert.ok(Math.abs((projected.lat - measured.lat) * 111320 - 900) < 1e-8);
  assert.equal(projected.speed, 100);
  assert.equal(measured.source, "gps");
  assert.equal(measured.timestamp, now - 20_000);
});

// Exercise the actual geolocation success/error and track-append handlers, with
// only browser dependencies and the clock replaced by deterministic fixtures.
const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const handlers = ["appendTrackPoint", "locate"].map(name => {
  const body = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(body, `actual app handler ${name} exists`);
  return body[0];
}).join("\n");
function locationFixture() {
  const survey = { status: "in_progress", track: [], route: { route: "1" } };
  const gps = {};
  let success, failure, saves = 0;
  const context = vm.createContext({
    navigator: { geolocation: {
      watchPosition(onSuccess, onFailure) { success = onSuccess; failure = onFailure; return 1; },
      clearWatch() {},
    } },
    watch: undefined, position: null, lastGpsFix: null, nearestIndex: null, map: null,
    cur: () => survey, hkTimestamp, projectMomentum: value => projectMomentum(value, now),
    persist: () => { saves++; }, updateGps() {}, suggest() {}, renderGpsText() {},
    $: () => gps, t: value => value,
  });
  vm.runInContext(`${handlers}\nlocate();`, context);
  return { survey, context, gps, saves: () => saves,
    success: heading => success({ coords: { latitude: fix.lat, longitude: fix.lng,
      accuracy: fix.accuracy, speed: fix.speed, heading }, timestamp: fix.timestamp }),
    failure: (code = 2) => failure({ code }),
  };
}

test("GPS outage with missing heading retains the measured fix without appending a northward estimate", () => {
  for (const heading of [null, undefined, "", "invalid"]) {
    const f = locationFixture();
    f.success(heading);
    f.failure();
    assert.equal(f.survey.track.length, 1);
    assert.equal(f.survey.track[0].source, "gps");
    assert.equal(f.survey.track[0].heading, null);
    assert.equal(f.survey.track[0].lat, fix.lat);
    assert.equal(f.context.position, null);
    assert.equal(f.gps.textContent, "gpsUnavailable");
    assert.equal(f.saves(), 1);
    assert.doesNotMatch(makeGpx(f.survey), /estimated/);
  }
});

test("GPS outage with heading zero appends a labelled estimate and permission denial never projects", () => {
  const f = locationFixture();
  f.success(0);
  f.failure();
  assert.equal(f.survey.track.length, 2);
  assert.equal(f.survey.track[0].source, "gps");
  assert.equal(f.survey.track[0].heading, 0);
  assert.equal(f.survey.track[1].source, "estimated");
  assert.equal(f.survey.track[1].heading, 0);
  assert.ok(f.survey.track[1].lat > fix.lat);
  const gpx = makeGpx(f.survey);
  assert.match(gpx, /<pc:accuracy_m>125<\/pc:accuracy_m>/);
  assert.match(gpx, /<pc:source>estimated<\/pc:source>/);
  assert.match(gpx, /<pc:heading_deg>0<\/pc:heading_deg>/);
  const denied = locationFixture();
  denied.success(0);
  denied.failure(1);
  assert.equal(denied.survey.track.length, 1);
  assert.equal(denied.context.position, null);
  assert.equal(denied.gps.textContent, "gpsDenied");
});
