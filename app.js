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
  validPassengerCount,
} from "./core.js";
import { load, save, loadSurveyor, saveSurveyor } from "./storage.js";
import { routes } from "./data.js";
import { uploadSurvey } from "./upload.js";
const $ = (id) => document.getElementById(id),
  fields = ["boarding", "alighting", "onboard"];
let state = load(),
  data,
  matches = [],
  map,
  markers = [],
  position,
  watch,
  screen = "setup",
  mapReturn = "setup",
  followGps = true,
  selectedField = "boarding",
  replaceOnDigit = true,
  nearestIndex = null;
const cur = () => state.surveys.find((s) => s.id === state.currentId);
const stopLabel = (stop, i) =>
  `${i + 1}. ${stop.name.zh ? stop.name.zh + " · " : ""}${stop.name.en}`;
const validLocation = (x) => Number.isFinite(x?.lat) && Number.isFinite(x?.lng);
const error = (message) => {
  $("error").textContent = message;
  $("error").hidden = !message;
};
function persist() {
  try {
    save(state);
    $("saveStatus").textContent = "Saved on this device";
    return true;
  } catch {
    $("saveStatus").textContent = "NOT SAVED";
    error("Device storage is unavailable. Save a CSV before closing.");
    return false;
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
function showScreen(next) {
  screen = next;
  document.body.dataset.screen = next;
  for (const [id, value] of [
    ["setup", "setup"],
    ["countScreen", "count"],
    ["mapScreen", "map"],
    ["reviewScreen", "review"],
  ])
    $(id).hidden = value !== next;
  if (cur()) {
    cur().screen = next === "map" ? mapReturn : next;
    persist();
  }
  if (next === "count") renderCount();
  if (next === "review") renderReview();
  if (next === "map") {
    setupMap();
    requestAnimationFrame(() => {
      map?.invalidateSize();
      centerMap();
    });
  }
  window.scrollTo(0, 0);
}
function list() {
  $("saved").replaceChildren(new Option("New survey", ""));
  for (const s of [...state.surveys].reverse())
    $("saved").add(
      new Option(
        `${s.date} · ${s.route.route} ${OPERATORS[s.route.operator] || s.route.operator} → ${s.route.dest.en} · ${s.vehicle || "No vehicle"}`,
        s.id,
      ),
    );
  $("saved").value = state.currentId || "";
}
async function search(force = false) {
  const number = $("route").value.trim();
  if (!number && !force) return;
  error("");
  try {
    data = await routes((x) => ($("dataStatus").textContent = x), force);
    matches = number ? variants(data, number, $("operator").value) : [];
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
  $("clock").textContent = `${c.date} ${c.time} (Hong Kong)`;
  $("results").replaceChildren();
  $("otherResults").replaceChildren();
  let hidden = 0;
  for (const r of matches) {
    const status = serviceStatus(r, data, new Date(), +$("upcoming").value),
      button = document.createElement("button");
    button.className = "route";
    button.textContent = `${OPERATORS[r.operator]} ${r.route} · ${r.orig.en} → ${r.dest.en}`;
    const extra = document.createElement("span");
    extra.textContent = `${r.orig.zh || ""} → ${r.dest.zh || ""} · Direction ${r.direction} · Variant ${r.serviceType} · ${r.stopIds.length} stops`;
    const badge = document.createElement("span");
    badge.className = status.kind;
    badge.textContent = status.text;
    button.append(extra, badge);
    button.onclick = () => selectRoute(r);
    if (status.kind === "inactive") {
      $("otherResults").append(button);
      hidden++;
    } else $("results").append(button);
  }
  $("other").hidden = !hidden;
  $("otherTitle").textContent = `Show ${hidden} other directions / variants`;
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
      screen: "setup",
      updatedAt: new Date().toISOString(),
    };
  state.surveys.push(s);
  state.currentId = s.id;
  followGps = true;
  persist();
  renderSurvey();
  showScreen("setup");
  $("tripSetup").scrollIntoView({ block: "start" });
}
function renderSurvey() {
  const s = cur();
  list();
  $("tripSetup").hidden = !s;
  if (!s) {
    $("surveyor").value = loadSurveyor();
    showScreen("setup");
    return;
  }
  $("surveyor").value = s.surveyor;
  $("selected").textContent =
    `${OPERATORS[s.route.operator] || s.route.operator} ${s.route.route} · ${s.route.orig.en} → ${s.route.dest.en}`;
  for (const f of ["date", "vehicle", "notes"]) $(f).value = s[f];
  $("start").replaceChildren(new Option("Choose or wait for GPS", ""));
  $("active").replaceChildren();
  $("mapStop").replaceChildren();
  s.stops.forEach((stop, i) => {
    for (const id of ["start", "active", "mapStop"])
      $(id).add(new Option(stopLabel(stop, i), String(i)));
  });
  $("start").value = s.pendingStart ?? s.startIndex ?? "";
  nearestIndex = null;
  startStatus();
  active(s.activeIndex || 0);
  if (map) setupMap();
  suggest();
  locate();
}
function selectPending(index, source) {
  const s = cur();
  if (!s || !s.stops[index]) return;
  s.pendingStart = index;
  s.startSource = source;
  $("start").value = String(index);
  active(index);
  edit();
  startStatus();
}
function startStatus() {
  const s = cur();
  if (!s) return;
  $("confirm").disabled = s.pendingStart == null;
  $("resume").hidden = s.startIndex == null;
  $("startStatus").textContent =
    s.pendingStart == null
      ? "Allow GPS to suggest a stop, or choose manually."
      : `Selected: ${stopLabel(s.stops[s.pendingStart], s.pendingStart)}. Confirm to start counting here.`;
}
function active(index) {
  const s = cur();
  if (!s || !s.stops[index]) return;
  s.activeIndex = index;
  $("active").value = String(index);
  $("mapStop").value = String(index);
  for (const [i, marker] of markers.entries())
    marker?.setIcon(icon(i, i === index));
  selectedField = "boarding";
  replaceOnDigit = true;
  renderCount();
  if (screen === "review") renderReview();
  persist();
}
function renderCount() {
  const s = cur();
  if (!s) return;
  const row = s.rows[s.activeIndex],
    onboard = onboardValues(s.rows)[s.activeIndex];
  $("tripTitle").textContent = `${s.route.route} → ${s.route.dest.en}`;
  $("active").value = String(s.activeIndex);
  for (const field of fields) {
    const input = $(field);
    input.value =
      field === "onboard" && row.onboard === "" ? (onboard ?? "") : row[field];
    input.classList.toggle("selectedField", field === selectedField);
    input.classList.toggle(
      "derived",
      field === "onboard" && row.onboard === "" && onboard !== null,
    );
  }
  $("onboardSource").textContent =
    row.onboard === "" && onboard !== null ? "auto · tap to override" : "";
  $("prev").disabled = s.activeIndex === 0;
  $("next").disabled = s.activeIndex === s.stops.length - 1;
  $("stopTime").value = row.time;
  $("stopNotes").value = row.notes;
  $("nextField").textContent =
    selectedField === "onboard"
      ? "Next stop"
      : selectedField === "boarding"
        ? "Next: alighting"
        : "Next: onboard";
  renderNearby();
}
function selectField(field) {
  selectedField = field;
  replaceOnDigit = true;
  renderCount();
}
function enterKey(key) {
  const s = cur();
  if (!s) return;
  const row = s.rows[s.activeIndex];
  let value = row[selectedField];
  if (key === "clear") value = "";
  else if (key === "backspace") value = value.slice(0, -1);
  else if (/^[0-9]$/.test(key))
    value = replaceOnDigit ? key : value === "0" ? key : value + key;
  else return;
  if (!validPassengerCount(value)) return;
  replaceOnDigit = false;
  row[selectedField] = value;
  if (value !== "" && !row.time) row.time = hkClock().time;
  edit();
  renderCount();
}
function nextField() {
  const i = fields.indexOf(selectedField);
  if (i < 2) selectField(fields[i + 1]);
  else if (cur().activeIndex < cur().stops.length - 1)
    active(cur().activeIndex + 1);
}
function renderReview() {
  const s = cur();
  if (!s) return;
  const counts = onboardValues(s.rows);
  $("body").replaceChildren();
  s.rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.dataset.i = String(i);
    tr.classList.toggle("selectedRow", i === s.activeIndex);
    const td = document.createElement("td"),
      button = document.createElement("button");
    button.textContent = stopLabel(s.stops[i], i);
    button.onclick = () => {
      active(i);
      showScreen("count");
    };
    td.append(button);
    tr.append(td);
    for (const field of ["time", ...fields]) {
      const cell = document.createElement("td");
      cell.dataset.f = field;
      cell.textContent = field === "onboard" ? (counts[i] ?? "") : row[field];
      if (field === "onboard" && row.onboard === "" && counts[i] !== null) {
        const tag = document.createElement("span");
        tag.className = "derivedText";
        tag.textContent = "auto";
        cell.append(tag);
      }
      tr.append(cell);
    }
    $("body").append(tr);
  });
}
const icon = (i, selected) =>
  L.divIcon({
    html: i + 1,
    className: `stopIcon${selected ? " selected" : ""}`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
function setFollow(value) {
  followGps = value;
  $("myLocation").textContent = value ? "Following GPS" : "Follow GPS";
  $("myLocation").setAttribute("aria-pressed", String(value));
  $("mapMode").textContent = value
    ? "Following current GPS location"
    : "Map inspection · tap Follow GPS to resume";
}
function centerMap() {
  if (!map) return;
  if (followGps && position)
    map.setView([position.lat, position.lng], 18, { animate: false });
  else if (!position) {
    const s = cur(),
      stop = s?.stops[s.activeIndex];
    if (validLocation(stop))
      map.setView([stop.lat, stop.lng], 18, { animate: false });
  }
}
function setupMap() {
  const s = cur();
  if (!s || !window.L) return;
  if (!map) {
    map = L.map("map").setView([22.32, 114.17], 18);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    map.createPane("gpsPane");
    map.getPane("gpsPane").style.zIndex = 650;
    map.on("dragstart", () => setFollow(false));
  }
  markers.forEach((m) => m?.remove());
  markers = s.stops.map((stop, i) => {
    if (!validLocation(stop)) return null;
    const label = document.createElement("span");
    label.textContent = stopLabel(stop, i);
    return L.marker([stop.lat, stop.lng], {
      icon: icon(i, i === s.activeIndex),
    })
      .bindTooltip(label, {
        permanent: true,
        direction: i % 2 ? "left" : "right",
      })
      .on("click", () => {
        if (mapReturn === "setup") selectPending(i, "manual");
        else active(i);
      })
      .addTo(map);
  });
  updateGps();
  setFollow(followGps);
  centerMap();
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
  if (followGps) map.setView(latlng, 18, { animate: false });
}
function locate(restart = false) {
  if (!navigator.geolocation) {
    $("gps").textContent = "GPS unavailable; choose a stop manually.";
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
    (e) => {
      $("gps").textContent =
        e.code === 1
          ? "Location permission is off. Choose a stop manually."
          : "Cannot get a fresh location. Choose manually or retry.";
      position = null;
      nearestIndex = null;
      if (map?.gps) {
        map.gps.remove();
        map.accuracy.remove();
        map.gps = null;
        map.accuracy = null;
      }
      renderNearby();
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  );
}
function suggest() {
  const s = cur();
  if (!s || !position || Date.now() - position.timestamp > 60000) return;
  const nearest = nearestStops(s.stops, position)[0];
  if (!nearest) return;
  nearestIndex = nearest.index;
  $("gps").textContent =
    `GPS ±${Math.round(position.accuracy)} m · Nearest: ${stopLabel(nearest, nearest.index)} (${Math.round(nearest.distance)} m away)`;
  if (
    s.startIndex == null &&
    s.startSource !== "manual" &&
    s.pendingStart !== nearest.index
  )
    selectPending(nearest.index, "gps");
  renderNearby();
}
function renderNearby() {
  const s = cur();
  if (!s) return;
  const fresh =
    position &&
    Date.now() - position.timestamp < 60000 &&
    nearestIndex !== null;
  $("nearby").textContent = fresh
    ? `GPS nearest: ${nearestIndex + 1}. ${s.stops[nearestIndex].name.en}`
    : "GPS unavailable · choose the stop manually";
  $("useNearest").hidden = !fresh || nearestIndex === s.activeIndex;
  if (fresh)
    $("useNearest").textContent = `Use nearest stop: ${nearestIndex + 1}`;
}
function openMap() {
  mapReturn = screen;
  showScreen("map");
  locate();
}
function download() {
  const s = cur();
  if (!s) return;
  const csv = makeCSV(s),
    filename = `bus-${s.route.route}-${s.date}.csv`;
  if (window.PassengerCountAndroid) {
    window.PassengerCountAndroid.saveCsv(csv, filename);
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
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
for (const [code, name] of Object.entries(OPERATORS))
  $("operator").add(new Option(name, code));
$("surveyor").value = loadSurveyor();
$("surveyor").oninput = () => {
  try {
    saveSurveyor($("surveyor").value);
  } catch {
    error("Cannot save the surveyor name.");
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
$("upcoming").onchange = () => {
  state.search = { ...state.search, upcoming: $("upcoming").value };
  persist();
  renderMatches();
};
$("refreshData").onclick = async () => {
  $("refreshData").disabled = true;
  try {
    await search(true);
  } finally {
    $("refreshData").disabled = false;
  }
};
$("saved").onchange = () => {
  state.currentId = $("saved").value || null;
  persist();
  renderSurvey();
  if (cur()?.startIndex != null) showScreen("count");
};
$("new").onclick = () => {
  state.currentId = null;
  persist();
  renderSurvey();
};
for (const field of ["date", "vehicle", "notes"])
  $(field).oninput = () => {
    cur()[field] = $(field).value;
    edit();
    list();
  };
$("start").onchange = () => {
  if ($("start").value === "") {
    cur().pendingStart = null;
    cur().startSource = "manual";
    edit();
    startStatus();
  } else selectPending(+$("start").value, "manual");
};
$("confirm").onclick = () => {
  const s = cur();
  if (s.pendingStart == null) return;
  s.startIndex = s.pendingStart;
  active(s.startIndex);
  edit();
  showScreen("count");
};
$("resume").onclick = () => showScreen("count");
$("settings").onclick = () => showScreen("setup");
$("active").onchange = () => active(+$("active").value);
$("prev").onclick = () => active(cur().activeIndex - 1);
$("next").onclick = () => active(cur().activeIndex + 1);
$("useNearest").onclick = () => {
  if (
    position &&
    Date.now() - position.timestamp < 60000 &&
    nearestIndex !== null
  )
    active(nearestIndex);
};
for (const field of fields) {
  $(field).onfocus = () => selectField(field);
  $(field).onclick = () => selectField(field);
  $(field).addEventListener("paste", (e) => {
    e.preventDefault();
    const value = e.clipboardData.getData("text");
    if (validPassengerCount(value)) {
      const row = cur().rows[cur().activeIndex];
      row[field] = value;
      if (value && !row.time) row.time = hkClock().time;
      replaceOnDigit = false;
      edit();
      renderCount();
    }
  });
}
$("keypad").onpointerdown = (e) => {
  if (e.target.closest("button")) e.preventDefault();
};
$("keypad").onclick = (e) => {
  const key = e.target.closest("[data-key]")?.dataset.key;
  if (key) enterKey(key);
};
$("nextField").onclick = nextField;
document.addEventListener("keydown", (e) => {
  if (screen !== "count" || e.ctrlKey || e.altKey || e.metaKey) return;
  const editing = document.activeElement;
  if (editing && ["stopTime", "stopNotes", "active"].includes(editing.id))
    return;
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    enterKey(e.key);
  } else if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    enterKey(e.key === "Backspace" ? "backspace" : "clear");
  } else if (e.key === "Enter" && fields.includes(editing?.id)) {
    e.preventDefault();
    nextField();
  }
});
$("stopTime").oninput = () => {
  cur().rows[cur().activeIndex].time = $("stopTime").value;
  edit();
};
$("stopNotes").oninput = () => {
  cur().rows[cur().activeIndex].notes = $("stopNotes").value;
  edit();
};
$("setupMap").onclick = $("checkMap").onclick = openMap;
$("mapBack").onclick = () => showScreen(mapReturn);
$("useMapStop").onclick = () => {
  if (mapReturn === "setup") {
    selectPending(+$("mapStop").value, "manual");
    showScreen("setup");
  } else {
    active(+$("mapStop").value);
    showScreen("count");
  }
};
$("mapStop").onchange = () => {
  if (mapReturn === "setup") selectPending(+$("mapStop").value, "manual");
  else active(+$("mapStop").value);
};
$("myLocation").onclick = () => {
  setFollow(true);
  centerMap();
  locate(true);
};
$("locate").onclick = () => locate(true);
$("selectedStop").onclick = () => {
  const stop = cur().stops[cur().activeIndex];
  if (map && validLocation(stop)) {
    setFollow(false);
    map.setView([stop.lat, stop.lng], 18, { animate: false });
  }
};
$("whole").onclick = () => {
  const points = cur()
    .stops.filter(validLocation)
    .map((s) => [s.lat, s.lng]);
  if (map && points.length) {
    setFollow(false);
    map.fitBounds(points, { padding: [30, 30] });
  }
};
$("review").onclick = $("finish").onclick = () => showScreen("review");
$("reviewBack").onclick = () => showScreen("count");
$("csv").onclick = download;
$("upload").onclick = () => upload(false);
$("both").onclick = () => upload(true);
const query = state.search || {};
$("route").value = query.number || "";
$("operator").value = query.operator || "";
$("upcoming").value = query.upcoming || "30";
const resumeScreen = cur()?.screen;
renderSurvey();
if (cur()?.startIndex != null)
  showScreen(resumeScreen === "setup" ? "setup" : "count");
else showScreen("setup");
persist();
if (query.number) search();
window.addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    if (data && matches.length) renderMatches();
    if (cur()) locate(true);
  }
});
setInterval(() => {
  if (data && matches.length) renderMatches();
  renderNearby();
}, 60000);
if (!window.PassengerCountAndroid && "serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});

window.addEventListener("government-data-updated", () => {
  if (screen === "setup" && $("route").value.trim()) search();
});
