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
    e.rejected = true;
    throw e;
  }
  return returning ? r.json() : null;
}

const value = (v) => (v == null ? 0 : Number(v) || 0);

export async function uploadSurvey(s, save) {
  if (s.upload?.done) return;
  if (s.upload?.uncertain)
    throw Error(
      "A previous upload has an unconfirmed result. Check the database before retrying.",
    );

  const source = records(s);
  const passengerLogs = [];
  let cumulativeBoarding = null,
    surveyStartTime = null,
    surveyStart = null,
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
      surveyStartTime = time || null;
      surveyStart = x.name.zh || null;
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

  if (!passengerLogs.length) throw Error("No passenger data to upload");

  const weekday = s.date
    ? new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en", {
        weekday: "long",
        timeZone: "UTC",
      })
    : "";

  s.upload ||= { id: null, done: false, uncertain: false };
  if (!s.upload.id) {
    s.upload.uncertain = true;
    save();
    let result;
    try {
      result = await post(
        "surveys",
        [
          {
            surveyor_name: s.surveyor || "Unknown",
            survey_date: s.date || null,
            survey_day: weekday,
            operator:
              { kmb: "KMB", ctb: "Citybus (CTB)" }[s.route.operator] ||
              OPERATORS[s.route.operator] ||
              s.route.operator,
            route: s.route.route,
            survey_start_time: surveyStartTime,
            survey_start: surveyStart,
            survey_end: surveyEnd,
            vehicle_number: s.vehicle || "N/A",
            general_notes: s.notes || null,
          },
        ],
        true,
      );
    } catch (e) {
      if (e.rejected) {
        s.upload.uncertain = false;
        save();
      }
      throw e;
    }
    s.upload.id = result[0].id;
    s.upload.uncertain = false;
    save();
  }

  s.upload.uncertain = true;
  save();
  try {
    await post(
      "passenger_logs",
      passengerLogs.map((x) => ({ ...x, survey_id: s.upload.id })),
    );
  } catch (e) {
    if (e.rejected) {
      s.upload.uncertain = false;
      save();
    }
    throw e;
  }

  s.upload.done = true;
  s.upload.uncertain = false;
  save();
}
