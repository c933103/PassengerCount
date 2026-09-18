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
export function migrateSurvey(s) {
  s.status ??= s.startIndex == null ? "draft" : "in_progress";
  s.initialOnboard ??= "";
  s.finalOnboard ??= "";
  s.endIndex ??= null;
  s.startsAtOrigin ??= s.startIndex === 0;
  s.endsAtTerminus ??= true;
  s.routeEdits ??= [];
  s.rows.forEach((r) => {
    r.skipped ??= {};
    r.recorded ??= ["time", "boarding", "alighting", "onboard", "notes"].some(
      (k) => r[k] !== "" && r[k] != null,
    );
  });
  return s;
}
export function recordStop(s, index, time, noChange = false) {
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
export function reopenSurvey(s, now = new Date().toISOString()) {
  if (s.status !== "completed") return;
  const end = Number.isInteger(s.endIndex) ? s.endIndex : s.activeIndex;
  const row = s.rows[end];
  // A known final count belongs at the old end, not at a future terminus.
  // Preserve both observations by requiring an existing conflict to be corrected.
  if (s.finalOnboard !== "" && row.onboard !== "" &&
      Number(s.finalOnboard) !== Number(row.onboard))
    throw Error("Conflicting final count");
  if (s.finalOnboard !== "") row.onboard = s.finalOnboard;
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
  shiftIndexes(s, index);
  s.stops.splice(index, 0, { ...stop, custom: true });
  s.rows.splice(index, 0, emptyRow());
  s.stops.forEach((x, i) => (x.sequence = i + 1));
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
  const added = stops.slice(skip).map((x) => ({ ...x, name: { ...x.name } }));
  if (
    s.status === "completed" &&
    s.finalOnboard !== "" &&
    Number.isInteger(s.endIndex) &&
    s.rows[s.endIndex].onboard === ""
  )
    s.rows[s.endIndex].onboard = s.finalOnboard;
  s.stops.push(...added);
  s.rows.push(...added.map(emptyRow));
  s.stops.forEach((x, i) => (x.sequence = i + 1));
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
