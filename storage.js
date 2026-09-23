const KEY = "passenger-count:workspace:v2",
  PROFILE = "passenger-count:surveyor";
// The Android bridge commits to app-private storage before acknowledging each edit.
const device = () => globalThis.PassengerCountAndroid;
const read = (key) =>
  device() ? device().get(key) : localStorage.getItem(key);
const write = (key, value) => {
  if (device()) {
    if (!device().set(key, value)) throw Error("Device storage write failed");
  } else localStorage.setItem(key, value);
};
export const load = () => {
  const x = read(KEY);
  return x
    ? JSON.parse(x)
    : { version: 2, currentId: null, surveys: [], search: {} };
};
export const save = (s) => write(KEY, JSON.stringify(s));
export const loadSurveyor = () => read(PROFILE) || "";
export const saveSurveyor = (x) => write(PROFILE, x);
const db = () =>
  new Promise((ok, no) => {
    const r = indexedDB.open("passenger-count", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("cache");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
export async function cacheGet() {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction("cache"),
      r = t.objectStore("cache").get("routes");
    t.oncomplete = () => {
      d.close();
      ok(r.result);
    };
    t.onerror = () => no(t.error);
  });
}
export async function cachePut(x) {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction("cache", "readwrite");
    t.objectStore("cache").put(x, "routes");
    t.oncomplete = () => {
      d.close();
      ok();
    };
    t.onerror = () => no(t.error);
  });
}
