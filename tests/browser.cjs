const { chromium } = require("playwright");
const http = require("http"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
  };
const server = http.createServer((req, res) => {
  try {
    const file = path.join(
      root,
      req.url === "/" ? "index.html" : req.url.split("?")[0],
    );
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
const disk = {},
  errors = [],
  requests = [];
let exported, exportedGpx, exportedPng, browser;
const route = (ids, dest) => ({
  route: "1",
  agency: "NLB",
  orig: { en: "First stop", zh: "甲站" },
  dest: { en: dest, zh: dest === "Third stop" ? "丙站" : "甲站" },
  serviceType: 1,
  bound: { nlb: "1" },
  stops: { nlb: ids },
  source: "hk-td-gtfs-v1",
  schedule: [["daily", 12 * 3600, 12 * 3600, 0, 7200]],
});
const data = {
  source: { id: "hk-td-gtfs-v1", retrievedAt: new Date().toISOString() },
  routeList: {
    a: route(["s0", "s1", "s2"], "Third stop"),
    b: route(["s1", "s2", "s3", "s0"], "First stop"),
  },
  stopList: Object.fromEntries(
    [0, 1, 2, 3].map((i) => [
      "s" + i,
      {
        name: {
          en: ["First stop", "Second stop", "Third stop", "Fourth stop"][i],
          zh: ["甲站", "乙站", "丙站", "丁站"][i],
        },
        location: { lat: 22.3 + i * 0.001, lng: 114.17 + i * 0.001 },
      },
    ]),
  ),
  calendars: {
    daily: {
      days: [1, 1, 1, 1, 1, 1, 1],
      start: "20260101",
      end: "20261231",
      exceptions: {},
    },
  },
};
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--no-sandbox"],
  });
  async function open(seed = {}, width = 412, catalogue = data, time = "2026-09-15T06:10:00Z", workerFixture = null) {
    const context = await browser.newContext({
      viewport: { width, height: 850 },
      geolocation: { latitude: 22.301, longitude: 114.171, accuracy: 10 },
      permissions: ["geolocation"],
    });
    await context.exposeBinding("captureDisk", (_, k, v) => {
      disk[k] = v;
    });
    await context.exposeBinding("captureCSV", (_, csv, name) => {
      exported = { csv, name };
    });
    await context.exposeBinding("capturePNG", (_, base64, name) => {
      exportedPng = { base64, name };
    });
    await context.exposeBinding("captureGPX", (_, gpx, name) => {
      exportedGpx = { gpx, name };
    });
    await context.route("**/data/government-routes.json.gz", (r) =>
      r.fulfill({
        body: require("zlib").gzipSync(JSON.stringify(catalogue)),
        contentType: "application/octet-stream",
      }),
    );
    await context.route("https://www.1823.gov.hk/common/ical/en.json", (r) =>
      r.fulfill({ body: JSON.stringify({ date: "20260915", name: "fixture public holiday" }), contentType: "application/json" }),
    );
    await context.route("https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php**", (r) =>
      r.fulfill({ body: JSON.stringify({ date: "2026-09-15", lunarDate: "八月十五" }), contentType: "application/json" }),
    );
    await context.route("https://data.weather.gov.hk/weatherAPI/opendata/weather.php**", (r) =>
      r.fulfill({ body: JSON.stringify({ fixture: true }), contentType: "application/json" }),
    );
    await context.route("https://rt.data.gov.hk/**", (r) =>
      r.fulfill({ body: JSON.stringify({ data: [
        { route: "1", eta: "2026-09-15T14:15:00+08:00", eta_seq: 1 },
        { route: "1", eta: "2026-09-15T14:25:00+08:00", eta_seq: 2 },
      ] }), contentType: "application/json" }),
    );
    await context.route("https://data.etabus.gov.hk/**", (r) =>
      r.fulfill({ body: JSON.stringify({ data: [] }), contentType: "application/json" }),
    );
    await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => requests.push(r.url()));
    await page.addInitScript((seed) => {
      const native = { ...seed };
      const defaultFolder = "/storage/emulated/0/Download/PaxCountRecord";
      const finishExport = (name) => {
        const result = { ok: !window.__failExport, path: `${native.exportDirectory || defaultFolder}/${name}` };
        native.exportResult = JSON.stringify(result);
        window.captureDisk("exportResult", native.exportResult);
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("export-result", { detail: result })));
      };
      window.PassengerCountAndroid = {
        get: (k) => native[k] ?? null,
        set: (k, v) => {
          if (window.__failSave) return false;
          native[k] = v;
          window.captureDisk(k, v);
          return true;
        },
        saveCsv: (csv, name) => { window.captureCSV(csv, name); finishExport(name); },
        savePng: (base64, name) => { window.capturePNG(base64, name); finishExport(name); },
        saveGpx: (gpx, name) => { window.captureGPX(gpx, name); finishExport(name); },
        getExportDirectory: () => native.exportDirectory || defaultFolder,
        getExportResult: () => native.exportResult || null,
        chooseExportDirectory: () => {
          native.exportDirectory = "/storage/emulated/0/PaxCountRecord";
          window.captureDisk("exportDirectory", native.exportDirectory);
          window.dispatchEvent(new Event("export-directory-changed"));
        },
        resetExportDirectory: () => {
          delete native.exportDirectory;
          window.captureDisk("exportDirectory", null);
          window.dispatchEvent(new Event("export-directory-changed"));
        },
        startTracking: (id) => {
          native.trackingId = id;
          window.captureDisk("trackingId", id);
        },
        stopTracking: (id) => {
          if (native.trackingId === id) delete native.trackingId;
          window.captureDisk("trackingId", native.trackingId || null);
        },
        getTrack: () => JSON.stringify(native.track || []),
      };
    }, seed);
    if (workerFixture) await page.addInitScript((fresh) => {
      window.__workers = [];
      window.Worker = class {
        constructor(url) { this.url = url; }
        postMessage(message) { this.message = message; window.__workers.push(this); }
        terminate() { this.terminated = true; }
      };
      window.__finishUpdate = (fail = false) => window.__workers.at(-1).onmessage({
        data: fail ? { error: "Offline" } : { data: fresh },
      });
    }, workerFixture);
    await page.clock.setFixedTime(new Date(time));
    await page.goto(base);
    await page.waitForFunction(
      () => document.querySelector("#new").textContent.length > 0,
    );
    return { context, page };
  }
  let { context, page } = await open();
  const saved = () => JSON.parse(disk["passenger-count:workspace:v2"]);
  const current = () => {
    const s = saved();
    return s.surveys.find((x) => x.id === s.currentId);
  };
  async function flush() {
    await page.waitForFunction(
      () =>
        window.PassengerCountAndroid.get("passenger-count:workspace:v2") !==
        null,
    );
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  }
  async function finishAndReview(button = "complete") {
    const id = current().id;
    await page.locator("#" + button).click();
    await flush();
    assert.equal(
      await page.locator("#homeScreen").isVisible(),
      true,
      "save exits directly to the main screen",
    );
    assert.equal(saved().surveys.find((s) => s.id === id).status, "completed");
    await page.locator(`.recordCard[data-id="${id}"] button`).first().click();
    assert.equal(await page.locator("#recordScreen").isVisible(), true);
  }
  async function key(n) {
    await page.locator(`[data-key="${n}"]`).click();
  }
  async function newTrip(start = "0") {
    await page.locator("#new").click();
    await page.locator("#route").fill("1");
    await page.locator("#search button").click();
    await page.locator("#results button").first().click();
    await page.waitForFunction(
      () => document.querySelector("#start").value !== "",
    );
    await page.locator("#start").selectOption(start);
    await page.locator("#confirm").click();
  }
  assert.equal(await page.locator("html").getAttribute("lang"), "yue-Hant-HK");
  assert.equal(await page.locator("#new").textContent(), "新增行程");
  await page.locator("#surveyor").fill("Android surveyor");
  await page.locator("#new").click();
  await page.locator("#route").fill("1");
  await page.locator("#search button").click();
  await page
    .locator("#results button.route")
    .first()
    .waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#results button.route").count(),
    2,
    "12:00 + 120 min + 10 min remains suggested at 14:10",
  );
  await page.evaluate(() =>
    L.Map.addInitHook(function () {
      window.__map = this;
    }),
  );
  await page.locator("#results button").first().click();
  await page.waitForFunction(
    () => document.querySelector("#start").value === "1",
  );
  assert.equal(await page.locator("#active").inputValue(), "1");
  await page.locator("#language").selectOption("en");
  await page.locator("#start").selectOption("0");
  await context.setGeolocation({
    latitude: 22.302,
    longitude: 114.172,
    accuracy: 10,
  });
  await page.waitForFunction(
    () => Math.abs(window.__map.getCenter().lat - 22.302) < 0.00001,
  );
  assert.equal(await page.locator("#start").inputValue(), "0");
  await page.locator("#vehicle").fill("AB1234");
  await page.locator("#selectedStop").click();
  assert.equal(await page.locator("#myLocation").getAttribute("aria-pressed"), "false");
  await page.locator("#confirm").click();
  await flush();
  assert.equal(disk.trackingId, current().id, "native foreground tracking starts with an active survey");
  assert.equal(await page.locator("#myLocation").getAttribute("aria-pressed"), "true", "counting starts with GPS following even after inspecting setup map");
  await page.waitForFunction(() => Math.abs(window.__map.getCenter().lat - 22.302) < 0.00001);
  assert.equal(await page.locator("#setupScreen").isVisible(), false);
  assert.equal(await page.locator("#onboard").textContent(), "0");
  assert.equal(
    await page.locator("#boarding").evaluate((e) => e.readOnly),
    true,
  );
  assert.equal(
    await page.locator("#boarding").getAttribute("inputmode"),
    "numeric",
  );
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector("#countMapHost")
          .compareDocumentPosition(document.querySelector("#active")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ),
    4,
  );
  async function checkDock() {
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector("#entryDock").getBoundingClientRect().bottom -
            innerHeight,
        ) < 2,
    );
    const geometry = await page.evaluate(() => {
      const rect = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return {
        height: innerHeight,
        width: innerWidth,
        dock: rect("entryDock"),
        stop: rect("active"),
        boarding: rect("boarding"),
        alighting: rect("alighting"),
        keys: rect("keypad"),
        actions: rect("recordNext"),
        save: rect("complete"),
        pause: rect("pause"),
        abort: rect("abort"),
      };
    });
    assert.ok(geometry.dock.top >= 0, "dock fits in viewport");
    for (const part of [
      "stop",
      "boarding",
      "alighting",
      "keys",
      "actions",
      "save",
      "pause",
      "abort",
    ]) {
      const r = geometry[part];
      assert.ok(
        r.top >= geometry.dock.top && r.bottom <= geometry.height + 1,
        `${part} stays visible`,
      );
      assert.ok(
        r.left >= 0 && r.right <= geometry.width + 1,
        `${part} fits horizontally`,
      );
    }
    assert.ok(
      geometry.stop.bottom <= geometry.keys.top,
      "stop name stays above keypad",
    );
    if (geometry.height > 600)
      assert.ok(
        geometry.boarding.bottom <= geometry.keys.top,
        "count fields stay above keypad",
      );
    const before = geometry.dock;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const after = await page.locator("#entryDock").boundingBox();
    assert.ok(
      Math.abs(before.top - after.y) < 2,
      "scrolling never moves the dock",
    );
    const complete = await page.locator("#complete").boundingBox();
    assert.ok(
      complete.y >= after.y &&
        complete.y + complete.height <= after.y + after.height,
      "save remains inside the pinned dock after scrolling",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await checkDock();
  await page.setViewportSize({ width: 740, height: 360 });
  await checkDock();
  await page.setViewportSize({ width: 412, height: 850 });
  await checkDock();
  await key(3);
  assert.equal(await page.locator("#boarding").inputValue(), "3");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#boarding").inputValue(), "", "undo restores the prior passenger entry");
  await page.locator("#redo").click();
  assert.equal(await page.locator("#boarding").inputValue(), "3", "redo reapplies the passenger entry");
  await page.keyboard.type("e.-+abc");
  assert.equal(await page.locator("#boarding").inputValue(), "3");
  await page.locator("#boarding").evaluate((e) => {
    const d = new DataTransfer();
    d.setData("text/plain", "-1");
    e.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: d,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(await page.locator("#boarding").inputValue(), "3");
  await page.locator("#skipAlighting").click();
  assert.equal(await page.locator("#active").inputValue(), "1");
  await flush();
  assert.equal(current().rows[0].skipped.alighting, true);
  assert.match(current().rows[0].observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/, "recorded stops keep a full Hong Kong timestamp");
  await page.locator("#noChange").click();
  assert.equal(await page.locator("#active").inputValue(), "2");
  await page.locator("#noChange").click();
  await flush();
  assert.equal(current().rows[2].recorded, true);
  assert.equal(current().rows[2].boarding, "0");
  assert.equal(current().rows[2].alighting, "0");
  await context.setGeolocation({
    latitude: 22.303,
    longitude: 114.173,
    accuracy: 8,
  });
  await page.waitForFunction(
    () => Math.abs(window.__map.getCenter().lat - 22.303) < 0.00001,
  );
  assert.equal(await page.locator("#active").inputValue(), "2");
  await page.locator("#selectedStop").click();
  await context.setGeolocation({
    latitude: 22.304,
    longitude: 114.174,
    accuracy: 8,
  });
  await page.waitForFunction(() =>
    document.querySelector("#gps").textContent.includes("±8"),
  );
  assert.ok(
    Math.abs(
      (await page.evaluate(() => window.__map.getCenter().lat)) - 22.302,
    ) < 0.00001,
  );
  await page.locator("#myLocation").click();
  await page.waitForFunction(
    () => Math.abs(window.__map.getCenter().lat - 22.304) < 0.00001,
  );
  await page.evaluate(() => window.__map.setZoom(17));
  await context.setGeolocation({
    latitude: 22.305,
    longitude: 114.175,
    accuracy: 8,
  });
  await page.waitForFunction(
    () => Math.abs(window.__map.getCenter().lat - 22.305) < 0.00001,
  );
  assert.equal(await page.evaluate(() => window.__map.getZoom()), 17, "GPS follow preserves the user's zoom level");
  assert.equal(await page.locator("#myLocation").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".leaflet-tooltip").count(), 3);
  await finishAndReview("recordNext");
  await flush();
  assert.equal(current().status, "completed");
  assert.equal(await page.locator("#recordScreen").isVisible(), true);
  assert.equal(await page.locator("#recordIssues").isVisible(), true);
  assert.equal(
    await page.locator("#chart rect[data-series=boarding]").count(),
    3,
  );
  assert.equal(
    await page.locator("#chart [data-series=onboard-line]").count(),
    1,
  );
  await page.locator("#editRecord").click();
  assert.equal(await page.locator("#allStops").evaluate((e) => e.open), true, "editing a completed trip opens its table");
  await page
    .locator('#body tr[data-i="0"] input[data-field="boarding"]')
    .click();
  await key(5);
  assert.equal(await page.locator("#boarding").inputValue(), "5");
  assert.equal(await page.locator("#onboard").textContent(), "5");
  await page
    .locator('#body tr[data-i="2"] input[data-field="alighting"]')
    .click();
  await key(5);
  assert.equal(await page.locator("#countIssues").isVisible(), false);
  const originalEnd = current().endIndex;
  await finishAndReview("saveCompleted");
  assert.equal(
    current().endIndex,
    originalEnd,
    "saving completed edits preserves the trip end",
  );
  await page.locator("#editRecord").click();

  // Custom corrections insert before an existing row without moving its observations.
  await page.locator("#corrections summary").click();
  await page.locator("#addStop").click();
  await page.locator("#insertPosition").selectOption("1");
  await page.locator("#stopNameZh").fill("新增站");
  await page.locator("#stopNameEn").fill("Missing stop");
  await page.locator("#stopForm button[data-i18n=saveStop]").click();
  assert.equal(await page.locator("#active").inputValue(), "3");
  assert.equal(await page.locator("#alighting").inputValue(), "5");
  assert.equal(await page.locator("#body tr").count(), 4);
  await page.locator("#continueRoute").click();
  await page.waitForFunction(
    () => document.querySelector("#sectionChoice").options.length === 2,
  );
  await page.locator("#sectionChoice").selectOption("1");
  assert.equal(await page.locator("#sectionOverlap").inputValue(), "2");
  assert.equal(await page.locator("#sectionStops li").count(), 2);
  await page.locator("#joinSection").click();
  await flush();
  assert.deepEqual(
    current()
      .stops.map((s) => s.id)
      .filter((id) => !id.startsWith("custom:")),
    ["s0", "s1", "s2", "s3", "s0"],
  );
  assert.equal(current().rows[3].alighting, "5");
  assert.equal(current().status, "in_progress");
  await page.locator("#active").selectOption("1");
  await page.locator("#noChange").click();
  await page.locator("#active").selectOption("4");
  await page.locator("#noChange").click();
  await page.locator("#noChange").click();
  await page.locator("#whole").click();
  assert.equal(await page.locator("#myLocation").getAttribute("aria-pressed"), "false");
  await page.locator("#pause").click();
  await flush();
  assert.equal(disk.trackingId, null, "pausing stops native foreground tracking");
  assert.equal(await page.locator("#homeScreen").isVisible(), true);
  assert.match(await page.locator("#recordList").textContent(), /Paused/);
  await page.locator("#recordList button").first().click();
  await flush();
  assert.equal(disk.trackingId, current().id, "resuming restarts native foreground tracking");
  assert.equal(await page.locator("#allStops").evaluate((e) => e.open), true);
  assert.equal(await page.locator("#active").inputValue(), "5");
  assert.equal(await page.locator("#myLocation").getAttribute("aria-pressed"), "true", "resume restores GPS following");
  await page.locator("#selectedStop").click();
  await page.locator("#toggleMap").click();
  await page.locator("#toggleMap").click();
  await page.waitForFunction(() => document.querySelector("#myLocation").getAttribute("aria-pressed") === "true");
  await page.locator("#whole").click();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(await page.locator("#myLocation").getAttribute("aria-pressed"), "true", "foregrounding restores GPS following");
  await page.locator("#abort").click();
  await flush();
  assert.equal(disk.trackingId, null, "aborting stops native foreground tracking");
  assert.match(await page.locator("#recordList").textContent(), /Aborted/);
  await page.locator("#recordList button").first().click();
  await finishAndReview();
  assert.equal(await page.locator("#recordIssues").isVisible(), false);
  await page.locator("#gpx").click();
  await flush();
  assert.match(exportedGpx.name, /\.gpx$/);
  assert.match(exportedGpx.gpx, /<trkpt /);
  assert.match(exportedGpx.gpx, /<time>\d{4}-\d{2}-\d{2}T/);
  await page.locator("#csv").click();
  await flush();
  assert.match(exported.csv, /Status,completed/);
  assert.match(exported.csv, /Android surveyor/);
  assert.match(exported.csv, /custom_stop/);
  assert.match(exported.name, /\.csv$/);
  await page.locator("#language").selectOption("yue-Hant-HK");
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCREENSHOT_PATH.replace(".png", "-record.png"),
      fullPage: true,
    });
  await page.locator("#recordHome").click();
  await newTrip("1");
  assert.equal(await page.locator("#onboard").textContent(), "未知");
  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#countScreen").isVisible(), true);
  await key(2);
  await page.locator("#boundaries summary").click();
  await page.locator("#initialOnboard").fill("4");
  assert.equal(await page.locator("#onboard").textContent(), "6");
  await page.locator("#initialOnboard").fill("2e1");
  assert.equal(await page.locator("#initialOnboard").inputValue(), "4");
  await page.locator("#boundaries summary").click();
  await flush();
  const seed = { ...disk };
  await context.close();
  ({ context, page } = await open(seed, 360));
  await page.setViewportSize({ width: 360, height: 740 });
  await checkDock();
  assert.equal(await page.locator("html").getAttribute("lang"), "yue-Hant-HK");
  assert.equal(await page.locator("#countScreen").isVisible(), true);
  assert.equal(await page.locator("#active").inputValue(), "1");
  assert.equal(await page.locator("#boarding").inputValue(), "2");
  assert.equal(await page.locator("#onboard").textContent(), "6");
  assert.equal(
    await page.locator("#surveyor").inputValue(),
    "Android surveyor",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await flush();
  assert.equal(saved().surveys.length, 2);
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCREENSHOT_PATH,
      fullPage: false,
    });
  await page.locator("#skipAlighting").click();
  await page.locator("#skipBoarding").click();
  await key(6);
  assert.equal(await page.locator("#recordNext").textContent(), "記錄最後一站");
  await page.locator("#recordNext").click();
  assert.equal(await page.locator("#active").inputValue(), "2");
  assert.equal(await page.locator("#countScreen").isVisible(), true);
  assert.equal(
    await page.locator("#recordNext").textContent(),
    "儲存並返回主頁",
  );
  await flush();
  const finalStopSeed = { ...disk };
  await context.close();
  ({ context, page } = await open(finalStopSeed, 360));
  assert.equal(
    await page.locator("#recordNext").textContent(),
    "儲存並返回主頁",
    "recorded final-stop action survives cold recovery",
  );
  // A failed save must keep the counting screen open so the user can retry.
  await page.evaluate(() => (window.__failSave = true));
  await page.locator("#recordNext").click();
  assert.equal(await page.locator("#countScreen").isVisible(), true);
  await flush();
  assert.equal(current().status, "in_progress");
  await page.evaluate(() => (window.__failSave = false));
  await finishAndReview("recordNext");
  assert.equal(await page.locator("#recordIssues").isVisible(), false);
  await page.locator("#language").selectOption("en");
  await flush();
  assert.equal(saved().language, "en");
  // Master selection -> checkboxes -> OK -> listed confirmation; no per-record deletion.
  const ids = saved().surveys.map((s) => s.id);
  await page.locator("#recordHome").click();
  assert.equal(
    await page.locator("#recordList input[type=checkbox]").count(),
    0,
  );
  assert.equal(await page.locator("[data-delete-id],#deleteRecord").count(), 0);
  await page.locator("#deleteRecords").click();
  assert.equal(
    await page.locator("#recordList input[type=checkbox]").count(),
    2,
  );
  assert.equal(await page.locator("#selectionOkay").isDisabled(), true);
  await page.locator(`input[data-record-id="${ids[0]}"]`).check();
  await page.locator(`input[data-record-id="${ids[1]}"]`).check();
  assert.equal(
    await page.locator("#deleteDialog").isVisible(),
    false,
    "checkboxes alone cannot open confirmation",
  );
  await page.locator("#selectionOkay").click();
  assert.equal(await page.locator("#deleteSummary li").count(), 2);
  assert.match(await page.locator("#deleteTitle").textContent(), /2/);
  assert.deepEqual(
    (
      await page
        .locator("#deleteSummary li")
        .evaluateAll((items) => items.map((x) => x.dataset.recordId))
    ).sort(),
    [...ids].sort(),
  );
  for (const item of await page.locator("#deleteSummary li").all())
    assert.match(await item.textContent(), /1 · New Lantao Bus/);
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCREENSHOT_PATH.replace(".png", "-delete.png"),
    });
  await page.locator("#cancelDelete").click();
  assert.equal(await page.locator("#recordList input:checked").count(), 2);
  await page.locator("#selectionOkay").click();
  await page.evaluate(() => (window.__failSave = true));
  await page.locator("#confirmDelete").click();
  assert.equal(await page.locator("#deleteError").isVisible(), true);
  await flush();
  assert.equal(saved().surveys.length, 2);
  await page.evaluate(() => (window.__failSave = false));
  await page.locator("#confirmDelete").click();
  await flush();
  assert.equal(saved().surveys.length, 0);
  assert.equal(await page.locator("#deleteRecords").isDisabled(), true);
  // Cold restore after bulk deletion cannot resurrect either trip.
  const deletedSeed = { ...disk };
  await context.close();
  ({ context, page } = await open(deletedSeed, 360));
  assert.equal(await page.locator(".recordCard").count(), 0);
  assert.match(
    await page.locator("#recordList").textContent(),
    /No saved records/,
  );
  // Select only one of the two saved fixtures: the unselected record must survive.
  await context.close();
  ({ context, page } = await open(seed, 360));
  await page.locator("#pause").click();
  await page.locator("#deleteRecords").click();
  await page.locator(`input[data-record-id="${ids[0]}"]`).check();
  await page.locator("#cancelSelection").click();
  assert.equal(
    await page.locator("#recordList input[type=checkbox]").count(),
    0,
  );
  await page.locator("#deleteRecords").click();
  assert.equal(await page.locator("#recordList input:checked").count(), 0);
  await page.locator(`input[data-record-id="${ids[0]}"]`).check();
  await page.locator("#selectionOkay").click();
  assert.equal(await page.locator("#deleteSummary li").count(), 1);
  assert.equal(
    await page.locator("#deleteSummary li").getAttribute("data-record-id"),
    ids[0],
  );
  await page.locator("#confirmDelete").click();
  await flush();
  assert.deepEqual(
    saved().surveys.map((s) => s.id),
    [ids[1]],
  );
  // Long trip lists must not push selection/confirmation controls off screen.
  await context.close();
  const manyState = JSON.parse(seed["passenger-count:workspace:v2"]);
  manyState.currentId = null;
  manyState.screen = "home";
  manyState.language = "yue-Hant-HK";
  const sample = manyState.surveys[0];
  manyState.surveys = Array.from({ length: 80 }, (_, i) => ({
    ...structuredClone(sample), id: `long-trip-${i}`, vehicle: `BUS-${i}`,
    route: { ...sample.route, route: `N${i}`, dest: { en: "A very long destination name for overflow testing", zh: "很長的目的地名稱，用作檢查大量行程刪除清單的畫面" } },
  }));
  ({ context, page } = await open({ "passenger-count:workspace:v2": JSON.stringify(manyState) }, 360));
  await page.setViewportSize({ width: 360, height: 740 });
  await page.locator("#deleteRecords").click();
  async function controlsVisible(selectors) {
    for (const selector of selectors) {
      const box = await page.locator(selector).boundingBox(), viewport = page.viewportSize();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} fits ${JSON.stringify(viewport)}: ${JSON.stringify(box)}`);
    }
  }
  for (const checkbox of await page.locator("#recordList input[type=checkbox]").all())
    await checkbox.check();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await controlsVisible(["#selectionOkay", "#cancelSelection"]);
  const lastCard = await page.locator(".recordCard").last().boundingBox();
  assert.ok(lastCard.y + lastCard.height <= (await page.locator("#recordSelection").boundingBox()).y, "last trip scrolls above selection controls");
  await page.locator("#selectionOkay").click();
  assert.equal(await page.locator("#deleteSummary li").count(), 80);
  for (const [width, height, fontSize] of [[360, 740, 16], [740, 360, 16], [320, 568, 24]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((size) => document.documentElement.style.fontSize = `${size}px`, fontSize);
    await controlsVisible(["#deleteTitle", "#cancelDelete", "#confirmDelete"]);
    const footerBefore = await page.locator("#confirmDelete").boundingBox();
    await page.locator("#deleteReview").evaluate((el) => el.scrollTop = el.scrollHeight);
    assert.ok(await page.locator("#deleteReview").evaluate((el) => el.scrollTop > 0));
    assert.deepEqual(await page.locator("#confirmDelete").boundingBox(), footerBefore, "confirmation buttons do not scroll with the list");
    const last = await page.locator("#deleteSummary li").last().boundingBox();
    assert.ok(last.y + last.height <= footerBefore.y, "last selected trip can be reviewed above the footer");
  }
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({ path: process.env.SCREENSHOT_PATH.replace(".png", "-long-delete.png") });
  await page.locator("#cancelDelete").click();
  assert.equal(await page.locator("#recordList input:checked").count(), 80);
  await controlsVisible(["#selectionOkay", "#cancelSelection"]);
  await page.locator("#selectionOkay").click();
  assert.equal(await page.locator("#deleteReview").evaluate((el) => el.scrollTop), 0, "reopened confirmation begins at the first trip");
  await page.evaluate(() => window.__failSave = true);
  await page.locator("#confirmDelete").click();
  await controlsVisible(["#deleteError", "#cancelDelete", "#confirmDelete"]);
  await flush();
  assert.equal(saved().surveys.length, 80);
  await page.evaluate(() => window.__failSave = false);
  await page.locator("#confirmDelete").click();
  await flush();
  assert.equal(saved().surveys.length, 0);

  // Reproduce the actual N8 screenshot using the bundled government data.
  await context.close();
  const bundled = JSON.parse(require("zlib").gunzipSync(fs.readFileSync(path.join(root, "data/government-routes.json.gz"))));
  ({ context, page } = await open({}, 360, bundled, "2026-09-16T05:32:00+08:00"));
  await page.locator("#new").click();
  await page.locator("#route").fill("N8");
  await page.locator("#search button").click();
  await page.locator("#results .route").first().waitFor();
  assert.equal(await page.locator("#results .route").count(), 1);
  assert.match(await page.locator("#results .route").textContent(), /1000594/);
  assert.equal(await page.locator("#otherResults .route").count(), 2);
  assert.equal(await page.locator("#upcoming").count(), 0, "tolerance is fixed, with no configurable selector");
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({ path: process.env.SCREENSHOT_PATH.replace(".png", "-n8.png") });

  // Saved legacy preference cannot override the fixed allowance.
  await context.close();
  ({ context, page } = await open({ "passenger-count:workspace:v2": JSON.stringify({ ...manyState, surveys: [], search: { number: "1", upcoming: "120" } }) }, 360, data, "2026-09-15T11:49:59+08:00"));
  await page.locator("#new").click();
  await page.locator("#route").fill("1");
  await page.locator("#search button").click();
  await page.waitForFunction(() => document.querySelectorAll("#otherResults .route").length === 2);
  assert.equal(await page.locator("#results .route").count(), 0);
  await page.clock.setFixedTime(new Date("2026-09-15T11:50:00+08:00"));
  await page.locator("#search button").click();
  await page.waitForFunction(() => document.querySelectorAll("#results .route .upcoming").length === 2);
  // Reopen a completed trip, correct its table, continue, and save again.
  await context.close();
  const reopening = structuredClone(sample);
  reopening.id = "reopening-trip";
  reopening.status = "completed";
  reopening.endIndex = 0;
  reopening.activeIndex = 0;
  reopening.completedAt = "2026-09-15T06:00:00Z";
  reopening.finalOnboard = "";
  ({ context, page } = await open({ "passenger-count:workspace:v2": JSON.stringify({ ...manyState, surveys: [reopening], language: "en" }) }, 360));
  await page.locator("#recordList button").first().click();
  await page.locator("#continueRecord").click();
  await flush();
  assert.equal(current().id, "reopening-trip");
  assert.equal(current().status, "in_progress");
  assert.equal(current().endIndex, null);
  assert.equal(current().completedAt, null);
  assert.deepEqual(current().rows, reopening.rows);
  assert.equal(await page.locator("#active").inputValue(), "1");
  if (!await page.locator("#allStops").evaluate((e) => e.open)) await page.locator("#allStops summary").click();
  const preservedTime = current().rows[0].time;
  const preservedObservedAt = current().rows[0].observedAt;
  await page.locator('#body tr[data-i="0"] input[data-field="boarding"]').click();
  await key(9);
  await flush();
  assert.equal(current().rows[0].boarding, "9");
  assert.equal(current().rows[0].time, preservedTime, "later table correction does not replace stop time");
  assert.equal(current().rows[0].observedAt, preservedObservedAt, "later table correction does not replace full observation timestamp");
  await page.locator("#active").selectOption("1");
  await page.locator("#noChange").click();
  await finishAndReview();
  assert.equal(current().id, "reopening-trip");
  assert.equal(current().rows[0].boarding, "9");

  // Chart fits narrow screens and PNG export contains real image bytes and path feedback.
  for (const width of [320, 740]) {
    await page.setViewportSize({ width, height: 740 });
    await page.waitForFunction(() => document.querySelector("#chart svg").viewBox.baseVal.width === document.querySelector("#chart").clientWidth);
    const box = await page.locator("#chart svg").boundingBox();
    assert.ok(box.width <= width && box.x + box.width <= width);
    assert.ok(await page.locator("#chart").evaluate((e) => e.scrollWidth <= e.clientWidth));
  }
  await page.setViewportSize({ width: 360, height: 740 });
  const chartState = saved();
  const chartTrip = chartState.surveys.find((s) => s.id === chartState.currentId);
  const chartStops = chartTrip.stops, chartRows = chartTrip.rows;
  chartTrip.stops = Array.from({ length: 80 }, (_, i) => ({ ...chartStops[i % chartStops.length], sequence: i + 1 }));
  chartTrip.rows = Array.from({ length: 80 }, (_, i) => ({ ...chartRows[i % chartRows.length] }));
  chartTrip.endIndex = 79;
  const chartSeed = { ...disk, "passenger-count:workspace:v2": JSON.stringify(chartState) };
  await context.close();
  ({ context, page } = await open(chartSeed, 360));
  await page.locator("#recordScreen").waitFor();
  assert.equal(await page.locator('#chart rect[data-series="boarding"]').count(), 80);
  assert.ok(await page.locator("#chart").evaluate((e) => e.scrollWidth <= e.clientWidth), "80 stops fit the screen");
  assert.equal(await page.locator("#chart text").evaluateAll((nodes) =>
    nodes.some((n) => /^-?\d+\.\d+$/.test(n.textContent.trim()))), false,
    "passenger chart labels are integers only");
  await page.locator("#saveChart").click();
  await flush();
  assert.match(exportedPng.name, /\.png$/);
  assert.deepEqual([...Buffer.from(exportedPng.base64, "base64").subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  assert.match(await page.locator("#exportStatus").textContent(), /\/storage\/emulated\/0\/Download\/PaxCountRecord\/.*\.png/);
  if (process.env.SCREENSHOT_PATH) fs.writeFileSync(process.env.SCREENSHOT_PATH.replace(".png", "-chart.png"), Buffer.from(exportedPng.base64, "base64"));
  await page.locator("#csv").click();
  await flush();
  assert.match(await page.locator("#exportStatus").textContent(), /\.csv/);
  await page.evaluate(() => window.__failExport = true);
  await page.locator("#csv").click();
  await flush();
  assert.match(await page.locator("#exportStatus").textContent(), /Export failed/);
  assert.equal(current().status, "completed");
  await page.evaluate(() => window.__failExport = false);

  await page.locator("#recordHome").click();
  await page.locator("#exportSettings summary").click();
  assert.match(await page.locator("#exportDirectory").textContent(), /Download\/PaxCountRecord/);
  await page.locator("#chooseExportDirectory").click();
  assert.equal(await page.locator("#exportDirectory").textContent(), "/storage/emulated/0/PaxCountRecord");
  await flush();
  const folderSeed = { ...disk };
  await context.close();
  ({ context, page } = await open(folderSeed, 360));
  await page.locator("#exportSettings summary").click();
  assert.equal(await page.locator("#exportDirectory").textContent(), "/storage/emulated/0/PaxCountRecord", "folder survives cold restart");
  await page.locator("#recordList button").first().click();
  await page.locator("#csv").click();
  await flush();
  assert.match(await page.locator("#exportStatus").textContent(), /\/storage\/emulated\/0\/PaxCountRecord\/.*\.csv/);
  await page.locator("#recordHome").click();
  await page.locator("#resetExportDirectory").click();
  assert.match(await page.locator("#exportDirectory").textContent(), /Download\/PaxCountRecord/);

  // Launch on Home without a previous search starts the stale-data worker.
  await context.close();
  const stale = structuredClone(data), fresh = structuredClone(data);
  stale.source.retrievedAt = "2026-09-12T15:59:59.999Z"; // Just before Sunday HK midnight.
  fresh.source.retrievedAt = "2026-09-15T06:10:00Z";
  fresh.source.publishedAt = "2026-09-01T00:00:00Z"; // Publication age must not trigger repeats.
  ({ context, page } = await open({}, 360, stale, "2026-09-15T06:10:00Z", fresh));
  await page.waitForFunction(() => window.__workers.length === 1);
  assert.equal(await page.locator("#homeScreen").isVisible(), true);
  assert.equal(await page.locator("#route").inputValue(), "");
  assert.equal(await page.locator("#settingsRefreshData").isDisabled(), true);
  await page.locator("#surveyor").fill("Background update surveyor");
  await newTrip("0");
  await key(7);
  await flush();
  const duringUpdate = structuredClone(current());
  assert.equal(await page.evaluate(() => window.__workers.length), 1, "search while updating does not start another worker");
  await page.evaluate(() => window.__finishUpdate());
  await page.waitForFunction(async () => (await (await import("./storage.js")).cacheGet())?.data.source.retrievedAt === "2026-09-15T06:10:00Z");
  await flush();
  assert.equal(await page.locator("#countScreen").isVisible(), true);
  assert.deepEqual(current().rows, duringUpdate.rows, "background data update preserves entered counts");
  assert.deepEqual(current().stops, duringUpdate.stops, "background data update preserves stop snapshot");
  await page.locator("#pause").click();
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#settingsDataStatus").textContent.includes("2026-09-01"));
  assert.equal(await page.evaluate(() => window.__workers.length), 0, "successful cached update suppresses refresh on next launch even with old publication date");
  await page.locator("#exportSettings summary").click();
  await page.locator("#settingsRefreshData").click();
  await page.waitForFunction(() => window.__workers.length === 1);
  await page.evaluate(() => window.__finishUpdate());
  await page.waitForFunction(() => !document.querySelector("#settingsRefreshData").disabled);
  assert.equal(await page.evaluate(() => window.__workers.length), 1, "Settings can manually refresh current data");
  // The pre-existing manual refresh in route setup remains usable too.
  await page.locator("#new").click();
  await page.locator("#refreshData").evaluate((e) => e.closest("details").open = true);
  await page.locator("#refreshData").click();
  await page.waitForFunction(() => window.__workers.length === 2);
  await page.evaluate(() => window.__finishUpdate());
  await page.waitForFunction(() => !document.querySelector("#refreshData").disabled);

  // Failed launches retain data and retry on a subsequent launch, not each search.
  await context.close();
  ({ context, page } = await open({}, 360, stale, "2026-09-15T06:10:00Z", fresh));
  await page.waitForFunction(() => window.__workers.length === 1);
  await page.evaluate(() => window.__finishUpdate(true));
  await page.waitForFunction(() => !document.querySelector("#settingsRefreshData").disabled);
  assert.equal(await page.evaluate(async () => await (await import("./storage.js")).cacheGet()), undefined);
  await newTrip("0");
  assert.equal(await page.evaluate(() => window.__workers.length), 1);
  await page.locator("#pause").click();
  await page.reload();
  await page.waitForFunction(() => window.__workers.length === 1);
  await page.evaluate(() => window.__finishUpdate(true));

  // Successful retrieval at Sunday 00:00 exactly is already current.
  await context.close();
  const boundaryData = structuredClone(stale);
  boundaryData.source.retrievedAt = "2026-09-12T16:00:00Z";
  ({ context, page } = await open({}, 360, boundaryData, "2026-09-15T06:10:00Z", fresh));
  await page.waitForFunction(() => document.querySelector("#settingsDataStatus").textContent.includes("2026-09-12"));
  assert.equal(await page.evaluate(() => window.__workers.length), 0);
  await page.clock.setFixedTime(new Date("2026-09-20T00:00:00+08:00"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => window.__workers.length === 1);
  await page.evaluate(() => window.__finishUpdate(true));
  await page.waitForFunction(() => !document.querySelector("#settingsRefreshData").disabled);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => window.__workers.length === 2);
  await page.evaluate(() => window.__finishUpdate(true));

  assert.equal(
    requests.some((u) => /hkbus|routeFareList/.test(u)),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Cantonese/English, GPS synchronization and map following, numeric-only entry, skipped fields, zero-change last stop, derived counts and conflict warnings, editable table, custom stops, overlapping circular sections, pause/abort/resume, completed records/charts/CSV, autosave and cold-context recovery, bottom-pinned entry in portrait/landscape, and bulk record selection/confirmation/cancellation/storage failure/recovery, the inclusive 14:10 service window, final-stop save/home transition and pinned trip exit controls; 80-trip deletion with fixed actions and enlarged text, actual bundled N8 at 05:32, fixed 10-minute early tolerance overriding old preferences; GPS following on map/resume/foreground, completed-trip reopening and correction, responsive PNG charts, and remembered export folders with full-path/error feedback; Sunday-cutoff launch refresh, usable counting during updates, persisted freshness, offline retry and manual updates in Settings/setup.",
  );
  await browser.close();
  server.close();
})().catch(async (e) => {
  console.error(e, errors);
  if (browser) await browser.close();
  server.close();
  process.exitCode = 1;
});
