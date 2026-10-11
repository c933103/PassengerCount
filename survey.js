// Survey data and passenger conservation. A row's onboard count is AFTER that stop.
export const emptyRow = () => ({
  time: "",
  boarding: "",
  alighting: "",
  onboard: "",
  notes: "",
  recorded: false,
  skipped: {},
});
export const validPassengerCount = (value) =>
  value === "" ||
  (/^[0-9]+$/.test(String(value)) && Number.isSafeInteger(Number(value)));
const number = (value) =>
  value === "" || value == null ? null : Number(value);
export const rowObserved = (row) =>
  row.recorded === true ||
  ["time", "boarding", "alighting", "onboard", "notes"].some(
    (k) => row[k] !== "" && row[k] != null,
  ) ||
  Object.values(row.skipped || {}).some(Boolean);
// Occurrence identity is survey-local, monotonic, and distinct from a route's
// stop ID (which may repeat on circular sections). History never rewinds it.
function ensureStopOccurrences(s) {
  if (!Number.isSafeInteger(s.nextStopOccurrence) || s.nextStopOccurrence < 0)
    s.nextStopOccurrence = 0;
  const used = new Set((s.stops || []).map(stop => stop.occurrenceId).filter(Boolean));
  const seen = new Set();
  for (const stop of s.stops || []) {
    if (!stop.occurrenceId || seen.has(stop.occurrenceId)) {
      do {
        if (s.nextStopOccurrence >= Number.MAX_SAFE_INTEGER) s.nextStopOccurrence = 0;
        stop.occurrenceId = `stop-${++s.nextStopOccurrence}`;
      } while (used.has(stop.occurrenceId));
      used.add(stop.occurrenceId);
    }
    seen.add(stop.occurrenceId);
  }
}
export function stopReference(s, index) {
  const stop = s.stops?.[index];
  return stop ? { occurrenceId: stop.occurrenceId, index,
    stop: JSON.parse(JSON.stringify(stop)) }
    : { occurrenceId: null, index: index ?? null, stop: null };
}
export function reconcileEvidenceStops(s) {
  const current = new Map((s.stops || []).map((stop, index) => [stop.occurrenceId, index]));
  const reconcile = (entry, indexKey, referenceKey, stopId) => {
    if (!entry[referenceKey]) {
      // Older app versions did not update evidence indices during route edits.
      // Even a matching provider stop ID cannot prove a repeated occurrence.
      // Preserve the legacy index as unverified evidence, never invent a ref.
      entry[referenceKey] = { occurrenceId: null, index: entry[indexKey] ?? null,
        stop: null, providerStopId: stopId ?? null, association: "unverified-legacy-index" };
    }
    const id = entry[referenceKey].occurrenceId;
    entry[indexKey] = id && current.has(id) ? current.get(id) : null;
  };
  for (const event of s.weatherHistory || []) reconcile(event, "stopIndex", "stopRef");
  for (const evidence of s.etaSnapshots || []) {
    const currentResult = (evidence.results || []).find(result => result.stopIndex === evidence.currentStop);
    reconcile(evidence, "currentStop", "currentStopRef", currentResult?.stopId);
    for (const result of evidence.results || [])
      reconcile(result, "stopIndex", "stopRef", result.stopId);
  }
}
export function migrateSurvey(s) {
  s.status ??= s.startIndex == null ? "draft" : "in_progress";
  s.initialOnboard ??= "";
  s.finalOnboard ??= "";
  s.endIndex ??= null;
  s.startsAtOrigin ??= s.startIndex === 0;
  s.endsAtTerminus ??= true;
  s.routeEdits ??= [];
  s.track ??= [];
  s.weatherHistory ??= [];
  s.etaSnapshots ??= [];
  s.calendarContext ??= null;
  s.vehicleMatch ??= null;
  ensureStopOccurrences(s);
  reconcileEvidenceStops(s);
  s.rows.forEach((r) => {
    r.skipped ??= {};
    r.observedAt ??= null;
    r.recorded ??= ["time", "boarding", "alighting", "onboard", "notes"].some(
      (k) => r[k] !== "" && r[k] != null,
    );
  });
  return s;
}
export function recordStop(s, index, time, noChange = false, observedAt = null) {
  const row = s.rows[index];
  if (!row) throw Error("Invalid stop");
  row.skipped ??= {};
  if (noChange) {
    row.boarding = "0";
    row.alighting = "0";
    row.skipped.boarding = false;
    row.skipped.alighting = false;
  } else
    for (const f of ["boarding", "alighting"])
      if (row[f] === "") row.skipped[f] = true;
  row.recorded = true;
  if (!row.time) row.time = time;
  if (!row.observedAt && observedAt) row.observedAt = observedAt;
}
export function skipField(s, index, field) {
  const r = s.rows[index];
  r[field] = "";
  r.skipped ??= {};
  r.skipped[field] = true;
}
export function calculateOnboard(s) {
  const rows = s.rows,
    prefix = [0],
    manual = [],
    assumed = [],
    issues = [];
  let limit = -1;
  rows.forEach((r, i) => {
    prefix.push(
      prefix[i] + (number(r.boarding) || 0) - (number(r.alighting) || 0),
    );
    if (rowObserved(r)) limit = i;
    if (number(r.onboard) !== null)
      manual.push({ index: i, value: number(r.onboard), source: "entered" });
  });
  const start = Number.isInteger(s.startIndex) ? s.startIndex : null;
  if (number(s.initialOnboard) !== null && start !== null)
    manual.push({
      index: start - 1,
      value: number(s.initialOnboard),
      source: "initial",
    });
  else if (start === 0 && s.startsAtOrigin !== false)
    assumed.push({ index: -1, value: 0, source: "origin_zero" });
  const end = Number.isInteger(s.endIndex) ? s.endIndex : rows.length - 1;
  if (number(s.finalOnboard) !== null)
    manual.push({ index: end, value: number(s.finalOnboard), source: "final" });
  else if (
    s.status === "completed" &&
    end === rows.length - 1 &&
    s.endsAtTerminus !== false
  )
    assumed.push({ index: end, value: 0, source: "terminus_zero" });
  for (const anchor of [...manual, ...assumed])
    anchor.base = anchor.value - prefix[anchor.index + 1];
  manual.sort((a, b) => a.index - b.index);
  let anchors = manual.length ? manual : assumed;
  // An explicit observation takes precedence over an empty-vehicle assumption.
  if (manual.length)
    for (const a of assumed)
      if (manual.some((m) => m.base !== a.base))
        issues.push({
          type: "boundary",
          index: a.index,
          expected: a.value,
          actual: manual[0].base + prefix[a.index + 1],
        });
  if (
    !manual.length &&
    assumed.length > 1 &&
    assumed.some((a) => a.base !== assumed[0].base)
  ) {
    const last = assumed.at(-1);
    issues.push({
      type: "boundary",
      index: last.index,
      expected: 0,
      actual: assumed[0].base + prefix[last.index + 1],
    });
    anchors = [assumed[0]];
  }
  for (let i = 1; i < manual.length; i++)
    if (manual[i].base !== manual[i - 1].base)
      issues.push({
        type: "anchors",
        from: manual[i - 1].index,
        index: manual[i].index,
        expected: manual[i - 1].base + prefix[manual[i].index + 1],
        actual: manual[i].value,
      });
  limit = Math.max(limit, start ?? -1, ...anchors.map((a) => a.index));
  const values = rows.map(() => null),
    sources = rows.map(() => ""),
    estimated = rows.map(() => false);
  for (let i = 0; i <= limit && i < rows.length; i++) {
    const at = manual.filter((a) => a.index === i);
    let anchor;
    if (at.length) {
      values[i] = at.at(-1).value;
      sources[i] = at.at(-1).source;
    } else if (anchors.length) {
      const before = anchors.filter((a) => a.index < i).at(-1),
        after = anchors.find((a) => a.index > i);
      if (before && after && before.base !== after.base) continue;
      anchor = before || after || anchors[0];
      values[i] = anchor.base + prefix[i + 1];
      sources[i] = "calculated";
      const a = Math.min(i, anchor.index),
        b = Math.max(i, anchor.index);
      estimated[i] = rows
        .slice(Math.max(0, a + 1), b + 1)
        .some(
          (r) =>
            !r.recorded &&
            ["boarding", "alighting"].some(
              (f) => r[f] === "" && !r.skipped?.[f],
            ),
        );
    }
    if (values[i] !== null && values[i] < 0)
      issues.push({ type: "negative", index: i, actual: values[i] });
  }
  return {
    values,
    sources,
    estimated,
    issues,
    assumptions: assumed,
    initial: anchors.length ? anchors[0].base : null,
  };
}
export function completeSurvey(s, index, now = new Date().toISOString()) {
  s.status = "completed";
  s.endIndex = index;
  s.completedAt = now;
  s.updatedAt = now;
  return calculateOnboard(s);
}
function preserveFinalObservation(s) {
  const end = Number.isInteger(s.endIndex) ? s.endIndex : s.activeIndex;
  const row = s.rows[end];
  if (!row) throw Error("Invalid end stop");
  // A known final count belongs at the old end, not at a future terminus.
  // Preserve both observations by requiring an existing conflict to be corrected.
  if (s.finalOnboard !== "" && row.onboard !== "" &&
      Number(s.finalOnboard) !== Number(row.onboard))
    throw Error("Conflicting final count");
  if (s.finalOnboard !== "") row.onboard = s.finalOnboard;
  return end;
}
export function reopenSurvey(s, now = new Date().toISOString()) {
  if (s.status !== "completed") return;
  const end = preserveFinalObservation(s);
  s.finalOnboard = "";
  s.endIndex = null;
  s.completedAt = null;
  s.status = "in_progress";
  s.activeIndex = Math.min(end + 1, s.rows.length - 1);
  s.updatedAt = now;
}
function shiftIndexes(s, index) {
  for (const key of ["startIndex", "pendingStart", "activeIndex", "endIndex"])
    if (Number.isInteger(s[key]) && s[key] >= index) s[key]++;
}
export function insertStop(s, index, stop) {
  if (!Number.isInteger(index) || index < 0 || index > s.stops.length)
    throw Error("Invalid insertion position");
  ensureStopOccurrences(s);
  reconcileEvidenceStops(s);
  shiftIndexes(s, index);
  const added = { ...stop, custom: true };
  delete added.occurrenceId;
  s.stops.splice(index, 0, added);
  s.rows.splice(index, 0, emptyRow());
  s.stops.forEach((x, i) => (x.sequence = i + 1));
  ensureStopOccurrences(s);
  reconcileEvidenceStops(s);
  if (s.startIndex !== 0) s.startsAtOrigin = false;
  s.routeEdits ??= [];
  s.routeEdits.push({
    type: "insert",
    id: stop.id,
    index,
    at: new Date().toISOString(),
  });
}
export function overlapCount(previous, next) {
  for (let n = Math.min(previous.length, next.length); n > 0; n--)
    if (previous.slice(-n).every((s, i) => s.id === next[i].id)) return n;
  return 0;
}
export function appendSection(s, route, stops, skip = 0) {
  if (!Number.isInteger(skip) || skip < 0 || skip >= stops.length)
    throw Error("Invalid overlap");
  const added = stops.slice(skip).map((x) => {
    const stop = { ...x, name: { ...x.name } };
    delete stop.occurrenceId;
    return stop;
  });
  // Validate before mutating stops, rows or lifecycle boundaries. A rejected
  // join must preserve both conflicting observations for correction.
  if (s.status === "completed") preserveFinalObservation(s);
  ensureStopOccurrences(s);
  reconcileEvidenceStops(s);
  s.stops.push(...added);
  s.rows.push(...added.map(emptyRow));
  s.stops.forEach((x, i) => (x.sequence = i + 1));
  ensureStopOccurrences(s);
  reconcileEvidenceStops(s);
  s.routeEdits ??= [];
  s.routeEdits.push({
    type: "append",
    routeKey: route.key,
    skippedOverlap: skip,
    added: added.length,
    at: new Date().toISOString(),
  });
  s.segments ??= [{ key: s.route.key, from: 0 }];
  s.segments.push({
    key: route.key,
    from: s.stops.length - added.length,
    route: route.route,
    operator: route.operator,
  });
  s.endIndex = null;
  s.finalOnboard = "";
  s.completedAt = null;
  s.status = "in_progress";
  s.route.dest = { ...route.dest };
  return added.length;
}
