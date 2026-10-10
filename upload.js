import { OPERATORS, records } from "./core.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

async function post(table, body, returning = false) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: returning ? "return=representation" : "return=minimal",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const x = await r.json().catch(() => ({})),
      e = Error(x.message || `Database HTTP ${r.status}`);
    // PostgREST request rejection permits retry for its 4xx responses,
    // except timeout. A server/timeout error may follow an applied write.
    e.rejected = r.status >= 400 && r.status < 500 && r.status !== 408;
    throw e;
  }
  return returning ? r.json() : null;
}

const value = (v) => (v == null ? 0 : Number(v) || 0);
const validSurveyId = id => typeof id === "string" ? id.trim().length > 0
  : typeof id === "number" && Number.isSafeInteger(id);

function saveProgress(s, save, next, fallback = s.upload) {
  s.upload = next;
  try {
    // storage.save throws; the application's persist wrapper returns false.
    // Both contracts must stop the next request and prevent a success result.
    if (save() === false) throw Error("Local storage write failed");
  } catch (cause) {
    s.upload = fallback;
    throw Error("Upload progress could not be saved. No further request was sent.", { cause });
  }
}

function uploadPayload(s) {
  const source = records(s);
  const passengerLogs = [];
  const configuredStart = source[s.startIndex];
  let cumulativeBoarding = null,
    surveyStartTime = configuredStart?.time || null,
    surveyStart = s.stops[s.startIndex]?.name?.zh || null,
    surveyEnd = null,
    first = true;

  for (const x of source) {
    const boarding = value(x.boarding),
      alighting = value(x.alighting),
      onboard = value(x.onboard),
      time = x.time || "";

    // Match the reference webapp: notes alone do not create a database row,
    // and explicit/derived zeros are uploaded as null values.
    if (!(time || boarding > 0 || alighting > 0 || onboard > 0)) continue;

    if (first) {
      cumulativeBoarding = onboard || 0;
      first = false;
    }
    surveyEnd = x.name.zh || null;
    cumulativeBoarding = (cumulativeBoarding || 0) + boarding;
    passengerLogs.push({
      stop_tc: x.name.zh,
      stop_en: x.name.en,
      stop_time: time.trim() ? time : null,
      boarding: boarding > 0 ? boarding : null,
      alighting: alighting > 0 ? alighting : null,
      onboard: onboard > 0 ? onboard : null,
      total: cumulativeBoarding,
      notes: x.notes || null,
    });
  }

  const weekday = s.date
    ? new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en", {
        weekday: "long",
        timeZone: "UTC",
      })
    : "";

  return {
    survey: [{
      surveyor_name: s.surveyor || "Unknown",
      survey_date: s.date || null,
      survey_day: weekday,
      operator: { kmb: "KMB", ctb: "Citybus (CTB)" }[s.route.operator] ||
        OPERATORS[s.route.operator] || s.route.operator,
      route: s.route.route,
      survey_start_time: surveyStartTime,
      survey_start: surveyStart,
      survey_end: surveyEnd,
      vehicle_number: s.vehicle || "N/A",
      general_notes: s.notes || null,
    }],
    passengerLogs,
  };
}

// Exact submitted fields only: lifecycle/GPS/history metadata is not uploaded.
// Keep the representation local so a restarted partial upload cannot combine
// a prior survey row with passenger logs from a different data revision.
export const uploadPayloadKey = s => JSON.stringify(uploadPayload(s));

export function uploadReceiptStatus(s) {
  if (s?.upload?.uncertain) return "uncertain";
  if (!s?.upload?.done) return "none";
  if (!s.upload.payloadKey) return "unknown";
  try { return s.upload.payloadKey === uploadPayloadKey(s) ? "current" : "changed"; }
  catch { return "changed"; }
}

export async function uploadSurvey(s, save) {
  if (s.upload?.uncertain)
    throw Error("A previous upload has an unconfirmed result. Check the database before retrying.");
  // A completed receipt is immutable history, even when current fields differ.
  // Ordinary Upload neither inserts another survey nor assumes a server update.
  if (s.upload?.done) return { done: true, status: uploadReceiptStatus(s) };
  const payload = uploadPayload(s), payloadKey = JSON.stringify(payload);
  if (s.upload?.id != null && !validSurveyId(s.upload.id))
    throw Error("Saved upload has an invalid survey ID. Check the database before retrying.");
  if (!payload.passengerLogs.length) throw Error("No passenger data to upload");
  if (s.upload?.id != null && s.upload.payloadKey !== payloadKey) {
    // Older partial receipts without a payload binding also require review.
    const uncertain = { ...s.upload, done: false, uncertain: true };
    saveProgress(s, save, uncertain, uncertain);
    throw Error("Saved upload data cannot be confirmed. Check the database before retrying.");
  }
  function requireSamePayload(next = s.upload) {
    let unchanged = false;
    try { unchanged = uploadPayloadKey(s) === payloadKey; } catch {}
    if (unchanged) return;
    const uncertain = { ...next, payloadKey, done: false, uncertain: true };
    // Keep uncertainty even if persisting the changed-data guard also fails.
    saveProgress(s, save, uncertain, uncertain);
    throw Error("The record changed during upload. Check the database before retrying.");
  }

  s.upload ||= { id: null, done: false, uncertain: false };
  if (s.upload.id == null) {
    saveProgress(s, save, { ...s.upload, payloadKey, uncertain: true });
    let result;
    try {
      result = await post("surveys", payload.survey, true);
    } catch (e) {
      if (e.rejected) {
        requireSamePayload();
        saveProgress(s, save, { ...s.upload, uncertain: false });
      }
      throw e;
    }
    const id = result?.[0]?.id;
    if (!validSurveyId(id)) throw Error("Database response has no valid survey ID");
    requireSamePayload({ ...s.upload, id });
    saveProgress(s, save,
      { ...s.upload, id, uncertain: false },
      { ...s.upload, id, uncertain: true });
  }

  requireSamePayload();
  saveProgress(s, save, { ...s.upload, uncertain: true });
  try {
    await post("passenger_logs", payload.passengerLogs.map(x => ({ ...x, survey_id: s.upload.id })));
  } catch (e) {
    if (e.rejected) {
      requireSamePayload();
      saveProgress(s, save, { ...s.upload, uncertain: false });
    }
    throw e;
  }
  requireSamePayload();
  saveProgress(s, save, { ...s.upload, done: true, uncertain: false });
}
