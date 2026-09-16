import { unzipSync, strFromU8 } from "./vendor/fflate/fflate.js";
import { normalizeGovernment, GOVERNMENT_URLS } from "./government.js";
const needed = new Set([
  "routes.txt",
  "stops.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "frequencies.txt",
]);
async function archive(url, names) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90000),
    cache: "no-store",
  });
  if (!response.ok)
    throw Error(`Government download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const files = unzipSync(bytes, {
    filter: (f) => names.has(f.name) && f.originalSize <= 100000000,
  });
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([n, b]) => [n, strFromU8(b)]),
    ),
    publishedAt: response.headers.get("Last-Modified"),
  };
}
self.onmessage = async ({ data }) => {
  try {
    const en = await archive(
      data.native ? "./government/en.zip" : GOVERNMENT_URLS.en,
      needed,
    );
    const zh = await archive(
      data.native ? "./government/zh.zip" : GOVERNMENT_URLS.zh,
      new Set(["stops.txt", "routes.txt"]),
    );
    self.postMessage({
      data: normalizeGovernment(en.files, zh.files, {
        publishedAt: en.publishedAt,
      }),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
