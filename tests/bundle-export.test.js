import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { makeExportBundle, withBundleChart } from '../export.js';
import { makeGpx } from '../fieldkit.js';
import { importNativeTrack } from '../native-track.js';
import { migrateSurvey } from '../survey.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const chart = fs.readFileSync(new URL('../charts.js', import.meta.url), 'utf8');
const methods = ['syncNativeTrack', 'updateExportControls', 'exportResult', 'exportFilename', 'download', 'downloadGpx', 'saveChart'].map(name => {
  const method = app.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(method, `actual ${name} handler exists`);
  return method[0];
}).join('\n');
const encoder = chart.match(/export async function chartPng\([^]*?\n\}/)[0].replace('export ', '');
const initialTime = '2026-10-10T00:00:00.000Z';
const expectedBase = 'bus-A1-2026-10-09-AAAAAAAA-20261010T000000000Z';
const A = () => migrateSurvey({
  id: 'AAAAAAAA-1111', date: '2026-10-09', route: { route: 'A1', operator: 'ctb', serviceType: 'R1' },
  status: 'completed', startIndex: 0, endIndex: 0, initialOnboard: '', finalOnboard: '',
  stops: [{ id: 's0', name: { en: 'A stop' }, zone: 'A' }],
  rows: [{ time: '08:00', observedAt: '2026-10-09T08:00:00+08:00', boarding: '3', alighting: '0', onboard: '', recorded: true, skipped: {}, notes: '' }],
  track: [], weatherHistory: [{ emoji: '☀️' }],
});
function fixture({ native = true, failSave = false, throwBridge = false } = {}) {
  const original = A(), catalogue = { fares: { R1: [{ origin: 'A', destination: 'A', price: 5, currency: 'HKD' }] } };
  let current = original, now = initialTime, chartIdentity = 'chart-A', drawn, persisted;
  const pending = [], bundles = [], singles = [], downloads = [], blobs = new Map();
  const elements = Object.fromEntries(['csv', 'gpx', 'saveChart', 'exportStatus', 'chart'].map(id => [id, {
    disabled: false, textContent: '', classList: { toggle(key, value) { this[key] = value; } },
  }]));
  elements.chart.querySelector = () => ({ identity: chartIdentity, viewBox: { baseVal: { width: 320, height: 320 } } });
  const journal = [{ nativeId: 'tail-A', lat: 22.3, lng: 114.1, time: '2026-10-09T00:00:00Z', speed: null, heading: null, source: 'gps' }];
  const bridge = native ? {
    getTrackPage: (id, cursor) => JSON.stringify({ points: cursor ? [] : journal, cursor: '1', more: false }),
    saveBundle: (folder, base, csv, json, gpx, pngBase64) => {
      if (throwBridge) throw Error('bridge unavailable');
      bundles.push({ folder, base, csv, json, gpx, pngBase64 });
    },
    savePng: (...args) => singles.push(args), saveGpx: (...args) => singles.push(args),
  } : undefined;
  const context = vm.createContext({
    nativeExportPending: false, chartExportPending: false, screen: 'record',
    $: id => elements[id], cur: () => current, data: catalogue, t: key => key,
    window: { PassengerCountAndroid: bridge }, makeExportBundle, withBundleChart, makeGpx, importNativeTrack,
    persist: () => { if (failSave) return false; persisted = structuredClone(original); return true; },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
    Image: class { decode() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); } },
    XMLSerializer: class { serializeToString(node) { return node.identity; } },
    document: { createElement: () => ({ getContext: () => ({ drawImage(image) { drawn = decodeURIComponent(image.src.split(',')[1]); } }),
      toDataURL: () => `data:image/png;base64,${Buffer.from(drawn).toString('base64')}` }) },
    URL: { createObjectURL: blob => { const id = `blob:${blobs.size}`; blobs.set(id, blob); return id; }, revokeObjectURL() {} },
    Blob, setTimeout() {}, browserDownload: (url, name) => downloads.push({ url, name }),
  });
  vm.runInContext(`const deleting = () => false;\n${encoder}\n${methods}`, context);
  return {
    elements, pending, bundles, singles, downloads, blobs, original, catalogue, context,
    start: () => vm.runInContext('download()', context),
    invoke: code => vm.runInContext(code, context),
    result(value) { context.result = value; vm.runInContext('exportResult(result)', context); },
    navigate(home = false) { current = home ? null : { ...A(), id: 'BBBBBBBB-2222', route: { route: 'B2' } }; chartIdentity = 'chart-B'; },
    mutate() { original.id = 'BBBBBBBB-2222'; original.date = '2026-10-10'; original.route.route = 'B2'; original.rows[0].boarding = '99'; original.weatherHistory[0].emoji = '🌧️'; original.track.push({ lat: 1, lng: 2 }); catalogue.fares.R1[0].price = 99; },
    later() { now = '2026-10-10T01:00:00.000Z'; },
    allowSave() { failSave = false; }, allowBridge() { throwBridge = false; },
    persisted: () => persisted,
  };
}
function controls(f, disabled) {
  for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(f.elements[id].disabled, disabled, `${id} disabled=${disabled}`);
}
async function contents(f) {
  if (f.bundles.length) return f.bundles.at(-1);
  const found = Object.fromEntries(await Promise.all(f.downloads.map(async ({ url, name }) => [name.split('.').at(-1),
    url.startsWith('blob:') ? await f.blobs.get(url).text() : url.split(',')[1]])));
  return { base: f.downloads[0].name.slice(0, -4), csv: found.csv, json: found.json, gpx: found.gpx, pngBase64: found.png };
}
for (const native of [false, true]) {
  for (const destination of ['B', 'Home', 'mutation']) {
    test(`${native ? 'native' : 'browser'} bundle freezes all data and timestamp before PNG decoding across ${destination}`, async () => {
      const f = fixture({ native }), done = f.start();
      controls(f, true); assert.equal(f.pending.length, 1);
      if (destination === 'mutation') f.mutate(); else f.navigate(destination === 'Home');
      f.later(); f.pending[0].resolve(); await done;
      const bundle = await contents(f), record = JSON.parse(bundle.json);
      assert.equal(bundle.base, expectedBase);
      assert.equal(record.files.chart, `${expectedBase}.png`);
      assert.equal(record.exportedAt, initialTime);
      assert.equal(record.survey.id, 'AAAAAAAA-1111');
      assert.equal(record.survey.route.route, 'A1');
      assert.equal(record.survey.rows[0].boarding, '3');
      assert.equal(record.survey.weatherHistory[0].emoji, '☀️');
      assert.equal(record.survey.metrics.fare, 15);
      assert.equal(record.track.points, native ? 1 : 0);
      assert.equal((bundle.gpx.match(/<trkpt /g) || []).length, native ? 1 : 0);
      assert.match(bundle.csv, /A1/); assert.doesNotMatch(bundle.csv, /B2/);
      assert.equal(Buffer.from(bundle.pngBase64, 'base64').toString(), 'chart-A');
      if (native) { controls(f, true); f.result({ ok: true, path: '/trip-folder' }); }
      controls(f, false);
    });
  }
  test(`${native ? 'native' : 'browser'} optional PNG decode failure still exports the frozen CSV/JSON/GPX record`, async () => {
    const f = fixture({ native }), done = f.start(); f.navigate();
    f.pending[0].reject(Error('controlled decode failure')); await done;
    const bundle = await contents(f);
    assert.equal(bundle.base, expectedBase);
    assert.equal(JSON.parse(bundle.json).survey.id, 'AAAAAAAA-1111');
    assert.equal(bundle.pngBase64 || '', '');
    assert.equal(JSON.parse(bundle.json).files.chart, null);
    assert.equal(f.pending.length, 1);
    if (native) f.result({ ok: true, path: '/trip-folder' });
    else assert.equal(f.downloads.length, 3);
    controls(f, false);
  });
}
test('failed acknowledged journal persistence blocks bundle and leaves tail/cursor retryable', async () => {
  const f = fixture({ failSave: true }); await f.start();
  assert.equal(f.pending.length, 0); assert.equal(f.bundles.length, 0);
  assert.equal(f.original.nativeTrackCursor, undefined); assert.deepEqual(f.original.track, []);
  assert.equal(f.elements.exportStatus.textContent, 'exportFailed'); controls(f, false);
  f.allowSave(); const retry = f.start();
  assert.equal(f.persisted().track.length, 1); assert.equal(f.persisted().nativeTrackCursor, '1');
  f.pending[0].resolve(); await retry;
  assert.equal(JSON.parse(f.bundles[0].json).track.points, 1);
});
test('all repeated handlers are gated during encoding and through native bundle settlement', async () => {
  const f = fixture(), done = f.start();
  await f.invoke('download(); downloadGpx(); saveChart()');
  assert.equal(f.pending.length, 1); assert.equal(f.singles.length, 0);
  f.pending[0].resolve(); await done; controls(f, true);
  await f.invoke('download(); downloadGpx(); saveChart()');
  assert.equal(f.pending.length, 1); assert.equal(f.bundles.length, 1); assert.equal(f.singles.length, 0);
  f.result({ ok: true }); controls(f, false);
});
for (const result of [{ ok: true }, { ok: false }, { uncertain: true }]) {
  test(`late native ${JSON.stringify(result)} cannot unlock a bundle encoder`, async () => {
    const f = fixture(), done = f.start(); f.result(result); controls(f, true);
    await f.start(); assert.equal(f.pending.length, 1);
    f.pending[0].resolve(); await done; controls(f, true);
    f.result({ ok: true }); controls(f, false);
  });
  test(`native ${JSON.stringify(result)} settlement never automatically replays and permits explicit retry`, async () => {
    const f = fixture(), done = f.start(); f.pending[0].resolve(); await done;
    f.result(result); f.result(result); controls(f, false); assert.equal(f.bundles.length, 1);
    assert.equal(f.elements.exportStatus.textContent, result.uncertain ? 'exportUncertain' : result.ok ? 'exportSaved' : 'exportFailed');
    f.navigate(); const retry = f.start(); f.pending[1].resolve(); await retry;
    assert.equal(f.bundles.length, 2); assert.match(f.bundles[1].base, /^bus-B2-/);
  });
}
test('synchronous native bridge failure clears both gates for an explicit retry', async () => {
  const f = fixture({ throwBridge: true }), done = f.start(); f.pending[0].resolve(); await done;
  controls(f, false); assert.equal(f.elements.exportStatus.textContent, 'exportFailed');
  f.allowBridge(); const retry = f.start(); f.pending[1].resolve(); await retry;
  assert.equal(f.bundles.length, 1); controls(f, true);
});
test('restored native pending state blocks all handlers without encoding or re-enqueue', async () => {
  const f = fixture(); f.result({ pending: true });
  await f.invoke('download(); downloadGpx(); saveChart()'); controls(f, true);
  assert.equal(f.pending.length, 0); assert.equal(f.bundles.length, 0); assert.equal(f.singles.length, 0);
});
