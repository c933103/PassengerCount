import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Run the actual app handlers and chart encoder with a controlled Image.decode.
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const chart = fs.readFileSync(new URL("../charts.js", import.meta.url), "utf8");
const handlers = ["updateExportControls", "exportFilename", "saveChart"].map(name => {
  const match = app.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `actual ${name} handler exists`);
  return match[0];
}).join("\n");
const encoder = chart.match(/export async function chartPng\([^]*?\n\}/)[0].replace("export ", "");
const A = { id: "AAAAAAAA-1111", date: "2026-10-08", route: { route: "A1" } };
const B = { id: "BBBBBBBB-2222", date: "2026-10-09", route: { route: "B2" } };
const filenameA = "bus-A1-2026-10-08-AAAAAAAA-2026-10-09T07-00-00-000Z.png";

function fixture(native = false) {
  let current = structuredClone(A), now = "2026-10-09T07:00:00.000Z", drawn;
  const svg = identity => ({ identity, viewBox: { baseVal: { width: 320, height: 320 } } });
  let selectedSvg = svg("chart-A");
  const elements = {
    csv: { disabled: false }, gpx: { disabled: false },
    saveChart: { disabled: false }, exportStatus: { textContent: "" },
    chart: { querySelector: () => selectedSvg },
  };
  const pending = [], downloads = [], failures = [];
  const context = vm.createContext({
    nativeExportPending: false, chartExportPending: false,
    $: id => elements[id], cur: () => current, t: value => value,
    Date: class extends Date { constructor() { super(now); } },
    window: { PassengerCountAndroid: native ? {
      savePng: (bytes, filename) => {
        downloads.push({ bytes, filename });
        context.nativeExportPending = false; // Simulated native completion.
      },
    } : undefined },
    browserDownload: (png, filename) => downloads.push({ bytes: png.split(",")[1], filename }),
    exportResult: result => { failures.push(result.ok); context.nativeExportPending = false; },
    Image: class { decode() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); } },
    XMLSerializer: class { serializeToString(node) { return node.identity; } },
    document: { createElement(tag) {
      assert.equal(tag, "canvas");
      return {
        getContext: () => ({ drawImage(image) { drawn = decodeURIComponent(image.src.split(",")[1]); } }),
        toDataURL: () => `data:image/png;base64,${Buffer.from(drawn).toString("base64")}`,
      };
    } },
  });
  vm.runInContext(`${encoder}\n${handlers}`, context);
  return {
    elements, pending, downloads, failures,
    start: () => vm.runInContext("saveChart()", context),
    navigate(next) { current = next && structuredClone(next); selectedSvg = next && svg(`chart-${next === B ? "B" : "A"}`); },
    editIdentity() { current.id = B.id; current.route.route = B.route.route; current.date = B.date; },
    later() { now = "2026-10-09T07:01:00.000Z"; },
  };
}

for (const native of [false, true]) {
  for (const destination of ["record B", "Home"]) {
    test(`${native ? "native" : "browser"} PNG keeps chart A identity after navigating to ${destination} during decode`, async () => {
      const f = fixture(native), done = f.start();
      assert.equal(f.elements.saveChart.disabled, true);
      assert.equal(f.pending.length, 1);
      f.navigate(destination === "Home" ? null : B);
      f.later();
      f.pending[0].resolve(); await done;
      assert.deepEqual(f.failures, [], "navigation must not turn the pending export into a failure");
      assert.deepEqual(f.downloads, [{ bytes: Buffer.from("chart-A").toString("base64"), filename: filenameA }]);
      assert.equal(f.elements.saveChart.disabled, false);
    });
  }
  test(`${native ? "native" : "browser"} PNG freezes filename values before decode, not a mutable survey reference`, async () => {
    const f = fixture(native), done = f.start();
    f.editIdentity(); f.later(); f.pending[0].resolve(); await done;
    assert.equal(f.downloads[0].filename, filenameA);
  });
}

test("decode failure after navigation reports failure, re-enables export and allows retry", async () => {
  const f = fixture(), failed = f.start();
  f.navigate(B); f.pending[0].reject(Error("decode fixture")); await failed;
  assert.deepEqual(f.failures, [false]);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.elements.saveChart.disabled, false);
  const retry = f.start(); f.pending[1].resolve(); await retry;
  assert.equal(f.downloads.length, 1);
  assert.match(f.downloads[0].filename, /^bus-B2-2026-10-09-BBBBBBBB-/);
  assert.equal(Buffer.from(f.downloads[0].bytes, "base64").toString(), "chart-B");
  assert.equal(f.elements.saveChart.disabled, false);
});

test("missing chart reports failure and leaves the export button usable", async () => {
  const f = fixture(); f.elements.chart.querySelector = () => null;
  await f.start();
  assert.deepEqual(f.failures, [false]);
  assert.equal(f.pending.length, 0);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.elements.saveChart.disabled, false);
});
