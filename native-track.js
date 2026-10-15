import { hkTimestamp, validTrackInterruptions, trackTimestamp, compareTrackTimes } from "./fieldkit.js";

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

// Interruption records share the same journal/cursor as fixes, but are never
// converted to coordinates. The timestamp is when denial was observed; its
// missing-GPS interval and eventual recovery time remain unknown.
export function mergeNativeInterruptions(previous = [], records = []) {
  // Preserve malformed prior metadata for structured backup, but do not let it
  // block valid new journal points or be mistaken for an acknowledged receipt.
  const prior = Array.isArray(previous) ? previous : [previous];
  const merged = prior.map((event) => event && typeof event === "object"
    ? (Array.isArray(event) ? [...event] : { ...event }) : event);
  const seen = new Set(validTrackInterruptions({ trackInterruptions: merged })
    .map((event) => event.nativeId));
  for (const record of records) {
    if (record?.event !== "foreground_start_denied") continue;
    if (typeof record.nativeId !== "string" || !record.nativeId ||
        !Number.isFinite(record.timestamp) || record.timestamp <= 0 ||
        !Number.isFinite(new Date(record.timestamp).getTime()))
      throw Error("Invalid native tracking interruption");
    if (seen.has(record.nativeId)) continue;
    merged.push({ nativeId: record.nativeId, reason: record.event,
      observedAt: new Date(record.timestamp).toISOString() });
    seen.add(record.nativeId);
  }
  return merged;
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
  // Malformed timestamps cannot participate in chronological comparisons.
  // Keep those observations in their slots and sort only validated fixes;
  // mixing precise instants with Date.parse fallback is non-transitive.
  const times = new Map(merged.map(p => [p, trackTimestamp(p.time)]));
  const ordered = merged.filter(p => times.get(p) !== null).sort((a, b) =>
    compareTrackTimes(times.get(a), times.get(b)) ||
      ((a.nativeOrder ?? Infinity) - (b.nativeOrder ?? Infinity)));
  let next = 0;
  for (let i = 0; i < merged.length; i++) {
    if (times.get(merged[i]) !== null) merged[i] = ordered[next++];
  }
  return merged.slice(-LIMIT);
}

export function importNativeTrack(s, bridge, persist) {
  // Reconciliation reads existing evidence; it never starts recording. Saved
  // paused/aborted/completed records can still have an unconsumed native tail.
  if (!s || !bridge) return true;
  const paged = typeof bridge.getTrackPage === "function";
  if (!paged && typeof bridge.getTrack !== "function") return true;
  for (;;) {
    const previousTrack = s.track;
    const previousCursor = s.nativeTrackCursor;
    const previousInterruptions = s.trackInterruptions;
    const raw = paged ? bridge.getTrackPage(s.id, previousCursor || "") : bridge.getTrack(s.id);
    if (!raw) return false;
    const page = JSON.parse(raw);
    const points = paged ? page.points : page;
    if (!Array.isArray(points) || (paged && typeof page.cursor !== "string")) return false;
    const interruptions = mergeNativeInterruptions(s.trackInterruptions, points);
    s.track = mergeNativeTrack(s.track, points);
    if (interruptions.length) s.trackInterruptions = interruptions;
    if (paged) s.nativeTrackCursor = page.cursor;
    // Track and cursor belong to the same durable workspace write. Never ack
    // journal consumption in memory after a failed storage commit.
    let saved = false;
    try { saved = persist() !== false; }
    finally {
      if (!saved) {
        s.track = previousTrack;
        if (previousInterruptions === undefined) delete s.trackInterruptions;
        else s.trackInterruptions = previousInterruptions;
        if (previousCursor === undefined) delete s.nativeTrackCursor;
        else s.nativeTrackCursor = previousCursor;
      }
    }
    if (!saved) return false;
    if (!paged || !page.more) return true;
    if (page.cursor === previousCursor) return false;
  }
}
