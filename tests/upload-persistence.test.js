import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uploadSurvey, uploadPayloadKey, uploadReceiptStatus } from '../upload.js';
import { load, save } from '../storage.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const extract = name => app.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
const sample = () => ({
  id: 'fixture-trip', date: '2026-10-10', status: 'completed',
  startIndex: 0, initialOnboard: '0', startsAtOrigin: true, endsAtTerminus: false,
  route: { route: 'TEST', operator: 'kmb' },
  stops: [{ id: 'stop', name: { zh: '測試', en: 'Fixture' } }],
  rows: [{ time: '12:00', boarding: '1', alighting: '0', onboard: '', recorded: true, skipped: {} }],
});

function fixture({ mode = 'android-false', failAt = 0, response } = {}) {
  const originals = Object.fromEntries(['fetch', 'PassengerCountAndroid', 'localStorage'].map(k => [k, globalThis[k]]));
  let durable = JSON.stringify({ version: 2, currentId: null, surveys: [sample()] });
  let writes = 0;
  const write = (_key, value) => {
    if (++writes === failAt) {
      if (mode.endsWith('false')) return false;
      throw Error('Synthetic storage failure');
    }
    durable = value;
    return true;
  };
  delete globalThis.PassengerCountAndroid;
  if (mode.startsWith('android')) globalThis.PassengerCountAndroid = { get: () => durable, set: write };
  globalThis.localStorage = { getItem: () => durable, setItem: write };
  const elements = {};
  const ctx = vm.createContext({
    state: load(), save, uploadSurvey, uploadReceiptStatus, uploadBusy: false,
    $: id => elements[id] ||= {}, t: s => s, rowObserved: () => true,
  });
  vm.runInContext('const deleting = id => state.deletingIds?.includes(id) === true;\nfunction cur() { return state.surveys[0]; }\n' + extract('error') + '\n' + extract('persist') + '\n' + extract('renderUploadStatus') + '\n' + extract('upload'), ctx);
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    // Transport is replaced for every case; no request reaches a live service.
    requests.push(JSON.parse(options.body));
    if (response) return response(requests.length);
    return new Response(requests.length === 1 && !requests[0][0].survey_id ? '[{"id":77}]' : '', { status: 201 });
  };
  const checkpoint = () => {
    if (mode.startsWith('direct')) {
      if (++writes === failAt) {
        if (mode.endsWith('false')) return false;
        throw Error('Synthetic callback failure');
      }
      durable = JSON.stringify(ctx.state);
      return undefined; // Legacy save callbacks intentionally have no return value.
    }
    return ctx.persist();
  };
  return {
    ctx, requests, elements,
    get survey() { return ctx.state.surveys[0]; },
    get disk() { return JSON.parse(durable).surveys[0]; },
    run: () => uploadSurvey(ctx.state.surveys[0], checkpoint),
    restart() { ctx.state = JSON.parse(durable); },
    restore() { for (const [key, value] of Object.entries(originals)) value === undefined ? delete globalThis[key] : globalThis[key] = value; },
  };
}

for (const mode of ['android-false', 'android-throw', 'browser-throw', 'direct-false', 'direct-throw']) {
  for (const phase of [1, 2, 3, 4]) {
    test(`${mode}: checkpoint ${phase} gates requests and restart`, async () => {
      const f = fixture({ mode, failAt: phase });
      try {
        await assert.rejects(f.run(), /could not be saved/);
        assert.equal(f.requests.length, [0, 0, 1, 1, 2][phase]);
        assert.notEqual(f.survey.upload?.done, true);
        if (phase === 2 || phase === 4) {
          assert.equal(f.survey.upload.uncertain, true);
          assert.equal(f.disk.upload.uncertain, true);
          assert.equal(f.survey.upload.id, 77);
          await assert.rejects(f.run(), /unconfirmed/);
          f.restart();
          await assert.rejects(f.run(), /unconfirmed/);
          assert.equal(f.requests.length, phase === 2 ? 1 : 2);
        } else {
          assert.notEqual(f.survey.upload?.uncertain, true);
          f.restart();
          await f.run();
          assert.equal(f.requests.length, 2, 'only the safely unsent requests are retried');
          assert.equal(f.disk.upload.done, true);
          f.restart();
          await f.run();
          assert.equal(f.requests.length, 2, 'durably completed uploads are idempotent locally');
        }
      } finally { f.restore(); }
    });
  }
}

for (const failedRequest of [1, 2]) {
  for (const mode of ['android-false', 'android-throw', 'browser-throw', 'direct-false', 'direct-throw']) {
    test(`${mode}: failed rejection checkpoint for request ${failedRequest} keeps the durable guard`, async () => {
      const f = fixture({ mode, failAt: failedRequest === 1 ? 2 : 4,
        response: n => n === failedRequest ? new Response('{"message":"rejected"}', { status: 400 }) : new Response('[{"id":77}]', { status: 201 }),
      });
      try {
        await assert.rejects(f.run(), /could not be saved/);
        assert.equal(f.survey.upload.uncertain, true);
        assert.equal(f.disk.upload.uncertain, true);
        f.restart();
        await assert.rejects(f.run(), /unconfirmed/);
        assert.equal(f.requests.length, failedRequest);
      } finally { f.restore(); }
    });
  }
}

for (const failedRequest of [1, 2]) {
  test(`durably saved rejection for request ${failedRequest} permits only safe retry`, async () => {
    const f = fixture({ response: n => n === failedRequest ? new Response('{"message":"rejected"}', { status: 400 }) : new Response('[{"id":77}]', { status: 201 }) });
    try {
      await assert.rejects(f.run(), /rejected/);
      assert.equal(f.disk.upload.uncertain, false);
      f.restart(); await f.run();
      assert.equal(f.disk.upload.done, true);
      assert.equal(f.requests.length, 3);
    } finally { f.restore(); }
  });
}

for (const status of [408, 500, 503, 'network', 'invalid-json', 'missing-id']) {
  for (const failedRequest of status === 'invalid-json' || status === 'missing-id' ? [1] : [1, 2]) {
    test(`${status} on request ${failedRequest} remains uncertain across restart`, async () => {
      const f = fixture({ response: n => {
        if (n !== failedRequest) return new Response('[{"id":77}]', { status: 201 });
        if (status === 'network') throw Error('Connection interrupted');
        if (status === 'invalid-json') return new Response('{', { status: 201 });
        if (status === 'missing-id') return new Response('[]', { status: 201 });
        return new Response('{}', { status });
      } });
      try {
        await assert.rejects(f.run());
        assert.equal(f.survey.upload.uncertain, true);
        assert.equal(f.disk.upload.uncertain, true);
        f.restart(); await assert.rejects(f.run(), /unconfirmed/);
        assert.equal(f.requests.length, failedRequest);
      } finally { f.restore(); }
    });
  }
}

for (const phase of [1, 2, 3, 4]) {
  test(`production upload UI never claims completion when checkpoint ${phase} fails`, async () => {
    const f = fixture({ failAt: phase });
    try {
      await f.ctx.upload();
      assert.equal(f.elements.uploadStatus.textContent, phase === 2 || phase === 4 ? 'uploadUncertain' : '');
      assert.equal(f.elements.error.textContent, 'uploadError');
      assert.equal(f.elements.saveStatus.textContent, 'notSaved');
      assert.equal(f.elements.upload.disabled, false);
      assert.equal(f.ctx.uploadBusy, false);
    } finally { f.restore(); }
  });
}

test('production persistence acknowledges success before the UI claims completion', async () => {
  const f = fixture();
  try {
    await f.ctx.upload();
    assert.equal(f.disk.upload.done, true);
    assert.equal(f.elements.uploadStatus.textContent, 'uploaded');
    f.restart(); await f.ctx.upload();
    assert.equal(f.requests.length, 2);
  } finally { f.restore(); }
});

for (const id of [{}, [], true, false, '', '   ', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid response ID ${JSON.stringify(id)} keeps the request uncertain`, async () => {
    const f = fixture({ response: () => new Response(JSON.stringify([{ id }]), { status: 201 }) });
    try {
      await assert.rejects(f.run(), /no valid survey ID/);
      assert.equal(f.survey.upload.uncertain, true);
      f.restart(); await assert.rejects(f.run(), /unconfirmed/);
      assert.equal(f.requests.length, 1);
    } finally { f.restore(); }
  });
  test(`invalid saved ID ${JSON.stringify(id)} sends no requests`, async () => {
    const f = fixture();
    try {
      f.survey.upload = { id, done: false, uncertain: false };
      f.ctx.persist();
      await assert.rejects(f.run(), /invalid survey ID/);
      f.restart(); await assert.rejects(f.run(), /invalid survey ID/);
      assert.equal(f.requests.length, 0);
    } finally { f.restore(); }
  });
}
for (const id of [0, 77, -1, '0', 'fixture-uuid']) {
  for (const resumed of [false, true]) {
    test(`valid scalar ID ${JSON.stringify(id)} ${resumed ? 'resumes logs only' : 'uploads without conversion'}`, async () => {
      const f = fixture({ response: () => new Response(JSON.stringify([{ id }]), { status: 201 }) });
      try {
        if (resumed) { f.survey.upload = { id, done: false, uncertain: false, payloadKey: uploadPayloadKey(f.survey) }; f.ctx.persist(); }
        await f.run();
        assert.equal(f.requests.length, resumed ? 1 : 2);
        assert.equal(f.requests.at(-1)[0].survey_id, id);
        assert.equal(f.disk.upload.id, id);
        assert.equal(f.disk.upload.done, true);
        f.restart(); await f.run();
        assert.equal(f.requests.length, resumed ? 1 : 2);
      } finally { f.restore(); }
    });
  }
}
