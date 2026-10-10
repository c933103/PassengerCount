import test from "node:test";
import assert from "node:assert/strict";
import { uploadSurvey } from "../upload.js";

test("database upload uses only the reference webapp field contract", async () => {
  const requests = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options, body: JSON.parse(options.body) });
    if (String(url).endsWith("/surveys"))
      return new Response(JSON.stringify([{ id: 77 }]), { status: 201, headers: { "content-type": "application/json" } });
    return new Response("", { status: 201 });
  };
  const s = {
    id: "local-secret-id",
    surveyor: "Tester",
    date: "2026-09-23",
    vehicle: "AB1234",
    notes: "ordinary general note",
    status: "completed",
    completedAt: "2026-09-23T05:00:00Z",
    startIndex: 0,
    endIndex: 1,
    initialOnboard: "2",
    finalOnboard: "",
    startsAtOrigin: false,
    endsAtTerminus: true,
    routeEdits: [{ type: "edit" }],
    vehicleMatch: { model: "secret extra" },
    calendarContext: { publicHoliday: true },
    weatherHistory: [{ warning: true }],
    etaSnapshots: [{ hidden: true }],
    track: [{ lat: 1, lng: 2 }],
    route: { route: "1", operator: "kmb", key: "secret-variant" },
    stops: [
      { id: "s0", sequence: 1, name: { zh: "甲站", en: "A" } },
      { id: "s1", sequence: 2, name: { zh: "乙站", en: "B" } },
    ],
    rows: [
      { time: "12:00", boarding: "3", alighting: "", onboard: "5", notes: "first note", recorded: true, skipped: {}, observedAt: "2026-09-23T12:00:00+08:00" },
      { time: "12:10", boarding: "0", alighting: "2", onboard: "3", notes: "", recorded: true, skipped: {}, observedAt: "2026-09-23T12:10:00+08:00" },
    ],
  };
  const saves = [];
  try {
    await uploadSurvey(s, () => saves.push(structuredClone(s.upload)));
  } finally {
    global.fetch = original;
  }

  assert.equal(requests.length, 2);
  assert.deepEqual(Object.keys(requests[0].body[0]).sort(), [
    "general_notes","operator","route","survey_date","survey_day","survey_end",
    "survey_start","survey_start_time","surveyor_name","vehicle_number",
  ].sort());
  assert.deepEqual(requests[0].body[0], {
    surveyor_name: "Tester",
    survey_date: "2026-09-23",
    survey_day: "Wednesday",
    operator: "KMB",
    route: "1",
    survey_start_time: "12:00",
    survey_start: "甲站",
    survey_end: "乙站",
    vehicle_number: "AB1234",
    general_notes: "ordinary general note",
  });

  assert.equal(requests[1].body.length, 2);
  assert.deepEqual(Object.keys(requests[1].body[0]).sort(), [
    "alighting","boarding","notes","onboard","stop_en","stop_tc","stop_time","survey_id","total",
  ].sort());
  assert.deepEqual(requests[1].body[0], {
    stop_tc: "甲站", stop_en: "A", stop_time: "12:00",
    boarding: 3, alighting: null, onboard: 5, total: 8,
    notes: "first note", survey_id: 77,
  });
  assert.deepEqual(requests[1].body[1], {
    stop_tc: "乙站", stop_en: "B", stop_time: "12:10",
    boarding: null, alighting: 2, onboard: 3, total: 8,
    notes: null, survey_id: 77,
  });
  const raw = requests.map((r) => JSON.stringify(r.body)).join("\n");
  assert.doesNotMatch(raw, /PassengerCount|local-secret-id|secret-variant|vehicleMatch|calendarContext|weatherHistory|etaSnapshots|observedAt/);
});


test("database survey start stays at the configured mid-route start even when earlier onboard values are derived", async () => {
  const requests = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).endsWith("/surveys"))
      return new Response(JSON.stringify([{ id: 88 }]), { status: 201, headers: { "content-type": "application/json" } });
    return new Response("", { status: 201 });
  };
  const s = {
    id: "mid-route",
    surveyor: "Tester",
    date: "2026-09-23",
    vehicle: "",
    notes: "",
    status: "in_progress",
    startIndex: 1,
    initialOnboard: "5",
    finalOnboard: "",
    startsAtOrigin: false,
    endsAtTerminus: false,
    route: { route: "1", operator: "kmb" },
    stops: [
      { id: "s0", sequence: 1, name: { zh: "甲站", en: "A" } },
      { id: "s1", sequence: 2, name: { zh: "乙站", en: "B" } },
      { id: "s2", sequence: 3, name: { zh: "丙站", en: "C" } },
    ],
    rows: [
      { time: "", boarding: "", alighting: "", onboard: "", notes: "", recorded: false, skipped: {} },
      { time: "12:00", boarding: "2", alighting: "0", onboard: "", notes: "", recorded: true, skipped: {} },
      { time: "", boarding: "", alighting: "", onboard: "", notes: "", recorded: false, skipped: {} },
    ],
  };
  try {
    await uploadSurvey(s, () => {});
  } finally {
    global.fetch = original;
  }
  assert.equal(requests[0].body[0].survey_start, "乙站");
  assert.equal(requests[0].body[0].survey_start_time, "12:00");
  assert.equal(requests[1].body[0].stop_tc, "甲站", "a derived earlier passenger log does not redefine survey start");
});
