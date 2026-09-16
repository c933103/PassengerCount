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
let exported, browser;
const route = (ids, dest) => ({
  route: "1",
  agency: "NLB",
  orig: { en: "First stop", zh: "甲站" },
  dest: { en: dest, zh: dest === "Third stop" ? "丙站" : "甲站" },
  serviceType: 1,
  bound: { nlb: "1" },
  stops: { nlb: ids },
  source: "hk-td-gtfs-v1",
  schedule: [],
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
  calendars: {},
};
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--no-sandbox"],
  });
  async function open(seed = {}, width = 412) {
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
    await context.route("**/data/government-routes.json.gz", (r) =>
      r.fulfill({
        body: require("zlib").gzipSync(JSON.stringify(data)),
        contentType: "application/octet-stream",
      }),
    );
    await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => requests.push(r.url()));
    await page.addInitScript((seed) => {
      const native = { ...seed };
      window.PassengerCountAndroid = {
        get: (k) => native[k] ?? null,
        set: (k, v) => {
          if (window.__failSave) return false;
          native[k] = v;
          window.captureDisk(k, v);
          return true;
        },
        saveCsv: (csv, name) => window.captureCSV(csv, name),
      };
    }, seed);
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
  await page.locator("#confirm").click();
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
      };
    });
    assert.ok(geometry.dock.top >= 0, "dock fits in viewport");
    for (const part of ["stop", "boarding", "alighting", "keys", "actions"]) {
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
      complete.y + complete.height <= after.y,
      "trip controls can scroll above the dock",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await checkDock();
  await page.setViewportSize({ width: 740, height: 360 });
  await checkDock();
  await page.setViewportSize({ width: 412, height: 850 });
  await checkDock();
  await key(3);
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
  assert.equal(await page.locator(".leaflet-tooltip").count(), 3);
  await page.locator("#complete").click();
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
  await page.locator("#allStops summary").click();
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
  await page.locator("#pause").click();
  assert.equal(await page.locator("#homeScreen").isVisible(), true);
  assert.match(await page.locator("#recordList").textContent(), /Paused/);
  await page.locator("#recordList button").first().click();
  assert.equal(await page.locator("#allStops").evaluate((e) => e.open), true);
  assert.equal(await page.locator("#active").inputValue(), "5");
  await page.locator("#abort").click();
  assert.match(await page.locator("#recordList").textContent(), /Aborted/);
  await page.locator("#recordList button").first().click();
  await page.locator("#complete").click();
  assert.equal(await page.locator("#recordIssues").isVisible(), false);
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
  await page.locator("#recordNext").click();
  assert.equal(await page.locator("#active").inputValue(), "2");
  await page.locator("#complete").click();
  assert.equal(await page.locator("#recordIssues").isVisible(), false);
  await page.locator("#language").selectOption("en");
  await flush();
  assert.equal(saved().language, "en");
  // Deleting a selected record is transactional, cancellable, and survives app restoration.
  const removedId = current().id,
    keptId = saved().surveys.find((s) => s.id !== removedId).id;
  await page.locator("#deleteRecord").click();
  assert.match(await page.locator("#deleteSummary").textContent(), /Completed/);
  await page.locator("#cancelDelete").click();
  await flush();
  assert.equal(saved().surveys.length, 2);
  await page.locator("#deleteRecord").click();
  await page.evaluate(() => (window.__failSave = true));
  await page.locator("#confirmDelete").click();
  assert.equal(await page.locator("#deleteError").isVisible(), true);
  await flush();
  assert.equal(saved().surveys.length, 2);
  await page.evaluate(() => (window.__failSave = false));
  await page.locator("#confirmDelete").click();
  await flush();
  assert.equal(await page.locator("#homeScreen").isVisible(), true);
  assert.equal(saved().currentId, null);
  assert.deepEqual(
    saved().surveys.map((s) => s.id),
    [keptId],
  );
  const deletedSeed = { ...disk };
  await context.close();
  ({ context, page } = await open(deletedSeed, 360));
  assert.equal(await page.locator(".recordCard").count(), 1);
  assert.equal(
    await page.locator(`[data-delete-id="${removedId}"]`).count(),
    0,
  );
  await page.locator(`[data-delete-id="${keptId}"]`).click();
  await page.locator("#cancelDelete").click();
  assert.equal(await page.locator(".recordCard").count(), 1);
  await page.locator(`[data-delete-id="${keptId}"]`).click();
  await page.locator("#confirmDelete").click();
  await flush();
  assert.equal(saved().surveys.length, 0);
  assert.match(
    await page.locator("#recordList").textContent(),
    /No saved records/,
  );
  assert.equal(
    requests.some((u) => /hkbus|routeFareList/.test(u)),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Cantonese/English, GPS synchronization and map following, numeric-only entry, skipped fields, zero-change last stop, derived counts and conflict warnings, editable table, custom stops, overlapping circular sections, pause/abort/resume, completed records/charts/CSV, autosave and cold-context recovery, bottom-pinned entry in portrait/landscape, and saved-record deletion/cancellation/storage failure/recovery.",
  );
  await browser.close();
  server.close();
})().catch(async (e) => {
  console.error(e, errors);
  if (browser) await browser.close();
  server.close();
  process.exitCode = 1;
});
