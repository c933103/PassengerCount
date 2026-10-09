import { hkTimestamp } from "./fieldkit.js";

const LIMIT = 20000;
const measurementKey = (p) => JSON.stringify([
  p.lat, p.lng, p.accuracy, p.speed, p.heading, p.source, p.time,
]);
function normalize(p) {
  if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return null;
  return {
    lat: p.lat, lng: p.lng,
    accuracy: Number.isFinite(p.accuracy) ? p.accuracy : null,
    speed: Number.isFinite(p.speed) ? p.speed : null,
    heading: Number.isFinite(p.heading) ? p.heading : null,
    source: p.source || "gps",
    time: p.time || hkTimestamp(new Date(p.timestamp || Date.now())),
  };
}

// Native IDs identify journal records, not timestamps or approximate locations.
// Match old/foreground points once by the entire stored measurement when upgrading.
export function mergeNativeTrack(track, points) {
  const merged = (track || []).map((p) => ({ ...p }));
  const seen = new Map(merged.filter((p) => p.nativeId).map((p) => [p.nativeId, p]));
  const unclaimed = new Map();
  for (const p of merged) {
    if (p.nativeId) continue;
    const key = measurementKey(p);
    if (!unclaimed.has(key)) unclaimed.set(key, []);
    unclaimed.get(key).push(p);
  }
  const occurrences = new Map();
  for (const [index, raw] of points.entries()) {
    const p = normalize(raw);
    if (!p) continue;
    const key = measurementKey(p);
    const n = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, n);
    // Compatibility for an older APK's full-snapshot getTrack bridge.
    p.nativeId = typeof raw.nativeId === "string" && raw.nativeId
      ? raw.nativeId : `legacy:${key}:${n}`;
    // New bridge pages supply an absolute byte offset; old full snapshots use
    // their array index. Time alone cannot order same-time journal occurrences.
    p.nativeOrder = Number.isSafeInteger(raw.nativeOrder) && raw.nativeOrder >= 0
      ? raw.nativeOrder : index;
    const known = seen.get(p.nativeId);
    if (known) {
      known.nativeOrder = p.nativeOrder;
      continue;
    }
    const existing = unclaimed.get(key)?.shift();
    if (existing) {
      existing.nativeId = p.nativeId;
      existing.nativeOrder = p.nativeOrder;
    } else merged.push(p);
    seen.set(p.nativeId, existing || p);
  }
  // A foreground fix may already be newer than the background journal tail.
  // Use journal order for equal-time native points, including evicted points
  // replayed after cursor invalidation. Untagged foreground ties stay after them.
  merged.sort((a, b) => (Date.parse(a.time) - Date.parse(b.time)) ||
    ((a.nativeOrder ?? Infinity) - (b.nativeOrder ?? Infinity)));
  return merged.slice(-LIMIT);
}

export function importNativeTrack(s, bridge, persist) {
  // PC-001 (stop/drain and non-active lifecycle reconciliation) is separate.
  if (!s || s.status !== "in_progress" || !bridge) return;
  const paged = typeof bridge.getTrackPage === "function";
  if (!paged && typeof bridge.getTrack !== "function") return;
  for (;;) {
    const previousTrack = s.track;
    const previousCursor = s.nativeTrackCursor;
    const raw = paged ? bridge.getTrackPage(s.id, previousCursor || "") : bridge.getTrack(s.id);
    if (!raw) return;
    const page = JSON.parse(raw);
    const points = paged ? page.points : page;
    if (!Array.isArray(points) || (paged && typeof page.cursor !== "string")) return;
    s.track = mergeNativeTrack(s.track, points);
    if (paged) s.nativeTrackCursor = page.cursor;
    // Track and cursor belong to the same durable workspace write. Never ack
    // journal consumption in memory after a failed storage commit.
    let saved = false;
    try { saved = persist() !== false; }
    finally {
      if (!saved) {
        s.track = previousTrack;
        if (previousCursor === undefined) delete s.nativeTrackCursor;
        else s.nativeTrackCursor = previousCursor;
      }
    }
    if (!saved || !paged || !page.more || page.cursor === previousCursor) return;
  }
}
