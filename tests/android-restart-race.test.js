import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyzeRestartRace, analyzeNoTriggerControl, publishRestartRace} from '../scripts/analyze-android-restart-race.mjs';

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
function runShell(events,dump=service,transportError=false,warmReady=true,scope=null,fault=null,diagnostic=false,control=false) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'pc-race-'));
  const out=control?path.join(base,'no-trigger-control'):base;
  if(control) { fs.mkdirSync(out); timingFixture(base); provenanceFixture(base,out);
    if(fault?.stage==='timing') fs.writeFileSync(path.join(base,'race-trigger-slot.json'),'{"status":"measured"}');
    if(fault?.stage==='control-receipt') fs.mkdirSync(path.join(out,fault.name));
  }
  try {
    fs.writeFileSync(path.join(out,'input.log'),(warmReady?['10-15 09:09:30.000 333 333 I PassengerRaceTrigger: RACE_WARM_READY pid=333 uid=10210',...events]:events).join('\n'));fs.writeFileSync(path.join(out,'input.services'),dump);
    const r=spawnSync('bash',['-c',`set -euo pipefail
ROOT=${JSON.stringify(root)}; OUT=${JSON.stringify(out)}; CI=true; EMU_PID=99; SERIAL=emulator-5556; PACKAGE=app.passengercount
PASSENGER_RESTART_RACE_ONLY=${diagnostic?'1':'0'}
PASSENGER_RESTART_NO_TRIGGER=${control?'1':'0'}
${scope ? "TRACK_PROCESS=app.passengercount:tracking" : ""}
fixtureClock=0
observation_logs=0; observation_services=0; classifier_calls=0
sleep(){ fixtureClock=$((fixtureClock+1)); }
node(){
 classifier_calls=$((classifier_calls+1))
 ${fault?.stage === 'classifier' ? `if [[ "$classifier_calls" == ${fault.at ?? 2} ]]; then echo 'injected classifier failure' >&2; return ${fault.exit ?? 3}; fi` : ''}
 command node "$@"
}
launch_home(){ echo launch_home >> "$OUT/calls"; }
activity_state(){ echo "activity_state $*" >> "$OUT/calls"; }
detached(){ echo "detached $*" >> "$OUT/calls"; }
background_home(){ echo background_home >> "$OUT/calls"; }
phase(){ echo "phase $*" >> "$OUT/calls"; touch "$OUT/prepared"; }
adb(){
 echo "adb $*" >> "$OUT/calls"
 ${transportError ? 'if [[ "$*" == "logcat -d -v threadtime" ]]; then echo "error: device offline" >&2; return 0; fi' : ''}
 case "$*" in
  'shell pidof app.passengercount') ${scope ? `if [[ ! -f "$OUT/prepared" ]] || [[ "${scope.uiAlive !== false}" == true ]]; then echo 444; else return 1; fi` : 'echo 111'};;
  'shell pidof app.passengercount:tracking') echo 111;;
  'shell pidof app.passengercount app.passengercount:tracking') ${control?'touch "$OUT/triggered";':''} ${scope?.absenceOutput ? `echo ${JSON.stringify(scope.absenceOutput)};` : ''} ${scope?.absenceStderr ? `echo ${JSON.stringify(scope.absenceStderr)} >&2;` : ''} return ${scope?.absenceExit ?? 1};;
  'logcat -d -v threadtime')
   if [[ -f "$OUT/triggered" ]]; then
    observation_logs=$((observation_logs+1))
    ${fault?.stage === 'log' ? `if [[ "$observation_logs" == ${fault.at ?? 2} ]]; then printf 'partial log'; ${fault.stderr ? `echo ${JSON.stringify(fault.stderr)} >&2;` : ''} return ${fault.exit ?? 1}; fi` : ''}
   fi
   cat "$OUT/input.log";;
  'shell dumpsys activity services app.passengercount'|'shell dumpsys activity services')
   if [[ -f "$OUT/triggered" ]]; then
    observation_services=$((observation_services+1))
    ${fault?.stage === 'services' ? `if [[ "$observation_services" == ${fault.at ?? 2} ]]; then printf 'partial services'; ${fault.stderr ? `echo ${JSON.stringify(fault.stderr)} >&2;` : ''} return ${fault.exit ?? 1}; fi` : ''}
   fi
   cat "$OUT/input.services";;
  'shell am start-foreground-service -n app.passengercount.tests/app.passengercount.RestartRaceTriggerService -a app.passengercount.tests.TRIGGER') touch "$OUT/triggered";;
  *) echo 'Starting service: Intent { test fixture }';;
 esac
}
${shell}
restart_race ${scope?.kind || ""}
`],{encoding:'utf8',timeout:10000});
    const files=Object.fromEntries(fs.readdirSync(out,{recursive:true})
      .filter(p=>fs.statSync(path.join(out,p)).isFile()).map(p=>[p,fs.readFileSync(path.join(out,p),'utf8')]));
    return {...r,files,calls:files.calls,result:files['race-result.json']?JSON.parse(files['race-result.json']):null};
  } finally {fs.rmSync(base,{recursive:true,force:true});}
}
test('actual shell requires foreground proof before GPS verification reattaches',()=>{
  const r=runShell([death,died,scheduled,entering,promoted,start]);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.result.outcome,'foreground-restored');
  assert.ok(r.calls.indexOf('phase verify-race attached')>r.calls.lastIndexOf('adb shell am start-foreground-service'));
});
test('actual shell returns failure immediately on denied restart without reattaching',()=>{
  const r=runShell([death,died,scheduled,entering,promoted,cleanup,start,denied],'');
  assert.equal(r.status,1,r.stdout+r.stderr);assert.doesNotMatch(r.calls,/phase verify-race/);
});

test('independent observation reuses service command slots without client callbacks or gate relaxation',()=>{
  const fullDump=service+`\n  * ServiceRecord{other u0 app.other/.Service c:app.other}\n    isForeground=true foregroundId=701 types=0x00000800\n\n  Active foreground apps - user 0:\n  #0: app.passengercount\n    mNumActive=1 mAppOnTop=false\n`;
  const events=[death,died,scheduled,entering,promoted,start,denied];
  const original=runShell(events,fullDump);
  const diagnostic=runShell(events,fullDump,false,true,null,null,true);
  for(const r of [original,diagnostic]) {
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.equal(r.result.outcome,'automatic-restart-denied');
    assert.doesNotMatch(r.calls,/phase verify-race/);
  }
  const originalCalls=original.calls.split('\n').filter(l=>l.startsWith('adb shell dumpsys activity services'));
  const diagnosticCalls=diagnostic.calls.split('\n').filter(l=>l.startsWith('adb shell dumpsys activity services'));
  assert.equal(diagnosticCalls.length,originalCalls.length,'no added in-interval snapshot command');
  assert.ok(originalCalls.every(l=>l==='adb shell dumpsys activity services app.passengercount'));
  assert.ok(diagnosticCalls.every(l=>l==='adb shell dumpsys activity services'));
  assert.doesNotMatch(diagnostic.calls,/dumpsys activity -(?:p|c)/);
  assert.equal(diagnostic.files['race-before-services.txt.scope.txt'],'ALL_SERVICES_NO_CLIENTS_DIAGNOSTIC_ONLY\n');
  assert.ok(!Object.keys(original.files).some(n=>n.endsWith('.scope.txt')));
  const scoped=Object.keys(diagnostic.files).filter(n=>n.endsWith('services.txt.scope.txt'));
  assert.equal(scoped.length,diagnosticCalls.length);
});

test('an active foreground-app bookkeeping entry cannot establish target service foreground restoration',()=>{
  const bookkeepingOnly=`ACTIVITY MANAGER SERVICES (dumpsys activity services)\n  * ServiceRecord{other u0 app.other/.Service c:app.other}\n    isForeground=true foregroundId=701 types=0x00000800\n  Active foreground apps - user 0:\n  #0: app.passengercount\n    mNumActive=1 mAppOnTop=false\n`;
  assert.equal(analyzeRestartRace(log,bookkeepingOnly,111).outcome,'inconclusive');
});
for(const listing of ['Pending','Restarting','Destroy'])
test(`classifier cannot borrow foreground state from an unrelated ${listing} ServiceRecord`,()=>{
  const dump=service.replace('isForeground=true','isForeground=false')+
    `  * ${listing} ServiceRecord{other u0 app.other/.Other c:app.other}\n    app=ProcessRecord{other 333:app.other/u0a333}\n    isForeground=true foregroundId=701 types=0x00000800\n`;
  const observation=analyzeRestartRace(log,dump,111);
  assert.equal(observation.foreground,false);
  assert.equal(observation.outcome,'inconclusive');
  assert.equal(analyzeRestartRace(log+'\n'+denied,dump,111).outcome,'automatic-restart-denied');
});
test('actual shell preserves a missed interleaving as unverified, not success',()=>{
  const r=runShell([death,died,scheduled,start,entering,promoted]);
  assert.equal(r.status,2,r.stdout+r.stderr);assert.doesNotMatch(r.calls,/phase verify-race/);
});
test('opt-in probe remains after every original installed phase',()=>{
  const installed=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
  assert.ok(installed.lastIndexOf('source "$ROOT/scripts/android-restart-race.sh"')>installed.indexOf('phase recover-denied attached'));
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

test('helper warm-up uses an FGS and is proven complete before target launch',()=>{
 const r=runShell([death,died,scheduled,entering,promoted,start]);
 assert.equal(r.status,0);
 assert.match(r.calls,/adb shell am start-foreground-service .*app.passengercount.tests.WARM/);
 assert.doesNotMatch(r.calls,/adb shell am startservice/);
 assert.ok(r.calls.indexOf('adb logcat -d -v threadtime')<r.calls.indexOf('launch_home'));
});
test('missing helper warm completion is inconclusive before touching the target',()=>{
 const r=runShell([death,died,scheduled,entering,promoted,start],service,false,false);
 assert.equal(r.status,2);assert.match(r.stdout,/RACE_WARM_UNVERIFIED/);
 assert.doesNotMatch(r.calls,/launch_home|phase prepare-race/);
});

for (const kind of ['split','race']) test('tracking-process '+kind+' classifier cannot mistake the surviving UI for a service restart',()=>{
  const events=[death.replace('prepare-race','prepare-'+kind),died.replace('app.passengercount (','app.passengercount:tracking ('),scheduled,entering,promoted,start.replace(':app.passengercount/',':app.passengercount:tracking/')];
  const dump=service.replace(':app.passengercount/',':app.passengercount:tracking/');
  assert.equal(analyzeRestartRace(events.join('\n'),dump,111,kind,'app.passengercount:tracking').outcome,'foreground-restored');
  assert.equal(analyzeRestartRace(events.join('\n'),service,111,kind,'app.passengercount:tracking').outcome,'inconclusive');
  const wrongStart=events.map(x=>x.replace('222:app.passengercount:tracking/','222:app.passengercount/'));
  assert.equal(analyzeRestartRace(wrongStart.join('\n'),dump,111,kind,'app.passengercount:tracking').outcome,'interleaving-unverified');
});
test('split-process helper still fails on an observed target denial',()=>{
  const events=[death.replace('prepare-race','prepare-split'),died.replace('app.passengercount (','app.passengercount:tracking ('),scheduled,entering,promoted,start.replace(':app.passengercount/',':app.passengercount:tracking/'),denied];
  assert.equal(analyzeRestartRace(events.join('\n'),'',111,'split','app.passengercount:tracking').outcome,'automatic-restart-denied');
});
test('process-split harness keeps independent all-process absence gate after service-only race',()=>{
  const installed=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
  assert.match(installed,/OUT="\$original_out\/service-only-race"/);
  assert.ok(installed.indexOf('restart_race split')<installed.lastIndexOf('restart_race\nfi'));
  assert.match(shell,/RACE_UI_SURVIVAL_UNVERIFIED/);
  assert.match(shell,/RACE_ALL_PROCESS_ABSENCE_UNVERIFIED/);
  const instrument=fs.readFileSync(new URL('./android/JournalLifecycleInstrumentation.java',import.meta.url),'utf8');
  assert.match(instrument,/phase\.equals\("prepare-race"\)[\s\S]*ALL_PACKAGE_KILL/);
});

function splitEvents(kind,denial=false,uiDeath=true) {
  return [...(uiDeath?['ActivityManager: Process app.passengercount (pid 444) has died: cch CEM']:[]),
    death.replace('prepare-race','prepare-'+kind),died.replace('app.passengercount (','app.passengercount:tracking ('),
    scheduled,entering,promoted,start.replace(':app.passengercount/',':app.passengercount:tracking/'),...(denial?[denied]:[])];
}
const trackerService=service.replace(':app.passengercount/',':app.passengercount:tracking/');
test('actual split shell requires original UI PID survival before claiming service-only recovery',()=>{
  const r=runShell(splitEvents('split'),trackerService,false,true,{kind:'split'});
  assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.calls,/phase verify-split attached/);
  const missing=runShell(splitEvents('split'),trackerService,false,true,{kind:'split',uiAlive:false});
  assert.equal(missing.status,2,missing.stdout+missing.stderr);assert.doesNotMatch(missing.calls,/phase verify-split/);
});
test('actual all-process shell retains denial after proven OS and ActivityManager absence',()=>{
  const r=runShell(splitEvents('race',true),'',false,true,{kind:'race',uiAlive:false});
  assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.result.outcome,'automatic-restart-denied');
});
test('richer independent snapshots retain the exact all-process absence requirement and denial',()=>{
  const observed=runShell(splitEvents('race',true),'',false,true,{kind:'race',uiAlive:false},null,true);
  assert.equal(observed.status,1,observed.stdout+observed.stderr);
  assert.equal(observed.result.outcome,'automatic-restart-denied');
  for(const [options,uiDeath] of [
    [{absenceExit:255,absenceStderr:'error: device offline'},true],
    [{absenceExit:0,absenceOutput:'444'},true],
    [{},false],
  ]) {
    const r=runShell(splitEvents('race',true,uiDeath),'',false,true,{kind:'race',uiAlive:false,...options},null,true);
    assert.equal(r.status,2,r.stdout+r.stderr);
    assert.doesNotMatch(r.calls,/app.passengercount.tests.TRIGGER/);
  }
});
for(const [label,options,deathObserved] of [
  ['transport error',{absenceExit:255,absenceStderr:'error: device offline'},true],
  ['surviving process',{absenceExit:0,absenceOutput:'444'},true],
  ['missing ActivityManager UI death',{},false],
]) test('all-process absence cannot be fabricated by '+label,()=>{
  const r=runShell(splitEvents('race',true,deathObserved),'',false,true,{kind:'race',uiAlive:false,...options});
  assert.equal(r.status,2,r.stdout+r.stderr);
  assert.doesNotMatch(r.calls,/app.passengercount.tests.TRIGGER/);
});

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function assertPaired(r) {
  assert.ok(r.result?.evidence, 'a completed observation identifies its exact inputs');
  const {evidence,...classification}=r.result;
  for(const item of Object.values(evidence)) {
    assert.equal(digest(r.files[item.path]),item.sha256);
    assert.equal(Buffer.byteLength(r.files[item.path]),item.bytes);
    assert.equal(r.files[item.path+'.exit-code.txt'],'0\n');
    assert.equal(r.files[item.path+'.stderr'],'');
  }
  assert.equal(path.dirname(evidence.log.path),path.dirname(evidence.services.path));
  assert.equal(r.files[path.join(path.dirname(evidence.log.path),'result.json')],r.files['race-result.json']);
  assert.deepEqual(analyzeRestartRace(r.files[evidence.log.path],r.files[evidence.services.path],
    classification.oldPid,'race',classification.process),classification);
}

for(const [label,fault] of [
  ['partial logcat/nonzero with empty stderr',{stage:'log',exit:1}],
  ['partial logcat/zero exit with stderr',{stage:'log',exit:0,stderr:'transport warning'}],
  ['partial service dump after new complete log',{stage:'services',exit:1}],
  ['service dump/zero exit with stderr',{stage:'services',exit:0,stderr:'transport warning'}],
  ['classifier failure after both captures',{stage:'classifier'}],
  ['classifier launch exit 1 after both captures',{stage:'classifier',exit:1}],
]) test('last complete evidence survives later '+label,()=>{
  // Complete observation, but missed timing: continue polling without calling
  // this a product success, then reproduce run111's later partial capture.
  const r=runShell([death,died,scheduled,start,entering,promoted],service,false,true,null,fault);
  assert.equal(r.status,2,r.stdout+r.stderr);
  assert.equal(r.result.outcome,'interleaving-unverified');
  assertPaired(r);
  assert.doesNotMatch(r.calls,/phase verify-race/);
  assert.doesNotMatch(r.stdout,/PASS: one measured/);
  const attempts=[...new Set(Object.keys(r.files).filter(p=>p.startsWith('race-observation.')).map(p=>p.split('/')[0]))];
  assert.equal(attempts.length,2);
  const failed=attempts.find(p=>p!==path.dirname(r.result.evidence.log.path));
  assert.equal(r.files[failed+'/result.json'],undefined);
  if(fault.stage==='classifier') assert.equal(r.files[failed+'/classifier-exit-code.txt'],`${fault.exit ?? 3}\n`);
  else {
    const file=failed+(fault.stage==='log'?'/logcat.txt':'/services.txt');
    assert.match(r.files[file],/^partial /);
    assert.equal(r.files[file+'.exit-code.txt'],`${fault.exit}\n`);
    assert.equal(r.files[file+'.stderr'],fault.stderr?fault.stderr+'\n':'');
  }
});
for(const stage of ['log','services','classifier']) test('first '+stage+' failure publishes no stale success',()=>{
  const r=runShell([death,died,scheduled,entering,promoted,start],service,false,true,null,{stage,at:1});
  assert.equal(r.status,2,r.stdout+r.stderr);
  assert.equal(r.result,null);
  assert.doesNotMatch(r.calls,/phase verify-race/);
});
test('success and denial each publish complete pairs with unchanged outcome codes',()=>{
  for(const [events,dump,code] of [[log.split('\n'),service,0],[[death,died,scheduled,entering,promoted,start,denied],'',1]]) {
    const r=runShell(events,dump,false,true,null,{stage:'log',at:2});
    assert.equal(r.status,code,r.stdout+r.stderr);
    assertPaired(r);
    assert.equal(Object.keys(r.files).filter(p=>/race-observation\.[^/]+\/result.json$/.test(p)).length,1);
    if(code===1) assert.doesNotMatch(r.calls,/phase verify-race/);
  }
});

function publicationFixture(fn) {
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'pc-race-publish-'));
  function attempt(name,events=log) {
    const dir=path.join(out,name);fs.mkdirSync(dir);
    for(const [file,content] of [['logcat.txt',events],['services.txt',service]]) {
      fs.writeFileSync(path.join(dir,file),content);
      fs.writeFileSync(path.join(dir,file+'.stderr'),'');
      fs.writeFileSync(path.join(dir,file+'.exit-code.txt'),'0\n');
    }
    return [path.join(dir,'logcat.txt'),path.join(dir,'services.txt'),'111','race','app.passengercount',path.join(out,'race-result.json')];
  }
  try {
    const first=attempt('first',[death,died,scheduled,start,entering,promoted].join('\n'));
    publishRestartRace(...first);
    const previous=fs.readFileSync(first[5]);
    fn({out,first,previous,attempt});
  } finally {fs.rmSync(out,{recursive:true,force:true});}
}
for(const failure of ['missing-log','missing-services','missing-status','nonzero-status','stderr','mixed-attempts','reused-attempt'])
  test('publisher refuses '+failure+' without disturbing prior pair',()=>publicationFixture(({first,previous,attempt})=>{
    const next=attempt('next');
    if(failure==='missing-log') fs.unlinkSync(next[0]);
    if(failure==='missing-services') fs.unlinkSync(next[1]);
    if(failure==='missing-status') fs.unlinkSync(next[0]+'.exit-code.txt');
    if(failure==='nonzero-status') fs.writeFileSync(next[1]+'.exit-code.txt','1\n');
    if(failure==='stderr') fs.writeFileSync(next[0]+'.stderr','unverified');
    if(failure==='mixed-attempts') next[1]=first[1];
    if(failure==='reused-attempt') fs.writeFileSync(path.join(path.dirname(next[0]),'result.json'),'existing');
    assert.throws(()=>publishRestartRace(...next));
    assert.deepEqual(fs.readFileSync(first[5]),previous);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(first[0]),'result.json')),previous);
  }));
for(const failure of ['snapshot-write','staging-directory','staging-write','atomic-rename'])
  test('publication '+failure+' failure retains the last complete result',()=>publicationFixture(({first,previous,attempt})=>{
    const next=attempt('next');
    const method=failure==='staging-directory'?'mkdtempSync':failure==='atomic-rename'?'renameSync':'writeFileSync';
    const original=fs[method];
    fs[method]=function(filename,...args) {
      if(failure==='staging-directory'||failure==='atomic-rename'
          || (failure==='snapshot-write'&&filename===path.join(path.dirname(next[0]),'result.json'))
          || (failure==='staging-write'&&filename.includes('.race-result-')))
        throw new Error('injected '+failure);
      return original.call(this,filename,...args);
    };
    try {assert.throws(()=>publishRestartRace(...next),/injected/);}
    finally {fs[method]=original;}
    assert.deepEqual(fs.readFileSync(first[5]),previous);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(first[0]),'result.json')),previous);
  }));
test('actual classifier CLI distinguishes publication/input errors from a product denial',()=>publicationFixture(({first,previous,attempt})=>{
  const next=attempt('next');fs.writeFileSync(next[0]+'.exit-code.txt','1\n');
  const r=spawnSync(process.execPath,[path.join(root,'scripts/analyze-android-restart-race.mjs'),...next.slice(0,5),'--publish',next[5]],{encoding:'utf8'});
  assert.equal(r.status,3,r.stdout+r.stderr);
  assert.match(r.stderr,/RACE_CLASSIFICATION_UNVERIFIED/);
  assert.deepEqual(fs.readFileSync(first[5]),previous);
}));
test('a publication failure cannot downgrade an observed denial to inconclusive',()=>publicationFixture(({first,previous,attempt})=>{
  const next=attempt('denied',[death,died,scheduled,entering,promoted,start,denied].join('\n'));
  // Refuse reuse before any root publication, while retaining the denial
  // established from complete inputs and the previously published pair.
  fs.writeFileSync(path.join(path.dirname(next[0]),'result.json'),'existing');
  const r=spawnSync(process.execPath,[path.join(root,'scripts/analyze-android-restart-race.mjs'),...next.slice(0,5),'--publish',next[5]],{encoding:'utf8'});
  assert.equal(r.status,10,r.stdout+r.stderr);
  assert.match(r.stderr,/RACE_AUTOMATIC_RESTART_DENIED/);
  assert.match(r.stderr,/result publication failed/);
  assert.deepEqual(fs.readFileSync(first[5]),previous);
}));
test('standalone classifier retains its established success/denial/inconclusive exit codes',()=>publicationFixture(({attempt})=>{
  for(const [name,events,expected] of [
    ['restored',log,0],
    ['denied',[death,died,scheduled,entering,promoted,start,denied].join('\n'),1],
    ['late',[death,died,scheduled,start,entering,promoted].join('\n'),2],
  ]) {
    const args=attempt(name,events);
    const r=spawnSync(process.execPath,[path.join(root,'scripts/analyze-android-restart-race.mjs'),...args.slice(0,5)],{encoding:'utf8'});
    assert.equal(r.status,expected,r.stdout+r.stderr);
    assert.equal(JSON.parse(r.stdout).evidence,undefined);
  }
}));

// Transport-only fixtures exercise host timing and the separate control. They
// do not simulate Android foreground-service policy or claim runtime causality.
function timingFixture(parent) {
  const slot={kind:'host-timing-observation-not-acceptance',mode:'triggered',status:'measured',
    clock:'time.monotonic_ns',verifiedAbsenceNs:1000,slotStartNs:2000,slotEndNs:2002000,
    elapsedNs:2000000,captureExitCode:0};
  const bytes=JSON.stringify(slot)+'\n';
  fs.writeFileSync(path.join(parent,'race-trigger-slot.json'),bytes);
  const first={kind:slot.kind,mode:'triggered',status:'measured',clock:slot.clock,
    verifiedAbsenceNs:1000,firstServicesStartNs:3002000,firstServicesEndNs:4002000,
    servicesElapsedNs:1000000,gapAfterSlotNs:1000000,elapsedFromAbsenceNs:3001000,
    slotEvidence:{bytes:Buffer.byteLength(bytes),sha256:digest(bytes)}};
  fs.writeFileSync(path.join(parent,'race-first-services-timing.json'),JSON.stringify(first)+'\n');
  return {slot,first};
}
const controlEvents=(denial=false)=>splitEvents('race',denial).filter(line=>!line.includes('RACE_TRIGGER_'));
test('strict original classifier still refuses an untriggered foreground observation',()=>{
  assert.equal(analyzeRestartRace(controlEvents().join('\n'),trackerService,111,'race','app.passengercount:tracking').outcome,'interleaving-unverified');
  const result=analyzeNoTriggerControl(controlEvents().join('\n'),trackerService,111);
  assert.equal(result.outcome,'foreground-observed-no-trigger');
  assert.equal(result.kind,'independent-no-trigger-observation-not-acceptance');
  assert.equal(result.interleaved,false);
});
for(const missing of ['SIGKILL_AFTER_DETACH','has died: fg','Scheduling restart','Start proc'])
test('no-trigger control cannot replace missing '+missing,()=>{
  const result=analyzeNoTriggerControl(controlEvents().filter(line=>!line.includes(missing)).join('\n'),trackerService,111);
  assert.equal(result.outcome,'control-comparison-unverified'); assert.equal(result.comparisonEligible,false);
});
for(const contamination of [entering,promoted]) test('unexpected control trigger invalidates comparison without hiding denial: '+contamination,()=>{
  for(const denial of [false,true]) {
    const result=analyzeNoTriggerControl([...controlEvents(denial),contamination].join('\n'),trackerService,111);
    assert.equal(result.outcome,denial?'automatic-restart-denied':'control-comparison-unverified');
    assert.equal(result.comparisonEligible,false);assert.equal(result.comparisonStatus,'unexpected-trigger');
  }
});
test('a pre-kill trigger also contaminates a fresh-emulator control, while denial remains failure',()=>{
  for(const denial of [false,true]) {
    const result=analyzeNoTriggerControl([entering,promoted,...controlEvents(denial)].join('\n'),trackerService,111);
    assert.equal(result.comparisonEligible,false);assert.equal(result.comparisonStatus,'unexpected-trigger');
    assert.equal(result.outcome,denial?'automatic-restart-denied':'control-comparison-unverified');
  }
});
for(const [label,events,dump] of [
  ['same PID',controlEvents().map(line=>line.replace('222:','111:')),trackerService],
  ['surviving UI process',controlEvents(),service],
  ['not foreground',controlEvents(),trackerService.replace('isForeground=true','isForeground=false')],
  ['unrelated foreground',controlEvents(),service.replaceAll('app.passengercount','app.other')],
]) test('control rejects '+label,()=>assert.equal(analyzeNoTriggerControl(events.join('\n'),dump,111).outcome,'control-comparison-unverified'));

test('actual control shell omits only trigger slot, keeps full absence/snapshot cadence, and never reattaches',()=>{
  const triggered=runShell(splitEvents('race'),trackerService,false,true,{kind:'race',uiAlive:false},null,true);
  const control=runShell(controlEvents(),trackerService,false,true,{kind:'race',uiAlive:false},null,true,true);
  assert.equal(control.status,0,control.stdout+control.stderr);
  assert.equal(control.result.outcome,'foreground-observed-no-trigger');
  assert.equal(control.result.fullAbsenceReceiptVerified,true);assert.equal(control.result.comparisonEligible,true);
  assert.equal(control.result.comparisonTiming.timingEqualityEstablished,false);
  assert.equal(control.result.comparisonTiming.status,'measured-differences-not-matched');
  assert.doesNotMatch(control.calls,/app.passengercount.tests.TRIGGER|phase verify-/);
  assert.doesNotMatch(control.stdout,/PASS:/); assert.match(control.files['race-result.txt'],/OBSERVATION ONLY/);
  const commands=r=>r.calls.split('\n').filter(line=>line.startsWith('adb ')&&!line.includes('.TRIGGER'));
  assert.deepEqual(commands(control),commands(triggered));
  assert.equal(control.files['race-process-scope.txt'],'ALL_PACKAGE_PROCESSES_ABSENT before_control_idle=true\n');
  assert.equal(control.files['race-absent-pids.exit-code.txt'],'1\n');
  const slot=JSON.parse(control.files['race-trigger-slot.json']);
  const first=JSON.parse(control.files['race-first-services-timing.json']);
  assert.ok(slot.replayDifferenceNs>=0);
  assert.equal(slot.requestedReplayNs,2000000);
  assert.equal(first.slotEvidence.sha256,digest(control.files['race-trigger-slot.json']));
  assert.equal(first.elapsedFromAbsenceNs,first.firstServicesStartNs-slot.verifiedAbsenceNs);
  assert.ok(first.firstServicesStartNs>=slot.slotEndNs);
});
test('actual control denial remains1; unexpected trigger affects only comparison eligibility',()=>{
  for(const contaminate of [false,true]) {
    const events=[...controlEvents(true),...(contaminate?[entering]:[])];
    const r=runShell(events,'',false,true,{kind:'race',uiAlive:false},null,true,true);
    assert.equal(r.status,1,r.stdout+r.stderr); assert.equal(r.result.outcome,'automatic-restart-denied');
    assert.equal(r.result.comparisonEligible,!contaminate);assert.doesNotMatch(r.calls,/phase verify-/);
  }
});
test('original race mode rejects a leaked control flag before any device command',()=>{
  const r=runShell(controlEvents(),trackerService,false,true,{kind:'race',uiAlive:false},null,false,true);
  assert.equal(r.status,2,r.stdout+r.stderr);assert.equal(r.calls,undefined);
  assert.match(r.stdout,/NO_TRIGGER_CONTROL_REQUIRES_INDEPENDENT/);
});
for(const options of [{absenceExit:0,absenceOutput:'444'},{absenceExit:255,absenceStderr:'offline'}])
test('control cannot weaken all-process absence: '+JSON.stringify(options),()=>{
  const r=runShell(controlEvents(true),'',false,true,{kind:'race',uiAlive:false,...options},null,true,true);
  assert.equal(r.status,2,r.stdout+r.stderr); assert.equal(r.result,null);
  assert.equal(r.files['race-trigger-slot.json'],undefined);
});

function controlPublicationFixture(fn) {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'pc-control-publish-'));
  const out=path.join(parent,'no-trigger-control');fs.mkdirSync(out);
  timingFixture(parent); provenanceFixture(parent,out);
  const triggeredBytes=fs.readFileSync(path.join(parent,'race-trigger-slot.json'));
  const slot={kind:'host-timing-observation-not-acceptance',mode:'no-trigger-control',status:'measured',
    clock:'time.monotonic_ns',verifiedAbsenceNs:5000000,slotStartNs:5100000,slotEndNs:7200000,
    elapsedNs:2100000,requestedReplayNs:2000000,replayDifferenceNs:100000,
    reference:{bytes:triggeredBytes.length,sha256:digest(triggeredBytes)}};
  const slotBytes=JSON.stringify(slot)+'\n';
  const first={kind:slot.kind,mode:slot.mode,status:'measured',clock:slot.clock,
    verifiedAbsenceNs:slot.verifiedAbsenceNs,firstServicesStartNs:8500000,firstServicesEndNs:9500000,
    servicesElapsedNs:1000000,gapAfterSlotNs:1300000,elapsedFromAbsenceNs:3500000,
    slotEvidence:{bytes:Buffer.byteLength(slotBytes),sha256:digest(slotBytes)}};
  for(const [name,value] of Object.entries({'race-process-scope.txt':'ALL_PACKAGE_PROCESSES_ABSENT before_control_idle=true\n',
    'race-absent-pids.exit-code.txt':'1\n','race-absent-pids.txt':'','race-absent-pids.stderr':'',
    'race-trigger-slot.json':slotBytes,'race-first-services-timing.json':JSON.stringify(first)+'\n'})) fs.writeFileSync(path.join(out,name),value);
  const attempt=(name,denial=false)=>{
    const directory=path.join(out,name);fs.mkdirSync(directory);
    for(const [file,content] of [['logcat.txt',controlEvents(denial).join('\n')],['services.txt',trackerService]]) {
      fs.writeFileSync(path.join(directory,file),content);
      fs.writeFileSync(path.join(directory,file+'.stderr'),'');fs.writeFileSync(path.join(directory,file+'.exit-code.txt'),'0\n');
    }
    return [path.join(directory,'logcat.txt'),path.join(directory,'services.txt'),'111','race','app.passengercount:tracking',path.join(out,'race-result.json'),true];
  };
  try {fn({out,parent,slot,first,attempt});} finally {fs.rmSync(parent,{recursive:true,force:true});}
}
test('control publication binds exact timing receipts and reports differences instead of equality',()=>controlPublicationFixture(({attempt})=>{
  const result=publishRestartRace(...attempt('first'));
  assert.equal(result.outcome,'foreground-observed-no-trigger');assert.equal(result.comparisonEligible,true);
  assert.deepEqual(result.comparisonTiming.controlMinusTriggered,{slotElapsedNs:100000,firstServicesFromAbsenceNs:499000,firstServicesAfterSlotNs:300000,servicesElapsedNs:0});
  assert.equal(result.comparisonTiming.timingEqualityEstablished,false);
}));
for(const fault of ['missing-absence','wrong-absence','absence-stderr','missing-slot','oversized-slot','slot-reference','slot-elapsed','slot-replay','negative-number','unsafe-number','first-reference','first-order','first-gap','first-absence','triggered-reference','triggered-source'])
test('control metadata '+fault+' is uncertainty without erasing complete denial',()=>{
  for(const denial of [false,true]) controlPublicationFixture(({out,parent,slot,first,attempt})=>{
    const save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value)+'\n');
    if(fault==='missing-absence') fs.unlinkSync(path.join(out,'race-absent-pids.exit-code.txt'));
    if(fault==='wrong-absence') fs.writeFileSync(path.join(out,'race-absent-pids.exit-code.txt'),'0\n');
    if(fault==='absence-stderr') fs.writeFileSync(path.join(out,'race-absent-pids.stderr'),'transport warning');
    if(fault==='missing-slot') fs.unlinkSync(path.join(out,'race-trigger-slot.json'));
    if(fault==='oversized-slot') fs.writeFileSync(path.join(out,'race-trigger-slot.json'),' '.repeat(65537));
    if(fault==='slot-reference') {slot.reference.sha256='bad';save('race-trigger-slot.json',slot);}
    if(fault==='slot-elapsed') {slot.elapsedNs++;save('race-trigger-slot.json',slot);}
    if(fault==='slot-replay') {slot.requestedReplayNs++;save('race-trigger-slot.json',slot);}
    if(fault==='negative-number') {slot.slotStartNs=-1;save('race-trigger-slot.json',slot);}
    if(fault==='unsafe-number') {slot.slotEndNs=Number.MAX_SAFE_INTEGER+1;save('race-trigger-slot.json',slot);}
    if(fault==='first-reference') {first.slotEvidence.sha256='bad';save('race-first-services-timing.json',first);}
    if(fault==='first-order') {first.firstServicesStartNs=1;save('race-first-services-timing.json',first);}
    if(fault==='first-gap') {first.gapAfterSlotNs++;save('race-first-services-timing.json',first);}
    if(fault==='first-absence') {first.verifiedAbsenceNs++;save('race-first-services-timing.json',first);}
    if(fault==='triggered-reference') {
      const file=path.join(parent,'race-first-services-timing.json'),data=JSON.parse(fs.readFileSync(file));data.slotEvidence.sha256='bad';fs.writeFileSync(file,JSON.stringify(data));
    }
    if(fault==='triggered-source') fs.appendFileSync(path.join(parent,'race-trigger-slot.json'),' ');
    const result=publishRestartRace(...attempt('attempt',denial));
    assert.equal(result.comparisonEligible,false);assert.equal(result.comparisonTiming.status,'unverified');
    assert.equal(result.outcome,denial?'automatic-restart-denied':'control-comparison-unverified');
    assert.ok(result.controlEvidenceErrors.length);
  });
});
test('later control partial input cannot overwrite a prior exact paired observation',()=>controlPublicationFixture(({out,attempt})=>{
  const first=attempt('first');publishRestartRace(...first);const previous=fs.readFileSync(path.join(out,'race-result.json'));
  const later=attempt('later',true);fs.writeFileSync(later[0]+'.stderr','partial capture');
  assert.throws(()=>publishRestartRace(...later),/Incomplete log/);
  assert.deepEqual(fs.readFileSync(path.join(out,'race-result.json')),previous);
}));

test('missing replay timing cannot hide a control denial or make foreground an accepted contrast',()=>{
  for(const denial of [false,true]) {
    const r=runShell(controlEvents(denial),trackerService,false,true,{kind:'race',uiAlive:false},{stage:'timing'},true,true);
    assert.equal(r.status,denial?1:2,r.stdout+r.stderr);
    assert.equal(r.result.outcome,denial?'automatic-restart-denied':'control-comparison-unverified');
    assert.equal(r.result.comparisonEligible,false);
    assert.match(r.files['host-idle.stderr'],/RACE_HOST_TIMING_UNVERIFIED/);
    assert.doesNotMatch(r.calls,/app.passengercount.tests.TRIGGER|phase verify-/);
  }
});
test('raw memory-pressure restart rescheduling remains in the bound control evidence',()=>{
  const events=controlEvents(true);
  events.splice(4,0,'ActivityManager: Rescheduling restart of crashed service app.passengercount/.TrackService in 8975ms for mem-pressure-event',
    'ActivityManager: Rescheduling restart of crashed service app.passengercount/.TrackService in 0ms for mem-pressure-event');
  const r=runShell(events,'',false,true,{kind:'race',uiAlive:false},null,true,true);
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.files[r.result.evidence.log.path],/in 8975ms for mem-pressure-event\nActivityManager: Rescheduling.*in 0ms for mem-pressure-event/);
  assert.equal(digest(r.files[r.result.evidence.log.path]),r.result.evidence.log.sha256);
});

const hostTiming=shell.slice(shell.indexOf('race_host_timing() {'),shell.indexOf('\nrestart_race() {'));
function timingCall(args) {
  return spawnSync('bash',['-c',`${hostTiming}\nrace_host_timing "$@"`,'_',...args.map(String)],{encoding:'utf8',timeout:3000});
}
test('real host helper records absence, bounded idle, actual overshoot and first-services gap',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-host-clock-'));
  try {
    const first=path.join(dir,'trigger.json'),control=path.join(dir,'control.json'),services=path.join(dir,'services.json');
    let r=timingCall(['record',first,100,200,20200,0]);assert.equal(r.status,0,r.stderr);
    const before=Number(timingCall(['now']).stdout.trim());
    r=timingCall(['idle',first,control,before]);assert.equal(r.status,0,r.stderr);
    const slot=JSON.parse(fs.readFileSync(control));
    assert.equal(slot.reference.sha256,digest(fs.readFileSync(first)));
    assert.equal(slot.requestedReplayNs,20000);assert.ok(slot.elapsedNs>=20000);
    assert.equal(slot.replayDifferenceNs,slot.elapsedNs-20000);
    const start=Number(timingCall(['now']).stdout.trim()),end=Number(timingCall(['now']).stdout.trim());
    r=timingCall(['first-services',control,services,start,end]);assert.equal(r.status,0,r.stderr);
    const result=JSON.parse(fs.readFileSync(services));
    assert.equal(result.elapsedFromAbsenceNs,start-before);assert.equal(result.gapAfterSlotNs,start-slot.slotEndNs);
    assert.equal(result.slotEvidence.sha256,digest(fs.readFileSync(control)));
    assert.equal(timingCall(['record',first,100,200,300,0]).status,2,'never overwrite a previous timing receipt');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
for(const fault of ['over-limit','negative','elapsed-mismatch','nonzero-capture','missing-clock','oversized','absent'])
test('host idle refuses unverified input '+fault+' without waiting or publishing',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-host-clock-invalid-'));
  try {
    const {slot}=timingFixture(dir),file=path.join(dir,'race-trigger-slot.json'),out=path.join(dir,'control.json');
    if(fault==='over-limit') {slot.elapsedNs=10000000001;slot.slotEndNs=slot.slotStartNs+slot.elapsedNs;}
    if(fault==='negative') slot.elapsedNs=-1;
    if(fault==='elapsed-mismatch') slot.elapsedNs++;
    if(fault==='nonzero-capture') slot.captureExitCode=2;
    if(fault==='missing-clock') delete slot.clock;
    fs.writeFileSync(file,fault==='oversized'?' '.repeat(65537):JSON.stringify(slot));
    if(fault==='absent') fs.unlinkSync(file);
    const r=timingCall(['idle',file,out,100]);
    assert.equal(r.status,2,r.stdout+r.stderr);assert.match(r.stderr,/RACE_HOST_TIMING_UNVERIFIED/);assert.equal(fs.existsSync(out),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('control TERM preserves124 and partials while skipping new collectors and retaining owned teardown',()=>{
  const installed=fs.readFileSync(path.join(root,'scripts/test-android-installed.sh'),'utf8');
  const cleanup=installed.slice(installed.indexOf('\ncleanup() {'),installed.indexOf('\ngit -C "$ROOT" rev-parse'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-control-term-'));
  try {
    fs.writeFileSync(path.join(dir,'partial.txt'),'partial bytes');
    const r=spawnSync('bash',['-c',`set -euo pipefail
OUT=${JSON.stringify(dir)}; EMU_PID=999999; GPS_PID=; LOG_PID=; PLATFORM_PREFLIGHT_READY=1; PACKAGE=app.passengercount
PASSENGER_RESTART_NO_TRIGGER=1
adb(){ echo "adb $*" >> "$OUT/calls"; }
wait(){ echo wait >> "$OUT/calls"; }
platform_preflight(){ echo UNEXPECTED_PREFLIGHT >> "$OUT/calls"; }
framework_binary_capture(){ echo UNEXPECTED_FRAMEWORK >> "$OUT/calls"; }
${cleanup}
kill -TERM $$
echo unexpected-return
`],{encoding:'utf8',timeout:3000});
    assert.equal(r.status,124,r.stdout+r.stderr);
    assert.equal(fs.readFileSync(path.join(dir,'exit-code.txt'),'utf8'),'124\n');
    assert.equal(fs.readFileSync(path.join(dir,'partial.txt'),'utf8'),'partial bytes');
    assert.equal(fs.readFileSync(path.join(dir,'calls'),'utf8'),'adb emu kill\nwait\n');
    assert.equal(r.stdout,'');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

function provenanceFixture(parent,out) {
  for(const [name,value] of Object.entries({
    'apk-sha256.txt':`${'a'.repeat(64)}  /source/android/build/PassengerCount.apk\n${'b'.repeat(64)}  /source/android/build/lifecycle-tests/PassengerCount-lifecycle-tests.apk\n`,
    'device-fingerprint.txt':'google/sdk_gphone64_x86_64/emu64xa:15/AP3A/123:userdebug/dev-keys\n',
    'source.txt':`${'c'.repeat(40)}\n${'d'.repeat(40)}\n`,
  })) for(const directory of [parent,out]) fs.writeFileSync(path.join(directory,name),value);
}
for(const filename of ['apk-sha256.txt','device-fingerprint.txt','source.txt'])
for(const fault of ['missing','different','both-malformed'])
test(`paired ${filename} ${fault} invalidates comparison, not observed denial`,()=>{
  for(const denial of [false,true]) controlPublicationFixture(({out,parent,attempt})=>{
    if(fault==='missing') fs.unlinkSync(path.join(out,filename));
    if(fault==='different') fs.appendFileSync(path.join(out,filename),'different');
    if(fault==='both-malformed') for(const directory of [parent,out]) fs.writeFileSync(path.join(directory,filename),'invalid');
    const result=publishRestartRace(...attempt('attempt',denial));
    assert.equal(result.outcome,denial?'automatic-restart-denied':'control-comparison-unverified');
    assert.equal(result.comparisonEligible,false);assert.equal(result.pairProvenance.status,'unverified');
    assert.equal(result.pairProvenance.wholeImageOrRuntimeEquivalenceEstablished,false);
    if(fault==='different') {
      const key={'apk-sha256.txt':'apkHashes','device-fingerprint.txt':'fingerprint','source.txt':'source'}[filename];
      assert.notEqual(result.evidence['control'+key].sha256,result.evidence['triggered'+key].sha256);
    }
  });
});
test('paired provenance identifies exact APKs/head/tree/fingerprint, not runtime equivalence',()=>controlPublicationFixture(({attempt})=>{
  const result=publishRestartRace(...attempt('first'));
  assert.equal(result.comparisonEligible,true);assert.equal(result.pairProvenance.status,'matching-exact-receipts');
  assert.equal(result.pairProvenance.apkSha256.target,'a'.repeat(64));
  assert.equal(result.pairProvenance.source.tree,'d'.repeat(40));
  assert.equal(result.pairProvenance.wholeImageOrRuntimeEquivalenceEstablished,false);
}));

for(const name of ['race-process-scope.txt','no-trigger-control.txt','race-result.txt'])
test('control-only receipt write failure is uncertainty2: '+name,()=>{
  const r=runShell(controlEvents(),trackerService,false,true,{kind:'race',uiAlive:false},{stage:'control-receipt',name},true,true);
  assert.equal(r.status,2,r.stdout+r.stderr);assert.doesNotMatch(r.calls,/phase verify-/);
  if(name==='race-result.txt') assert.equal(r.result.outcome,'foreground-observed-no-trigger');
});
