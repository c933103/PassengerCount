import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyzeRestartRace, publishRestartRace} from '../scripts/analyze-android-restart-race.mjs';

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
function runShell(events,dump=service,transportError=false,warmReady=true,scope=null,fault=null) {
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'pc-race-'));
  try {
    fs.writeFileSync(path.join(out,'input.log'),(warmReady?['10-15 09:09:30.000 333 333 I PassengerRaceTrigger: RACE_WARM_READY pid=333 uid=10210',...events]:events).join('\n'));fs.writeFileSync(path.join(out,'input.services'),dump);
    const r=spawnSync('bash',['-c',`set -euo pipefail
ROOT=${JSON.stringify(root)}; OUT=${JSON.stringify(out)}; CI=true; EMU_PID=99; SERIAL=emulator-5556; PACKAGE=app.passengercount
${scope ? "TRACK_PROCESS=app.passengercount:tracking" : ""}
fixtureClock=0
observation_logs=0; observation_services=0; classifier_calls=0
sleep(){ fixtureClock=$((fixtureClock+1)); }
node(){
 classifier_calls=$((classifier_calls+1))
 ${fault?.stage === 'classifier' ? `if [[ "$classifier_calls" == ${fault.at ?? 2} ]]; then echo 'injected classifier failure' >&2; return 3; fi` : ''}
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
  'shell pidof app.passengercount app.passengercount:tracking') ${scope?.absenceOutput ? `echo ${JSON.stringify(scope.absenceOutput)};` : ''} ${scope?.absenceStderr ? `echo ${JSON.stringify(scope.absenceStderr)} >&2;` : ''} return ${scope?.absenceExit ?? 1};;
  'logcat -d -v threadtime')
   if [[ -f "$OUT/triggered" ]]; then
    observation_logs=$((observation_logs+1))
    ${fault?.stage === 'log' ? `if [[ "$observation_logs" == ${fault.at ?? 2} ]]; then printf 'partial log'; ${fault.stderr ? `echo ${JSON.stringify(fault.stderr)} >&2;` : ''} return ${fault.exit ?? 1}; fi` : ''}
   fi
   cat "$OUT/input.log";;
  'shell dumpsys activity services app.passengercount')
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
  } finally {fs.rmSync(out,{recursive:true,force:true});}
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
  if(fault.stage==='classifier') assert.equal(r.files[failed+'/classifier-exit-code.txt'],'3\n');
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
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stderr,/RACE_AUTOMATIC_RESTART_DENIED/);
  assert.match(r.stderr,/result publication failed/);
  assert.deepEqual(fs.readFileSync(first[5]),previous);
}));
