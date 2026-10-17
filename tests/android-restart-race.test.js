import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyzeRestartRace} from '../scripts/analyze-android-restart-race.mjs';

const death = '10-15 09:09:41.843 111 111 I PassengerJournalTest: SIGKILL_AFTER_DETACH prepare-race pid=111';
const died = '10-15 09:09:41.954 564 1725 I ActivityManager: Process app.passengercount (pid 111) has died: fg +50 FGS';
const scheduled = '10-15 09:09:41.964 564 1725 W ActivityManager: Scheduling restart of crashed service app.passengercount/.TrackService in 1000ms for start-requested';
const entering = '10-15 09:09:42.800 333 333 I PassengerRaceTrigger: RACE_TRIGGER_ENTER pid=333 uid=10210';
const promoted = '10-15 09:09:42.841 333 333 I PassengerRaceTrigger: RACE_TRIGGER_FOREGROUND pid=333 uid=10210';
const cleanup = '10-15 09:09:42.845 564 598 E AppOps  : Operation not started: uid=10209 pkg=app.passengercount(null) op=START_FOREGROUND';
const start = '10-15 09:09:43.017 564 599 I ActivityManager: Start proc 222:app.passengercount/u0a209 for service {app.passengercount/app.passengercount.TrackService}';
const denied = '10-15 09:09:43.157 564 1866 W ActivityManager: Service.startForeground() not allowed due to mAllowStartForeground false: service app.passengercount/.TrackService';
const log = [death,died,scheduled,entering,promoted,start].join('\n');
const service = `ACTIVITY MANAGER SERVICES (dumpsys activity services)
  * ServiceRecord{abc u0 app.passengercount/.TrackService c:app.passengercount}
    app=ProcessRecord{abc 222:app.passengercount/u0a209}
    isForeground=true foregroundId=19 types=0x00000008
`;
function classify(events, dump = service) {return analyzeRestartRace(events.join('\n'), dump, 111);}
test('accepts only a measured foreground restart after the other package entered foreground', () => {
  const r = analyzeRestartRace(log,service,111);
  assert.equal(r.outcome,'foreground-restored'); assert.equal(r.newPid,'222');
  assert.equal(r.interleaved,true); assert.equal(r.cleanupDuringAbsence,false);
});
test('retained denial signature after the measured interleaving is failure, not recovered', () => {
  const r=classify([death,died,scheduled,entering,promoted,cleanup,start,denied],'');
  assert.equal(r.outcome,'automatic-restart-denied');
  assert.equal(r.cleanupDuringAbsence,true); assert.equal(r.triggerBeforeCleanup,true);
});
test('a newer foreground snapshot cannot erase a recorded denial', () => {
  assert.equal(classify([death,died,scheduled,entering,promoted,cleanup,start,denied]).outcome,'automatic-restart-denied');
});
for(const [label,events] of [
  ['missing detached marker',[died,scheduled,entering,promoted,start]],
  ['missing actual process death',[death,scheduled,entering,promoted,start]],
  ['missing actual restart scheduling',[death,died,entering,promoted,start]],
  ['another PID death',[death,died.replace('(pid 111)','(pid 112)'),scheduled,entering,promoted,start]],
  ['late helper transition',[death,died,scheduled,start,entering,promoted]],
  ['helper never entered foreground',[death,died,scheduled,entering,start]],
  ['historical helper transition',[entering,promoted,death,died,scheduled,start]],
  ['helper before restart scheduling',[death,died,entering,promoted,scheduled,start]],
  ['activity-triggered target restart',[death,died,scheduled,entering,promoted,start.replace('for service','for activity')]],
  ['same PID',[death,died,scheduled,entering,promoted,start.replace('222:','111:')]],
]) test('unverified interleaving: '+label,()=>assert.equal(classify(events).outcome,'interleaving-unverified'));
for(const [label,dump] of [
  ['empty snapshot',''],
  ['old target process',service.replace('222:','111:')],
  ['still initializing',service.replace('isForeground=true','isForeground=false')],
  ['another service foreground',service.replace('isForeground=true','isForeground=false')
    +'  * ServiceRecord{other u0 app.passengercount/.AnotherService}\n    app=ProcessRecord{abc 222:app.passengercount/u0a209}\n    isForeground=true\n'],
  ['other process in later block',service.replace('222:','111:')
    +'  * ServiceRecord{other u0 app.passengercount/.AnotherService}\n    app=ProcessRecord{abc 222:app.passengercount/u0a209}\n'],
]) test('does not substitute partial or unrelated service state: '+label,()=>assert.equal(analyzeRestartRace(log,dump,111).outcome,'inconclusive'));
test('unrelated app-op and denial cannot accuse the target',()=>{
  const r=classify([death,died,scheduled,entering,promoted,cleanup.replaceAll('app.passengercount','other.app'),start,denied.replaceAll('app.passengercount','other.app')]);
  assert.equal(r.outcome,'foreground-restored');assert.equal(r.cleanupDuringAbsence,false);
});
test('no helper requirement for historical natural control; no app-op cleanup alone proves the cause',()=>{
  const r=analyzeRestartRace([death.replace('prepare-race','prepare-valid'),died,scheduled,cleanup,start,denied].join('\n'),'',111,'valid');
  assert.equal(r.outcome,'automatic-restart-denied');assert.equal(r.interleaved,false);assert.equal(r.triggerBeforeCleanup,false);
});

const root=fileURLToPath(new URL('../',import.meta.url));
const shell=fs.readFileSync(new URL('../scripts/android-restart-race.sh',import.meta.url),'utf8')
  .replace(/\bSECONDS\b/g,'fixtureClock').replace('fixtureClock+75','fixtureClock+5');
function runShell(events,dump=service,transportError=false) {
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'pc-race-'));
  try {
    fs.writeFileSync(path.join(out,'input.log'),events.join('\n'));fs.writeFileSync(path.join(out,'input.services'),dump);
    const r=spawnSync('bash',['-c',`set -euo pipefail
ROOT=${JSON.stringify(root)}; OUT=${JSON.stringify(out)}; CI=true; EMU_PID=99; SERIAL=emulator-5556; PACKAGE=app.passengercount
fixtureClock=0
sleep(){ fixtureClock=$((fixtureClock+1)); }
launch_home(){ echo launch_home >> "$OUT/calls"; }
activity_state(){ echo "activity_state $*" >> "$OUT/calls"; }
detached(){ echo "detached $*" >> "$OUT/calls"; }
background_home(){ echo background_home >> "$OUT/calls"; }
phase(){ echo "phase $*" >> "$OUT/calls"; }
adb(){
 echo "adb $*" >> "$OUT/calls"
 ${transportError ? 'if [[ "$*" == "logcat -d -v threadtime" ]]; then echo "error: device offline" >&2; return 0; fi' : ''}
 case "$*" in
  'shell pidof app.passengercount') echo 111;;
  'logcat -d -v threadtime') cat "$OUT/input.log";;
  'shell dumpsys activity services app.passengercount') cat "$OUT/input.services";;
  *) echo 'Starting service: Intent { test fixture }';;
 esac
}
${shell}
restart_race
`],{encoding:'utf8',timeout:10000});
    return {...r,calls:fs.readFileSync(path.join(out,'calls'),'utf8'),result:fs.existsSync(path.join(out,'race-result.json'))?JSON.parse(fs.readFileSync(path.join(out,'race-result.json'),'utf8')):null};
  } finally {fs.rmSync(out,{recursive:true,force:true});}
}
test('actual shell requires foreground proof before GPS verification reattaches',()=>{
  const r=runShell([death,died,scheduled,entering,promoted,start]);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.result.outcome,'foreground-restored');
  assert.ok(r.calls.indexOf('phase verify-race attached')>r.calls.indexOf('adb shell am start-foreground-service'));
});
test('actual shell returns failure immediately on denied restart without reattaching',()=>{
  const r=runShell([death,died,scheduled,entering,promoted,cleanup,start,denied],'');
  assert.equal(r.status,1,r.stdout+r.stderr);assert.doesNotMatch(r.calls,/phase verify-race/);
});
test('actual shell preserves a missed interleaving as unverified, not success',()=>{
  const r=runShell([death,died,scheduled,start,entering,promoted]);
  assert.equal(r.status,2,r.stdout+r.stderr);assert.doesNotMatch(r.calls,/phase verify-race/);
});
test('opt-in probe remains after every original installed phase',()=>{
  const installed=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
  assert.ok(installed.indexOf('source "$ROOT/scripts/android-restart-race.sh"')>installed.indexOf('phase recover-denied attached'));
  assert.match(installed,/if \[\[ "\$\{PASSENGER_RESTART_RACE:-0\}" == 1 \]\]/);
});

test('actual shell rejects transport stderr even with a zero command exit',()=>{
  const r=runShell([death,died,scheduled,entering,promoted,start],service,true);
  assert.equal(r.status,2,r.stdout+r.stderr);
  assert.match(r.stderr,/RACE_OBSERVATION_UNVERIFIED/);
  assert.doesNotMatch(r.calls,/phase verify-race/);
});

test('a late helper cannot downgrade the target denial to a timing miss',()=>{
  const r=classify([death,died,scheduled,cleanup,start,denied,entering,promoted],'');
  assert.equal(r.outcome,'automatic-restart-denied');assert.equal(r.interleaved,false);
});
test('actual shell returns failure for a target denial even if helper misses the window',()=>{
  const r=runShell([death,died,scheduled,cleanup,start,denied,entering,promoted],'');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.equal(r.result.interleaved,false);
  assert.doesNotMatch(r.calls,/phase verify-race/);
});
