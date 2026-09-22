const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

export function hkTimestamp(now = new Date()) {
  const d = new Date(now.getTime() + HK_OFFSET_MS);
  return d.toISOString().slice(0, 19) + "+08:00";
}

export function hkDate(now = new Date()) {
  return hkTimestamp(now).slice(0, 10);
}

export function projectMomentum(fix, now = Date.now()) {
  if (!fix || fix.source === "estimated") return null;
  const age = Math.max(0, now - Number(fix.timestamp || 0));
  const speed = Number(fix.speed);
  const heading = Number(fix.heading);
  if (
    age < 12000 ||
    age > 120000 ||
    !Number.isFinite(speed) ||
    speed < 0.5 ||
    !Number.isFinite(heading)
  ) return null;
  const distance = Math.min(speed, 45) * age / 1000;
  const bearing = heading * Math.PI / 180;
  const latRad = Number(fix.lat) * Math.PI / 180;
  const metresPerDegreeLat = 111320;
  const metresPerDegreeLng = Math.max(1, 111320 * Math.cos(latRad));
  return {
    lat: Number(fix.lat) + Math.cos(bearing) * distance / metresPerDegreeLat,
    lng: Number(fix.lng) + Math.sin(bearing) * distance / metresPerDegreeLng,
    accuracy: Math.max(Number(fix.accuracy) || 0, 25 + distance * 0.3 + age / 1000 * 2),
    timestamp: now,
    speed,
    heading,
    source: "estimated",
  };
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function makeGpx(s) {
  const points = Array.isArray(s?.track) ? s.track : [];
  const title = `${s?.route?.route || "trip"} ${s?.date || ""}`.trim();
  const body = points
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.time)
    .map((p) => {
      const comment = [
        p.source || "gps",
        Number.isFinite(Number(p.accuracy)) ? `accuracy=${Math.round(Number(p.accuracy))}m` : "",
      ].filter(Boolean).join("; ");
      return `<trkpt lat="${Number(p.lat).toFixed(7)}" lon="${Number(p.lng).toFixed(7)}"><time>${escapeXml(p.time)}</time>${comment ? `<cmt>${escapeXml(comment)}</cmt>` : ""}</trkpt>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="PassengerCount" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml(title)}</name></metadata><trk><name>${escapeXml(title)}</name><trkseg>${body}</trkseg></trk></gpx>\n`;
}

export function parseVehicleProfiles(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [pattern = "", operator = "", model = "", seats = "", capacity = ""] = line.split("|").map((x) => x.trim());
      return {
        pattern,
        operator,
        model,
        seats: /^\d+$/.test(seats) ? Number(seats) : null,
        capacity: /^\d+$/.test(capacity) ? Number(capacity) : null,
      };
    })
    .filter((x) => x.pattern);
}

function wildcardRegex(pattern) {
  const source = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${source}$`, "i");
}

export function matchVehicle(value, profiles = [], fallbackOperator = "") {
  const input = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!input) return null;
  const found = profiles.find((p) => {
    try { return wildcardRegex(String(p.pattern).replace(/\s+/g, "")).test(input); }
    catch { return false; }
  });
  if (!found) return { input, operator: fallbackOperator || "", model: "", seats: null, capacity: null, matched: false };
  return { input, ...found, matched: true };
}

function num(v) {
  return v === "" || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);
}

function fareForBoarding(data, route, stop, terminal) {
  const rules = data?.fares?.[route?.serviceType];
  if (!Array.isArray(rules) || !rules.length) return null;
  const origin = stop?.zone ?? "";
  const destination = terminal?.zone ?? "";
  const candidates = rules.filter((r) =>
    (!r.origin || r.origin === origin) && (!r.destination || r.destination === destination));
  if (!candidates.length) return null;
  candidates.sort((a, b) =>
    Number(Boolean(b.origin)) + Number(Boolean(b.destination)) -
    Number(Boolean(a.origin)) - Number(Boolean(a.destination)));
  const fare = candidates[0];
  return Number.isFinite(Number(fare.price))
    ? { price: Number(fare.price), currency: fare.currency || "HKD" }
    : null;
}

export function tripMetrics(s, data) {
  if (!s?.rows?.length) return { served: 0, fare: null, currency: "HKD", unpriced: 0 };
  const start = Number.isInteger(s.startIndex) ? s.startIndex : 0;
  const end = Number.isInteger(s.endIndex) ? s.endIndex : s.rows.length - 1;
  const initial = s.initialOnboard === "" || s.initialOnboard == null ? 0 : num(s.initialOnboard);
  let served = initial, fare = 0, priced = 0, unpriced = initial;
  const terminal = s.stops.at(-1);
  for (let i = start; i <= end && i < s.rows.length; i++) {
    const boarding = num(s.rows[i].boarding);
    served += boarding;
    if (!boarding) continue;
    const rule = fareForBoarding(data, s.route, s.stops[i], terminal);
    if (rule) {
      fare += boarding * rule.price;
      priced += boarding;
    } else unpriced += boarding;
  }
  return {
    served,
    fare: priced ? Math.round(fare * 100) / 100 : null,
    currency: "HKD",
    unpriced,
    priced,
    assumption: "boarding-stop-to-route-terminus",
  };
}

export function festivalFromLunar(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  const map = [
    ["正月十五", "Lantern Festival"],
    ["七月初七", "Qixi Festival"],
    ["七月十五", "Hungry Ghost Festival"],
    ["八月十五", "Mid-Autumn Festival"],
    ["九月初九", "Chung Yeung Festival"],
  ];
  const hit = map.find(([needle]) => text.includes(needle));
  return hit ? { name: hit[1], lunar: hit[0] } : null;
}

export function schoolHolidayForDate(date, ranges = []) {
  for (const r of ranges || []) {
    if (r?.start && r?.end && date >= r.start && date <= r.end)
      return { known: true, name: r.name || "School holiday", start: r.start, end: r.end };
  }
  return { known: false, name: "", note: "No school-specific calendar configured" };
}
