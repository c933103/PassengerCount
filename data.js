import { gunzipSync, strFromU8 } from "./vendor/fflate/fflate.js";
import { cacheGet, cachePut } from "./storage.js";
import { GOVERNMENT_SOURCE } from "./government.js";
let current,
  pending,
  updating,
  autoAttempted = false;
const valid = (x) =>
  x?.source?.id === GOVERNMENT_SOURCE && x.routeList && x.stopList;
const description = (x) =>
  `Transport Department government data · ${new Date(x.source.publishedAt || x.source.retrievedAt).toISOString().slice(0, 10)}`;
function update() {
  if (updating) return updating;
  updating = new Promise((resolve, reject) => {
    const worker = new Worker("./route-worker.js", { type: "module" }),
      timer = setTimeout(() => {
        worker.terminate();
        reject(Error("Government download timed out"));
      }, 210000);
    const end = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = ({ data }) => {
      end();
      data.error ? reject(Error(data.error)) : resolve(data.data);
    };
    worker.onerror = () => {
      end();
      reject(Error("Government update could not be loaded"));
    };
    worker.postMessage({ native: !!globalThis.PassengerCountAndroid });
  }).finally(() => {
    updating = null;
  });
  return updating;
}
function refreshIfStale(value, status) {
  if (
    autoAttempted ||
    !globalThis.PassengerCountAndroid ||
    Date.now() - Date.parse(value.source.retrievedAt) < 14 * 86400000
  )
    return;
  autoAttempted = true;
  update()
    .then(async (fresh) => {
      if (!valid(fresh)) throw Error("Invalid government data");
      try {
        await cachePut({ data: fresh, at: Date.now() });
      } catch {}
      current = fresh;
      status(description(fresh));
      globalThis.dispatchEvent(new Event("government-data-updated"));
    })
    .catch(() =>
      status(
        `${description(value)} · Offline / update unavailable; saved data retained.`,
      ),
    );
}
export async function routes(status, force = false) {
  if (current && !force) {
    status(description(current));
    refreshIfStale(current, status);
    return current;
  }
  if (pending) return pending;
  pending = (async () => {
    let cached;
    try {
      const saved = await cacheGet();
      if (valid(saved?.data)) cached = saved.data;
    } catch {}
    let bundled;
    try {
      const r = await fetch("./data/government-routes.json.gz");
      if (r.ok) {
        const d = JSON.parse(
          strFromU8(gunzipSync(new Uint8Array(await r.arrayBuffer()))),
        );
        if (valid(d)) bundled = d;
      }
    } catch {}
    const fallback = [current, cached, bundled]
      .filter(valid)
      .sort(
        (a, b) =>
          Date.parse(b.source.retrievedAt) - Date.parse(a.source.retrievedAt),
      )[0];
    if (fallback && !force) {
      status(description(fallback));
      refreshIfStale(fallback, status);
      return (current = fallback);
    }
    try {
      status("Downloading government routes and timetables…");
      const fresh = await update();
      if (!valid(fresh)) throw Error("Invalid government data");
      try {
        await cachePut({ data: fresh, at: Date.now() });
      } catch {}
      status(description(fresh));
      return (current = fresh);
    } catch (e) {
      if (fallback) {
        status(`${e.message}. Using saved ${description(fallback)}.`);
        return (current = fallback);
      }
      throw Error(
        "Government data unavailable. Saved surveys remain available.",
      );
    }
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
