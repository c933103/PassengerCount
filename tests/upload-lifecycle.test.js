import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uploadSurvey, uploadPayloadKey, uploadReceiptStatus } from '../upload.js';
import { deleteRecords } from '../record-deletion.js';
import { load, save } from '../storage.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const method = name => app.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
const sample = () => ({ id: 'A', date: '2026-10-10', status: 'completed', startIndex: 0,
  initialOnboard: '0', startsAtOrigin: true, endsAtTerminus: false, notes: 'current',
  route: { route: 'TEST', operator: 'kmb' }, stops: [{ id: 'stop', name: { en: 'Test', zh: '測試' } }],
  rows: [{ time: '12:00', boarding: '1', alighting: '0', onboard: '', recorded: true, skipped: {} }],
});
function fixture() {
  const originals = { fetch: globalThis.fetch, native: globalThis.PassengerCountAndroid };
  let disk = JSON.stringify({ version: 2, currentId: 'A', surveys: [sample()] });
  let failSave = false, failDelete = false;
  const bridge = {
    get: () => disk,
    set: (_key, value) => { if (failSave === 'throw') throw Error('Synthetic storage failure'); if (failSave) return false; disk = value; return true; },
    deleteTrack: () => !failDelete,
  };
  globalThis.PassengerCountAndroid = bridge;
  const elements = {}, initial = load(), snapshot = structuredClone(initial.surveys[0]);
  snapshot.notes = 'before edit';
  snapshot.rows[0].boarding = '9';
  const noop = () => {};
  const ctx = vm.createContext({ state: initial, save, uploadSurvey, uploadReceiptStatus, deleteRecords,
    window: { PassengerCountAndroid: bridge }, clone: structuredClone, uploadBusy: false,
    undoStack: [snapshot], redoStack: [], historyId: 'A', historyCurrent: structuredClone(initial.surveys[0]),
    screen: 'record', map: null, deleteMode: false, selectedRecordIds: new Set(), pendingDeleteIds: [],
    $: id => elements[id] ||= { scrollIntoView: noop, close: noop }, t: key => key, rowObserved: () => true,
    buildStopOptions: noop, buildTable: noop, renderSetup: noop, renderCount: noop, renderRecord: noop,
    renderHome: noop, updateHistoryButtons: noop, setupMap: noop, showScreen: noop,
  });
  vm.runInContext('const deleting = id => state.deletingIds?.includes(id) === true;\n' +
    'const cur = () => state.surveys.find(s => s.id === state.currentId && !deleting(s.id));\n' +
    ['error', 'persist', 'renderUploadStatus', 'upload', 'restoreHistory', 'undo', 'redo', 'edit', 'confirmDelete'].map(method).join('\n'), ctx);
  const requests = [], replies = [], arrived = new Map();
  globalThis.fetch = (url, options) => new Promise(resolve => {
    requests.push({ table: String(url).split('/').at(-1), body: JSON.parse(options.body) });
    replies.push(resolve); arrived.get(requests.length)?.();
  });
  return { ctx, elements, requests,
    get current() { return ctx.state.surveys[0]; }, get disk() { return JSON.parse(disk); },
    wait(n) { return requests.length >= n ? Promise.resolve() : new Promise(resolve => arrived.set(n, resolve)); },
    reply(n, status = 201) { replies[n - 1](new Response(requests[n - 1].table === 'surveys' ? '[{"id":77}]' : '', { status })); },
    restart() { ctx.state = load(); ctx.uploadBusy = false; },
    failSave(value = true) { failSave = value; }, failDelete(value = true) { failDelete = value; },
    remove() { ctx.pendingDeleteIds = ['A']; ctx.confirmDelete(); },
    restore() { globalThis.fetch = originals.fetch; if (originals.native === undefined) delete globalThis.PassengerCountAndroid; else globalThis.PassengerCountAndroid = originals.native; },
  };
}
for (const phase of [1, 2]) {
  test(`Undo/Redo during deferred response ${phase} preserves live upload state through restart/retry`, async () => {
    const f = fixture();
    try {
      const live = f.current, run = f.ctx.upload();
      await f.wait(1);
      if (phase === 2) { f.reply(1); await f.wait(2); }
      const marker = live.upload;
      f.ctx.undo();
      assert.equal(f.current, live, 'Undo keeps the live object used by the pending upload');
      assert.equal(f.current.upload, marker, 'Undo cannot replace lifecycle metadata');
      assert.equal(f.disk.surveys[0].upload.uncertain, true);
      assert.equal(f.current.notes, 'before edit');
      f.ctx.redo(); assert.equal(f.current, live); assert.equal(f.current.notes, 'current');
      assert.equal(f.current.upload, marker);
      f.reply(phase);
      if (phase === 1) { await f.wait(2); f.reply(2); }
      await run;
      assert.equal(f.disk.surveys[0].upload.done, true);
      assert.equal(f.elements.uploadStatus.textContent, 'uploaded');
      // With data unchanged, restart alone cannot revive a completed upload.
      f.restart(); await f.ctx.upload();
      assert.equal(f.requests.length, 2);
    } finally { f.restore(); }
  });
}
test('a checkpoint failure after deferred Undo remains uncertain and cannot replay after restart', async () => {
  const f = fixture();
  try {
    const run = f.ctx.upload(); await f.wait(1); f.ctx.undo(); f.failSave(); f.reply(1); await run;
    assert.equal(f.requests.length, 1); assert.equal(f.current.upload.uncertain, true);
    assert.equal(f.disk.surveys[0].upload.uncertain, true);
    assert.notEqual(f.elements.uploadStatus.textContent, 'uploaded');
    f.failSave(false); f.restart(); await f.ctx.upload(); assert.equal(f.requests.length, 1);
  } finally { f.restore(); }
});
for (const phase of [1, 2]) {
  test(`deletion during deferred response ${phase} cannot continue or resurrect a completed upload`, async () => {
    const f = fixture();
    try {
      const run = f.ctx.upload(); await f.wait(1);
      if (phase === 2) { f.reply(1); await f.wait(2); }
      f.remove(); assert.equal(f.disk.surveys.length, 0);
      f.reply(phase); await run;
      assert.equal(f.requests.length, phase, 'removed survey causes no later request');
      assert.equal(f.disk.surveys.length, 0);
      assert.notEqual(f.elements.uploadStatus.textContent, 'uploaded');
      f.restart(); assert.equal(f.ctx.state.surveys.length, 0);
    } finally { f.restore(); }
  });
}
test('incomplete native deletion during the first response blocks passenger logs and stays pending after restart', async () => {
  const f = fixture();
  try {
    const run = f.ctx.upload(); await f.wait(1); f.failDelete(); f.remove();
    assert.deepEqual(f.disk.deletingIds, ['A']); f.reply(1); await run;
    assert.equal(f.requests.length, 1); assert.equal(f.disk.surveys[0].upload.uncertain, true);
    assert.notEqual(f.elements.uploadStatus.textContent, 'uploaded');
    f.restart(); assert.deepEqual(Array.from(f.ctx.state.deletingIds), ['A']);
    f.failDelete(false); f.remove(); assert.equal(f.disk.surveys.length, 0);
  } finally { f.restore(); }
});
for (const phase of [1, 2]) {
  test(`unexpected object replacement during deferred response ${phase} fails closed with the existing durable guard`, async () => {
    const f = fixture();
    try {
      const run = f.ctx.upload(); await f.wait(1);
      if (phase === 2) { f.reply(1); await f.wait(2); }
      const replacement = structuredClone(f.current);
      f.ctx.state.surveys[0] = replacement; f.ctx.persist();
      f.reply(phase); await run;
      assert.equal(f.requests.length, phase); assert.equal(f.current, replacement);
      assert.equal(f.disk.surveys[0].upload.uncertain, true);
      assert.notEqual(f.elements.uploadStatus.textContent, 'uploaded');
      f.restart(); await f.ctx.upload(); assert.equal(f.requests.length, phase);
    } finally { f.restore(); }
  });
}
test('history cannot inject a receipt, uncertainty flag or another trip ID', () => {
  const f = fixture();
  try {
    f.ctx.restoreHistory({ ...structuredClone(f.current), upload: { id: 777, done: true } }, []);
    assert.equal(f.current.upload, undefined);
    const live = f.current;
    f.ctx.restoreHistory({ ...structuredClone(live), id: 'other-trip' }, []);
    assert.equal(f.current, live); assert.equal(f.current.id, 'A');
  } finally { f.restore(); }
});

function mutate(f, action) {
  if (action === 'undo') f.ctx.undo();
  else if (action === 'redo') {
    const snapshot = structuredClone(f.current);
    snapshot.rows[0].boarding = '9'; snapshot.notes = 'before edit';
    f.ctx.redoStack = [snapshot]; f.ctx.redo();
  } else {
    f.current.rows[0].boarding = '9'; f.current.notes = 'before edit'; f.ctx.edit();
  }
}
function assertPostedRevision(f, marker, firstRequest = 1) {
  const payload = JSON.parse(marker.payloadKey);
  assert.deepEqual(f.requests[firstRequest - 1].body, payload.survey);
  const logs = f.requests[firstRequest];
  if (logs?.table === 'passenger_logs')
    assert.deepEqual(logs.body, payload.passengerLogs.map(x => ({ ...x, survey_id: 77 })));
}
for (const phase of [1, 2]) {
  for (const action of ['undo', 'edit']) {
    for (const storageFailure of [false, true, 'throw']) {
      test(`${action} without restoring data during response ${phase}, save failure ${storageFailure}, keeps a bound uncertain revision`, async () => {
        const f = fixture();
        try {
          const run = f.ctx.upload(); await f.wait(1);
          if (phase === 2) { f.reply(1); await f.wait(2); }
          mutate(f, action);
          assert.equal(f.disk.surveys[0].rows[0].boarding, '9');
          assert.equal(f.disk.surveys[0].notes, 'before edit');
          assert.equal(f.current.upload.uncertain, true, 'editing cannot clear an in-flight guard');
          f.failSave(storageFailure); f.reply(phase); await run;
          assert.equal(f.requests.length, phase, 'changed revision prevents later requests');
          assert.equal(f.current.upload.uncertain, true); assert.equal(f.current.upload.done, false);
          assert.equal(f.disk.surveys[0].upload.uncertain, true);
          assert.notEqual(f.elements.uploadStatus.textContent, 'uploaded');
          assertPostedRevision(f, f.current.upload);
          assert.notEqual(f.current.upload.payloadKey, uploadPayloadKey(f.current), 'receipt remains bound to submitted fields');
          f.failSave(false); f.restart(); await f.ctx.upload();
          assert.equal(f.requests.length, phase, 'restart never blindly retries the changed revision');
        } finally { f.restore(); }
      });
    }
  }
}
for (const phase of [1, 2]) {
  test(`rejection after relevant edit during response ${phase} does not erase the changed-data guard`, async () => {
    const f = fixture();
    try {
      const run = f.ctx.upload(); await f.wait(1);
      if (phase === 2) { f.reply(1); await f.wait(2); }
      mutate(f, 'edit'); f.reply(phase, 400); await run;
      assert.equal(f.requests.length, phase); assert.equal(f.disk.surveys[0].upload.uncertain, true);
      f.restart(); await f.ctx.upload(); assert.equal(f.requests.length, phase);
    } finally { f.restore(); }
  });
}
for (const action of ['undo', 'redo', 'edit']) {
  test(`confirmed completion followed by ${action} retains the immutable receipt and never submits another pair`, async () => {
    const f = fixture();
    try {
      const run = f.ctx.upload(); await f.wait(1); f.reply(1); await f.wait(2); f.reply(2); await run;
      const accepted = structuredClone(f.current), receipt = f.current.upload;
      const receiptBytes = JSON.stringify(receipt);
      assert.equal(receipt.done, true); assertPostedRevision(f, receipt);
      mutate(f, action);
      assert.equal(f.current.upload, receipt, 'editing keeps the accepted receipt object');
      assert.equal(JSON.stringify(f.disk.surveys[0].upload), receiptBytes);
      assert.equal(f.disk.surveys[0].rows[0].boarding, '9');
      assert.equal(f.disk.surveys[0].notes, 'before edit');
      assert.equal(f.elements.uploadStatus.textContent, 'uploadedEarlier');
      assert.equal(uploadReceiptStatus(f.current), 'changed');
      await f.ctx.upload();
      assert.equal(f.requests.length, 2, 'ordinary Upload does not silently create a second copy');
      const helperResult = await uploadSurvey(f.current, f.ctx.persist);
      assert.equal(helperResult.status, 'changed'); assert.equal(f.requests.length, 2);
      f.restart(); await f.ctx.upload();
      assert.equal(f.requests.length, 2); assert.equal(f.elements.uploadStatus.textContent, 'uploadedEarlier');
      assert.equal(f.current.upload.id, 77);
      assert.equal(JSON.stringify(f.current.upload), receiptBytes);
      // Returning editable data to its submitted version changes only status.
      f.ctx.restoreHistory(accepted, []);
      assert.equal(f.elements.uploadStatus.textContent, 'uploaded');
      assert.equal(JSON.stringify(f.current.upload), receiptBytes);
      await f.ctx.upload(); assert.equal(f.requests.length, 2);
    } finally { f.restore(); }
  });
}
for (const action of ['edit', 'undo', 'redo']) {
  test(`${action} of only non-uploaded data preserves a completed receipt`, async () => {
    const f = fixture();
    try {
      const run = f.ctx.upload(); await f.wait(1); f.reply(1); await f.wait(2); f.reply(2); await run;
      const receipt = f.current.upload;
      if (action === 'edit') { f.current.track = [{ lat: 0.1, lng: 0.2 }]; f.ctx.edit(); }
      else {
        const snapshot = structuredClone(f.current); snapshot.track = [{ lat: 0.1, lng: 0.2 }];
        if (action === 'undo') { f.ctx.undoStack = [snapshot]; f.ctx.undo(); }
        else { f.ctx.redoStack = [snapshot]; f.ctx.redo(); }
      }
      assert.equal(f.current.upload, receipt); assert.equal(f.disk.surveys[0].upload.done, true);
      f.restart(); await f.ctx.upload(); assert.equal(f.requests.length, 2);
    } finally { f.restore(); }
  });
}
test('a partial receipt with a changed or unknown revision cannot post passenger logs after restart', async () => {
  for (const bound of [true, false]) {
    const f = fixture();
    try {
      const marker = { id: 77, done: false, uncertain: false };
      if (bound) marker.payloadKey = uploadPayloadKey(f.current);
      f.current.upload = marker;
      f.current.rows[0].boarding = '9'; f.ctx.persist(); f.restart();
      await f.ctx.upload(); assert.equal(f.requests.length, 0);
      assert.equal(f.disk.surveys[0].upload.uncertain, true);
      f.restart(); await f.ctx.upload(); assert.equal(f.requests.length, 0);
    } finally { f.restore(); }
  }
});
test('legacy completed receipts survive Undo and report their unverified submitted version', async () => {
  const f = fixture();
  try {
    f.current.upload = { id: 77, done: true, uncertain: false };
    f.ctx.persist(); f.ctx.undo();
    assert.equal(f.disk.surveys[0].upload.id, 77);
    assert.equal(f.disk.surveys[0].upload.payloadKey, undefined);
    assert.equal(f.disk.surveys[0].rows[0].boarding, '9');
    assert.equal(f.elements.uploadStatus.textContent, 'uploadedUnverified');
    f.restart(); await f.ctx.upload(); assert.equal(f.requests.length, 0);
  } finally { f.restore(); }
});

test('completion for survey A cannot label a newly opened survey B as uploaded', async () => {
  const f = fixture();
  try {
    const run = f.ctx.upload(); await f.wait(1);
    const b = { ...structuredClone(f.current), id: 'B' }; delete b.upload;
    f.ctx.state.surveys.push(b); f.ctx.state.currentId = 'B';
    f.elements.uploadStatus.textContent = 'B has no upload';
    f.reply(1); await f.wait(2); f.reply(2); await run;
    assert.equal(f.disk.surveys[0].upload.done, true);
    assert.equal(f.disk.surveys[1].upload, undefined);
    assert.equal(f.elements.uploadStatus.textContent, 'B has no upload');
  } finally { f.restore(); }
});
for (const action of ['undo', 'redo', 'edit']) {
  for (const failure of [true, 'throw']) {
    test(`failed save of post-completion ${action} (${failure}) restores the matching completed revision on restart`, async () => {
      const f = fixture();
      try {
        const run = f.ctx.upload(); await f.wait(1); f.reply(1); await f.wait(2); f.reply(2); await run;
        const receiptBytes = JSON.stringify(f.current.upload);
        f.failSave(failure); mutate(f, action);
        assert.equal(JSON.stringify(f.current.upload), receiptBytes);
        assert.equal(f.elements.uploadStatus.textContent, 'uploadedEarlier');
        assert.equal(f.current.rows[0].boarding, '9');
        assert.equal(f.disk.surveys[0].rows[0].boarding, '1');
        assert.equal(f.disk.surveys[0].upload.done, true);
        assert.equal(f.elements.saveStatus.textContent, 'notSaved');
        f.failSave(false); f.restart(); await f.ctx.upload();
        assert.equal(f.current.upload.payloadKey, uploadPayloadKey(f.current));
        assert.equal(f.requests.length, 2, 'unsaved edits cannot turn restart into an unintended new upload');
      } finally { f.restore(); }
    });
  }
}
for (const action of ['undo', 'redo', 'edit']) {
  for (const id of [null, 77]) {
    test(`${action} preserves an existing uncertain receipt (${id}) byte-for-byte across restart`, async () => {
      const f = fixture();
      try {
        f.current.upload = { id, done: false, uncertain: true, payloadKey: uploadPayloadKey(f.current) };
        f.ctx.persist(); const receiptBytes = JSON.stringify(f.current.upload);
        mutate(f, action);
        assert.equal(JSON.stringify(f.current.upload), receiptBytes);
        assert.equal(JSON.stringify(f.disk.surveys[0].upload), receiptBytes);
        assert.equal(f.elements.uploadStatus.textContent, 'uploadUncertain');
        f.restart(); await f.ctx.upload();
        assert.equal(JSON.stringify(f.current.upload), receiptBytes);
        assert.equal(f.requests.length, 0);
        assert.equal(f.elements.uploadStatus.textContent, 'uploadUncertain');
      } finally { f.restore(); }
    });
  }
}
