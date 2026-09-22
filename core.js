import { calculateOnboard, rowObserved } from "./survey.js";
import { tripMetrics } from "./fieldkit.js";
export { emptyRow, validPassengerCount } from "./survey.js";
import {
  governmentServiceStatus,
  agencyStopName,
  SERVICE_TOLERANCE_MINUTES,
} from "./government.js";
export const OPERATORS = {
  kmb: "KMB",
  ctb: "Citybus",
  nlb: "New Lantao Bus",
  lrtfeeder: "MTR Bus",
  gmb: "Green minibus",
  lwb: "Long Win",
  db: "Discovery Bay",
  pi: "Park Island",
  xb: "Cross-boundary coach",
};
export function hkClock(now = new Date()) {
  const d = new Date(now.getTime() + 28800000);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
const mins = (v) => {
  const s = String(v).replace(":", "");
  return /^\d{4}$/.test(s) && +s.slice(2) < 60
    ? +s.slice(0, 2) * 60 + +s.slice(2)
    : NaN;
};
export function serviceStatus(route, data, now = new Date()) {
  if (route.source === "hk-td-gtfs-v1")
    return governmentServiceStatus(route, data, now);
  if (!route.freq || !Object.keys(route.freq).length)
    return { kind: "unknown", text: "Timetable unavailable — select manually" };
  const c = hkClock(now),
    journey = +route.jt,
    hasJourney = journey > 0;
  let unknown = false,
    running = false,
    next = Infinity,
    departedWithoutJourney = false;
  for (const offset of [-2, -1, 0, 1]) {
    const day = new Date(`${c.date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10).replaceAll("-", ""),
      weekday = (data.holidays || []).includes(date) ? 0 : day.getUTCDay();
    for (const [service, entries] of Object.entries(route.freq)) {
      const cal = data.serviceDayMap?.[service];
      if (!cal || cal.length !== 7) {
        unknown = true;
        continue;
      }
      if (String(cal[weekday]) !== "1") continue;
      for (const [t, interval] of Object.entries(entries)) {
        const start = mins(t);
        let end = interval ? mins(interval[0]) : start;
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          unknown = true;
          continue;
        }
        if (end < start) end += 1440;
        const a = start + offset * 1440 - c.minutes - now.getUTCSeconds() / 60,
          b = end + offset * 1440 - c.minutes - now.getUTCSeconds() / 60;
        if (
          (a <= 0 && b >= 0) ||
          (hasJourney && a <= 0 && b + journey + SERVICE_TOLERANCE_MINUTES >= 0)
        )
          running = true;
        if (!hasJourney && b < 0 && offset >= -1) departedWithoutJourney = true;
        if (a > 0) next = Math.min(next, a);
      }
    }
  }
  if (running)
    return {
      kind: "active",
      text: "Within estimated running time, including a 10-minute delay allowance",
    };
  if (next <= SERVICE_TOLERANCE_MINUTES)
    return { kind: "upcoming", text: `Starts in ${next} min` };
  if (unknown || departedWithoutJourney)
    return {
      kind: "unknown",
      text: departedWithoutJourney
        ? "Earlier departures — journey time unavailable"
        : "Timetable incomplete — select manually",
    };
  return {
    kind: "inactive",
    text: Number.isFinite(next)
      ? `Next start in ${Math.floor(next / 60)}h ${next % 60}m`
      : "No service in this time window",
  };
}
export function variants(data, number, operator = "") {
  return Object.entries(data.routeList).flatMap(([key, r]) =>
    Object.keys(r.stops || {})
      .filter(
        (co) =>
          OPERATORS[co] &&
          (!operator || co === operator) &&
          String(r.route).toUpperCase() === number.trim().toUpperCase(),
      )
      .map((co) => ({
        ...r,
        key: `${key}::${co}`,
        operator: co,
        direction: r.bound?.[co] || "",
        stopIds: r.stops[co],
      })),
  );
}
export function stopsFor(route, data) {
  return route.stopIds.map((id, i) => {
    const s = data.stopList[id];
    if (!s) throw Error(`Missing stop ${id}`);
    return {
      id,
      sequence: i + 1,
      name:
        route.source === "hk-td-gtfs-v1"
          ? {
              en: agencyStopName(s.name.en, route.agency),
              zh: agencyStopName(s.name.zh, route.agency),
            }
          : s.name,
      lat: s.location?.lat,
      lng: s.location?.lng,
      zone: s.zone || "",
    };
  });
}
const count = (v) => (v === "" || v == null ? null : Number(v));
export function onboardValues(rows) {
  return calculateOnboard({ rows }).values;
}
export function distance(a, b) {
  const R = Math.PI / 180,
    p = (b.lat - a.lat) * R,
    q = (b.lng - a.lng) * R,
    x =
      Math.sin(p / 2) ** 2 +
      Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(q / 2) ** 2;
  return 12742000 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function nearestStops(stops, pos) {
  return stops
    .map((s, index) => ({ ...s, index, distance: distance(pos, s) }))
    .filter((s) => Number.isFinite(s.distance))
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
}
const csv = (v) => {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export function records(s) {
  const calculation = calculateOnboard(s),
    values = calculation.values;
  let total = null;
  return s.rows.map((r, i) => {
    const observed = rowObserved(r);
    if (total === null && (observed || values[i] !== null))
      total = values[i] ?? (count(r.boarding) || 0);
    else if (total !== null) total += count(r.boarding) || 0;
    return {
      ...r,
      ...s.stops[i],
      boarding: count(r.boarding),
      alighting: count(r.alighting),
      onboard: values[i],
      total,
      observed,
      derived: r.onboard === "" && values[i] !== null,
      countSource: calculation.sources[i],
      estimated: calculation.estimated[i],
    };
  });
}
export function makeCSV(s) {
  const r = s.route,
    rows = [
      ["SURVEY INFORMATION"],
      ["Surveyor Name", s.surveyor],
      ["Date", s.date],
      ["Vehicle Number", s.vehicle],
      ["Vehicle match", JSON.stringify(s.vehicleMatch || null)],
      ["Calendar context", JSON.stringify(s.calendarContext || null)],
      ["Weather history", JSON.stringify(s.weatherHistory || [])],
      ["ETA snapshots", JSON.stringify(s.etaSnapshots || [])],
      ["Route", r.route],
      ["Operator", OPERATORS[r.operator]],
      ["Direction", r.direction],
      ["Variant", r.key],
      [
        "Route data source",
        r.source === "hk-td-gtfs-v1"
          ? "Transport Department / DATA.GOV.HK (https://data.gov.hk/en-data/dataset/hk-td-tis_11-pt-headway-en)"
          : "Legacy saved survey",
      ],
      [
        "Route data attribution",
        r.source === "hk-td-gtfs-v1"
          ? "Route, stop and timetable data © Government of the Hong Kong SAR; reuse terms: https://data.gov.hk/en/terms-and-conditions"
          : "Original survey stop snapshot",
      ],
      [
        "Confirmed start sequence",
        s.startIndex == null ? "" : s.startIndex + 1,
      ],
      ["Status", s.status || "in_progress"],
      ["Completed at", s.completedAt || ""],
      ["End stop", s.endIndex == null ? "" : s.endIndex + 1],
      ["Known onboard before start", s.initialOnboard || ""],
      ["Known onboard after end", s.finalOnboard || ""],
      ["Start zero assumption", s.startsAtOrigin === true],
      ["End zero assumption", s.endsAtTerminus !== false],
      ["Calculation issues", JSON.stringify(calculateOnboard(s).issues)],
      ["Route corrections", JSON.stringify(s.routeEdits || [])],
      ["Trip metrics", JSON.stringify(tripMetrics(s, s.catalogueSnapshot || null))],
      ["Track points", Array.isArray(s.track) ? s.track.length : 0],
      ["Notes", s.notes],
      [],
      ["PASSENGER DATA"],
      [
        "sequence",
        "stop_id",
        "stop_tc",
        "stop_en",
        "time",
        "observed_at_hkt",
        "boarding",
        "alighting",
        "onboard",
        "cumulative_boarding",
        "onboard_source",
        "notes",
        "recorded",
        "boarding_not_applicable",
        "alighting_not_applicable",
        "custom_stop",
        "onboard_estimated",
      ],
    ];
  for (const x of records(s))
    rows.push([
      x.sequence,
      x.id,
      x.name.zh,
      x.name.en,
      x.time,
      x.observedAt || "",
      x.boarding,
      x.alighting,
      x.onboard,
      x.total,
      x.derived ? "calculated" : x.onboard == null ? "" : "entered",
      x.notes,
      x.recorded === true,
      x.skipped?.boarding === true,
      x.skipped?.alighting === true,
      x.custom === true || x.modified === true,
      x.estimated,
    ]);
  return "\uFEFF" + rows.map((r) => r.map(csv).join(",")).join("\r\n");
}
