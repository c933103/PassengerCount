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
  const name = path.join(
    root,
    req.url === "/" ? "index.html" : req.url.split("?")[0],
  );
  try {
    res.setHeader("Content-Type", mime[path.extname(name)] || "text/plain");
    res.end(fs.readFileSync(name));
  } catch {
    res.writeHead(404).end();
  }
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 850 },
    geolocation: { latitude: 22.301, longitude: 114.171, accuracy: 10 },
    permissions: ["geolocation"],
  });
  const disk = {};
  let exported;
  const errors = [],
    requests = [];
  await context.exposeBinding("captureDisk", (_, key, value) => {
    disk[key] = value;
  });
  await context.exposeBinding("captureCSV", (_, csv, name) => {
    exported = { csv, name };
  });
  const data = {
    source: { id: "hk-td-gtfs-v1", retrievedAt: new Date().toISOString() },
    routeList: {
      a: {
        route: "1",
        agency: "NLB",
        orig: { en: "First stop", zh: "甲" },
        dest: { en: "Third stop", zh: "丙" },
        serviceType: 1,
        bound: { nlb: "1" },
        stops: { nlb: ["s0", "s1", "s2"] },
        source: "hk-td-gtfs-v1",
        schedule: [],
      },
    },
    stopList: Object.fromEntries(
      [0, 1, 2].map((i) => [
        "s" + i,
        {
          name: {
            en: ["First stop", "Second stop", "Third stop"][i],
            zh: ["甲", "乙", "丙"][i],
          },
          location: { lat: 22.3 + i * 0.001, lng: 114.17 + i * 0.001 },
        },
      ]),
    ),
    calendars: {},
  };
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
        native[k] = v;
        window.captureDisk(k, v);
        return true;
      },
      saveCsv: (csv, name) => window.captureCSV(csv, name),
    };
  }, disk);
  await page.goto(base);
  await page.locator("#surveyor").fill("Android surveyor");
  await page.locator("#route").fill("1");
  await page.locator("#search button").click();
  await page.locator("#results button").first().click();
  await page.waitForFunction(
    () => document.querySelector("#start").value === "1",
  );
  assert.equal(
    await page.locator("#active").inputValue(),
    "1",
    "GPS suggestion must select the count row immediately",
  );
  await page.locator("#start").selectOption("0");
  assert.equal(
    await page.locator("#active").inputValue(),
    "0",
    "manual starting stop must select the count row",
  );
  await context.setGeolocation({
    latitude: 22.302,
    longitude: 114.172,
    accuracy: 10,
  });
  await page.waitForFunction(() =>
    document.querySelector("#gps").textContent.includes("Third stop"),
  );
  assert.equal(
    await page.locator("#start").inputValue(),
    "0",
    "GPS cannot overwrite manual choice",
  );
  await page.locator("#start").selectOption("1");
  await page.locator("#vehicle").fill("AB1234");
  await page.locator("#confirm").click();
  assert.equal(await page.locator("#setup").isVisible(), false);
  assert.equal(await page.locator("#countScreen").isVisible(), true);
  assert.equal(await page.locator("#active").inputValue(), "1");
  assert.equal(
    await page.locator("#boarding").getAttribute("inputmode"),
    "numeric",
  );
  assert.equal(
    await page.locator("#boarding").evaluate((e) => e.readOnly),
    true,
  );
  await page.locator('[data-key="3"]').click();
  await page.locator("#onboard").click();
  await page.locator('[data-key="1"]').click();
  await page.locator('[data-key="0"]').click();
  assert.equal(await page.locator("#onboard").inputValue(), "10");
  await page.keyboard.type("e.-+abc");
  assert.equal(
    await page.locator("#onboard").inputValue(),
    "10",
    "invalid hardware input must be ignored",
  );
  await page.locator("#boarding").evaluate((e) => {
    const event = new Event("input", { bubbles: true });
    e.dispatchEvent(event);
  });
  // Read-only fields and rejected invalid paste prevent scientific notation / signs / decimals.
  await page.locator("#boarding").evaluate((e) => {
    const data = new DataTransfer();
    data.setData("text/plain", "-1");
    e.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(await page.locator("#boarding").inputValue(), "3");
  await page.evaluate(() => {
    L.Map.addInitHook(function () {
      window.__map = this;
    });
  });
  await page.locator("#checkMap").click();
  await page.waitForFunction(
    () => Math.abs(window.__map.getCenter().lat - 22.302) < 0.00001,
  );
  assert.equal(await page.locator(".leaflet-tooltip").count(), 3);
  await context.setGeolocation({
    latitude: 22.303,
    longitude: 114.173,
    accuracy: 8,
  });
  await page.waitForFunction(
    () => Math.abs(window.__map.getCenter().lat - 22.303) < 0.00001,
  );
  assert.equal(
    await page.locator("#active").inputValue(),
    "1",
    "live GPS must not redirect an in-progress entry",
  );
  await page.locator("#selectedStop").click();
  await context.setGeolocation({
    latitude: 22.304,
    longitude: 114.174,
    accuracy: 8,
  });
  await page.waitForFunction(() =>
    document.querySelector("#gps").textContent.includes("GPS ±8"),
  );
  assert.ok(
    Math.abs(
      (await page.evaluate(() => window.__map.getCenter().lat)) - 22.301,
    ) < 0.00001,
  );
  await page.locator("#myLocation").click();
  await page.waitForFunction(
    () => Math.abs(window.__map.getCenter().lat - 22.304) < 0.00001,
  );
  await page.locator("#mapStop").selectOption("2");
  await page.locator("#useMapStop").click();
  assert.equal(await page.locator("#active").inputValue(), "2");
  assert.equal(await page.locator("#boarding").inputValue(), "");
  await page.locator('[data-key="0"]').click();
  await page.locator("#active").selectOption("1");
  assert.equal(await page.locator("#boarding").inputValue(), "3");
  assert.equal(await page.locator("#onboard").inputValue(), "10");
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCREENSHOT_PATH,
      fullPage: true,
    });
  await page.locator("#finish").click();
  assert.match(
    await page.locator('[data-i="0"] [data-f="onboard"]').textContent(),
    /^7auto$/,
  );
  await page.locator("#csv").click();
  await page.waitForTimeout(100);
  assert.match(exported.csv, /Android surveyor/);
  assert.match(exported.csv, /calculated/);
  assert.match(exported.name, /\.csv$/);
  await page.locator("#reviewBack").click();
  const saved = { ...disk };
  await context.close();
  const restored = await browser.newContext({
    viewport: { width: 360, height: 740 },
  });
  await restored.route("**/data/government-routes.json.gz", (r) =>
    r.fulfill({
      body: require("zlib").gzipSync(JSON.stringify(data)),
      contentType: "application/octet-stream",
    }),
  );
  await restored.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  const p = await restored.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript((seed) => {
    window.PassengerCountAndroid = {
      get: (k) => seed[k] ?? null,
      set: (k, v) => {
        seed[k] = v;
        return true;
      },
      saveCsv: () => {},
    };
  }, saved);
  await p.goto(base);
  assert.equal(await p.locator("#countScreen").isVisible(), true);
  assert.equal(await p.locator("#active").inputValue(), "1");
  assert.equal(await p.locator("#boarding").inputValue(), "3");
  assert.equal(await p.locator("#onboard").inputValue(), "10");
  assert.equal(await p.locator("#surveyor").inputValue(), "Android surveyor");
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.locator("#settings").click();
  assert.equal(await p.locator("#vehicle").inputValue(), "AB1234");
  await p.locator("#start").selectOption("0");
  await p.locator("#confirm").click();
  assert.equal(await p.locator("#active").inputValue(), "0");
  assert.equal(await p.locator("#onboard").inputValue(), "7");
  assert.equal(
    requests.some((u) => /hkbus|routeFareList/.test(u)),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: GPS/manual stop synchronization, compact keypad, count validation, live map tracking and override, backward counts, government-only requests, CSV and cold-context recovery.",
  );
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
