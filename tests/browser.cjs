const { chromium } = require("playwright");
const http = require("http"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const mime = {
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
    viewport: { width: 412, height: 915 },
    geolocation: { latitude: 22.301, longitude: 114.171, accuracy: 10 },
    permissions: ["geolocation"],
  });
  const disk = {};
  let exported;
  const errors = [];
  await context.exposeBinding("captureDisk", (_, key, value) => {
    disk[key] = value;
  });
  await context.exposeBinding("captureCSV", (_, csv, name) => {
    exported = { csv, name };
  });
  const data = {
    routeList: {
      a: {
        route: "1",
        orig: { en: "Origin", zh: "起點" },
        dest: { en: "Destination", zh: "終點" },
        serviceType: 1,
        bound: { nlb: "O" },
        stops: { nlb: ["s0", "s1", "s2"] },
      },
    },
    stopList: Object.fromEntries(
      [0, 1, 2].map((i) => [
        "s" + i,
        {
          name: {
            en: ["First stop", "Second stop", "Third stop"][i],
            zh: ["第一站", "第二站", "第三站"][i],
          },
          location: { lat: 22.3 + i * 0.001, lng: 114.17 + i * 0.001 },
        },
      ]),
    ),
  };
  await context.route("**/routeFareList.min.json", (r) =>
    r.fulfill({ json: data }),
  );
  await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  async function bridge() {
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
  }
  await bridge();
  await page.goto(base);
  await page.locator("#surveyor").fill("Android surveyor");
  await page.locator("#route").fill("1");
  await page.locator("#search button").click();
  await page.locator("#results button").first().click();
  await page.waitForFunction(
    () => document.querySelector("#start").value === "1",
  );
  assert.match(await page.locator("#gps").innerText(), /Second stop/);
  await page.locator("#confirm").click();
  await page.locator('[data-i="1"] [data-f="boarding"]').fill("3");
  await page.locator('[data-i="1"] [data-f="onboard"]').fill("10");
  await page.locator("#vehicle").fill("AB1234");
  assert.equal(
    await page.locator('[data-i="0"] [data-f="onboard"]').inputValue(),
    "7",
  );
  assert.equal(await page.locator(".leaflet-tooltip").count(), 3);
  await page.locator("#csv").click();
  await page.waitForTimeout(100);
  assert.match(exported.csv, /Android surveyor/);
  assert.match(exported.csv, /calculated/);
  assert.match(exported.name, /\.csv$/);
  // Simulate WebView eviction: start a fresh browser context with no localStorage/IndexedDB.
  const saved = { ...disk };
  await context.close();
  const restored = await browser.newContext({
    viewport: { width: 412, height: 915 },
  });
  await restored.route("**/routeFareList.min.json", (r) =>
    r.fulfill({ json: data }),
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
  assert.equal(await p.locator("#surveyor").inputValue(), "Android surveyor");
  assert.equal(await p.locator("#vehicle").inputValue(), "AB1234");
  assert.equal(await p.locator("#active").inputValue(), "1");
  assert.equal(
    await p.locator('[data-i="0"] [data-f="onboard"]').inputValue(),
    "7",
  );
  await p.locator("#notes").fill("Offline edit retained");
  assert.match(
    await p.locator("#startStatus").innerText(),
    /Confirmed start: 2/,
  );
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.locator("#selected").scrollIntoViewIfNeeded();
  if (process.env.SCREENSHOT_PATH)
    await p.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Android bridge, route selection, GPS suggestion, labels, backward counts, CSV export and fresh-context restoration; no JS errors or horizontal overflow.",
  );
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
