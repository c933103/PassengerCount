const assert = require('assert/strict');

module.exports = async function exportPermissionRecovery({ open, sample, getExports }) {
  for (const language of ['en', 'yue-Hant-HK']) {
    const survey = { ...structuredClone(sample), id: 'permission-retry', status: 'completed', screen: 'record' };
    const seed = {
      'passenger-count:workspace:v2': JSON.stringify({
        version: 2, currentId: survey.id, screen: 'record', language, surveys: [survey], search: {},
      }),
      // Exact durable fallback written before the Android 8–9 permission prompt.
      exportResult: '{"ok":false,"path":""}',
    };
    const before = getExports();
    const { context, page } = await open(seed, 360);
    try {
      await page.locator('#recordScreen').waitFor();
      assert.match(await page.locator('#exportStatus').textContent(), language === 'en'
        ? /Export failed\. Your trip remains saved\..*retry/ : /匯出失敗，行程記錄仍已儲存.*再試/);
      assert.equal(await page.locator('#exportStatus').evaluate(el => el.classList.contains('warning')), true);
      assert.deepEqual(getExports(), before, 'reloaded page never silently exports the interrupted request');
      const readSurvey = () => page.evaluate(() => JSON.parse(window.PassengerCountAndroid.get('passenger-count:workspace:v2')).surveys[0]);
      const retained = await readSurvey();
      assert.equal(retained.id, survey.id);
      assert.deepEqual(retained.rows, survey.rows, 'interrupted export preserves saved observations');
      await page.locator('#csv').click();
      await page.waitForFunction(() => /\.csv/.test(document.querySelector('#exportStatus').textContent));
      assert.match(await page.locator('#exportStatus').textContent(), /Download\/PaxCountRecord\/.*\.csv/);
      assert.equal((await readSurvey()).id, retained.id);
      assert.deepEqual((await readSurvey()).rows, retained.rows, 'explicit retry preserves the survey');
    } finally { await context.close(); }
    for (const ok of [true, false]) {
      const prior = getExports();
      const { context: resumedContext, page: resumed } = await open({ ...seed, exportResult: '{"pending":true}' }, 360);
      try {
        await resumed.locator('#recordScreen').waitFor();
        assert.equal(await resumed.locator('#exportStatus').textContent(), language === 'en' ? 'Saving…' : '正在儲存…');
        for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(await resumed.locator(`#${id}`).isDisabled(), true);
        await resumed.evaluate(() => {
          for (const id of ['csv', 'gpx', 'saveChart']) document.getElementById(id).click();
          window.dispatchEvent(new CustomEvent('export-result', { detail: { pending: true } }));
        });
        assert.deepEqual(getExports(), prior, 'recreated page cannot request a duplicate while the old native write runs');
        await resumed.evaluate(ok => {
          const detail = { ok, path: '/storage/emulated/0/Download/PaxCountRecord/original.csv' };
          window.dispatchEvent(new CustomEvent('export-result', { detail }));
          window.dispatchEvent(new CustomEvent('export-result', { detail }));
        }, ok);
        for (const id of ['csv', 'gpx', 'saveChart']) assert.equal(await resumed.locator(`#${id}`).isDisabled(), false);
        assert.equal(await resumed.locator('#exportStatus').evaluate(el => el.classList.contains('warning')), !ok);
        if (ok) assert.match(await resumed.locator('#exportStatus').textContent(), /original\.csv/);
        else assert.match(await resumed.locator('#exportStatus').textContent(), language === 'en' ? /Export failed/ : /匯出失敗/);
        await resumed.locator('#csv').click();
        await resumed.waitForFunction(() => /bus-.*\.csv/.test(document.querySelector('#exportStatus').textContent));
        const retained = await resumed.evaluate(() => JSON.parse(window.PassengerCountAndroid.get('passenger-count:workspace:v2')).surveys[0]);
        assert.deepEqual(retained.rows, survey.rows, 'completion and later explicit export preserve the original survey');
      } finally { await resumedContext.close(); }
    }
  }
  console.log('PASS: PC-004 restored export-failure feedback in English/Cantonese, retained surveys, no automatic export, in-flight controls/completion delivery and explicit retry (simulated native bridge).');
};
