import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const methods = ['updateExportControls', 'exportResult'].map(name =>
  app.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture() {
  const elements = Object.fromEntries(['csv', 'gpx', 'saveChart', 'exportStatus'].map(id => [id, {
    disabled: false, textContent: '', classList: { toggle(key, value) { this[key] = value; } },
  }]));
  const context = vm.createContext({
    nativeExportPending: false, chartExportPending: false,
    $: id => elements[id], t: key => key, screen: 'home',
  });
  vm.runInContext(methods, context);
  return { elements, context, result(value) { context.result = value; vm.runInContext('exportResult(result)', context); } };
}
for (const ok of [true, false]) {
  test(`restored in-flight export holds controls until ${ok ? 'success' : 'failure'} reaches the page`, () => {
    const f = fixture(); f.result({ pending: true });
    for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(f.elements[id].disabled, true);
    assert.equal(f.elements.exportStatus.textContent, 'exporting');
    assert.equal(f.elements.exportStatus.classList.warning, false);
    f.result({ ok, path: 'A.csv' });
    for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(f.elements[id].disabled, false);
    assert.equal(f.elements.exportStatus.textContent, ok ? 'exportSaved' : 'exportFailed');
    assert.equal(f.elements.exportStatus.classList.warning, !ok);
  });
}
test('late native completion cannot unlock an unfinished PNG encoder', () => {
  const f = fixture(); f.context.chartExportPending = true; f.result({ ok: true });
  for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(f.elements[id].disabled, true);
  f.context.chartExportPending = false;
  vm.runInContext('updateExportControls()', f.context);
  for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(f.elements[id].disabled, false);
});


test('uncertain saved-file outcome asks for a folder check before another export', () => {
  const f = fixture(); f.result({ uncertain: true });
  assert.equal(f.elements.exportStatus.textContent, 'exportUncertain');
  assert.equal(f.elements.exportStatus.classList.warning, true);
  for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(f.elements[id].disabled, false);
});
