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
      await page.waitForFunction(() => !document.querySelector('#exportStatus').classList.contains('warning'));
      assert.match(await page.locator('#exportStatus').textContent(), /Download\/PaxCountRecord\/.*\.csv/);
      assert.equal((await readSurvey()).id, retained.id);
      assert.deepEqual((await readSurvey()).rows, retained.rows, 'explicit retry preserves the survey');
    } finally { await context.close(); }
  }
  console.log('PASS: PC-004 restored export-failure feedback in English/Cantonese, retained surveys, no automatic export and explicit retry (simulated native bridge).');
};
