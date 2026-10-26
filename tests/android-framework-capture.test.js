import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
const start=source.indexOf('framework_binary_capture() {');
const cleanupStart=source.indexOf('\ncleanup() {',start);
const cleanupEnd=source.indexOf('\ntrap cleanup EXIT',cleanupStart);
assert.ok(start>0&&cleanupStart>start&&cleanupEnd>cleanupStart);
const captureFunction=source.slice(start,cleanupStart);
const cleanup=source.slice(cleanupStart,cleanupEnd);

test('framework binary collector regressions use only host fixture commands',()=>{
  const r=spawnSync('python3',[fileURLToPath(new URL('./android-framework-capture.test.py',import.meta.url))],
    {encoding:'utf8',timeout:60000});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stderr,/Ran \d+ tests/);
});

function fixture({gate=1,capture=0,ready=true,repeat=false,mkdirFailure=false,receiptFailure=false}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-framework-wiring-'));
  try {
    fs.writeFileSync(path.join(dir,'race-result.json'),'ORIGINAL DENIAL\n');
    if(receiptFailure)fs.mkdirSync(path.join(dir,'exit-code.txt'));
    const script=`set -euo pipefail
OUT=${JSON.stringify(dir)}; ROOT=/source; ANDROID_HOME=/sdk; ADB=/sdk/adb; SERIAL=emulator-5556
PACKAGE=app.passengercount; EMU_PID=999999; GPS_PID=; LOG_PID=; PLATFORM_PREFLIGHT_READY=${ready?'1':'0'}
adb(){ printf '%s\\n' "$*" >> "$OUT/adb-commands"; }
wait(){ :; }
platform_preflight(){ printf 'platform-before-framework\\n' >> "$OUT/order"; return 2; }
timeout(){ [[ "$1" == --kill-after=5s && "$2" == 120s ]] || return 99; shift 2; "$@"; }
python3(){
  printf '%s\\n' "$*"
  ${receiptFailure?':':`[[ "$(cat "$OUT/exit-code.txt")" == ${gate} ]] || return 98`}
  grep -q platform-before-framework "$OUT/order" || return 97
  printf 'framework-after-original-and-platform\\n' >> "$OUT/order"
  printf 'collector fixture stderr\\n' >&2
  return ${capture}
}
${mkdirFailure?'mktemp(){ return 1; }':''}
${captureFunction}
${cleanup}
${repeat?`printf '${gate}\\n' > "$OUT/exit-code.txt"\nplatform_preflight after-tests || :\nframework_binary_capture || :`:''}
trap cleanup EXIT
exit ${gate}
`;
    const r=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:5000});
    const attempts=fs.readdirSync(dir).filter(n=>n.startsWith('framework-static.')).sort().map(n=>({
      name:n,code:fs.readFileSync(path.join(dir,n,'collector-exit-code.txt'),'utf8'),
      stdout:fs.readFileSync(path.join(dir,n,'collector.stdout'),'utf8'),
      stderr:fs.readFileSync(path.join(dir,n,'collector.stderr'),'utf8'),
    }));
    return {...r,attempts,gateCode:fs.existsSync(path.join(dir,'exit-code.txt'))&&fs.statSync(path.join(dir,'exit-code.txt')).isFile()?fs.readFileSync(path.join(dir,'exit-code.txt'),'utf8'):null,
      original:fs.readFileSync(path.join(dir,'race-result.json'),'utf8'),
      adb:fs.existsSync(path.join(dir,'adb-commands'))?fs.readFileSync(path.join(dir,'adb-commands'),'utf8'):''};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

for(const [gate,capture] of [[0,2],[1,0],[1,2],[1,124],[1,137],[2,0],[255,2]])
test(`framework static status ${capture} cannot replace original exit ${gate}`,()=>{
  const r=fixture({gate,capture});
  assert.equal(r.status,gate,r.stdout+r.stderr);
  assert.equal(r.gateCode,`${gate}\n`);
  assert.equal(r.attempts.length,1);
  assert.equal(r.attempts[0].code,`${capture}\n`);
  assert.match(r.attempts[0].stdout,/--serial emulator-5556 --adb \/sdk\/adb --output-root /);
  assert.match(r.attempts[0].stdout,/--dexdump \/sdk\/build-tools\/35.0.0\/dexdump/);
  assert.equal(r.attempts[0].stderr,'collector fixture stderr\n');
  assert.equal(r.original,'ORIGINAL DENIAL\n');
  assert.match(r.adb,/emu kill/);
});

test('repeated framework captures retain distinct prior attempts',()=>{
  const r=fixture({repeat:true,capture:2});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.equal(r.attempts.length,2);
  assert.notEqual(r.attempts[0].name,r.attempts[1].name);
  for(const a of r.attempts)assert.equal(a.code,'2\n');
  assert.equal(r.original,'ORIGINAL DENIAL\n');
});
test('framework destination failure preserves denial and owned-emulator teardown',()=>{
  const r=fixture({mkdirFailure:true});
  assert.equal(r.status,1);assert.equal(r.gateCode,'1\n');assert.equal(r.attempts.length,0);
  assert.match(r.stderr,/FRAMEWORK_STATIC_CAPTURE_UNAVAILABLE/);assert.match(r.adb,/emu kill/);
});
test('framework capture never probes an unprepared target',()=>{
  const r=fixture({ready:false,gate:2});
  assert.equal(r.status,2);assert.equal(r.attempts.length,0);
});
for(const gate of [1,2,255])test(`failed original receipt write still retains exit ${gate} across framework capture`,()=>{
  const r=fixture({gate,receiptFailure:true});
  assert.equal(r.status,gate,r.stdout+r.stderr);assert.equal(r.gateCode,null);
  assert.match(r.stderr,/ORIGINAL_EXIT_RECEIPT_UNAVAILABLE/);assert.match(r.adb,/emu kill/);
  assert.equal(r.original,'ORIGINAL DENIAL\n');
});
test('exact binary capture runs only in terminal cleanup, outside all acceptance phases',()=>{
  assert.equal((source.match(/framework_binary_capture \|\|/g)||[]).length,1);
  assert.ok(cleanup.indexOf('> "$OUT/exit-code.txt"')<cleanup.indexOf('framework_binary_capture ||'));
  assert.ok(cleanup.indexOf('platform_preflight after-tests')<cleanup.indexOf('framework_binary_capture ||'));
  assert.doesNotMatch(source.slice(source.indexOf('\nphase() {')),/framework_binary_capture|capture-android-framework/);
  const race=fs.readFileSync(new URL('../scripts/android-restart-race.sh',import.meta.url),'utf8');
  assert.doesNotMatch(race,/framework_binary_capture|capture-android-framework|dexdump/);
});

test('outer deadline kills TERM-resistant local collector group without changing the original denial',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-framework-timeout-'));
  let childPid;
  try {
    fs.mkdirSync(path.join(dir,'scripts'));
    fs.writeFileSync(path.join(dir,'race-result.json'),'ORIGINAL DENIAL\n');
    fs.writeFileSync(path.join(dir,'scripts/capture-android-framework.py'),`import os,signal,subprocess,sys,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nroot=sys.argv[sys.argv.index('--output-root')+1]\nchild=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)'])\nopen(os.path.join(root,'child-pid'),'w').write(str(child.pid))\nprint('partial output before forced termination',flush=True)\ntime.sleep(30)\n`);
    const script=`set -euo pipefail
OUT=${JSON.stringify(dir)}; ROOT=$OUT; ANDROID_HOME=/sdk; ADB=/sdk/adb; SERIAL=emulator-5556
PACKAGE=app.passengercount; EMU_PID=999999; GPS_PID=; LOG_PID=; PLATFORM_PREFLIGHT_READY=1
adb(){ printf '%s\\n' "$*" >> "$OUT/adb-commands"; }
wait(){ :; }
platform_preflight(){ :; }
timeout(){ [[ "$1" == --kill-after=5s && "$2" == 120s ]] || return 99; shift 2; command timeout --kill-after=0.3s 0.3s "$@"; }
${captureFunction}
${cleanup}
trap cleanup EXIT
exit 1
`;
    const r=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:6000});
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.equal(fs.readFileSync(path.join(dir,'exit-code.txt'),'utf8'),'1\n');
    assert.equal(fs.readFileSync(path.join(dir,'race-result.json'),'utf8'),'ORIGINAL DENIAL\n');
    const attempt=path.join(dir,fs.readdirSync(dir).find(n=>n.startsWith('framework-static.')));
    assert.equal(fs.readFileSync(path.join(attempt,'collector-exit-code.txt'),'utf8'),'137\n');
    assert.match(fs.readFileSync(path.join(attempt,'collector.stdout'),'utf8'),/partial output/);
    assert.ok(!fs.existsSync(path.join(attempt,'receipt.json')),'a forcibly killed collector did not produce a receipt');
    assert.match(fs.readFileSync(path.join(dir,'adb-commands'),'utf8'),/emu kill/);
    childPid=Number(fs.readFileSync(path.join(attempt,'child-pid'),'utf8'));
    let state='gone';
    try { state=fs.readFileSync(`/proc/${childPid}/stat`,'utf8').split(') ')[1].split(' ')[0]; }
    catch(error) { assert.equal(error.code,'ENOENT'); }
    assert.ok(state==='gone'||state==='Z',`owned child still running: ${state}`);
  } finally {
    if(childPid)try {process.kill(childPid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
