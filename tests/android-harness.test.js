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
function detachedFixture({output,stderr='',code=0,call='detached valid 111'}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passenger-detached-'));
  try {
    fs.writeFileSync(path.join(dir,'dump'),output);
    fs.writeFileSync(path.join(dir,'stderr'),stderr);
    const script=`set -euo pipefail
OUT=${JSON.stringify(dir)}; PACKAGE=app.passengercount
adb(){
  printf '%s\\n' "$*" > "$OUT/command"
  cat "$OUT/dump"
  cat "$OUT/stderr" >&2
  return ${code}
}
${detachedCheck}
${call}
`;
    const result=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:5000});
    return {status:result.status,output:result.stdout+result.stderr,command:fs.readFileSync(path.join(dir,'command'),'utf8')};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const processHeader='ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)';
const pidMapping='  PID mappings:\n    PID #111: ProcessRecord{abc 111:app.passengercount/u0a100}\n';
const processEnd='  mForceBackgroundCheck=false\n';
const detachedDump=processHeader+'\n'+pidMapping+processEnd;
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
  ['truncated after PID mapping',processHeader+'\n'+pidMapping,0],
  ['unrecognized trailing output',detachedDump+'unexpected trailing result\n',0],
  ['missing header',pidMapping,0],
  ['another process PID',detachedDump.replaceAll('111','222'),0],
  ['command failure with otherwise valid output',detachedDump,1],
  ['dump timeout',detachedDump+'*** DUMP TIMEOUT ***\n',0],
  ['permission denial',detachedDump+'Permission Denial: cannot dump activity\n',0],
  ['active instrumentation summary',processHeader+'\n  Active instrumentation:\n    Instrumentation #0: ActiveInstrumentation{abc app.passengercount.tests/.JournalLifecycleInstrumentation}\n'+pidMapping+processEnd,0],
  ['active instrumentation on following lines',processHeader+'\n  Active instrumentation:\n    targetInfo=app.passengercount\n'+pidMapping+processEnd,0],
  ['process still instrumented',processHeader+'\n    mInstr=ActiveInstrumentation{abc}\n'+pidMapping+processEnd,0],
]) test('detachment fails closed for '+label,()=>{
  const r=detachedFixture({output,code});assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/DETACHED_STATE_PASS/);
});
for (const error of [
  'Error in poll while dumping service activity : Interrupted system call',
  'Failed to read while dumping service activity: Broken pipe',
  "Error with service 'activity' while dumping: DEAD_OBJECT",
  'Failed to write while dumping service activity: Broken pipe',
  'Failed to create pipe to dump service info for activity: Too many open files',
  "Can't find service: activity",
  'Permission Denial: cannot dump activity',
  'unrecognized diagnostic from transport',
]) test('detachment rejects stderr despite complete stdout and zero exit: '+error,()=>{
  const r=detachedFixture({output:detachedDump,stderr:error+'\n'});
  assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/DETACHED_STATE_PASS/);
});
function processStateDump(state,pid=111) {
  return processHeader+'\n  *APP* UID 100 ProcessRecord{abc '+pid+':app.passengercount/u0a100}\n'
    +'    curProcState='+state+' mRepProcState='+state+' setProcState='+state+'\n'+pidMapping+processEnd;
}
for (const [label,expected,actual,pid,passes] of [
  ['actual foreground Activity before user start',2,2,111,true],
  ['actual background foreground-service before kill',4,4,111,true],
  ['background start cannot count as foreground user start',2,4,111,false],
  ['foreground Activity cannot count as background restart context',4,2,111,false],
  ['other process state cannot satisfy target foreground',2,2,222,false],
]) test(label,()=>{
  const r=detachedFixture({output:processStateDump(actual,pid),call:'activity_state control '+expected+' 111'});
  assert.equal(r.status===0,passes,r.output);
  if(passes) assert.match(r.output,/ACTIVITY_STATE_PASS control/);
});
test('both installed crash scenarios prove foreground start then background before the unchanged restart gate',()=>{
  for(const kind of ['valid','deleted']) {
    const begin=source.indexOf('activity_state before-'+kind+' 2 "$oldpid"');
    const prepare=source.indexOf('phase prepare-'+kind+' attached',begin);
    const background=source.indexOf('\nbackground_home\n',prepare);
    const state=source.indexOf('activity_state background-'+kind+' 4 "$oldpid"',background);
    const restart=source.indexOf('crash_observe '+kind+' "$oldpid"',state);
    assert.ok(begin>0&&prepare>begin&&background>prepare&&state>background&&restart>state);
  }
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



test('controlled demotion follows both original sticky restart controls', () => {
  const originalDone = source.indexOf('\nphase verify-deleted\n');
  const controlledStart = source.indexOf('\nphase prepare-denied attached\n');
  assert.ok(originalDone > 0 && controlledStart > originalDone,
    'new policy-demotion fixture and delay must not precede the original sticky controls');
});

// Execute the same shell relay completion logic. A successful owner watcher
// reply alone cannot stand in for execution and detachment in the actual UI.
const phaseStart=source.indexOf('phase() {'), phaseEnd=source.indexOf('\nlaunch_home() {',phaseStart);
assert.ok(phaseStart>=0&&phaseEnd>phaseStart);
const phaseShell=source.slice(phaseStart,phaseEnd).replace(/\bSECONDS\b/g,'fixtureSeconds').replace('fixtureSeconds+65','fixtureSeconds+5');
const uiEnter='I PassengerJournalTest: IPC_UI_ENTER phase=ipc-basics pid=222';
const uiPass='I PassengerJournalTest: PHASE_PASS ipc-basics assertions=9 pid=222';
const uiDetached='I PassengerJournalTest: PHASE_DETACHED ipc-basics pid=222';
function phaseFixture({name='ipc-basics',ui=[uiEnter,uiPass,uiDetached],delayed=false,commandCode=0,logCode=0,watcherCode=-1,relay=true,mode='attached'}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passenger-ui-relay-'));
  try {
    fs.writeFileSync(path.join(dir,'log'),ui.join('\n')+'\n');
    const script=`set -euo pipefail
OUT=${JSON.stringify(dir)}; ADB=fake-adb; SERIAL=emulator-5556; RUNNER=owner-runner; UI_RUNNER=ui-runner
fixtureSeconds=0
sleep(){ fixtureSeconds=$((fixtureSeconds+1)); }
timeout(){ printf '%s\\n' "$*" > "$OUT/command"; echo '${name.startsWith('ipc-')?(relay?'PHASE_RELAY':'PHASE_PASS'):'PHASE_PASS'} ${name} ownerPid=111'; echo 'INSTRUMENTATION_CODE: ${watcherCode}'; return ${commandCode}; }
adb(){ if ${delayed?'((fixtureSeconds<2))':'false'}; then echo '${uiEnter}'; else cat "$OUT/log"; fi; return ${logCode}; }
${phaseShell}
phase ${name} ${mode}
echo "COMPLETE pid=\${IPC_UI_PID:-none}"
`;
    const result=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:5000});
    return {status:result.status,output:result.stdout+result.stderr,command:fs.readFileSync(path.join(dir,'command'),'utf8')};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('UI relay waits for same-PID UI execution and detachment after owner completion',()=>{
  const r=phaseFixture({delayed:true});assert.equal(r.status,0,r.output);assert.match(r.output,/COMPLETE pid=222/);assert.match(r.command,/--no-restart -e phase ipc-basics owner-runner/);
});
for (const [label,options] of [
  ['owner watcher success alone',{ui:[]}],
  ['UI result before entry',{ui:[uiPass,uiEnter,uiDetached]}],
  ['UI did not detach',{ui:[uiEnter,uiPass]}],
  ['UI detached before result',{ui:[uiEnter,uiDetached,uiPass]}],
  ['another UI PID passed',{ui:[uiEnter,uiPass.replace('222','333'),uiDetached]}],
  ['another UI PID detached',{ui:[uiEnter,uiPass,uiDetached.replace('222','333')]}],
  ['another phase passed',{ui:[uiEnter,uiPass.replace('ipc-basics','ipc-drain'),uiDetached]}],
  ['UI explicitly failed',{ui:[uiEnter,uiPass,uiDetached,'I PassengerJournalTest: PHASE_FAIL ipc-basics: failure']}],
  ['log transport failed',{logCode:1}],
  ['instrument command failed',{commandCode:1}],
  ['owner watcher failed',{watcherCode:0}],
  ['owner did not relay',{relay:false}],
]) test('UI relay rejects '+label,()=>{const r=phaseFixture(options);assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/COMPLETE/);});
test('bootstrap uses cold-target UI runner; owner fixtures select owner runner',()=>{
  const bootstrap=phaseFixture({name:'bootstrap',mode:'cold'}), owner=phaseFixture({name:'basics'});
  assert.equal(bootstrap.status,0,bootstrap.output);assert.match(bootstrap.command,/phase bootstrap ui-runner/);assert.doesNotMatch(bootstrap.command,/--no-restart/);
  assert.equal(owner.status,0,owner.output);assert.match(owner.command,/phase basics owner-runner/);
});

const absenceStart=source.indexOf('ui_absent() {'), absenceEnd=source.indexOf('\ndetached() {',absenceStart);
assert.ok(absenceStart>0&&absenceEnd>absenceStart);
const absenceShell=source.slice(absenceStart,absenceEnd);
for(const [label,stdout,stderr,code,expected] of [
  ['no matching process','','',1,0],['UI still alive','222\n','',0,1],
  ['ADB error','','transport failure\n',1,2],['unexpected error','','',7,2],
  ['PID despite nonzero status','222\n','',1,2],['empty successful response','','',0,2]
]) test('UI-only death observation: '+label,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passenger-ui-absence-'));
  try {
    const r=spawnSync('bash',['-c',`set -euo pipefail
OUT=${JSON.stringify(dir)}; PACKAGE=app.passengercount
adb(){ printf '%b' ${JSON.stringify(stdout)}; printf '%b' ${JSON.stringify(stderr)} >&2; return ${code}; }
${absenceShell}
ui_absent
`],{encoding:'utf8',timeout:5000});
    assert.equal(r.status,expected,r.stdout+r.stderr);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
