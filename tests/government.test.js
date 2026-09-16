import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import {
  normalizeGovernment,
  governmentServiceStatus,
  csvRows,
  GOVERNMENT_SOURCE,
} from "../government.js";
import { variants, stopsFor, validPassengerCount } from "../core.js";
const files = {
  "routes.txt":
    "route_id,agency_id,route_short_name,route_long_name,route_type\n1,KMB+CTB,88X,A - C,3\n2,DB,DB01R,Pier - Station,3\n",
  "stops.txt":
    "stop_id,stop_name,stop_lat,stop_lon\na,[CTB] City A|[KMB+CTB] Joint A,22.3,114.1\nb,B,22.31,114.11\nc,C,22.32,114.12\n",
  "trips.txt":
    "route_id,service_id,trip_id\n1,weekday,1-1-weekday-0800\n1,weekday,1-1-weekday-0900\n1,weekday,1-1-weekday-1000\n2,weekday,2-1-weekday-0800\n",
  "stop_times.txt":
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n1-1-weekday-0800,08:00:00,08:00:00,a,1\n1-1-weekday-0800,,,b,2\n1-1-weekday-0800,09:00:00,09:00:00,c,3\n1-1-weekday-0900,09:00:00,09:00:00,a,1\n1-1-weekday-0900,,,b,2\n1-1-weekday-0900,10:00:00,10:00:00,c,3\n1-1-weekday-1000,10:00:00,10:00:00,a,1\n1-1-weekday-1000,10:30:00,10:30:00,c,2\n2-1-weekday-0800,08:00:00,08:00:00,a,1\n2-1-weekday-0800,,,b,2\n2-1-weekday-0800,08:30:00,08:30:00,a,3\n",
  "calendar.txt":
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260101,20261231\n",
  "calendar_dates.txt":
    "service_id,date,exception_type\nweekday,20260916,2\nweekday,20260920,1\n",
  "frequencies.txt":
    "trip_id,start_time,end_time,headway_secs\n1-1-weekday-0800,08:00:00,09:00:00,600\n",
};
const translation = {
  "stops.txt": "stop_id,stop_name\na,甲\nb,乙\nc,丙\n",
  "routes.txt": "route_id,route_long_name\n1,甲 - 丙\n",
};
test("government conversion retains distinct sequences, joint operators, repeated stops and bilingual names", () => {
  const data = normalizeGovernment(files, translation);
  assert.equal(data.source.id, GOVERNMENT_SOURCE);
  assert.equal(Object.keys(data.routeList).length, 3);
  const found = variants(data, "88X", "ctb");
  assert.equal(found.length, 2);
  const route = found.find((r) => r.stopIds.length === 3);
  assert.equal(route.schedule.length, 2);
  assert.equal(stopsFor(route, data)[0].name.en, "Joint A");
  assert.equal(stopsFor(route, data)[0].name.zh, "甲");
  assert.deepEqual(variants(data, "DB01R")[0].stopIds, ["a", "b", "a"]);
});
test("government service calendars honour exceptions, date validity and overnight trips", () => {
  const data = normalizeGovernment(files, translation),
    route = variants(data, "88X", "ctb").find((r) => r.stopIds.length === 3);
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T00:20:00Z")).kind,
    "active",
  );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-16T00:20:00Z")).kind,
    "inactive",
  );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-20T00:20:00Z")).kind,
    "active",
  );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2027-09-20T00:20:00Z")).kind,
    "inactive",
  );
  const overnight = { schedule: [["weekday", 25 * 3600, 25 * 3600, 0, 1800]] };
  assert.equal(
    governmentServiceStatus(overnight, data, new Date("2026-09-15T17:20:00Z"))
      .kind,
    "active",
  );
});
test("exact frequency end is exclusive and long headway gaps are not reported running", () => {
  const data = normalizeGovernment(files),
    route = { schedule: [["weekday", 8 * 3600, 10 * 3600, 3600, 600, 1]] };
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T00:30Z"))
      .kind,
    "inactive",
  );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T00:50Z"))
      .kind,
    "upcoming",
  );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T02:05Z")).kind,
    "inactive",
  );
});
test("CSV quoting and nonnumeric count rejection", () => {
  assert.deepEqual(
    [...csvRows('id,name\r\n1,"A, B\nC"\r\n')],
    [{ id: "1", name: "A, B\nC" }],
  );
  for (const value of [
    "-1",
    "1.5",
    "1e3",
    "+4",
    "2a",
    " ",
    String(Number.MAX_SAFE_INTEGER + 1),
  ])
    assert.equal(validPassengerCount(value), false, value);
  for (const value of ["", "0", "123"])
    assert.equal(validPassengerCount(value), true);
});
test("incomplete government feed fails rather than supplying wrong stops", () => {
  assert.throws(
    () =>
      normalizeGovernment({
        ...files,
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\na,A,NaN,114.1\n",
      }),
    /coordinates/,
  );
  assert.throws(
    () =>
      normalizeGovernment({
        ...files,
        "stop_times.txt": files["stop_times.txt"].replace(",c,3", ",missing,3"),
      }),
    /sequence/,
  );
});

test("12:00 departure with 120-minute journey remains active through 14:10 inclusive", () => {
  const data = normalizeGovernment(files),
    route = { schedule: [["weekday", 12 * 3600, 12 * 3600, 0, 120 * 60]] };
  for (const time of ["04:00:00", "06:00:00", "06:09:59", "06:10:00"])
    assert.equal(
      governmentServiceStatus(route, data, new Date(`2026-09-15T${time}Z`))
        .kind,
      "active",
      time,
    );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T06:10:01Z")).kind,
    "inactive",
  );
});
test("exact frequency windows use the actual last departure then journey and delay allowance", () => {
  const data = normalizeGovernment(files),
    route = { schedule: [["weekday", 10 * 3600, 12 * 3600 + 600, 600, 7200, 1]] };
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T06:10:00Z")).kind,
    "active",
  );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T06:10:01Z")).kind,
    "inactive",
  );
});
test("previous-day trips retain their delay allowance after the service calendar ends", () => {
  const data = {
      calendars: {
        once: {
          days: [1, 1, 1, 1, 1, 1, 1],
          start: "20260915",
          end: "20260915",
          exceptions: {},
        },
      },
    },
    route = { schedule: [["once", 23 * 3600, 23 * 3600, 0, 7200]] };
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T17:10:00Z")).kind,
    "active",
  );
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T17:10:01Z")).kind,
    "inactive",
  );
});
test("missing journey time remains unknown instead of inventing a completion cutoff", () => {
  const data = normalizeGovernment(files),
    route = { schedule: [["weekday", 12 * 3600, 12 * 3600, 0, null]] };
  assert.equal(
    governmentServiceStatus(route, data, new Date("2026-09-15T07:00:00Z")).kind,
    "unknown",
  );
});

test("bundled N8 is suggested at 05:32 HK through the frequency window plus journey and delay", () => {
  const data = JSON.parse(gunzipSync(readFileSync(new URL("../data/government-routes.json.gz", import.meta.url))));
  const routes = variants(data, "N8", "ctb");
  const circular = routes.find((r) => r.serviceType === "1000594");
  assert.equal(circular.stopIds.length, 48);
  // Regression from the user's screenshot, using the actual shipped catalogue.
  for (const time of ["04:45:00", "05:20:00", "05:32:00", "05:57:00"])
    assert.equal(governmentServiceStatus(circular, data, new Date(`2026-09-16T${time}+08:00`)).kind, "active", time);
  assert.equal(governmentServiceStatus(circular, data, new Date("2026-09-16T05:57:01+08:00")).kind, "inactive");
  for (const r of routes.filter((r) => r !== circular))
    assert.equal(governmentServiceStatus(r, data, new Date("2026-09-16T05:32:00+08:00")).kind, "inactive");
});

test("converter retains exact_times and defaults omitted/zero values to frequency service", () => {
  for (const exact of ["", ",0", ",1"]) {
    const converted = normalizeGovernment({ ...files,
      "frequencies.txt": `trip_id,start_time,end_time,headway_secs${exact ? ",exact_times" : ""}\n1-1-weekday-0800,08:00:00,09:00:00,3600${exact}\n`,
    });
    const schedule = variants(converted, "88X", "ctb")[0].schedule.find((s) => s[3] > 0);
    assert.equal(schedule[5] || 0, exact === ",1" ? 1 : 0);
    const result = governmentServiceStatus({ schedule: [schedule] }, converted, new Date("2026-09-15T01:30:00Z"));
    assert.equal(result.kind, exact === ",1" ? "inactive" : "active");
  }
});

test("frequency windows extend through overnight journeys and respect the originating service calendar", () => {
  const data = { calendars: { once: {
    days: [1, 1, 1, 1, 1, 1, 1], start: "20260915", end: "20260915", exceptions: {},
  } } };
  for (const start of [23 * 3600, 25 * 3600]) {
    const route = { schedule: [["once", start, start + 3600, 1800, 7200]] };
    const end = Date.parse("2026-09-15T00:00:00+08:00") + (start + 3600 + 7200 + 600) * 1000;
    assert.equal(governmentServiceStatus(route, data, new Date(end)).kind, "active");
    assert.equal(governmentServiceStatus(route, data, new Date(end + 1000)).kind, "inactive");
    assert.equal(governmentServiceStatus(route, data, new Date(end + 86400000)).kind, "inactive");
  }
  data.calendars.once.exceptions["20260915"] = 2;
  assert.equal(governmentServiceStatus({ schedule: [["once", 23 * 3600, 25 * 3600, 1800, 7200]] }, data, new Date("2026-09-16T01:30:00+08:00")).kind, "inactive");
});

test("frequency service does not invent inactive gaps or silently drop unknown journey times", () => {
  const data = normalizeGovernment(files);
  const route = { schedule: [["weekday", 8 * 3600, 10 * 3600, 3600, 600]] };
  assert.equal(governmentServiceStatus(route, data, new Date("2026-09-15T00:30:00Z")).kind, "active");
  route.schedule[0][4] = null;
  assert.equal(governmentServiceStatus(route, data, new Date("2026-09-15T00:30:00Z")).kind, "active");
  assert.equal(governmentServiceStatus(route, data, new Date("2026-09-15T02:30:00Z")).kind, "unknown");
  assert.equal(governmentServiceStatus(route, data, new Date("2026-09-14T23:50:00Z")).kind, "upcoming");
});

test("every schedule type has a fixed inclusive ten-minute allowance before departure", () => {
  const data = normalizeGovernment(files);
  for (const [headway, exact] of [[0, 0], [1800, 0], [1800, 1]]) {
    const route = { schedule: [["weekday", 12 * 3600, 12 * 3600 + (headway ? 3600 : 0), headway, 7200, exact]] };
    for (const [time, expected] of [["11:49:59", "inactive"], ["11:50:00", "upcoming"], ["11:59:59", "upcoming"], ["12:00:00", "active"]])
      assert.equal(governmentServiceStatus(route, data, new Date(`2026-09-15T${time}+08:00`)).kind, expected, `${headway}/${exact} ${time}`);
  }
  // Early allowance crosses midnight and uses the upcoming departure's day.
  const route = { schedule: [["weekday", 5 * 60, 5 * 60, 0, 7200]] };
  assert.equal(governmentServiceStatus(route, data, new Date("2026-09-14T23:55:00+08:00")).kind, "upcoming");
});
