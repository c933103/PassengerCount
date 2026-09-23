import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyRow,
  migrateSurvey,
  calculateOnboard,
  recordStop,
  skipField,
  rowObserved,
  completeSurvey,
  reopenSurvey,
  insertStop,
  appendSection,
  overlapCount,
} from "../survey.js";
import { makeCSV, records } from "../core.js";
import { messages, DEFAULT_LANGUAGE, translate } from "../i18n.js";
const stop = (id) => ({
  id,
  sequence: 1,
  name: { en: id, zh: id },
  lat: 22.3,
  lng: 114.1,
});
const survey = (n = 3, startIndex = 0) =>
  migrateSurvey({
    id: "test",
    date: "2026-09-16",
    route: {
      key: "a",
      route: "1",
      operator: "nlb",
      dest: { en: "C", zh: "丙" },
    },
    stops: Array.from({ length: n }, (_, i) => stop(String(i))),
    rows: Array.from({ length: n }, emptyRow),
    startIndex,
    activeIndex: startIndex,
    pendingStart: startIndex,
  });

test("starting at the origin assumes zero without requiring onboard input", () => {
  const s = survey();
  s.rows[0].boarding = "3";
  recordStop(s, 0, "10:00");
  assert.deepEqual(calculateOnboard(s).values, [3, null, null]);
  assert.equal(s.rows[0].onboard, "");
  s.rows[1].alighting = "1";
  recordStop(s, 1, "10:01");
  assert.deepEqual(calculateOnboard(s).values, [3, 2, null]);
});
test("no-change stops, including the last, are observations with explicit zeros", () => {
  const s = survey();
  s.rows.forEach((r, i) => recordStop(s, i, "10:00", true));
  assert.ok(
    s.rows.every(
      (r) =>
        r.recorded &&
        r.boarding === "0" &&
        r.alighting === "0" &&
        rowObserved(r),
    ),
  );
  assert.deepEqual(completeSurvey(s, 2).values, [0, 0, 0]);
  assert.equal(s.status, "completed");
  assert.equal(s.endIndex, 2);
  assert.ok(records(s).every((r) => r.observed));
});
test("NA fields can be skipped independently and differ from unobserved stops", () => {
  const s = survey();
  skipField(s, 0, "boarding");
  s.rows[0].alighting = "0";
  recordStop(s, 0, "10:00");
  assert.equal(s.rows[0].boarding, "");
  assert.equal(s.rows[0].skipped.boarding, true);
  assert.equal(rowObserved(s.rows[0]), true);
  assert.equal(rowObserved(s.rows[1]), false);
  assert.equal(calculateOnboard(s).values[0], 0);
});
test("mid-route counts stay unknown until a known observation or endpoint exists", () => {
  const s = survey(3, 1);
  s.rows[1].boarding = "2";
  recordStop(s, 1, "10:00");
  assert.deepEqual(calculateOnboard(s).values, [null, null, null]);
  s.initialOnboard = "5";
  assert.deepEqual(calculateOnboard(s).values, [5, 7, null]);
});
test("completion at last stop deduces previous onboard counts backwards from zero", () => {
  const s = survey(4, 1);
  s.rows[1].boarding = "3";
  s.rows[2].alighting = "1";
  s.rows[3].alighting = "5";
  for (let i = 1; i < 4; i++) recordStop(s, i, "10:00");
  assert.deepEqual(completeSurvey(s, 3).values, [3, 6, 5, 0]);
  assert.equal(s.rows[0].recorded, false);
  assert.equal(calculateOnboard(s).estimated[0], false); // All changes between anchor and stop 0 were observed.
});
test("a known final count at an early ending stop anchors that stop", () => {
  const s = survey(4, 1);
  s.rows[1].boarding = "2";
  s.finalOnboard = "4";
  assert.deepEqual(completeSurvey(s, 1).values, [2, 4, null, null]);
  assert.equal(calculateOnboard(s).issues.length, 0);
});
test("ending early or disabling terminus assumption cannot invent a final zero", () => {
  const s = survey(3, 1);
  recordStop(s, 1, "10:00", true);
  completeSurvey(s, 1);
  assert.deepEqual(calculateOnboard(s).values, [null, null, null]);
  s.endsAtTerminus = false;
  completeSurvey(s, 2);
  assert.deepEqual(calculateOnboard(s).values, [null, null, null]);
});
test("conflicting empty-origin/empty-terminus assumptions are reported without hiding passengers", () => {
  const s = survey();
  s.rows[0].boarding = "3";
  recordStop(s, 2, "10:00", true);
  const result = completeSurvey(s, 2);
  assert.deepEqual(result.values, [3, 3, 3]);
  assert.ok(result.issues.some((x) => x.type === "boundary" && x.actual === 3));
});
test("explicit observations override assumptions and expose inconsistencies", () => {
  const s = survey();
  s.rows[0].onboard = "7";
  const result = calculateOnboard(s);
  assert.equal(result.values[0], 7);
  assert.ok(result.issues.some((x) => x.type === "boundary"));
  s.startsAtOrigin = false;
  assert.deepEqual(calculateOnboard(s).issues, []);
});
test("incompatible manual anchors leave ambiguous intervening values unknown", () => {
  const s = survey(5, 1);
  s.rows[1].onboard = "4";
  s.rows[4].onboard = "8";
  const result = calculateOnboard(s);
  assert.deepEqual(result.values, [4, 4, null, null, 8]);
  assert.ok(result.issues.some((x) => x.type === "anchors"));
  s.rows[3].boarding = "4";
  assert.deepEqual(calculateOnboard(s).values, [4, 4, 4, 8, 8]);
});
test("negative calculated passengers are flagged, not clamped to zero", () => {
  const s = survey();
  s.rows[0].alighting = "2";
  const result = calculateOnboard(s);
  assert.equal(result.values[0], -2);
  assert.ok(result.issues.some((x) => x.type === "negative"));
});
test("backward filling through unobserved changes is retained and labelled estimated", () => {
  const s = survey(4, 2);
  s.rows[2].onboard = "5";
  const result = calculateOnboard(s);
  assert.deepEqual(result.values, [5, 5, 5, null]);
  assert.equal(result.estimated[0], true);
});
test("legacy survey migration retains entered values and adds lifecycle defaults", () => {
  const s = migrateSurvey({
    startIndex: 1,
    rows: [
      { time: "", boarding: "", alighting: "", onboard: "", notes: "" },
      { time: "10:00", boarding: "0", alighting: "0", onboard: "3", notes: "" },
    ],
  });
  assert.equal(s.status, "in_progress");
  assert.equal(s.rows[0].recorded, false);
  assert.equal(s.rows[1].recorded, true);
  assert.equal(s.rows[1].onboard, "3");
});
test("inserting a missing stop preserves row identity, selected stop and boundaries", () => {
  const s = survey(3, 1);
  s.endIndex = 2;
  s.rows[1].boarding = "9";
  const oldRow = s.rows[1];
  insertStop(s, 0, stop("custom"));
  assert.equal(s.rows[2], oldRow);
  assert.equal(s.activeIndex, 2);
  assert.equal(s.startIndex, 2);
  assert.equal(s.pendingStart, 2);
  assert.equal(s.endIndex, 3);
  assert.equal(s.stops[0].custom, true);
  assert.equal(s.startsAtOrigin, false);
  assert.equal(s.rows[0].recorded, false);
  assert.deepEqual(
    s.stops.map((x) => x.sequence),
    [1, 2, 3, 4],
  );
});
test("joining overlapping sections keeps later repeated stops and existing counts", () => {
  const s = survey();
  s.stops = ["a", "b", "c"].map(stop);
  s.rows[2].onboard = "6";
  s.activeIndex = 2;
  const next = ["b", "c", "d", "a"].map(stop);
  assert.equal(overlapCount(s.stops, next), 2);
  appendSection(
    s,
    { key: "b", route: "1", operator: "nlb", dest: { en: "A", zh: "甲" } },
    next,
    2,
  );
  assert.deepEqual(
    s.stops.map((x) => x.id),
    ["a", "b", "c", "d", "a"],
  );
  assert.equal(s.rows[2].onboard, "6");
  assert.equal(s.activeIndex, 2);
  assert.equal(s.rows.length, s.stops.length);
  assert.equal(s.routeEdits[0].skippedOverlap, 2);
});
test("a new lap can retain every stop and append clears the obsolete final boundary", () => {
  const s = survey();
  s.finalOnboard = "3";
  completeSurvey(s, 2);
  const stops = s.stops.map((x) => ({ ...x }));
  assert.equal(overlapCount(stops, stops), 3);
  appendSection(s, { key: "lap2", dest: {} }, stops, 0);
  assert.equal(s.rows.length, 6);
  assert.equal(s.rows[2].onboard, "3");
  assert.equal(s.finalOnboard, "");
  assert.equal(s.endIndex, null);
  assert.equal(s.status, "in_progress");
});
test("CSV preserves completed status, skipped fields, explicit zeros and route corrections", () => {
  const s = survey();
  recordStop(s, 0, "10:00", true);
  skipField(s, 1, "boarding");
  recordStop(s, 1, "10:01");
  insertStop(s, 3, stop("added"));
  completeSurvey(s, 3);
  const csv = makeCSV(s);
  assert.match(csv, /Status,completed/);
  assert.match(csv, /boarding_not_applicable/);
  assert.match(csv, /custom_stop/);
  assert.match(csv, /insert/);
  assert.match(csv, /observed_at_hkt/);
  assert.match(csv, /10:00,,0,0/);
});
test("default Cantonese and English have matching UI keys and interpolation", () => {
  assert.equal(DEFAULT_LANGUAGE, "yue-Hant-HK");
  assert.deepEqual(
    Object.keys(messages.en).sort(),
    Object.keys(messages[DEFAULT_LANGUAGE]).sort(),
  );
  assert.equal(translate("en", "skipPrefix", { n: 2 }), "Skip first 2 stops");
  assert.match(translate(DEFAULT_LANGUAGE, "skipPrefix", { n: 2 }), /2/);
});


test("reopening a completed journey preserves rows and releases its completed boundary", () => {
  const s = survey(4);
  recordStop(s, 0, "12:00", true);
  s.rows[1].boarding = "5";
  recordStop(s, 1, "12:10");
  completeSurvey(s, 1);
  s.finalOnboard = "5";
  const id = s.id;
  reopenSurvey(s);
  assert.equal(s.id, id);
  assert.equal(s.status, "in_progress");
  assert.equal(s.endIndex, null);
  assert.equal(s.completedAt, null);
  assert.equal(s.finalOnboard, "");
  assert.equal(s.rows[1].onboard, "5");
  assert.equal(s.rows[1].boarding, "5");
  assert.equal(s.rows[1].time, "12:10");
  assert.equal(s.activeIndex, 2);
  assert.equal(s.rows[2].recorded, false);
  s.rows[2].alighting = "2";
  recordStop(s, 2, "12:20");
  assert.equal(calculateOnboard(s).values[2], 3);
});
test("reopening an accidental terminus completion removes assumed zero without altering observations", () => {
  const s = survey(3, 1);
  recordStop(s, 1, "12:00", true);
  recordStop(s, 2, "12:10", true);
  completeSurvey(s, 2);
  assert.equal(calculateOnboard(s).values[2], 0);
  const rows = structuredClone(s.rows);
  reopenSurvey(s);
  assert.deepEqual(s.rows, rows);
  assert.equal(calculateOnboard(s).values[2], null);
  assert.equal(s.activeIndex, 2);
});
test("reopening cannot discard incompatible entered final counts", () => {
  const s = survey(3);
  s.rows[1].onboard = "3";
  s.finalOnboard = "5";
  completeSurvey(s, 1);
  const before = structuredClone(s);
  assert.throws(() => reopenSurvey(s), /Conflicting/);
  assert.deepEqual(s, before);
});
