// Normalizes only the Transport Department's own GTFS feed. No operator/third-party database.
export const GOVERNMENT_SOURCE = "hk-td-gtfs-v1";
export const GOVERNMENT_URLS = {
  en: "https://static.data.gov.hk/td/pt-headway-en/gtfs.zip",
  zh: "https://static.data.gov.hk/td/pt-headway-tc/gtfs.zip",
};
const agencies = {
  KMB: "kmb",
  LWB: "lwb",
  CTB: "ctb",
  NLB: "nlb",
  LRTFeeder: "lrtfeeder",
  GMB: "gmb",
  DB: "db",
  PI: "pi",
  XB: "xb",
};

// CSV generator handles quotes, commas, CRLF and embedded newlines without creating a million row objects at once.
export function* csvRows(text) {
  let row = [],
    cell = "",
    quoted = false,
    headers;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n" || c === undefined)) {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (c !== ",") {
        if (!headers) headers = row;
        else if (row.some(Boolean))
          yield Object.fromEntries(headers.map((h, n) => [h, row[n] ?? ""]));
        row = [];
      }
    } else cell += c;
  }
}
export function seconds(time) {
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(time || "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
function cleanName(value) {
  return (value || "")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
}
export function agencyStopName(name, agency) {
  const choices = (name || "").split("|");
  const chosen =
    choices.find((x) => x.startsWith(`[${agency}]`)) ||
    choices.find((x) => x.startsWith(`[${agency?.split("+")[0]}]`)) ||
    choices[0];
  return cleanName(chosen.replace(/^\[[^\]]+\]\s*/, ""));
}
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
};
export function normalizeGovernment(files, translated = {}, meta = {}) {
  const read = (n) => {
    if (!files[n + ".txt"]) throw Error(`Government feed missing ${n}.txt`);
    return csvRows(files[n + ".txt"]);
  };
  const zhStops = new Map(
    [...csvRows(translated["stops.txt"] || "")].map((x) => [
      x.stop_id,
      x.stop_name,
    ]),
  );
  const zhRoutes = new Map(
    [...csvRows(translated["routes.txt"] || "")].map((x) => [
      x.route_id,
      x.route_long_name,
    ]),
  );
  const stopList = {};
  for (const s of read("stops")) {
    const lat = Number(s.stop_lat),
      lng = Number(s.stop_lon);
    if (
      !s.stop_id ||
      !s.stop_lat ||
      !s.stop_lon ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      throw Error("Invalid government stop coordinates");
    stopList[s.stop_id] = {
      name: { en: s.stop_name, zh: zhStops.get(s.stop_id) || "" },
      location: { lat, lng },
    };
  }
  const routeInfo = new Map(
    [...read("routes")]
      .filter(
        (r) =>
          r.route_type === "3" &&
          r.agency_id.split("+").some((a) => agencies[a]),
      )
      .map((r) => [r.route_id, r]),
  );
  const trips = new Map();
  for (const t of read("trips"))
    if (routeInfo.has(t.route_id))
      trips.set(t.trip_id, {
        ...t,
        ids: [],
        firstSeq: Infinity,
        lastSeq: -1,
        start: null,
        end: null,
        windows: [],
      });
  for (const s of read("stop_times")) {
    const t = trips.get(s.trip_id);
    if (!t) continue;
    const seq = Number(s.stop_sequence);
    if (!Number.isInteger(seq) || seq < 0 || !stopList[s.stop_id])
      throw Error("Invalid government stop sequence");
    t.ids[seq] = s.stop_id;
    if (seq < t.firstSeq) {
      t.firstSeq = seq;
      t.start = seconds(s.departure_time || s.arrival_time);
    }
    if (seq > t.lastSeq) {
      t.lastSeq = seq;
      t.end = seconds(s.arrival_time || s.departure_time);
    }
  }
  for (const f of read("frequencies")) {
    const t = trips.get(f.trip_id);
    if (!t) continue;
    const start = seconds(f.start_time);
    let end = seconds(f.end_time);
    const headway = Number(f.headway_secs);
    if (start === null || end === null || !(headway > 0))
      throw Error("Invalid government headway");
    if (end < start) end += 86400;
    t.windows.push([start, end, headway]);
  }
  const calendars = {};
  for (const c of read("calendar"))
    calendars[c.service_id] = {
      days: [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ].map((d) => Number(c[d])),
      start: c.start_date,
      end: c.end_date,
      exceptions: {},
    };
  for (const c of read("calendar_dates")) {
    calendars[c.service_id] ??= {
      days: [0, 0, 0, 0, 0, 0, 0],
      start: "",
      end: "",
      exceptions: {},
    };
    calendars[c.service_id].exceptions[c.date] = Number(c.exception_type);
  }
  const groups = new Map(),
    routeList = {};
  for (const t of trips.values()) {
    const r = routeInfo.get(t.route_id),
      ids = t.ids.filter((x) => x !== undefined);
    if (ids.length < 2) continue;
    const bound = t.trip_id.split("-")[1] || "1",
      sequence = ids.join(","),
      groupKey = `${r.route_id}/${bound}/${sequence}`;
    let variant = groups.get(groupKey);
    if (!variant) {
      const key = `td-${r.route_id}-${bound}-${hash(sequence)}`;
      if (routeList[key]) throw Error("Government variant ID collision");
      const name = (id) => ({
        en: agencyStopName(stopList[id].name.en, r.agency_id),
        zh: agencyStopName(stopList[id].name.zh, r.agency_id),
      });
      const operators = r.agency_id
        .split("+")
        .map((x) => agencies[x])
        .filter(Boolean);
      variant = {
        route: r.route_short_name,
        agency: r.agency_id,
        orig: name(ids[0]),
        dest: name(ids.at(-1)),
        description: {
          en: cleanName(r.route_long_name),
          zh: cleanName(zhRoutes.get(r.route_id) || ""),
        },
        serviceType: r.route_id,
        bound: Object.fromEntries(operators.map((co) => [co, bound])),
        stops: Object.fromEntries(operators.map((co) => [co, ids])),
        schedule: [],
        source: GOVERNMENT_SOURCE,
      };
      groups.set(groupKey, variant);
      routeList[key] = variant;
    }
    let duration = t.start !== null && t.end !== null ? t.end - t.start : null;
    if (duration !== null && duration < 0) duration += 86400;
    if (duration === 0) duration = null;
    const windows = t.windows.length
      ? t.windows
      : t.start !== null
        ? [[t.start, t.start, 0]]
        : [];
    for (const [a, b, h] of windows)
      variant.schedule.push([t.service_id, a, b, h, duration]);
  }
  if (!Object.keys(routeList).length)
    throw Error("Government feed contains no supported bus routes");
  for (const r of Object.values(routeList))
    r.schedule = [
      ...new Map(r.schedule.map((w) => [JSON.stringify(w), w])).values(),
    ];
  const used = new Set(
    Object.values(routeList).flatMap((r) => Object.values(r.stops).flat()),
  );
  return {
    source: {
      id: GOVERNMENT_SOURCE,
      publisher: "Transport Department, Government of the Hong Kong SAR",
      attribution:
        "Route, stop and timetable data © Government of the Hong Kong SAR. Source: Transport Department / DATA.GOV.HK.",
      urls: GOVERNMENT_URLS,
      terms: "https://data.gov.hk/en/terms-and-conditions",
      retrievedAt: meta.retrievedAt || new Date().toISOString(),
      publishedAt: meta.publishedAt || null,
    },
    routeList,
    stopList: Object.fromEntries(
      Object.entries(stopList).filter(([id]) => used.has(id)),
    ),
    calendars,
  };
}

export function governmentServiceStatus(
  route,
  data,
  now = new Date(),
  upcoming = 30,
) {
  if (!route.schedule?.length)
    return { kind: "unknown", text: "Timetable unavailable — select manually" };
  const hk = new Date(now.getTime() + 28800000),
    dayStart = Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), hk.getUTCDate()),
    clock =
      hk.getUTCHours() * 3600 + hk.getUTCMinutes() * 60 + hk.getUTCSeconds();
  let running = false,
    unknown = false,
    next = Infinity;
  for (const offset of [-2, -1, 0, 1]) {
    const date = new Date(dayStart + offset * 86400000),
      stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
    for (const [service, start, end, headway, duration] of route.schedule) {
      const cal = data.calendars?.[service];
      if (!cal) {
        unknown = true;
        continue;
      }
      const exception = cal.exceptions?.[stamp];
      const operates =
        exception === 1 ||
        (exception !== 2 &&
          stamp >= cal.start &&
          stamp <= cal.end &&
          cal.days[date.getUTCDay()] === 1);
      if (!operates) continue;
      const a = start + offset * 86400,
        b = end + offset * 86400;
      let last = a,
        following = a;
      if (headway > 0) {
        const count = Math.max(0, Math.ceil((b - a) / headway) - 1);
        const index = Math.min(count, Math.floor((clock - a) / headway));
        last = index >= 0 ? a + index * headway : null;
        const nextIndex = Math.max(0, Math.floor((clock - a) / headway) + 1);
        following = nextIndex <= count ? a + nextIndex * headway : Infinity;
      } else if (a < clock) following = Infinity;
      if (last !== null && last <= clock) {
        if (duration !== null && last + duration >= clock) running = true;
        else if (duration === null && clock - last <= 7200) unknown = true;
      }
      if (following >= clock) next = Math.min(next, following - clock);
    }
  }
  if (running) return { kind: "active", text: "Scheduled to be running now" };
  if (next <= upcoming * 60)
    return {
      kind: "upcoming",
      text: `Next scheduled departure in ${Math.ceil(next / 60)} min`,
    };
  if (unknown)
    return {
      kind: "unknown",
      text: "Journey time / timetable incomplete — select manually",
    };
  return {
    kind: "inactive",
    text: Number.isFinite(next)
      ? `Next departure in ${Math.floor(next / 3600)}h ${Math.ceil((next % 3600) / 60)}m`
      : "No service in this time window",
  };
}
