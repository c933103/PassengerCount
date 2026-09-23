import { gzipSync } from "node:zlib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { unzipSync, strFromU8 } from "../vendor/fflate/fflate.js";
import { normalizeGovernment, GOVERNMENT_URLS } from "../government.js";
const needed = new Set([
  "routes.txt",
  "stops.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "frequencies.txt",
]);
async function read(source, names) {
  const bytes = source.startsWith("https:")
    ? new Uint8Array(await (await fetch(source)).arrayBuffer())
    : await readFile(source);
  return Object.fromEntries(
    Object.entries(unzipSync(bytes, { filter: (f) => names.has(f.name) })).map(
      ([n, b]) => [n, strFromU8(b)],
    ),
  );
}
const en = await read(process.argv[2] || GOVERNMENT_URLS.en, needed),
  zh = await read(
    process.argv[3] || GOVERNMENT_URLS.zh,
    new Set(["routes.txt", "stops.txt"]),
  );
const data = normalizeGovernment(en, zh, {
  publishedAt: process.env.DATA_PUBLISHED_AT || null,
});
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/government-routes.json.gz", import.meta.url),
  gzipSync(JSON.stringify(data), { level: 9 }),
);
console.log(
  `Government routes: ${Object.keys(data.routeList).length} variants; ${Object.keys(data.stopList).length} stops.`,
);
