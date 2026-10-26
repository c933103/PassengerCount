import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('foreground bookkeeping parser tests use host fixtures, never an Android policy substitute',()=>{
  const result=spawnSync('python3',[fileURLToPath(new URL('./android-foreground-observation.test.py',import.meta.url))],
    {encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stderr,/Ran \d+ tests/);
});

test('host observation happens after independent execution and cannot select a device',()=>{
  const wrapper=fs.readFileSync(new URL('../scripts/test-android-restart-after-failure.sh',import.meta.url),'utf8');
  const observer=wrapper.indexOf('python3 "$ROOT/scripts/analyze-android-foreground-observation.py"');
  assert.ok(observer>wrapper.indexOf('diagnostic_code=$?'));
  assert.ok(observer<wrapper.lastIndexOf('exit "$diagnostic_code"'));
  assert.match(wrapper,/timeout --kill-after=2s 15s python3/);
  const parser=fs.readFileSync(new URL('../scripts/analyze-android-foreground-observation.py',import.meta.url),'utf8');
  assert.doesNotMatch(parser,/import subprocess|from subprocess|os\.system\(|os\.popen\(/);
  assert.match(parser,/framework-bookkeeping-observation-not-acceptance/);
});
