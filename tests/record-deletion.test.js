import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deleteRecords } from '../record-deletion.js';
import { load, save } from '../storage.js';

const sample = () => ({ version: 2, currentId: 'A', screen: 'count',
  surveys: ['A', 'B', 'C'].map(id => ({ id, status: 'in_progress', track: [{ lat: 0, lng: 0 }] })),
});
function fixture({ failSave = 0, failId, throwing = false, browser = false } = {}) {
  const originals = { native: globalThis.PassengerCountAndroid, local: globalThis.localStorage };
  let durable = JSON.stringify(sample()), writes = 0, cleanupFailure = failId;
  const journals = new Set(['A', 'B', 'C']), calls = [];
  const write = (_key, value) => {
    if (++writes === failSave) { if (throwing) throw Error('Storage failed'); return false; }
    durable = value; return true;
  };
  globalThis.PassengerCountAndroid = { get: () => durable, set: write };
  let state = load();
  const bridge = browser ? null : { deleteTrack(id) {
    calls.push(id);
    assert.deepEqual(JSON.parse(durable).deletingIds, state.deletingIds, 'intent is durable before cleanup');
    if (id === cleanupFailure) { if (throwing) throw Error('Cleanup failed'); return false; }
    journals.delete(id); return true;
  } };
  return {
    calls, journals, bridge,
    get state() { return state; }, get disk() { return JSON.parse(durable); },
    run: (ids = ['A', 'B']) => deleteRecords(state, ids, bridge, save),
    restart() { state = load(); }, recover() { cleanupFailure = undefined; },
    restore() {
      if (originals.native === undefined) delete globalThis.PassengerCountAndroid;
      else globalThis.PassengerCountAndroid = originals.native;
      if (originals.local === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = originals.local;
    },
  };
}
for (const throwing of [false, true]) {
  for (const failSave of [1, 2]) {
    test(`${throwing ? 'throwing' : 'false'} storage checkpoint ${failSave} remains retryable across restart`, () => {
      const f = fixture({ throwing, failSave });
      try {
        assert.throws(() => f.run());
        assert.equal(f.state.surveys.length, 3);
        assert.equal(f.disk.surveys.length, 3);
        if (failSave === 1) {
          assert.deepEqual(f.calls, []); assert.equal(f.state.deletingIds, undefined);
          assert.equal(f.journals.size, 3);
        } else {
          assert.deepEqual(f.state.deletingIds, ['A', 'B']);
          assert.deepEqual(f.disk.deletingIds, ['A', 'B']);
          assert.deepEqual([...f.journals], ['C']);
          assert.equal(f.state.currentId, null);
        }
        f.restart(); f.run();
        assert.deepEqual(f.disk.surveys.map(s => s.id), ['C']);
        assert.deepEqual(f.state.deletingIds, []);
        assert.deepEqual([...f.journals], ['C']);
        f.restart(); f.run([]);
        assert.deepEqual(f.disk.surveys.map(s => s.id), ['C']);
      } finally { f.restore(); }
    });
  }
  for (const failId of ['A', 'B']) {
    test(`${throwing ? 'throwing' : 'false'} cleanup for ${failId} preserves pending selection through restart`, () => {
      const f = fixture({ throwing, failId });
      try {
        assert.throws(() => f.run());
        assert.equal(f.state.surveys.length, 3);
        assert.deepEqual(f.disk.deletingIds, ['A', 'B']);
        assert.equal(f.journals.has('A'), failId === 'A');
        assert.equal(f.journals.has('B'), true);
        assert.equal(f.journals.has('C'), true);
        f.restart(); f.recover(); f.run([]);
        assert.deepEqual(f.disk.surveys.map(s => s.id), ['C']);
        assert.deepEqual([...f.journals], ['C']);
      } finally { f.restore(); }
    });
  }
}
test('successful native cleanup is idempotent and preserves unrelated trip bytes', () => {
  const f = fixture();
  try {
    const untouched = JSON.stringify(f.state.surveys[2]);
    f.run();
    assert.deepEqual(f.calls, ['A', 'B']);
    assert.equal(JSON.stringify(f.disk.surveys[0]), untouched);
    assert.deepEqual([...f.journals], ['C']);
    f.restart(); f.run([]);
    assert.deepEqual(f.calls, ['A', 'B']);
  } finally { f.restore(); }
});
test('an unavailable or older native bridge cannot silently discard pending cleanup', () => {
  const state = sample(); let writes = 0;
  assert.throws(() => deleteRecords(state, ['A'], {}, () => writes++), /unavailable/);
  assert.equal(writes, 0); assert.equal(state.surveys.length, 3);
  state.deletingIds = ['A'];
  assert.throws(() => deleteRecords(state, [], null, () => writes++), /unavailable/);
  assert.equal(writes, 0);
});
test('browser deletion remains one atomic workspace write without a native journal', () => {
  const f = fixture({ browser: true });
  try { f.run(); assert.equal(f.disk.surveys.length, 1); assert.deepEqual(f.calls, []); }
  finally { f.restore(); }
});
test('an explicitly false direct save callback is a failure before native cleanup', () => {
  const state = sample();
  assert.throws(() => deleteRecords(state, ['A'], { deleteTrack() { assert.fail('cleanup before save'); } }, () => false));
  assert.equal(state.surveys.length, 3); assert.equal(state.deletingIds, undefined);
});

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const method = name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
function page(f) {
  const elements = {}; let closed = false, home = false, imports = 0, starts = 0;
  const context = vm.createContext({ state: f.state, pendingDeleteIds: ['A', 'B'], selectedRecordIds: new Set(['A', 'B']),
    deleteMode: true, screen: "home", deleteRecords, save, window: { PassengerCountAndroid: { ...f.bridge, startTracking() { starts++; } } },
    $: id => elements[id] ||= { scrollIntoView() {}, close() { closed = true; } },
    t: key => key, renderHome() {}, showScreen() { home = true; }, error(message) { elements.error = message; },
    importNativeTrack() { imports++; }, persist() {}, cur: () => f.state.surveys[0],
  });
  vm.runInContext('const deleting = id => state.deletingIds?.includes(id) === true;\n' +
    ['confirmDelete', 'resumePendingDeletion', 'syncNativeTrack', 'startNativeTracking', 'openSurvey'].map(method).join('\n'), context);
  return { context, elements, get closed() { return closed; }, get home() { return home; }, get imports() { return imports; }, get starts() { return starts; } };
}
test('production deletion flow reports partial cleanup honestly, blocks open/replay, and recovers', () => {
  const f = fixture({ failId: 'B' });
  try {
    const p = page(f); p.context.confirmDelete();
    assert.equal(p.elements.deleteError.textContent, 'deleteIncomplete');
    assert.equal(p.closed, false); assert.equal(p.home, false);
    p.context.openSurvey('A', 'resume');
    assert.equal(f.state.currentId, null);
    p.context.syncNativeTrack(f.state.surveys[0]);
    p.context.startNativeTracking(f.state.surveys[0]);
    assert.equal(p.imports, 0); assert.equal(p.starts, 0);
    f.recover(); p.context.confirmDelete();
    assert.equal(p.closed, true); assert.equal(p.home, true);
    assert.equal(f.disk.surveys.length, 1);
  } finally { f.restore(); }
});
test('production startup retry retains a pending failure and later finishes without a new selection', () => {
  const f = fixture({ failId: 'A' });
  try {
    assert.throws(() => f.run()); f.restart(); const p = page(f);
    p.context.resumePendingDeletion(); assert.equal(p.elements.error, 'deleteIncomplete');
    f.recover(); p.context.resumePendingDeletion();
    assert.equal(f.disk.surveys.length, 1);
    assert.deepEqual(f.state.deletingIds, []);
  } finally { f.restore(); }
});
test('production initial save failure retains the original all-kept message', () => {
  const f = fixture({ failSave: 1 });
  try { const p = page(f); p.context.confirmDelete(); assert.equal(p.elements.deleteError.textContent, 'deleteFailed'); assert.equal(p.closed, false); }
  finally { f.restore(); }
});
