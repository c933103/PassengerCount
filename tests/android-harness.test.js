import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
const start=source.indexOf('crash_observe() {'), end=source.indexOf('\n}\n\nphase bootstrap',start);
assert.ok(start>=0&&end>start);
// Same shell observation function; only its clock budget is shortened for negative fixtures.
const observer=source.slice(start,end+2).replace('SECONDS+75','SECONDS+1');
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
sleep(){ :; }
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
