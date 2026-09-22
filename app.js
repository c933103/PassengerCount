import {
  OPERATORS,
  hkClock,
  serviceStatus,
  variants,
  stopsFor,
  nearestStops,
  makeCSV,
  validPassengerCount,
} from "./core.js";
import {
  emptyRow,
  migrateSurvey,
  calculateOnboard,
  rowObserved,
  recordStop,
  skipField,
  completeSurvey,
  reopenSurvey,
  insertStop,
  overlapCount,
  appendSection,
} from "./survey.js";
import { DEFAULT_LANGUAGE, translate } from "./i18n.js";
import { renderChart, chartPng } from "./charts.js";
import { load, save, loadSurveyor, saveSurveyor } from "./storage.js";
import { routes, checkRouteUpdates } from "./data.js";
import { uploadSurvey } from "./upload.js";
import {
  hkTimestamp,
  makeGpx,
  parseVehicleProfiles,
  matchVehicle,
  tripMetrics,
  projectMomentum,
} from "./fieldkit.js";
import {
  fetchCalendarContext,
  fetchWeatherSnapshot,
  fetchEtaEvidence,
} from "./live.js";
const $ = (id) => document.getElementById(id);
const state = load();
state.language ??= DEFAULT_LANGUAGE;
state.vehicleProfilesText ??= "";
state.schoolHolidayRangesText ??= "";
state.surveys.forEach(migrateSurvey);
let data,
  matches = [],
  screen = "home",
  map,
  markers = [],
  position,
  watch,
  followGps = true,
  nearestIndex = null,
  target = { index: 0, field: "boarding" },
  replaceOnDigit = true,
  stopEditIndex = null,
  sectionOptions = [],
  sectionStops = [],
  uploadBusy = false,
  lastGpsFix = null,
  momentumTimer = null;
let deleteMode = false;
let undoStack = [], redoStack = [], historyCurrent = null, historyId = null;
const WEATHER = ["", "☀️", "🌤️", "☁️", "🌧️", "⛈️", "🌫️", "💨", "🌡️", "❄️"];
const selectedRecordIds = new Set();
let pendingDeleteIds = [];
const cur = () => state.surveys.find((s) => s.id === state.currentId);
const t = (key, values) => translate(state.language, key, values);
const name = (stop) =>
  stop?.name?.[state.language === "en" ? "en" : "zh"] ||
  stop?.name?.en ||
  stop?.name?.zh ||
  "";
const stopLabel = (stop, index) =>
  `${index + 1}. ${name(stop)}${stop.custom ? " · " + t("customStop") : stop.modified ? " · " + t("modifiedStop") : ""}`;
const operator = (co) =>
  t("operator_" + co) === "operator_" + co
    ? OPERATORS[co] || co
    : t("operator_" + co);
const validLocation = (x) => Number.isFinite(x?.lat) && Number.isFinite(x?.lng);
function error(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function persist() {
  try {
    save(state);
    $("saveStatus").textContent = t("saved");
    return true;
  } catch {
    $("saveStatus").textContent = t("notSaved");
    error(t("saveError"));
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
function setLanguage(language) {
  state.language = language;
  document.documentElement.lang = language;
  document.title = t("app");
  $("language").value = language;
  document
    .querySelectorAll("[data-i18n]")
    .forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document
    .querySelectorAll("[data-i18n-aria]")
    .forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  $("entryDock").setAttribute("aria-label", t("countEntry"));
  window.PassengerCountAndroid?.setLanguage?.(language);
  const chosen = $("operator").value;
  $("operator").replaceChildren(new Option(t("allOperators"), ""));
  for (const co of Object.keys(OPERATORS))
    $("operator").add(new Option(operator(co), co));
  $("operator").value = chosen;
  renderHome();
  if (data) renderMatches();
  if (cur()) {
    renderSetup();
    buildStopOptions();
    buildTable();
    renderCount();
    if (screen === "record") renderRecord();
    if (map) setupMap();
  }
  setFollow(followGps);
  refreshExportSettings();
  $("toggleMap").textContent = t(
    $("mapContents").hidden ? "showMap" : "hideMap",
  );
  document
    .querySelector("[data-key=backspace]")
    .setAttribute("aria-label", t("deleteDigit"));
  persist();
}
function showScreen(next) {
  if (next === "setup" || next === "count") setFollow(true);
  if (next !== "home") {
    deleteMode = false;
    selectedRecordIds.clear();
    document.body.classList.remove("selectingRecords");
  }
  screen = next;
  state.screen = next;
  document.body.dataset.screen = next;
  for (const key of ["home", "setup", "count", "record"])
    $(key + "Screen").hidden = key !== next;
  const s = cur();
  if (s) s.screen = next;
  const host =
    next === "count" && s
      ? $("countMapHost")
      : next === "setup" && s
        ? $("setupMapHost")
        : $("mapParking");
  host.append($("mapPanel"));
  if (next === "home") {
    renderHome();
    if (watch !== undefined) {
      navigator.geolocation?.clearWatch(watch);
      watch = undefined;
    }
  }
  if (next === "setup") renderSetup();
  if (next === "count") {
    $("allStops").open = s.tableExpanded === true;
    buildStopOptions();
    buildTable();
    renderCount();
    locate();
  }
  if (next === "record") renderRecord();
  if ((next === "count" || next === "setup") && s) {
    setupMap();
    requestAnimationFrame(() => {
      map?.invalidateSize();
      centerMap();
    });
    locate();
  }
  measureDock();
  persist();
  window.scrollTo(0, 0);
}
function goHome() {
  state.currentId = null;
  showScreen("home");
}
function updateRecordSelection() {
  document.body.classList.toggle("selectingRecords", deleteMode);
  $("deleteRecords").hidden = deleteMode;
  $("deleteRecords").disabled = !state.surveys.length;
  $("recordSelection").hidden = !deleteMode;
  $("selectionOkay").disabled = !selectedRecordIds.size;
  $("selectedRecordCount").textContent = t("selectedRecords", {
    n: selectedRecordIds.size,
  });
}
function renderHome() {
  updateRecordSelection();
  const list = $("recordList");
  list.replaceChildren();
  if (!state.surveys.length) {
    list.textContent = t("noRecords");
    return;
  }
  for (const s of [...state.surveys].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  )) {
    const card = document.createElement("article");
    card.className = "recordCard";
    card.dataset.id = s.id;
    const title = document.createElement("h3");
    title.textContent = `${s.route.route} · ${operator(s.route.operator)} → ${name({ name: s.route.dest })}`;
    const detail = document.createElement("p");
    detail.textContent = `${t(s.status)} · ${s.date} · ${s.vehicle || ""} · ${s.rows.filter((r) => r.recorded).length}/${s.stops.length}`;
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const open = document.createElement("button");
    open.textContent = t(s.status === "completed" ? "view" : "resume");
    open.onclick = () =>
      openSurvey(s.id, s.status === "completed" ? "record" : "resume");
    buttons.append(open);
    if (s.status !== "completed") {
      const review = document.createElement("button");
      review.className = "secondary";
      review.textContent = t("view");
      review.onclick = () => openSurvey(s.id, "record");
      buttons.append(review);
    }
    if (deleteMode) {
      const label = document.createElement("label");
      label.className = "recordSelect";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.recordId = s.id;
      checkbox.checked = selectedRecordIds.has(s.id);
      checkbox.setAttribute(
        "aria-label",
        t("selectRecord", { route: s.route.route, date: s.date }),
      );
      checkbox.onchange = () => {
        if (checkbox.checked) selectedRecordIds.add(s.id);
        else selectedRecordIds.delete(s.id);
        updateRecordSelection();
      };
      const description = document.createElement("div");
      description.append(title, detail);
      label.append(checkbox, description);
      card.append(label);
    } else card.append(title, detail, buttons);
    list.append(card);
  }
}
function requestDelete() {
  const records = state.surveys.filter((s) => selectedRecordIds.has(s.id));
  if (!records.length) return;
  pendingDeleteIds = records.map((s) => s.id);
  $("deleteTitle").textContent = t("deleteSelectedTitle", {
    n: records.length,
  });
  $("deleteSummary").replaceChildren();
  for (const s of records) {
    const item = document.createElement("li");
    item.dataset.recordId = s.id;
    item.textContent = `${s.route.route} · ${operator(s.route.operator)} · ${name({ name: s.route.orig })} → ${name({ name: s.route.dest })} · ${s.date} ${s.rows[s.startIndex]?.time || ""} · ${s.vehicle || ""} · ${t(s.status)}`;
    $("deleteSummary").append(item);
  }
  $("deleteError").hidden = true;
  $("deleteDialog").showModal();
  $("deleteReview").scrollTop = 0;
}
function confirmDelete() {
  const ids = new Set(pendingDeleteIds);
  if (!state.surveys.some((s) => ids.has(s.id))) return;
  const next = {
    ...state,
    surveys: state.surveys.filter((s) => !ids.has(s.id)),
  };
  if (ids.has(next.currentId)) {
    next.currentId = null;
    next.screen = "home";
  }
  // Commit the whole selection together; a failed write retains every record.
  try {
    save(next);
  } catch {
    $("deleteError").textContent = t("deleteFailed");
    $("deleteError").hidden = false;
    $("deleteError").scrollIntoView({ block: "nearest" });
    return;
  }
  Object.assign(state, next);
  deleteMode = false;
  selectedRecordIds.clear();
  pendingDeleteIds = [];
  $("deleteDialog").close();
  showScreen("home");
}
function openSurvey(id, mode) {
  state.currentId = id;
  const s = cur();
  if (!s) return;
  target = { index: s.activeIndex || 0, field: "boarding" };
  replaceOnDigit = true;
  nearestIndex = null;
  if (mode === "resume" && s.startIndex != null) {
    s.status = "in_progress";
    s.completedAt = null;
    showScreen("count");
  } else showScreen(mode === "record" ? "record" : "setup");
}
function dataStatus(raw) {
  const date = /\d{4}-\d{2}-\d{2}/.exec(raw)?.[0];
  const message = /Loading|Downloading/.test(raw)
    ? t("dataLoading")
    : /unavailable|Offline|failed|timed out/i.test(raw)
      ? t("dataUnavailable")
      : date
      ? t("governmentData", { date })
      : t("dataUnavailable");
  $("dataStatus").textContent = message;
  $("settingsDataStatus").textContent = message;
}
async function search(force = false) {
  const number = $("route").value.trim();
  if (!number && !force) return;
  error();
  try {
    data = await routes(dataStatus, force);
    matches = number ? variants(data, number, $("operator").value) : [];
    state.search = {
      number,
      operator: $("operator").value,
    };
    persist();
    renderMatches();
  } catch {
    error(t("dataUnavailable"));
  }
}
function renderMatches() {
  const clock = hkClock();
  $("clock").textContent = `${clock.date} ${clock.time} (UTC+8)`;
  $("results").replaceChildren();
  $("otherResults").replaceChildren();
  let hidden = 0;
  for (const route of matches) {
    const status = serviceStatus(route, data, new Date()),
      button = document.createElement("button");
    button.className = "route";
    button.textContent = `${operator(route.operator)} ${route.route} · ${name({ name: route.orig })} → ${name({ name: route.dest })}`;
    const info = document.createElement("span");
    info.textContent = t("variant", {
      direction: route.direction,
      variant: route.serviceType,
      n: route.stopIds.length,
    });
    const badge = document.createElement("span");
    badge.className = status.kind;
    badge.textContent = t(
      {
        active: "running",
        upcoming: "upcoming",
        inactive: "inactive",
        unknown: "unknownService",
      }[status.kind],
    );
    button.append(info, badge);
    button.onclick = () => selectRoute(route);
    if (status.kind === "inactive") {
      $("otherResults").append(button);
      hidden++;
    } else $("results").append(button);
  }
  $("other").hidden = !hidden;
  $("otherTitle").textContent = t("otherVariants", { n: hidden });
  if (!$("results").children.length)
    $("results").textContent = t(matches.length ? "noCurrent" : "noMatches");
}
function selectRoute(route) {
  const stops = stopsFor(route, data),
    s = migrateSurvey({
      id: crypto.randomUUID(),
      route,
      stops,
      rows: stops.map(emptyRow),
      date: hkClock().date,
      vehicle: "",
      notes: "",
      surveyor: $("surveyor").value || loadSurveyor(),
      startIndex: null,
      pendingStart: null,
      startSource: null,
      activeIndex: 0,
      screen: "setup",
      updatedAt: new Date().toISOString(),
    });
  state.surveys.push(s);
  state.currentId = s.id;
  target = { index: 0, field: "boarding" };
  followGps = true;
  nearestIndex = null;
  buildTable();
  renderSetup();
  showScreen("setup");
  suggest();
  $("tripSetup").scrollIntoView({ block: "start" });
}
function renderSetup() {
  const s = cur();
  $("tripSetup").hidden = !s;
  if (!s) return;
  $("selected").textContent =
    `${operator(s.route.operator)} ${s.route.route} · ${name({ name: s.route.orig })} → ${name({ name: s.route.dest })}`;
  for (const field of ["date", "vehicle", "notes"]) $(field).value = s[field];
  buildStopOptions();
  $("resume").hidden = s.startIndex == null;
  $("confirm").disabled = s.pendingStart == null;
}
function buildStopOptions() {
  const s = cur();
  if (!s) return;
  const initial = $("start");
  initial.replaceChildren(new Option(t("chooseStop"), ""));
  $("active").replaceChildren();
  for (const [i, stop] of s.stops.entries()) {
    initial.add(new Option(stopLabel(stop, i), String(i)));
    $("active").add(new Option(stopLabel(stop, i), String(i)));
  }
  initial.value = s.pendingStart ?? s.startIndex ?? "";
  $("active").value = String(s.activeIndex || 0);
}
function selectPending(index, source) {
  const s = cur();
  if (!s?.stops[index]) return;
  s.pendingStart = index;
  s.startSource = source;
  if (s.startIndex == null) s.startsAtOrigin = index === 0;
  $("start").value = String(index);
  $("confirm").disabled = false;
  active(index);
  edit();
}
function active(index, field = "boarding") {
  const s = cur();
  if (!s?.stops[index]) return;
  s.activeIndex = index;
  target = { index, field };
  replaceOnDigit = true;
  $("active").value = String(index);
  for (const [i, marker] of markers.entries())
    marker?.setIcon(icon(i, i === index));
  renderCount();
  persist();
}
const rowState = (r) =>
  r.recorded
    ? "recorded"
    : r.unobserved
      ? "rowSkipped"
      : rowObserved(r)
        ? "in_progress"
        : "notObserved";
function showIssues(container, result) {
  container.hidden = !result.issues.length;
  container.replaceChildren();
  if (!result.issues.length) return;
  const title = document.createElement("strong");
  title.textContent = t("countConflict");
  const list = document.createElement("ul");
  for (const issue of result.issues) {
    const item = document.createElement("li");
    item.textContent = t(
      issue.type === "boundary"
        ? "boundaryConflict"
        : issue.type === "anchors"
          ? "anchorConflict"
          : "negativeConflict",
      {
        stop: issue.index === -1 ? t("origin") : issue.index + 1,
        expected: issue.expected,
        actual: issue.actual,
      },
    );
    list.append(item);
  }
  container.append(title, list);
}
function renderCount() {
  const s = cur();
  if (!s) return;
  const row = s.rows[s.activeIndex],
    result = calculateOnboard(s);
  $("tripTitle").textContent =
    `${s.route.route} → ${name({ name: s.route.dest })}`;
  $("active").value = String(s.activeIndex);
  $("rowStatus").textContent = t(rowState(row));
  for (const field of ["boarding", "alighting"]) {
    const input = $(field);
    input.value = row[field];
    input.placeholder = row.skipped?.[field] ? t("notApplicable") : "—";
    input.classList.toggle(
      "selectedField",
      target.index === s.activeIndex && target.field === field,
    );
  }
  const onboard = result.values[s.activeIndex];
  $("onboard").textContent = onboard ?? t("unknown");
  $("onboardSource").textContent =
    onboard === null
      ? ""
      : row.onboard !== ""
        ? ""
        : t(result.estimated[s.activeIndex] ? "estimate" : "auto");
  $("keypadTarget").textContent = t(target.field);
  $("prev").disabled = s.activeIndex === 0;
  $("next").disabled = s.activeIndex === s.stops.length - 1;
  const lastStop = s.activeIndex === s.stops.length - 1;
  const finishReady = lastStop && row.recorded;
  $("recordNext").textContent = t(
    finishReady ? "saveHome" : lastStop ? "recordLast" : "recordNext",
  );
  $("recordNext").dataset.action = finishReady ? "finish" : "record";
  $("nextField").textContent = t(
    target.field === "boarding"
      ? "nextField"
      : finishReady
        ? "saveHome"
        : lastStop
          ? "recordLast"
          : "recordNext",
  );
  for (const [id, value] of [
    ["stopTime", row.time],
    ["stopNotes", row.notes],
    ["initialOnboard", s.initialOnboard],
    ["finalOnboard", s.finalOnboard],
    ["knownOnboard", row.onboard],
  ])
    if (document.activeElement !== $(id)) $(id).value = value;
  $("startsAtOrigin").checked = s.startsAtOrigin;
  $("endsAtTerminus").checked = s.endsAtTerminus;
  showIssues($("countIssues"), result);
  updateTable(result);
  const completed = s.status === "completed";
  $("saveCompleted").hidden = !completed;
  for (const id of ["complete", "pause", "abort"]) $(id).hidden = completed;
  if (completed) $("rowStatus").textContent = t("editCompleted");
  renderGpsText();
}
function buildTable() {
  const s = cur();
  if (!s) return;
  const body = $("body");
  body.replaceChildren();
  s.rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.dataset.i = String(index);
    const title = document.createElement("td"),
      button = document.createElement("button");
    button.className = "stopLink";
    button.textContent = stopLabel(s.stops[index], index);
    button.onclick = () => active(index);
    title.append(button);
    tr.append(title);
    for (const field of ["time", "boarding", "alighting", "onboard"]) {
      const td = document.createElement("td"),
        input = document.createElement("input");
      input.dataset.field = field;
      input.dataset.i = String(index);
      input.setAttribute(
        "aria-label",
        `${t(field === "time" ? "stopTime" : field)} · ${stopLabel(s.stops[index], index)}`,
      );
      input.type = field === "time" ? "time" : "text";
      if (field !== "time") {
        input.readOnly = true;
        input.inputMode = "numeric";
        input.pattern = "[0-9]*";
        input.onfocus = () => active(index, field);
        input.onclick = () => active(index, field);
        bindNumericPaste(input, index, field);
      } else
        input.oninput = () => {
          row.time = input.value;
          edit();
        };
      td.append(input);
      if (field === "onboard") td.append(document.createElement("small"));
      tr.append(td);
    }
    const statusCell = document.createElement("td"),
      status = document.createElement("select");
    status.dataset.rowState = String(index);
    for (const [key, label] of [
      ["pending", "notObserved"],
      ["recorded", "recorded"],
      ["skipped", "rowSkipped"],
    ])
      status.add(new Option(t(label), key));
    status.onchange = () => {
      if (status.value === "recorded") recordStop(s, index, hkClock().time);
      else {
        row.recorded = false;
        row.unobserved = status.value === "skipped";
      }
      edit();
      renderCount();
    };
    statusCell.append(status);
    tr.append(statusCell);
    const notes = document.createElement("td"),
      input = document.createElement("input");
    input.dataset.field = "notes";
    input.type = "text";
    input.value = row.notes;
    input.oninput = () => {
      row.notes = input.value;
      edit();
    };
    notes.append(input);
    tr.append(notes);
    body.append(tr);
  });
  updateTable(calculateOnboard(s));
}
function updateTable(result) {
  const s = cur();
  if (!s) return;
  $("body")
    .querySelectorAll("tr")
    .forEach((tr, i) => {
      const row = s.rows[i];
      tr.classList.toggle("selectedRow", i === s.activeIndex);
      tr.querySelectorAll("input").forEach((input) => {
        const field = input.dataset.field;
        if (document.activeElement !== input || input.readOnly)
          input.value =
            field === "onboard" && row.onboard === ""
              ? (result.values[i] ?? "")
              : row[field];
        input.classList.toggle(
          "selectedField",
          target.index === i && target.field === field,
        );
        input.classList.toggle(
          "derived",
          field === "onboard" &&
            row.onboard === "" &&
            result.values[i] !== null,
        );
        if (field === "boarding" || field === "alighting")
          input.placeholder = row.skipped?.[field] ? t("notApplicable") : "—";
      });
      tr.querySelector("small").textContent =
        row.onboard === "" && result.values[i] !== null
          ? t(result.estimated[i] ? "estimate" : "auto")
          : "";
      tr.querySelector("select").value = row.recorded
        ? "recorded"
        : row.unobserved
          ? "skipped"
          : "pending";
    });
}
function setCount(index, field, value) {
  if (!validPassengerCount(value)) return false;
  const row = cur().rows[index];
  row[field] = value;
  row.skipped ??= {};
  row.skipped[field] = false;
  row.unobserved = false;
  if (value !== "" && !row.time) row.time = hkClock().time;
  edit();
  renderCount();
  return true;
}
function bindNumericPaste(input, index, field) {
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const i = index ?? cur().activeIndex;
    setCount(i, field, e.clipboardData.getData("text").trim());
  });
}
function enterKey(key) {
  const row = cur()?.rows[target.index];
  if (!row) return;
  let value = row[target.field];
  if (key === "clear") value = "";
  else if (key === "backspace") value = value.slice(0, -1);
  else if (/^[0-9]$/.test(key))
    value = replaceOnDigit ? key : value === "0" ? key : value + key;
  else return;
  if (setCount(target.index, target.field, value)) replaceOnDigit = false;
}
function advanceField() {
  if (target.field === "boarding") {
    active(cur().activeIndex, "alighting");
  } else recordOrFinish();
}
function recordOrFinish() {
  const s = cur();
  if (s.activeIndex === s.stops.length - 1 && s.rows[s.activeIndex].recorded)
    complete();
  else saveStop(true);
}
function saveStop(advance = false, noChange = false) {
  const s = cur();
  recordStop(s, s.activeIndex, hkClock().time, noChange);
  s.rows[s.activeIndex].unobserved = false;
  edit();
  if (advance && s.activeIndex < s.stops.length - 1) active(s.activeIndex + 1);
  else renderCount();
}
function pause(status) {
  const s = cur();
  s.status = status;
  s.updatedAt = new Date().toISOString();
  s[status === "aborted" ? "abortedAt" : "pausedAt"] = s.updatedAt;
  if (persist()) {
    error();
    goHome();
  }
}
function complete() {
  const s = cur();
  if (s.status !== "completed") {
    recordStop(s, s.activeIndex, hkClock().time);
    completeSurvey(s, s.activeIndex);
  }
  if (!persist()) {
    error(t("recordFailed"));
    renderCount();
    return;
  }
  error();
  goHome();
}
function renderRecord() {
  const s = cur();
  if (!s) return;
  $("continueRecord").hidden = s.status !== "completed";
  const result = calculateOnboard(s);
  $("recordTitle").textContent = `${s.route.route} · ${t(s.status)}`;
  $("recordSummary").textContent = t("recordSummary", {
    n: s.rows.filter((r) => r.recorded).length,
    date: s.date,
  });
  $("completedMessage").textContent =
    s.status === "completed" ? t("completedSaved") : t("pauseHelp");
  $("uploadStatus").textContent = s.upload?.done ? t("uploaded") : "";
  showIssues($("recordIssues"), result);
  renderChart($("chart"), s, t, name);
  $("recordBody").replaceChildren();
  s.rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = stopLabel(s.stops[i], i);
    tr.append(label);
    for (const field of ["boarding", "alighting", "onboard"]) {
      const cell = document.createElement("td");
      cell.textContent =
        field === "onboard"
          ? (result.values[i] ?? t("unknown"))
          : row.skipped?.[field]
            ? t("notApplicable")
            : row[field];
      tr.append(cell);
    }
    const status = document.createElement("td");
    status.textContent = t(rowState(row));
    tr.append(status);
    $("recordBody").append(tr);
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
  $("myLocation").textContent = t(value ? "following" : "follow");
  $("myLocation").setAttribute("aria-pressed", String(value));
  $("mapMode").textContent = value ? "" : t("mapInspect");
}
function centerMap() {
  if (!map) return;
  const selected = cur()?.stops[cur()?.activeIndex];
  if (followGps && position)
    map.setView([position.lat, position.lng], 18, { animate: false });
  else if (!position && validLocation(selected))
    map.setView([selected.lat, selected.lng], 18, { animate: false });
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
        if (screen === "setup") selectPending(i, "manual");
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
    $("gps").textContent = t("gpsUnavailable");
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
      position = null;
      nearestIndex = null;
      $("gps").textContent = t(e.code === 1 ? "gpsDenied" : "gpsUnavailable");
      if (map?.gps) {
        map.gps.remove();
        map.accuracy.remove();
        map.gps = null;
      }
      renderGpsText();
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  );
}
function suggest() {
  const s = cur();
  if (!s || !position || Date.now() - position.timestamp > 60000) return;
  const candidates = nearestStops(s.stops, position);
  if (!candidates.length) return;
  const nearest = candidates[0];
  const nearby = candidates.filter((x) => x.distance <= nearest.distance + 15);
  nearestIndex = nearby.reduce(
    (best, x) =>
      Math.abs(x.index - s.activeIndex) < Math.abs(best.index - s.activeIndex)
        ? x
        : best,
    nearest,
  ).index;
  if (
    s.startIndex == null &&
    s.startSource !== "manual" &&
    s.pendingStart !== nearestIndex
  )
    selectPending(nearestIndex, "gps");
  renderGpsText();
}
function renderGpsText() {
  const s = cur();
  if (!s) return;
  const fresh =
    position &&
    Date.now() - position.timestamp < 60000 &&
    nearestIndex !== null &&
    Boolean(s.stops[nearestIndex]);
  if (fresh)
    $("gps").textContent = t("gpsFix", {
      accuracy: Math.round(position.accuracy),
      stop: stopLabel(s.stops[nearestIndex], nearestIndex),
    });
  else $("gps").textContent = t("gpsUnavailable");
  $("useNearest").hidden = !fresh || nearestIndex === s.activeIndex;
}
function openStopForm(editing) {
  const s = cur();
  stopEditIndex = editing ? s.activeIndex : null;
  $("stopDialogTitle").textContent = t(editing ? "editStop" : "addStop");
  $("insertLabel").hidden = editing;
  $("insertPosition").replaceChildren();
  s.stops.forEach((stop, i) =>
    $("insertPosition").add(
      new Option(t("before", { stop: stopLabel(stop, i) }), String(i)),
    ),
  );
  $("insertPosition").add(new Option(t("afterLast"), String(s.stops.length)));
  $("insertPosition").value = String(s.activeIndex + 1);
  const stop = editing ? s.stops[s.activeIndex] : null;
  $("stopNameZh").value = stop?.name.zh || "";
  $("stopNameEn").value = stop?.name.en || "";
  $("stopLat").value = stop?.lat ?? "";
  $("stopLng").value = stop?.lng ?? "";
  $("stopFormError").hidden = true;
  $("stopDialog").showModal();
}
function saveStopForm(e) {
  e.preventDefault();
  const s = cur(),
    zh = $("stopNameZh").value.trim(),
    en = $("stopNameEn").value.trim(),
    a = $("stopLat").value.trim(),
    b = $("stopLng").value.trim();
  let message = "";
  if (!zh && !en) message = t("stopNameRequired");
  const lat = a === "" ? null : Number(a),
    lng = b === "" ? null : Number(b);
  if (
    (a === "") !== (b === "") ||
    (a !== "" &&
      (!Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180))
  )
    message = t("invalidCoordinates");
  if (message) {
    $("stopFormError").textContent = message;
    $("stopFormError").hidden = false;
    return;
  }
  if (stopEditIndex === null) {
    const i = +$("insertPosition").value;
    insertStop(s, i, {
      id: `custom:${crypto.randomUUID()}`,
      name: { zh, en },
      lat,
      lng,
    });
    target.index = s.activeIndex;
  } else {
    const stop = s.stops[stopEditIndex];
    stop.original ??= { name: { ...stop.name }, lat: stop.lat, lng: stop.lng };
    Object.assign(stop, { name: { zh, en }, lat, lng, modified: true });
    s.routeEdits.push({
      type: "edit",
      id: stop.id,
      index: stopEditIndex,
      at: new Date().toISOString(),
    });
  }
  edit();
  $("stopDialog").close();
  buildStopOptions();
  buildTable();
  setupMap();
  renderCount();
}
async function findSections(e) {
  e?.preventDefault();
  const s = cur();
  $("sectionChoice").replaceChildren();
  sectionOptions = [];
  sectionStops = [];
  $("sectionStops").replaceChildren();
  $("sectionOverlap").replaceChildren();
  $("joinSection").disabled = true;
  try {
    data = await routes(dataStatus);
    sectionOptions = variants(data, $("sectionNumber").value, s.route.operator);
    sectionOptions.forEach((route, i) =>
      $("sectionChoice").add(
        new Option(
          `${route.route} · ${name({ name: route.orig })} → ${name({ name: route.dest })} · ${route.stopIds.length}`,
          String(i),
        ),
      ),
    );
    chooseSection();
  } catch {
    $("sectionPreview").textContent = t("dataUnavailable");
  }
}
function chooseSection() {
  const route = sectionOptions[+$("sectionChoice").value];
  if (!route) {
    $("sectionPreview").textContent = t("noMatches");
    return;
  }
  sectionStops = stopsFor(route, data);
  $("sectionOverlap").replaceChildren();
  for (let i = 0; i < sectionStops.length; i++)
    $("sectionOverlap").add(
      new Option(i ? t("skipPrefix", { n: i }) : t("keepAll"), String(i)),
    );
  const overlap = overlapCount(cur().stops, sectionStops);
  $("sectionOverlap").value = String(
    overlap === sectionStops.length ? 0 : overlap,
  );
  renderSectionPreview();
}
function renderSectionPreview() {
  if (!sectionStops.length) return;
  const skip = +$("sectionOverlap").value,
    s = cur();
  $("sectionPreview").textContent =
    t("joinPreview", {
      old: s.stops.length,
      skip,
      added: sectionStops.length - skip,
    }) +
    " " +
    t("joinEnd", { stop: name(sectionStops.at(-1)) });
  $("sectionStops").replaceChildren();
  sectionStops.slice(skip).forEach((stop, i) => {
    const li = document.createElement("li");
    li.textContent = stopLabel(stop, s.stops.length + i);
    $("sectionStops").append(li);
  });
  $("joinSection").disabled = skip >= sectionStops.length;
}
function joinSection() {
  const s = cur(),
    route = sectionOptions[+$("sectionChoice").value];
  if (!route) return;
  appendSection(s, route, sectionStops, +$("sectionOverlap").value);
  edit();
  $("sectionDialog").close();
  buildStopOptions();
  buildTable();
  setupMap();
  renderCount();
}
function exportFilename(extension) {
  const s = cur(), stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `bus-${s.route.route}-${s.date}-${s.id.slice(0, 8)}-${stamp}.${extension}`;
}
function exportResult(result, reveal = false) {
  $("exportStatus").textContent = result.ok
    ? t("exportSaved", { path: result.path }) : t("exportFailed");
  $("exportStatus").classList.toggle("warning", !result.ok);
  if (reveal && screen === "record") $("exportStatus").scrollIntoView({ block: "nearest" });
}
function refreshExportSettings() {
  const native = window.PassengerCountAndroid;
  $("exportDirectory").textContent = native?.getExportDirectory?.() || t("browserFolder");
  $("chooseExportDirectory").hidden = !native?.chooseExportDirectory;
  $("resetExportDirectory").hidden = !native?.resetExportDirectory;
}
function browserDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  $("exportStatus").classList.remove("warning");
  $("exportStatus").textContent = t("downloadStarted");
}
function download() {
  if (!cur()) return;
  const csv = makeCSV(cur()), filename = exportFilename("csv");
  $("exportStatus").textContent = t("exporting");
  if (window.PassengerCountAndroid) {
    window.PassengerCountAndroid.saveCsv(csv, filename);
    return;
  }
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  browserDownload(href, filename);
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}
async function saveChart() {
  $("saveChart").disabled = true;
  $("exportStatus").textContent = t("exporting");
  try {
    const png = await chartPng($("chart")), filename = exportFilename("png");
    if (window.PassengerCountAndroid?.savePng)
      window.PassengerCountAndroid.savePng(png.split(",")[1], filename);
    else browserDownload(png, filename);
  } catch {
    exportResult({ ok: false });
  } finally {
    $("saveChart").disabled = false;
  }
}
async function upload() {
  const s = cur();
  if (uploadBusy) return;
  if (!s.rows.some(rowObserved)) return error(t("noObservations"));
  uploadBusy = true;
  $("upload").disabled = true;
  try {
    $("uploadStatus").textContent = t("uploading");
    await uploadSurvey(s, persist);
    $("uploadStatus").textContent = t("uploaded");
  } catch {
    error(t("uploadError"));
  } finally {
    uploadBusy = false;
    $("upload").disabled = false;
  }
}
$("language").onchange = () => setLanguage($("language").value);
$("surveyor").value = loadSurveyor();
$("surveyor").oninput = () => {
  try {
    saveSurveyor($("surveyor").value);
  } catch {
    error(t("saveError"));
  }
};
$("new").onclick = () => {
  state.currentId = null;
  showScreen("setup");
};
$("setupHome").onclick = () => {
  if (cur()?.status === "in_progress") cur().status = "paused";
  goHome();
};
$("recordHome").onclick = goHome;
$("deleteRecords").onclick = () => {
  deleteMode = true;
  selectedRecordIds.clear();
  renderHome();
};
$("cancelSelection").onclick = () => {
  deleteMode = false;
  selectedRecordIds.clear();
  renderHome();
};
$("selectionOkay").onclick = requestDelete;
$("confirmDelete").onclick = confirmDelete;
$("cancelDelete").onclick = () => $("deleteDialog").close();
$("deleteDialog").addEventListener("close", () => {
  pendingDeleteIds = [];
});
$("search").onsubmit = (e) => {
  e.preventDefault();
  search();
};
$("operator").onchange = () => search();
const updateButtons = (busy) => {
  for (const id of ["refreshData", "settingsRefreshData"]) $(id).disabled = busy;
};
async function refreshGovernmentData() {
  updateButtons(true);
  try {
    data = await routes(dataStatus, true);
    if (screen === "setup" && $("route").value.trim()) await search();
  } catch {
    dataStatus("Update unavailable");
  } finally {
    updateButtons(false);
  }
}
$("refreshData").onclick = refreshGovernmentData;
$("settingsRefreshData").onclick = refreshGovernmentData;
window.addEventListener("government-data-updating", () => updateButtons(true));
window.addEventListener("government-data-update-finished", () => updateButtons(false));
for (const f of ["date", "vehicle", "notes"])
  $(f).oninput = () => {
    cur()[f] = $(f).value;
    edit();
  };
$("start").onchange = () => {
  if ($("start").value === "") {
    cur().pendingStart = null;
    cur().startSource = "manual";
    $("confirm").disabled = true;
    edit();
  } else selectPending(+$("start").value, "manual");
};
$("confirm").onclick = () => {
  const s = cur();
  if (s.pendingStart == null) return;
  if (s.startIndex !== s.pendingStart) s.startsAtOrigin = s.pendingStart === 0;
  s.startIndex = s.pendingStart;
  s.status = "in_progress";
  s.endIndex = null;
  s.completedAt = null;
  active(s.startIndex);
  edit();
  showScreen("count");
};
$("resume").onclick = () => {
  if (cur().status !== "completed") cur().status = "in_progress";
  showScreen("count");
};
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
for (const f of ["boarding", "alighting"]) {
  $(f).onfocus = $(f).onclick = () => active(cur().activeIndex, f);
  bindNumericPaste($(f), null, f);
}
$("keypad").onpointerdown = (e) => {
  if (e.target.closest("button")) e.preventDefault();
};
$("keypad").onclick = (e) => {
  const key = e.target.closest("[data-key]")?.dataset.key;
  if (key) enterKey(key);
};
$("nextField").onclick = advanceField;
for (const [f, id] of [
  ["boarding", "skipBoarding"],
  ["alighting", "skipAlighting"],
])
  $(id).onclick = () => {
    skipField(cur(), cur().activeIndex, f);
    edit();
    if (f === "boarding") active(cur().activeIndex, "alighting");
    else saveStop(true);
  };
$("noChange").onclick = () => saveStop(true, true);
$("recordNext").onclick = recordOrFinish;
$("recordStay").onclick = () => saveStop(false);
$("skipStop").onclick = () => {
  const s = cur(),
    r = s.rows[s.activeIndex];
  r.unobserved = true;
  r.recorded = false;
  edit();
  if (s.activeIndex < s.stops.length - 1) active(s.activeIndex + 1);
  else renderCount();
};
document.addEventListener("keydown", (e) => {
  if (
    screen !== "count" ||
    document.querySelector("dialog[open]") ||
    e.ctrlKey ||
    e.altKey ||
    e.metaKey
  )
    return;
  const el = document.activeElement;
  if (el?.matches("input:not([readonly]),textarea,select")) return;
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    enterKey(e.key);
  } else if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    enterKey(e.key === "Backspace" ? "backspace" : "clear");
  } else if (e.key === "Enter" && el?.matches("input[readonly]")) {
    e.preventDefault();
    advanceField();
  }
});
for (const [id, field] of [
  ["stopTime", "time"],
  ["stopNotes", "notes"],
])
  $(id).oninput = () => {
    cur().rows[cur().activeIndex][field] = $(id).value;
    edit();
    updateTable(calculateOnboard(cur()));
  };
for (const field of ["initialOnboard", "finalOnboard", "knownOnboard"])
  $(field).oninput = () => {
    const s = cur(),
      value = $(field).value,
      old = field === "knownOnboard" ? s.rows[s.activeIndex].onboard : s[field];
    if (!validPassengerCount(value)) {
      $(field).value = old;
      return;
    }
    if (field === "knownOnboard") s.rows[s.activeIndex].onboard = value;
    else s[field] = value;
    edit();
    renderCount();
  };
for (const field of ["startsAtOrigin", "endsAtTerminus"])
  $(field).onchange = () => {
    cur()[field] = $(field).checked;
    edit();
    renderCount();
  };
$("allStops").ontoggle = () => {
  if (cur()) {
    cur().tableExpanded = $("allStops").open;
    persist();
  }
};
$("complete").onclick = complete;
$("pause").onclick = () => pause("paused");
$("abort").onclick = () => pause("aborted");
$("saveCompleted").onclick = complete;
$("editRecord").onclick = () => {
  cur().tableExpanded = true;
  target = { index: cur().activeIndex, field: "boarding" };
  showScreen("count");
};
$("continueRecord").onclick = () => {
  try {
    reopenSurvey(cur());
    error();
    target = { index: cur().activeIndex, field: "boarding" };
    showScreen("count");
  } catch {
    error(t("continueConflict"));
  }
};
$("csv").onclick = download;
$("saveChart").onclick = saveChart;
$("chooseExportDirectory").onclick = () => window.PassengerCountAndroid?.chooseExportDirectory();
$("resetExportDirectory").onclick = () => {
  window.PassengerCountAndroid?.resetExportDirectory();
  refreshExportSettings();
};
window.addEventListener("export-directory-changed", refreshExportSettings);
window.addEventListener("export-result", (event) => exportResult(event.detail, true));
$("upload").onclick = upload;
$("toggleMap").onclick = () => {
  $("mapContents").hidden = !$("mapContents").hidden;
  $("toggleMap").textContent = t(
    $("mapContents").hidden ? "showMap" : "hideMap",
  );
  if (!$("mapContents").hidden)
    requestAnimationFrame(() => {
      setFollow(true);
      map?.invalidateSize();
      centerMap();
    });
};
$("myLocation").onclick = () => {
  setFollow(true);
  centerMap();
  locate(true);
};
$("locate").onclick = () => locate(true);
$("selectedStop").onclick = () => {
  const stop = cur()?.stops[cur()?.activeIndex];
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
    map.fitBounds(points, { padding: [25, 25] });
  }
};
$("addStop").onclick = () => openStopForm(false);
$("editStop").onclick = () => openStopForm(true);
$("stopForm").onsubmit = saveStopForm;
$("cancelStop").onclick = () => $("stopDialog").close();
$("stopUseGps").onclick = () => {
  if (position && Date.now() - position.timestamp < 60000) {
    $("stopLat").value = position.lat;
    $("stopLng").value = position.lng;
  } else {
    $("stopFormError").textContent = t("gpsUnavailable");
    $("stopFormError").hidden = false;
  }
};
$("continueRoute").onclick = () => {
  $("sectionNumber").value = cur().route.route;
  $("sectionDialog").showModal();
  findSections();
};
$("sectionSearch").onsubmit = findSections;
$("sectionChoice").onchange = chooseSection;
$("sectionOverlap").onchange = renderSectionPreview;
$("joinSection").onclick = joinSection;
$("cancelSection").onclick = () => $("sectionDialog").close();
function measureDock() {
  if (screen !== "count") return;
  const height = Math.ceil($("entryDock").getBoundingClientRect().height);
  document.documentElement.style.setProperty(
    "--entry-dock-height",
    `${height}px`,
  );
}
new ResizeObserver(measureDock).observe($("entryDock"));
let chartWidth = 0;
new ResizeObserver(() => {
  const width = $("chart").clientWidth;
  if (screen === "record" && cur() && width && width !== chartWidth) {
    chartWidth = width;
    renderChart($("chart"), cur(), t, name);
  }
}).observe($("chart"));
new ResizeObserver(() => {
  document.documentElement.style.setProperty(
    "--selection-height",
    `${Math.ceil($("recordSelection").getBoundingClientRect().height)}px`,
  );
}).observe($("recordSelection"));
const query = state.search || {};
const initialScreen = state.screen || cur()?.screen;
$("route").value = query.number || "";
setLanguage(state.language);
$("operator").value = query.operator || "";
if (cur()) {
  target = { index: cur().activeIndex || 0, field: "boarding" };
  $("allStops").open = cur().tableExpanded === true;
  showScreen(
    cur().status === "completed"
      ? "record"
      : initialScreen === "count" && cur().status === "in_progress"
        ? "count"
        : initialScreen === "setup"
          ? "setup"
          : "home",
  );
} else showScreen("home");
try {
  const result = window.PassengerCountAndroid?.getExportResult?.();
  if (result) exportResult(JSON.parse(result));
} catch {}
if (query.number) search();
// Start the catalogue check on every launch, even on Home with no previous search.
// The saved/bundled catalogue resolves immediately while refresh runs in a worker.
else checkRouteUpdates(dataStatus).then((value) => { data = value; })
  .catch(() => dataStatus("Update unavailable"));
window.addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    checkRouteUpdates(dataStatus).then((value) => { data = value; })
      .catch(() => dataStatus("Update unavailable"));
    if (data && matches.length) renderMatches();
    if (cur() && (screen === "count" || screen === "setup")) {
      setFollow(true);
      centerMap();
      locate(true);
    }
  }
});
setInterval(() => {
  if (data && matches.length) renderMatches();
  if (cur()) renderGpsText();
}, 60000);
window.addEventListener("government-data-updated", () => {
  if (screen === "setup" && $("route").value.trim()) search();
});
if (!window.PassengerCountAndroid && "serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
