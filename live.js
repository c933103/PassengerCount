import { festivalFromLunar, schoolHolidayForDate } from "./fieldkit.js";

const json = async (url, timeout = 12000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: "no-store" });
  if (!r.ok) throw Error("HTTP " + r.status);
  return r.json();
};

function compact(value, max = 12000) {
  try {
    const text = JSON.stringify(value);
    return text.length <= max ? value : { truncated: true, text: text.slice(0, max) };
  } catch {
    return null;
  }
}

function findDateRecord(value, date) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDateRecord(item, date);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const text = JSON.stringify(value);
  if (text.includes(date) || text.includes(date.replaceAll("-", ""))) return value;
  for (const child of Object.values(value)) {
    const found = findDateRecord(child, date);
    if (found) return found;
  }
  return null;
}

export async function fetchCalendarContext(date, schoolRanges = []) {
  const context = {
    date,
    capturedAt: new Date().toISOString(),
    publicHoliday: null,
    schoolHoliday: schoolHolidayForDate(date, schoolRanges),
    festival: null,
    lunar: null,
  };
  const [holiday, lunar] = await Promise.allSettled([
    json("https://www.1823.gov.hk/common/ical/en.json"),
    json("https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php?date=" + encodeURIComponent(date)),
  ]);
  if (holiday.status === "fulfilled") {
    const item = findDateRecord(holiday.value, date);
    if (item) context.publicHoliday = compact(item, 2500);
  }
  if (lunar.status === "fulfilled") {
    context.lunar = compact(lunar.value, 2500);
    context.festival = festivalFromLunar(lunar.value);
  }
  return context;
}

export async function fetchWeatherSnapshot(language = "en") {
  const lang = language === "en" ? "en" : "tc";
  const base = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";
  const [current, warnings, tips] = await Promise.allSettled([
    json(base + "?dataType=rhrread&lang=" + lang),
    json(base + "?dataType=warnsum&lang=" + lang),
    json(base + "?dataType=swt&lang=" + lang),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    current: current.status === "fulfilled" ? compact(current.value, 7000) : null,
    warnings: warnings.status === "fulfilled" ? compact(warnings.value, 5000) : null,
    tips: tips.status === "fulfilled" ? compact(tips.value, 4000) : null,
    partial: [current, warnings, tips].some((x) => x.status !== "fulfilled"),
  };
}

function etaRows(payload, route) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((x) => String(x.route || x.route_no || "").toUpperCase() === String(route || "").toUpperCase())
    .map((x) => ({
      eta: x.eta || x.estimated_arrival_time || x.eta_iso || null,
      seq: x.eta_seq ?? x.sequence ?? null,
      direction: x.dir || x.direction || null,
      destination: x.dest_en || x.destination || x.dest_tc || null,
      remarks: x.rmk_en || x.remarks || x.rmk_tc || null,
      generatedAt: payload.generated_timestamp || payload.generated_at || null,
    }))
    .filter((x) => x.eta)
    .sort((a, b) => String(a.eta).localeCompare(String(b.eta)));
}

function headway(rows) {
  if (rows.length < 2) return null;
  const a = Date.parse(rows[0].eta), b = Date.parse(rows[1].eta);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : null;
}

export async function fetchEtaStop(s, index) {
  const stop = s?.stops?.[index];
  if (!stop) return { available: false, reason: "invalid-stop" };
  const co = s.route.operator;
  const route = s.route.route;
  let url = "";
  if (co === "kmb" || co === "lwb") {
    if (!/^[A-F0-9]{16}$/i.test(String(stop.id || "")))
      return { available: false, reason: "operator-stop-id-unavailable" };
    url = "https://data.etabus.gov.hk/v1/transport/kmb/eta/" +
      encodeURIComponent(stop.id) + "/" + encodeURIComponent(route) + "/1";
  } else if (co === "ctb" || co === "nlb") {
    url = "https://rt.data.gov.hk/v1/transport/batch/stop-eta/" +
      (co === "ctb" ? "CTB" : "NLB") + "/" + encodeURIComponent(stop.id) + "?lang=en";
  } else {
    return { available: false, reason: "operator-not-supported" };
  }
  try {
    const payload = await json(url, 10000);
    const rows = etaRows(payload, route);
    return {
      available: rows.length > 0,
      stopIndex: index,
      stopId: stop.id,
      retrievedAt: new Date().toISOString(),
      arrivals: rows.slice(0, 4),
      candidateHeadwayMinutes: headway(rows),
      confirmedSurveyedBus: false,
      reason: rows.length ? "" : "no-matching-route-eta",
    };
  } catch (e) {
    return { available: false, stopIndex: index, stopId: stop.id, retrievedAt: new Date().toISOString(), reason: "request-failed" };
  }
}

export async function fetchEtaEvidence(s, index, downstream = 4) {
  const indexes = [];
  for (let i = index; i < s.stops.length && i <= index + downstream; i++) indexes.push(i);
  const results = await Promise.all(indexes.map((i) => fetchEtaStop(s, i)));
  return {
    capturedAt: new Date().toISOString(),
    currentStop: index,
    results,
    note: "ETA comparison is evidence only; the surveyed vehicle is not identified unless an operator feed explicitly provides that link.",
  };
}
