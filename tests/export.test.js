import test from "node:test";
import assert from "node:assert/strict";
import { makeExportBundle } from "../export.js";

const survey = {
  id: "12345678-abcd",
  surveyor: "Tester",
  date: "2026-09-23",
  vehicle: "AB1234",
  notes: "ordinary note",
  status: "completed",
  completedAt: "2026-09-23T05:00:00Z",
  startIndex: 0,
  endIndex: 1,
  initialOnboard: "2",
  finalOnboard: "",
  startsAtOrigin: false,
  endsAtTerminus: true,
  routeEdits: [{ type: "edit", index: 1 }],
  vehicleMatch: { input: "AB1234", operator: "ctb", model: "Volvo B8L", seats: 85, capacity: 133, matched: true },
  calendarContext: { date: "2026-09-23", publicHoliday: { name: "fixture" }, schoolHoliday: { known: false } },
  weatherHistory: [{ at: "2026-09-23T12:00:00+08:00", emoji: "🌧️", snapshot: { warnings: { rain: true } } }],
  etaSnapshots: [{ capturedAt: "2026-09-23T12:01:00+08:00", results: [{ available: true, candidateHeadwayMinutes: 10 }] }],
  metrics: { served: 9, fare: 50, currency: "HKD", unpriced: 2, priced: 7, assumption: "boarding-stop-to-route-terminus" },
  route: { route: "1", operator: "ctb", direction: "outbound", key: "td-r1::ctb", serviceType: "R1", source: "hk-td-gtfs-v1" },
  stops: [
    { id: "s0", sequence: 1, name: { zh: "甲站", en: "A" }, lat: 22.3, lng: 114.17, zone: "A" },
    { id: "s1", sequence: 2, name: { zh: "乙站", en: "B" }, lat: 22.31, lng: 114.18, zone: "B" },
  ],
  rows: [
    { time: "12:00", observedAt: "2026-09-23T12:00:00+08:00", boarding: "3", alighting: "0", onboard: "5", notes: "", recorded: true, skipped: {} },
    { time: "12:10", observedAt: "2026-09-23T12:10:00+08:00", boarding: "4", alighting: "6", onboard: "3", notes: "stop note", recorded: true, skipped: {} },
  ],
  track: [
    { lat: 22.3, lng: 114.17, time: "2026-09-23T12:00:00+08:00", accuracy: 8, speed: 12.5, heading: 91, source: "gps" },
  ],
};

test("trip bundle separates tabular, structured, geographic and chart data", () => {
  const data = { fares: { R1: [{ origin: "A", destination: "B", price: 10, currency: "HKD" }] } };
  const bundle = makeExportBundle(
    structuredClone(survey),
    data,
    "data:image/png;base64,iVBORw0KGgo=",
    new Date("2026-09-23T05:10:11.123Z"),
  );

  assert.equal(bundle.folder, bundle.base);
  assert.match(bundle.base, /^bus-1-2026-09-23-12345678-20260923T051011123Z$/);

  assert.match(bundle.csv, /PASSENGER DATA/);
  assert.match(bundle.csv, /observed_at_hkt/);
  assert.doesNotMatch(bundle.csv, /Calendar context|Weather history|ETA snapshots|Vehicle match|Track points|Trip metrics/);

  const record = JSON.parse(bundle.json);
  assert.equal(record.schema, "app.passengercount.trip-export/v1");
  assert.deepEqual(record.survey.vehicleMatch, survey.vehicleMatch);
  assert.deepEqual(record.survey.calendarContext, survey.calendarContext);
  assert.deepEqual(record.survey.weatherHistory, survey.weatherHistory);
  assert.deepEqual(record.survey.etaSnapshots, survey.etaSnapshots);
  assert.equal(record.survey.stops[0].lat, 22.3);
  assert.equal(record.survey.track, undefined);
  assert.equal(record.survey.upload, undefined);
  assert.equal(record.track.points, 1);
  assert.equal(record.track.file, bundle.base + ".gpx");

  assert.match(bundle.gpx, /<trkpt /);
  assert.match(bundle.gpx, /<pc:accuracy_m>8<\/pc:accuracy_m>/);
  assert.match(bundle.gpx, /<pc:speed_mps>12.5<\/pc:speed_mps>/);
  assert.match(bundle.gpx, /<pc:heading_deg>91<\/pc:heading_deg>/);
  assert.match(bundle.gpx, /<pc:source>gps<\/pc:source>/);
  assert.equal(bundle.pngBase64, "iVBORw0KGgo=");
});
