import {
  OPERATORS,
  hkClock,
  serviceStatus,
  variants,
  stopsFor,
  emptyRow,
  onboardValues,
  nearestStops,
  makeCSV,
} from "./core.js";
import { load, save, loadSurveyor, saveSurveyor } from "./storage.js";
import { routes } from "./data.js";
import { uploadSurvey } from "./upload.js";
const $ = (id) => document.getElementById(id);
let state = load(),
  data,
  matches = [],
  map,
  markers = [],
  position,
  watch;
const cur = () => state.surveys.find((x) => x.id === state.currentId);
const error = (x) => {
  $("error").textContent = x;
  $("error").hidden = !x;
};
function persist() {
  try {
    save(state);
    $("saveStatus").textContent = window.PassengerCountAndroid
      ? "Saved on this device"
      : "Saved on this browser";
  } catch {
    $("saveStatus").textContent = "NOT SAVED";
    error("Device storage is unavailable. Save a CSV before closing.");
  }
}
function edit() {
  const s = cur();
  if (s) {
    s.updatedAt = new Date().toISOString();
    if (s.upload?.done) delete s.upload;
  }
  persist();
}
function list() {
  $("saved").replaceChildren(new Option("New survey", ""));
  for (const s of [...state.surveys].reverse())
    $("saved").add(
      new Option(
        `${s.date} · ${s.route.route} ${OPERATORS[s.route.operator]} → ${s.route.dest.en} · ${s.vehicle || "No vehicle"}`,
        s.id,
      ),
    );
  $("saved").value = state.currentId || "";
}
async function search(force = false) {
  const number = $("route").value.trim();
  if (!number) return;
  try {
    data = await routes((x) => ($("dataStatus").textContent = x), force);
    matches = variants(data, number, $("operator").value);
    state.search = {
      number,
      operator: $("operator").value,
      upcoming: $("upcoming").value,
    };
    persist();
    renderMatches();
  } catch (e) {
    error(e.message);
  }
}
function renderMatches() {
  const c = hkClock();
  $("clock").textContent = `Service filter: ${c.date} ${c.time} (Hong Kong)`;
  $("results").replaceChildren();
  $("otherResults").replaceChildren();
  let hidden = 0;
  for (const r of matches) {
    const s = serviceStatus(r, data, new Date(), +$("upcoming").value),
      b = document.createElement("button");
    b.className = "route";
    b.textContent = `${OPERATORS[r.operator]} ${r.route} · ${r.orig.en} → ${r.dest.en}`;
    const a = document.createElement("span");
    a.textContent = `${r.orig.zh || ""} → ${r.dest.zh || ""} · ${r.direction} · Variant ${r.serviceType} · ${r.stopIds.length} stops`;
    const badge = document.createElement("span");
    badge.className = s.kind;
    badge.textContent = s.text;
    b.append(a, badge);
    b.onclick = () => selectRoute(r);
    if (s.kind === "inactive") {
      $("otherResults").append(b);
      hidden++;
    } else $("results").append(b);
  }
  $("other").hidden = !hidden;
  $("otherTitle").textContent =
    `Show ${hidden} other directions / route variants`;
  if (!$("results").children.length)
    $("results").textContent = matches.length
      ? "No scheduled variants in this window. Expand the other variants."
      : "No matching routes found.";
}
function selectRoute(route) {
  const stops = stopsFor(route, data),
    s = {
      id: crypto.randomUUID(),
      route,
      stops,
      rows: stops.map(emptyRow),
      date: hkClock().date,
      vehicle: "",
      notes: "",
      surveyor: $("surveyor").value,
      startIndex: null,
      pendingStart: null,
      startSource: null,
      activeIndex: 0,
      updatedAt: new Date().toISOString(),
    };
  state.surveys.push(s);
  state.currentId = s.id;
  persist();
  renderSurvey();
}
function renderSurvey() {
  const s = cur();
  list();
  $("survey").hidden = !s;
  if (!s) {
    $("surveyor").value = loadSurveyor();
    return;
  }
  $("surveyor").value = s.surveyor;
  $("selected").textContent =
    `${OPERATORS[s.route.operator]} ${s.route.route} · ${s.route.orig.en} → ${s.route.dest.en} · Variant ${s.route.serviceType}`;
  $("date").value = s.date;
  $("vehicle").value = s.vehicle;
  $("notes").value = s.notes;
  $("start").replaceChildren(new Option("Choose or wait for GPS", ""));
  $("active").replaceChildren();
  s.stops.forEach((x, i) => {
    const label = `${i + 1}. ${x.name.zh || ""} · ${x.name.en || ""}`;
    $("start").add(new Option(label, i));
    $("active").add(new Option(label, i));
  });
  $("start").value = s.pendingStart ?? "";
  $("body").replaceChildren();
  s.rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.dataset.i = i;
    const name = document.createElement("td");
    name.textContent = `${i + 1}. ${s.stops[i].name.zh || ""} · ${s.stops[i].name.en || ""}`;
    name.onclick = () => active(i);
    tr.append(name);
    for (const f of ["time", "boarding", "alighting", "onboard", "notes"]) {
      const td = document.createElement("td"),
        input = document.createElement("input");
      input.type = f === "time" ? "time" : f === "notes" ? "text" : "number";
      input.value = r[f];
      input.dataset.f = f;
      input.setAttribute("aria-label", `${f} at stop ${i + 1}`);
      const label = document.createElement("label");
      label.className = "countLabel";
      label.textContent = f[0].toUpperCase() + f.slice(1);
      label.append(input);
      input.onblur = counts;
      if (input.type === "number") {
        input.min = 0;
        input.step = 1;
      }
      input.onfocus = () => active(i, false);
      input.oninput = () => {
        r[f] = input.value;
        if (
          (f === "boarding" || f === "alighting") &&
          input.value !== "" &&
          !r.time
        ) {
          r.time = hkClock().time;
          tr.querySelector("[data-f=time]").value = r.time;
        }
        edit();
        counts();
      };
      td.append(label);
      if (f === "onboard") td.append(document.createElement("small"));
      tr.append(td);
    }
    $("body").append(tr);
  });
  setupMap();
  counts();
  active(s.activeIndex, false);
  startStatus();
  suggest();
  locate();
}
function counts() {
  const s = cur(),
    v = onboardValues(s.rows);
  $("body")
    .querySelectorAll("tr")
    .forEach((tr, i) => {
      const x = tr.querySelector("[data-f=onboard]"),
        derived = s.rows[i].onboard === "" && v[i] != null;
      if (document.activeElement !== x) x.value = v[i] ?? "";
      x.classList.toggle("derived", derived);
      tr.querySelector("td:nth-child(5) small").textContent = derived
        ? "auto"
        : "";
    });
}
function active(i, center = true) {
  const s = cur();
  if (!s || !s.stops[i]) return;
  s.activeIndex = i;
  $("active").value = i;
  $("body")
    .querySelectorAll("tr")
    .forEach((r, n) => r.classList.toggle("selectedRow", n === i));
  for (const [n, m] of markers.entries()) m?.setIcon(icon(n, n === i));
  $("prev").disabled = $("entryPrev").disabled = i === 0;
  $("next").disabled = $("entryNext").disabled = i === s.stops.length - 1;
  if (center && map && validLocation(s.stops[i]))
    map.setView([s.stops[i].lat, s.stops[i].lng], 18);
  persist();
}
const icon = (i, selected) =>
  L.divIcon({
    html: i + 1,
    className: `stopIcon${selected ? " selected" : ""}`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
const validLocation = (x) => Number.isFinite(x?.lat) && Number.isFinite(x?.lng);
function setupMap() {
  const s = cur();
  if (!window.L) return;
  if (!map) {
    map = L.map("map").setView([22.32, 114.17], 18);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    map.createPane("gpsPane");
    map.getPane("gpsPane").style.zIndex = 650;
  }
  markers.forEach((x) => x?.remove());
  markers = s.stops.map((x, i) => {
    if (!validLocation(x)) return null;
    const label = document.createElement("span");
    label.textContent = `${i + 1}. ${x.name.zh || ""} · ${x.name.en || ""}`;
    return L.marker([x.lat, x.lng], { icon: icon(i, i === s.activeIndex) })
      .bindTooltip(label, {
        permanent: true,
        direction: i % 2 ? "left" : "right",
      })
      .on("click", () => active(i))
      .addTo(map);
  });
  setTimeout(() => map.invalidateSize(), 0);
  const target = validLocation(s.stops[s.activeIndex])
    ? s.stops[s.activeIndex]
    : s.stops.find(validLocation);
  if (target) map.setView([target.lat, target.lng], 18);
  updateGps();
}
function updateGps() {
  if (!map || !position) return;
  const latlng = [position.lat, position.lng];
  if (!map.gps) {
    map.accuracy = L.circle(latlng, {
      radius: position.accuracy,
      color: "#1670c5",
      weight: 1,
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);
    map.gps = L.circleMarker(latlng, {
      radius: 7,
      color: "#fff",
      weight: 2,
      fillColor: "#1670c5",
      fillOpacity: 1,
      pane: "gpsPane",
      interactive: false,
    }).addTo(map);
  } else {
    map.gps.setLatLng(latlng);
    map.accuracy.setLatLng(latlng).setRadius(position.accuracy);
  }
}
function locate(restart = false) {
  if (!navigator.geolocation) {
    $("gps").textContent = "GPS unavailable; choose manually.";
    return;
  }
  if (watch !== undefined && !restart) return;
  if (watch !== undefined) navigator.geolocation.clearWatch(watch);
  watch = navigator.geolocation.watchPosition(
    (p) => {
      position = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        timestamp: p.timestamp,
      };
      updateGps();
      suggest();
    },
    (e) =>
      ($("gps").textContent =
        e.code === 1
          ? "Location permission is off. Choose manually."
          : "Cannot get a fresh location."),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  );
}
function suggest() {
  const s = cur();
  if (!s || !position || Date.now() - position.timestamp > 60000) return;
  const n = nearestStops(s.stops, position)[0];
  if (!n) return;
  $("gps").textContent =
    `GPS ±${Math.round(position.accuracy)} m · Nearest: ${n.index + 1}. ${n.name.en} (${Math.round(n.distance)} m away).`;
  if (s.startIndex == null && s.startSource !== "manual") {
    s.pendingStart = n.index;
    s.startSource = "gps";
    $("start").value = n.index;
    edit();
    startStatus();
  }
}
function startStatus() {
  const s = cur();
  $("confirm").disabled = s.pendingStart == null;
  $("startStatus").textContent =
    s.startIndex == null
      ? s.pendingStart == null
        ? "Choose a start stop, or allow GPS to suggest one."
        : `GPS suggestion / selection: ${s.pendingStart + 1}. ${s.stops[s.pendingStart].name.en}. Confirm or change it.`
      : `Confirmed start: ${s.startIndex + 1}. ${s.stops[s.startIndex].name.en}. Earlier stops remain available for backward calculation.`;
}
function download() {
  const s = cur();
  if (window.PassengerCountAndroid) {
    window.PassengerCountAndroid.saveCsv(
      makeCSV(s),
      `bus-${s.route.route}-${s.date}.csv`,
    );
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([makeCSV(s)], { type: "text/csv" }));
  a.download = `bus-${s.route.route}-${s.date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function upload(withCSV) {
  const s = cur();
  if (withCSV) download();
  if (s.startIndex == null)
    return error("Confirm the starting stop before uploading.");
  if (!s.rows.some((r) => Object.values(r).some((v) => v !== "")))
    return error("Enter passenger data before uploading.");
  $("upload").disabled = $("both").disabled = true;
  try {
    $("uploadStatus").textContent = "Uploading…";
    await uploadSurvey(s, persist);
    $("uploadStatus").textContent = "Survey uploaded; local copy retained.";
  } catch (e) {
    error(`Upload failed: ${e.message}`);
    $("uploadStatus").textContent = "Local survey retained.";
  } finally {
    $("upload").disabled = $("both").disabled = false;
  }
}
$("surveyor").value = loadSurveyor();
$("surveyor").oninput = () => {
  try {
    saveSurveyor($("surveyor").value);
  } catch {
    error("Cannot save the surveyor name on this device.");
  }
  if (cur()) {
    cur().surveyor = $("surveyor").value;
    edit();
  }
};
$("search").onsubmit = (e) => {
  e.preventDefault();
  search();
};
$("operator").onchange = () => search();
$("upcoming").onchange = () => renderMatches();
$("saved").onchange = () => {
  state.currentId = $("saved").value || null;
  persist();
  renderSurvey();
};
$("new").onclick = () => {
  state.currentId = null;
  persist();
  renderSurvey();
};
for (const [id, k] of [
  ["date", "date"],
  ["vehicle", "vehicle"],
  ["notes", "notes"],
])
  $(id).oninput = () => {
    cur()[k] = $(id).value;
    edit();
    list();
  };
$("start").onchange = () => {
  const s = cur();
  s.pendingStart = $("start").value === "" ? null : +$("start").value;
  s.startSource = "manual";
  edit();
  startStatus();
};
$("confirm").onclick = () => {
  const s = cur();
  s.startIndex = s.pendingStart;
  edit();
  active(s.startIndex);
  startStatus();
};
$("active").onchange = () => active(+$("active").value);
for (const [id, d] of [
  ["prev", -1],
  ["entryPrev", -1],
  ["next", 1],
  ["entryNext", 1],
])
  $(id).onclick = () => active(cur().activeIndex + d);
$("locate").onclick = () => locate(true);
$("myLocation").onclick = () =>
  position && map.setView([position.lat, position.lng], 18);
$("selectedStop").onclick = () => active(cur().activeIndex);
$("whole").onclick = () => {
  const points = cur()
    .stops.filter(validLocation)
    .map((x) => [x.lat, x.lng]);
  if (map && points.length) map.fitBounds(points, { padding: [20, 20] });
};
$("all").onchange = () =>
  document.body.classList.toggle("showAll", $("all").checked);
$("csv").onclick = download;
$("upload").onclick = () => upload(false);
$("both").onclick = () => upload(true);
const q = state.search || {};
$("route").value = q.number || "";
$("operator").value = q.operator || "";
$("upcoming").value = q.upcoming || "30";
renderSurvey();
persist();
if (q.number) search();
window.addEventListener("pagehide", persist);
if (!window.PassengerCountAndroid && "serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});

setInterval(() => {
  if (data && matches.length) renderMatches();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    if (data && matches.length) renderMatches();
    if (cur()) locate(true);
  }
});
