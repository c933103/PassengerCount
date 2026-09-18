import { OPERATORS, records } from "./core.js";
import { calculateOnboard } from "./survey.js";
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
export async function uploadSurvey(s, save) {
  if (s.upload?.done) return;
  if (s.upload?.uncertain)
    throw Error(
      "A previous upload has an unconfirmed result. Check the database before retrying.",
    );
  const rows = records(s),
    observed = rows.filter((x) => x.observed);
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
            survey_day: s.date
              ? new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en", {
                  weekday: "long",
                  timeZone: "UTC",
                })
              : "",
            operator:
              { kmb: "KMB", ctb: "Citybus (CTB)" }[s.route.operator] ||
              OPERATORS[s.route.operator],
            route: s.route.route,
            survey_start_time: rows[s.startIndex].time || null,
            survey_start: s.stops[s.startIndex].name.zh,
            survey_end:
              observed.at(-1)?.name.zh || s.stops[s.startIndex].name.zh,
            vehicle_number: s.vehicle || "N/A",
            general_notes: `${s.notes}\n[PassengerCount: ${s.route.key}; start ${s.startIndex + 1}; local ${s.id}]\n${JSON.stringify({ status: s.status, completedAt: s.completedAt, endIndex: s.endIndex, initialOnboard: s.initialOnboard, finalOnboard: s.finalOnboard, startsAtOrigin: s.startsAtOrigin, endsAtTerminus: s.endsAtTerminus, issues: calculateOnboard(s).issues, routeEdits: s.routeEdits })}`,
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
      rows
        .filter((x) => x.observed || x.onboard !== null)
        .map((x) => ({
          survey_id: s.upload.id,
          stop_tc: x.name.zh,
          stop_en: x.name.en,
          stop_time: x.time || null,
          boarding: x.boarding,
          alighting: x.alighting,
          onboard: x.onboard,
          total: x.total,
          notes: `${x.notes}\n[Stop ${x.sequence}; ID ${x.id}; onboard ${x.derived ? "calculated" : x.onboard == null ? "empty" : "entered"}; recorded ${x.recorded === true}; NA ${JSON.stringify(x.skipped || {})}; custom ${x.custom === true || x.modified === true}; estimated ${x.estimated}]`,
        })),
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
