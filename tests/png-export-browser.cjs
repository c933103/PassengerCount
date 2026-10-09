const assert = require("assert/strict");
const fs = require("fs");

module.exports = async function pngExportIdentity({ open, sample }) {
  const survey = (letter, date) => ({
    ...structuredClone(sample), id: `png-${letter}-1111`, date, status: "completed", screen: "record",
    route: { ...sample.route, route: `PC-${letter}` },
  });
  const a = survey("A", "2026-09-14"), b = survey("B", "2026-09-15");
  const seed = { "passenger-count:workspace:v2": JSON.stringify({
    version: 2, currentId: a.id, screen: "record", language: "en", surveys: [a, b], search: {},
  }) };
  async function setup(native) {
    const opened = await open(seed, 360), { page } = opened;
    await page.locator("#recordScreen").waitFor();
    await page.waitForFunction(() => document.querySelector("#chart svg").viewBox.baseVal.width === document.querySelector("#chart").clientWidth);
    // A second real encoding of the original SVG must match the eventual bytes.
    const expected = await page.evaluate(async () => (await import("./charts.js")).chartPng(document.querySelector("#chart")));
    await page.evaluate((native) => {
      window.__pngSaves = [];
      if (native) {
        const savePng = window.PassengerCountAndroid.savePng;
        window.PassengerCountAndroid.savePng = (base64, name) => {
          window.__pngSaves.push({ base64, name });
          savePng(base64, name);
        };
      } else delete window.PassengerCountAndroid.savePng;
      window.__pngDecodes = [];
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        const decoded = decode.call(this);
        if (!this.src.startsWith("data:image/svg+xml")) return decoded;
        const gate = new Promise((resolve, reject) => window.__pngDecodes.push({ resolve, reject, src: this.src }));
        return Promise.all([decoded, gate]).then(() => undefined);
      };
    }, native);
    return { ...opened, expected: Buffer.from(expected.split(",")[1], "base64") };
  }
  async function navigate(page, destination) {
    await page.locator("#recordHome").click();
    if (destination === "B") await page.locator(`.recordCard[data-id="${b.id}"] button`).first().click();
    assert.equal(await page.locator(destination === "B" ? "#recordScreen" : "#homeScreen").isVisible(), true);
  }
  async function release(page, native, index = 0) {
    const download = native ? null : page.waitForEvent("download");
    await page.evaluate(i => window.__pngDecodes[i].resolve(), index);
    await page.waitForFunction(() => !document.querySelector("#saveChart").disabled);
    if (native) {
      const saved = await page.evaluate(() => window.__pngSaves.at(-1));
      assert.ok(saved, "native export completed");
      return { name: saved.name, bytes: Buffer.from(saved.base64, "base64") };
    }
    const file = await download;
    return { name: file.suggestedFilename(), bytes: fs.readFileSync(await file.path()) };
  }
  for (const native of [true, false]) {
    for (const destination of ["B", "Home"]) {
      const { context, page, expected } = await setup(native);
      try {
        await page.locator("#saveChart").click();
        assert.equal(await page.locator("#saveChart").isDisabled(), true);
        await page.evaluate(() => document.querySelector("#saveChart").click());
        assert.equal(await page.evaluate(() => window.__pngDecodes.length), 1, "disabled repeated click does not launch another encoder");
        assert.match(await page.evaluate(() => decodeURIComponent(window.__pngDecodes[0].src)), /PC-A/);
        await navigate(page, destination);
        assert.equal(await page.locator("#saveChart").isDisabled(), true, "navigation does not unlock the pending export");
        await page.clock.setFixedTime(new Date("2026-09-15T06:11:00Z"));
        const saved = await release(page, native);
        assert.equal(saved.name, `bus-PC-A-${a.date}-${a.id.slice(0, 8)}-2026-09-15T06-10-00-000Z.png`);
        assert.deepEqual(saved.bytes, expected, "actual PNG remains the original chart A");
        assert.equal(await page.locator(destination === "B" ? "#recordScreen" : "#homeScreen").isVisible(), true, "finishing export does not change navigation");
      } finally { await context.close(); }
    }
    const { context, page } = await setup(native);
    try {
      const downloads = [];
      page.on("download", file => downloads.push(file));
      await page.locator("#saveChart").click();
      await navigate(page, "B");
      await page.evaluate(() => window.__pngDecodes[0].reject(Error("controlled decode failure")));
      await page.waitForFunction(() => !document.querySelector("#saveChart").disabled);
      assert.match(await page.locator("#exportStatus").textContent(), /Export failed/);
      assert.equal(await page.evaluate(() => window.__pngSaves.length), 0);
      assert.equal(downloads.length, 0, "failed decoding does not publish a partial file");
      await page.locator("#saveChart").click();
      assert.equal(await page.evaluate(() => window.__pngDecodes.length), 2, "failed export can be retried");
      const saved = await release(page, native, 1);
      assert.equal(saved.name, `bus-PC-B-${b.date}-${b.id.slice(0, 8)}-2026-09-15T06-10-00-000Z.png`);
      assert.deepEqual([...saved.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(await page.locator("#exportStatus").evaluate(el => el.classList.contains("warning")), false);
    } finally { await context.close(); }
  }
  console.log("PASS: PC-003 real PNG decoding across record/Home navigation, frozen filenames and bytes, repeated clicks, decode failure and retry (native bridge and browser downloads).");
};
