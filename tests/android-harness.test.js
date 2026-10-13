import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
const start=source.indexOf('crash_observe() {'), end=source.indexOf('\n}\n\nphase bootstrap',start);
assert.ok(start>=0&&end>start);
// Same shell observation function with a deterministic five-poll test clock.
// A one-second wall-clock budget can expire before the third poll at a second boundary.
const observer=source.slice(start,end+2).replace(/\bSECONDS\b/g,'fixtureSeconds').replace('fixtureSeconds+75','fixtureSeconds+5');
const detachedStart=source.indexOf('detached() {'), detachedEnd=source.indexOf('\ncrash_observe() {',detachedStart);
assert.ok(detachedStart>=0&&detachedEnd>detachedStart);
const detachedCheck=source.slice(detachedStart,detachedEnd);
function detachedFixture({output,code=0}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passenger-detached-'));
  try {
    fs.writeFileSync(path.join(dir,'dump'),output);
    const script=`set -euo pipefail
OUT=${JSON.stringify(dir)}; PACKAGE=app.passengercount
adb(){
  printf '%s\\n' "$*" > "$OUT/command"
  cat "$OUT/dump"
  return ${code}
}
${detachedCheck}
detached valid 111
`;
    const result=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:5000});
    return {status:result.status,output:result.stdout+result.stderr,command:fs.readFileSync(path.join(dir,'command'),'utf8')};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const processHeader='ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)';
const pidMapping='  PID mappings:\n    PID #111: ProcessRecord{abc 111:app.passengercount/u0a100}\n';
const detachedDump=processHeader+'\n'+pidMapping;
test('detachment requires supported package-filtered process dump and original PID mapping',()=>{
  const r=detachedFixture({output:detachedDump});
  assert.equal(r.status,0,r.output);
  assert.equal(r.command,'shell dumpsys activity processes app.passengercount\n');
  assert.match(r.output,/DETACHED_STATE_PASS valid pid=111/);
});
for (const [label,output,code] of [
  ['captured API35 unsupported command','Unknown command: instrumentation\nBad activity command, or no activities match: instrumentation\nUse -h for help.\n',0],
  ['empty output','',0],
  ['header-only partial output',processHeader+'\n',0],
  ['missing header',pidMapping,0],
  ['another process PID',detachedDump.replaceAll('111','222'),0],
  ['command failure with otherwise valid output',detachedDump,1],
  ['dump timeout',detachedDump+'*** DUMP TIMEOUT ***\n',0],
  ['permission denial',detachedDump+'Permission Denial: cannot dump activity\n',0],
  ['active instrumentation summary',processHeader+'\n  Active instrumentation:\n    Instrumentation #0: ActiveInstrumentation{abc app.passengercount.tests/.JournalLifecycleInstrumentation}\n'+pidMapping,0],
  ['active instrumentation on following lines',processHeader+'\n  Active instrumentation:\n    targetInfo=app.passengercount\n'+pidMapping,0],
  ['process still instrumented',processHeader+'\n    mInstr=ActiveInstrumentation{abc}\n'+pidMapping,0],
]) test('detachment fails closed for '+label,()=>{
  const r=detachedFixture({output,code});assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/DETACHED_STATE_PASS/);
});
function fixture({kind='valid',marker=true,startAfter=true,rightPid=true,delayed=false}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passenger-observer-'));
  try {
    const death='PassengerJournalTest: SIGKILL_AFTER_DETACH prepare-'+kind+' pid=111';
    const service='ActivityManager: Start proc 222:app.passengercount/u0a100 for service {app.passengercount/app.passengercount.TrackService}';
    const log=[!startAfter?service:'',marker?death:'',startAfter?service:''].join('\n');
    fs.writeFileSync(path.join(dir,'log'),log);
    const script=`set -euo pipefail
OUT=${JSON.stringify(dir)}; PACKAGE=app.passengercount
detached(){ :; }
fixtureSeconds=0
sleep(){ fixtureSeconds=$((fixtureSeconds+1)); }
adb(){
  if [[ "$*" == 'logcat -d -v threadtime' ]]; then cat "$OUT/log"; return; fi
  n=$(cat "$OUT/polls" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$OUT/polls"
  ${kind==='deleted'?'if ((n>2)); then echo "(nothing)"; return; fi':''}
  echo 'ServiceRecord{abc u0 app.passengercount/.TrackService}'
  echo 'app=ProcessRecord{abc ${rightPid?'222':'333'}:app.passengercount/u0a100}'
  ${delayed?'if ((n<3)); then echo isForeground=false; else echo isForeground=true; fi':'echo isForeground=true'}
}
${observer}
crash_observe ${kind} 111
`;
    const result=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:5000});
    return {status:result.status,output:result.stdout+result.stderr,polls:Number(fs.readFileSync(path.join(dir,'polls'),'utf8')),pid:fs.existsSync(path.join(dir,'pid-'+kind+'.txt'))?fs.readFileSync(path.join(dir,'pid-'+kind+'.txt'),'utf8'):null};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
test('restart observer waits after PID creation until that service becomes foreground',()=>{
  const r=fixture({delayed:true});assert.equal(r.status,0,r.output);assert.ok(r.polls>=3);assert.equal(r.pid,'111 -> 222\n');
});
test('restart observer rejects foreground state belonging to another process',()=>assert.notEqual(fixture({rightPid:false}).status,0));
test('restart observer rejects a historical service start before this death marker',()=>assert.notEqual(fixture({startAfter:false}).status,0));
test('restart observer requires the detached-death marker',()=>assert.notEqual(fixture({marker:false}).status,0));
test('tombstone observer waits for observed restarted service to stop',()=>{
  const r=fixture({kind:'deleted'});assert.equal(r.status,0,r.output);assert.ok(r.polls>=3);assert.equal(r.pid,'111 -> 222\n');
});

