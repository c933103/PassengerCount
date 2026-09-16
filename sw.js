const C = "passenger-count-v9";
const F = [
  "./",
  "./index.html",
  "./app.js",
  "./core.js",
  "./survey.js",
  "./i18n.js",
  "./charts.js",
  "./data.js",
  "./government.js",
  "./route-worker.js",
  "./data/government-routes.json.gz",
  "./vendor/fflate/fflate.js",
  "./storage.js",
  "./upload.js",
  "./supabase-config.js",
  "./style.css",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
];
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(C).then((c) => c.addAll(F))),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((k) =>
        Promise.all(
          k
            .filter((x) => x.startsWith("passenger-count-") && x !== C)
            .map((x) => caches.delete(x)),
        ),
      )
      .then(() => clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  if (
    e.request.method !== "GET" ||
    new URL(e.request.url).origin !== location.origin
  )
    return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
