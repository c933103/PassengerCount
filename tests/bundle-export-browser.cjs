const assert = require('assert/strict');
const fs = require('fs');

module.exports = async function bundleExportConsistency({ open, sample }) {
  const survey = (letter, date) => ({
    ...structuredClone(sample), id: `bundle-${letter}-1111`, date, status: 'completed', screen: 'record',
    route: { ...sample.route, route: `PC-${letter}` },
  });
  const a = survey('A', '2026-09-14'), b = survey('B', '2026-09-15');
  const seed = { 'passenger-count:workspace:v2': JSON.stringify({
    version: 2, currentId: a.id, screen: 'record', language: 'en', surveys: [a, b], search: {},
  }) };
  const expectedBase = `bus-PC-A-${a.date}-${a.id.slice(0, 8)}-20260915T061000000Z`;
  async function setup(native) {
    const opened = await open(seed, 360), { page } = opened;
    await page.locator('#recordScreen').waitFor();
    await page.waitForFunction(() => document.querySelector('#chart svg').viewBox.baseVal.width === document.querySelector('#chart').clientWidth);
    const expected = await page.evaluate(async () => (await import('./charts.js')).chartPng(document.querySelector('#chart')));
    await page.evaluate(native => {
      window.__bundleSaves = [];
      if (native) window.PassengerCountAndroid.saveBundle = (folder, base, csv, json, gpx, pngBase64) => {
        window.__bundleSaves.push({ folder, base, csv, json, gpx, pngBase64 });
        // Keep the bridge result pending until the test explicitly settles it.
      };
      else delete window.PassengerCountAndroid.saveBundle;
      window.__bundleDecodes = [];
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        const decoded = decode.call(this);
        if (!this.src.startsWith('data:image/svg+xml')) return decoded;
        const gate = new Promise((resolve, reject) => window.__bundleDecodes.push({ resolve, reject }));
        return Promise.all([decoded, gate]).then(() => undefined);
      };
    }, native);
    const downloads = [];
    page.on('download', file => downloads.push(file));
    function waitForFiles(count) {
      if (downloads.length >= count) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { page.off('download', check); reject(Error(`Expected ${count} bundle downloads, received ${downloads.length}`)); }, 30000);
        function check() { if (downloads.length >= count) { clearTimeout(timer); page.off('download', check); resolve(); } }
        page.on('download', check);
      });
    }
    return { ...opened, expected: Buffer.from(expected.split(',')[1], 'base64'), downloads, waitForFiles };
  }
  async function controls(page, disabled) {
    for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(await page.locator(`#${id}`).isDisabled(), disabled, `${id} disabled=${disabled}`);
  }
  async function navigate(page, destination) {
    await page.locator('#recordHome').click();
    if (destination === 'B') await page.locator(`.recordCard[data-id="${b.id}"] button`).first().click();
  }
  async function repeat(page) {
    await page.evaluate(() => { for (const id of ['csv', 'gpx', 'saveChart']) document.getElementById(id).click(); });
  }
  async function settle(page, detail) {
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('export-result', { detail })), detail);
  }
  for (const native of [true, false]) {
    for (const destination of ['B', 'Home', 'edit']) {
      const { context, page, expected, downloads, waitForFiles } = await setup(native);
      try {
        await page.locator('#csv').click(); await controls(page, true);
        await repeat(page);
        assert.equal(await page.evaluate(() => window.__bundleDecodes.length), 1);
        // A late prior result must not release the new encoder's controls.
        await settle(page, { ok: true, path: '/previous.csv' }); await controls(page, true);
        if (destination === 'edit') {
          await page.locator('#vehicleRecord').fill('UPDATED-AFTER-SNAPSHOT');
          assert.equal(await page.evaluate(() => JSON.parse(window.PassengerCountAndroid.get('passenger-count:workspace:v2')).surveys[0].vehicle), 'UPDATED-AFTER-SNAPSHOT');
        } else await navigate(page, destination);
        await page.clock.setFixedTime(new Date('2026-09-15T06:11:00Z'));
        await page.evaluate(() => window.__bundleDecodes[0].resolve());
        let saved;
        if (native) {
          await page.waitForFunction(() => window.__bundleSaves.length === 1);
          await controls(page, true); await repeat(page);
          assert.equal(await page.evaluate(() => window.__bundleSaves.length), 1);
          saved = await page.evaluate(() => window.__bundleSaves[0]);
          await settle(page, { ok: true, path: `/storage/emulated/0/Download/PaxCountRecord/${saved.folder}` });
        } else {
          await page.waitForFunction(() => !document.querySelector('#csv').disabled);
          await waitForFiles(4);
          assert.equal(downloads.length, 4, 'browser emits four companion files');
          saved = { base: expectedBase };
          for (const file of downloads) {
            const name = file.suggestedFilename(), extension = name.split('.').at(-1);
            assert.equal(name, `${expectedBase}.${extension}`);
            const bytes = fs.readFileSync(await file.path());
            saved[extension === 'png' ? 'pngBase64' : extension] = bytes.toString(extension === 'png' ? 'base64' : 'utf8');
          }
        }
        await controls(page, false);
        assert.equal(saved.base, expectedBase);
        const record = JSON.parse(saved.json);
        assert.equal(record.survey.id, a.id);
        assert.equal(record.survey.route.route, 'PC-A');
        assert.equal(record.exportedAt, '2026-09-15T06:10:00.000Z');
        assert.equal(record.files.chart, `${expectedBase}.png`);
        assert.notEqual(record.survey.vehicle, 'UPDATED-AFTER-SNAPSHOT');
        assert.deepEqual(Buffer.from(saved.pngBase64, 'base64'), expected);
        assert.equal(await page.locator(destination === 'Home' ? '#homeScreen' : '#recordScreen').isVisible(), true);
      } finally { await context.close(); }
    }
  }
  // A failed durable journal acknowledgement cannot publish a partial record.
  const { context, page } = await setup(true);
  try {
    await page.evaluate(() => window.__failSave = true);
    await page.locator('#csv').click();
    assert.equal(await page.evaluate(() => window.__bundleSaves.length), 0);
    assert.equal(await page.evaluate(() => window.__bundleDecodes.length), 0);
    assert.match(await page.locator('#exportStatus').textContent(), /Export failed/);
    await controls(page, false);
    await page.evaluate(() => window.__failSave = false);
    await page.locator('#csv').click();
    await page.evaluate(() => window.__bundleDecodes[0].reject(Error('optional PNG decode failure')));
    await page.waitForFunction(() => window.__bundleSaves.length === 1);
    assert.equal(await page.evaluate(() => window.__bundleSaves[0].pngBase64), '');
    assert.equal(await page.evaluate(() => JSON.parse(window.__bundleSaves[0].json).files.chart), null);
    await controls(page, true);
    await settle(page, { uncertain: true }); await controls(page, false);
    assert.match(await page.locator('#exportStatus').textContent(), /Check the export folder before exporting again/);
    assert.equal(await page.evaluate(() => window.__bundleSaves.length), 1, 'uncertainty never replays a bundle');
    await page.locator('#csv').click();
    await page.evaluate(() => window.__bundleDecodes[1].resolve());
    await page.waitForFunction(() => window.__bundleSaves.length === 2);
    await settle(page, { ok: false }); await controls(page, false);
  } finally { await context.close(); }
  console.log('PASS: PR3 bundle actual PNG/JSON/CSV/GPX identity across navigation/edits, frozen time, all repeated controls, late native result, failed journal persistence, optional PNG failure, uncertain outcome and explicit retry.');
};
