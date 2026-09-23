import test from "node:test";
import assert from "node:assert/strict";
import {
  hkTimestamp,
  makeGpx,
  parseVehicleProfiles,
  matchVehicle,
  tripMetrics,
  projectMomentum,
  festivalFromLunar,
  schoolHolidayForDate,
} from "../fieldkit.js";
import { fetchWeatherSnapshot, fetchEtaEvidence } from "../live.js";

test("Hong Kong timestamps include full date, time and fixed +08:00 offset", () => {
  assert.equal(hkTimestamp(new Date("2026-09-22T16:30:45Z")), "2026-09-23T00:30:45+08:00");
  assert.equal(
    hkTimestamp(new Date("2026-09-23T01:30:45+09:00")),
    "2026-09-23T00:30:45+08:00",
    "same instant is independent of the phone/host timezone",
  );
});

test("GPX export keeps timestamped fixes and marks estimated fixes", () => {
  const xml = makeGpx({
    route: { route: "1" },
    date: "2026-09-22",
    track: [
      { lat: 22.3, lng: 114.17, time: "2026-09-22T12:00:00+08:00", accuracy: 8, source: "gps" },
      { lat: 22.301, lng: 114.171, time: "2026-09-22T12:00:10+08:00", accuracy: 40, source: "estimated" },
    ],
  });
  assert.match(xml, /<gpx version="1.1"/);
  assert.match(xml, /2026-09-22T12:00:00\+08:00/);
  assert.match(xml, /estimated; accuracy=40m/);
  assert.equal((xml.match(/<trkpt /g) || []).length, 2);
});

test("vehicle profiles pattern-match fleet or registration numbers", () => {
  const profiles = parseVehicleProfiles("AB*|ctb|Volvo B8L|85|133\n# ignored\nXY1234|kmb|ADL Enviro500|80|129");
  assert.deepEqual(matchVehicle("ab 1234", profiles, "ctb"), {
    input: "AB1234", pattern: "AB*", operator: "ctb", model: "Volvo B8L", seats: 85, capacity: 133, matched: true,
  });
  assert.deepEqual(matchVehicle("ZZ9999", profiles, "nlb"), {
    input: "ZZ9999", operator: "nlb", model: "", seats: null, capacity: null, matched: false,
  });
});

test("trip metrics count people served and apply stop-specific sectional fares", () => {
  const s = {
    route: { serviceType: "R1" },
    startIndex: 0, endIndex: 2, initialOnboard: "2",
    stops: [{ zone: "A" }, { zone: "B" }, { zone: "C" }],
    rows: [{ boarding: "3" }, { boarding: "4" }, { boarding: "0" }],
  };
  const data = { fares: { R1: [
    { origin: "A", destination: "C", price: 10, currency: "HKD" },
    { origin: "B", destination: "C", price: 5, currency: "HKD" },
  ] } };
  assert.deepEqual(tripMetrics(s, data), {
    served: 9, fare: 50, currency: "HKD", unpriced: 2, priced: 7,
    assumption: "boarding-stop-to-route-terminus",
  });
});

test("trip metrics expose unpriced boardings instead of inventing fares", () => {
  const m = tripMetrics({
    route: { serviceType: "R2" }, startIndex: 0, endIndex: 0, initialOnboard: "",
    stops: [{ zone: "A" }], rows: [{ boarding: "6" }],
  }, { fares: {} });
  assert.equal(m.served, 6);
  assert.equal(m.fare, null);
  assert.equal(m.unpriced, 6);
});

test("momentum fallback only projects a stale moving GPS fix and labels it estimated", () => {
  const fix = { lat: 22.3, lng: 114.17, accuracy: 8, speed: 10, heading: 90, timestamp: 1_000_000, source: "gps" };
  assert.equal(projectMomentum(fix, 1_005_000), null);
  const projected = projectMomentum(fix, 1_020_000);
  assert.equal(projected.source, "estimated");
  assert.equal(projected.lat.toFixed(5), "22.30000");
  assert.ok(projected.lng > fix.lng);
  assert.ok(projected.accuracy > fix.accuracy);
});

test("school holidays stay unknown without a configured school calendar", () => {
  assert.deepEqual(schoolHolidayForDate("2026-12-24", []), {
    known: false, name: "", note: "No school-specific calendar configured",
  });
  assert.deepEqual(
    schoolHolidayForDate("2026-12-24", [{ start: "2026-12-20", end: "2027-01-03", name: "Christmas break" }]),
    { known: true, name: "Christmas break", start: "2026-12-20", end: "2027-01-03" },
  );
});

test("non-holiday festival context can be derived separately from public holidays", () => {
  assert.deepEqual(festivalFromLunar({ lunarDate: "七月初七" }), {
    name: "Qixi Festival", lunar: "七月初七",
  });
  assert.equal(festivalFromLunar({ lunarDate: "六月初一" }), null);
});

test("weather evidence tolerates partial official API failure", async () => {
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("warnsum")) return new Response("bad", { status: 503 });
    return new Response(JSON.stringify({ ok: true, url: String(url) }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const x = await fetchWeatherSnapshot("en");
    assert.equal(x.partial, true);
    assert.equal(x.warnings, null);
    assert.equal(x.current.ok, true);
    assert.equal(x.tips.ok, true);
  } finally { global.fetch = original; }
});

test("ETA evidence prefetches the current and downstream stops without claiming bus identity", async () => {
  const original = global.fetch;
  global.fetch = async (url) => new Response(JSON.stringify({
    data: [
      { route: "1A", eta: "2026-09-22T12:05:00+08:00", eta_seq: 1 },
      { route: "1A", eta: "2026-09-22T12:15:00+08:00", eta_seq: 2 },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const s = {
      route: { operator: "kmb", route: "1A" },
      stops: [
        { id: "0123456789ABCDEF" },
        { id: "1111111111111111" },
        { id: "2222222222222222" },
      ],
    };
    const e = await fetchEtaEvidence(s, 0, 2);
    assert.equal(e.results.length, 3);
    assert.equal(e.results[0].candidateHeadwayMinutes, 10);
    assert.equal(e.results[0].confirmedSurveyedBus, false);
    assert.match(e.note, /not identified/i);
  } finally { global.fetch = original; }
});
