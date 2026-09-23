import { makeCSV } from "./core.js";
import { makeGpx, tripMetrics } from "./fieldkit.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safePart(value, fallback = "trip") {
  const s = String(value ?? "").trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

export function exportBase(s, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "Z");
  return [
    "bus",
    safePart(s?.route?.route, "route"),
    safePart(s?.date, "date"),
    safePart(String(s?.id || "").slice(0, 8), "record"),
    stamp,
  ].join("-");
}

export function recordObject(s, data, base, now = new Date()) {
  const survey = clone(s);
  delete survey.track;
  delete survey.upload;
  survey.metrics = data ? tripMetrics(s, data) : (s.metrics || tripMetrics(s, null));
  return {
    schema: "app.passengercount.trip-export/v1",
    exportedAt: now.toISOString(),
    files: {
      passengerTable: `${base}.csv`,
      structuredRecord: `${base}.json`,
      track: `${base}.gpx`,
      chart: `${base}.png`,
    },
    track: {
      file: `${base}.gpx`,
      points: Array.isArray(s.track) ? s.track.length : 0,
    },
    survey,
  };
}

export function makeRecordJson(s, data, base, now = new Date()) {
  return JSON.stringify(recordObject(s, data, base, now), null, 2) + "\n";
}

export function makeExportBundle(s, data, pngDataUrl = "", now = new Date()) {
  const base = exportBase(s, now);
  return {
    folder: base,
    base,
    csv: makeCSV(s),
    json: makeRecordJson(s, data, base, now),
    gpx: makeGpx(s),
    pngBase64: typeof pngDataUrl === "string" && pngDataUrl.includes(",")
      ? pngDataUrl.slice(pngDataUrl.indexOf(",") + 1)
      : "",
  };
}
