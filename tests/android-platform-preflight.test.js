import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
const preflightStart=source.indexOf('platform_preflight() {');
const cleanupStart=source.indexOf('\ncleanup() {',preflightStart);
const cleanupEnd=source.indexOf('\ntrap cleanup EXIT',cleanupStart);
assert.ok(preflightStart>0&&cleanupStart>preflightStart&&cleanupEnd>cleanupStart);
const preflight=source.slice(preflightStart,cleanupStart);
const cleanup=source.slice(cleanupStart,cleanupEnd);

test('platform metadata collector host regressions use no actual Android target',()=>{
  const r=spawnSync('python3',[fileURLToPath(new URL('./android-platform-preflight.test.py',import.meta.url))],
    {encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stderr,/Ran \d+ tests/);
});

function fixture({gate=1,capture=0,cleanupMode=false,ready=true,repeat=false,mkdirFailure=false,receiptFailure=false}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-platform-wiring-'));
  try {
    fs.writeFileSync(path.join(dir,'race-result.json'),'ORIGINAL DENIAL\n');
    if(receiptFailure)fs.mkdirSync(path.join(dir,'exit-code.txt'));
    const script=`set -euo pipefail
OUT=${JSON.stringify(dir)}; ROOT=/source; ANDROID_HOME=/sdk; ADB=/sdk/adb; SERIAL=emulator-5556
PACKAGE=app.passengercount; EMU_PID=999999; GPS_PID=; LOG_PID=; PLATFORM_PREFLIGHT_READY=${ready?'1':'0'}
adb(){ printf '%s\\n' "$*" >> "$OUT/adb-commands"; }
wait(){ :; }
timeout(){
  [[ "$1" == 35s ]] || return 99
  shift; "$@"
}
python3(){
  printf '%s\\n' "$*"
  ${cleanupMode?`[[ "$(cat "$OUT/exit-code.txt")" == ${gate} ]] || return 98`:':'}
  printf 'collector partial stderr\\n' >&2
  return ${capture}
}
${mkdirFailure?'mktemp(){ return 1; }':''}
${preflight}
${cleanupMode?`${cleanup}\ntrap cleanup EXIT\nexit ${gate}`:`platform_preflight before-tests || observed=$?\n${repeat?'platform_preflight before-tests || observed=$?':''}\nprintf 'caller-continued\\n'`}
`;
    const r=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:5000});
    const attempts=fs.readdirSync(dir).filter(n=>n.startsWith('platform-capability-')).sort().map(n=>({
      name:n,code:fs.readFileSync(path.join(dir,n,'collector-exit-code.txt'),'utf8'),
      stdout:fs.readFileSync(path.join(dir,n,'collector.stdout'),'utf8'),
      stderr:fs.readFileSync(path.join(dir,n,'collector.stderr'),'utf8'),
    }));
    return {...r,attempts,gateCode:fs.existsSync(path.join(dir,'exit-code.txt'))&&fs.statSync(path.join(dir,'exit-code.txt')).isFile()?fs.readFileSync(path.join(dir,'exit-code.txt'),'utf8'):null,
      original:fs.readFileSync(path.join(dir,'race-result.json'),'utf8'),
      adb:fs.existsSync(path.join(dir,'adb-commands'))?fs.readFileSync(path.join(dir,'adb-commands'),'utf8'):''};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

for(const capture of [0,2,124,137])test(`metadata wrapper retains collector exit ${capture} separately`,()=>{
  const r=fixture({capture});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.attempts.length,1);
  assert.equal(r.attempts[0].code,`${capture}\n`);
  assert.match(r.attempts[0].stdout,/--serial emulator-5556 --adb \/sdk\/adb --output-root /);
  assert.match(r.attempts[0].stdout,/--sdk-image-dir \/sdk\/system-images\/android-35\/google_apis\/x86_64/);
  assert.equal(r.attempts[0].stderr,'collector partial stderr\n');
  assert.equal(r.original,'ORIGINAL DENIAL\n');
});

for(const [gate,capture] of [[0,2],[1,0],[1,2],[1,124],[2,0],[255,2]])
test(`actual EXIT cleanup retains original ${gate} despite metadata ${capture}`,()=>{
  const r=fixture({gate,capture,cleanupMode:true});
  assert.equal(r.status,gate,r.stdout+r.stderr);
  assert.equal(r.gateCode,`${gate}\n`);
  assert.equal(r.attempts[0].code,`${capture}\n`);
  assert.equal(r.original,'ORIGINAL DENIAL\n');
  assert.match(r.adb,/emu kill/);
});

test('metadata retries get distinct attempt directories and retain prior bytes',()=>{
  const r=fixture({repeat:true,capture:2});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.attempts.length,2);
  assert.notEqual(r.attempts[0].name,r.attempts[1].name);
  for(const a of r.attempts)assert.equal(a.code,'2\n');
  assert.equal(r.original,'ORIGINAL DENIAL\n');
});
test('metadata output failure cannot replace the original gate exit',()=>{
  const r=fixture({cleanupMode:true,gate:1,mkdirFailure:true});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.equal(r.gateCode,'1\n');assert.equal(r.attempts.length,0);
  assert.match(r.stderr,/PLATFORM_CAPABILITY_CAPTURE_UNAVAILABLE/);
});
test('cleanup does not probe a target before owned-emulator preparation completed',()=>{
  const r=fixture({cleanupMode:true,gate:2,ready:false});
  assert.equal(r.status,2);assert.equal(r.gateCode,'2\n');assert.equal(r.attempts.length,0);
});
test('metadata probes stay before test preparation and after terminal result, never in absence interval',()=>{
  const first=source.indexOf('\nphase bootstrap\n');
  const startup=source.indexOf('  platform_preflight before-tests ||');
  assert.ok(startup>source.indexOf('adb shell dumpsys package "$PACKAGE"')&&startup<first);
  assert.ok(source.indexOf('adb logcat -v threadtime')>startup);
  assert.equal((source.match(/platform_preflight before-tests/g)||[]).length,1);
  assert.equal((source.match(/platform_preflight after-tests/g)||[]).length,1);
  assert.doesNotMatch(source.slice(first),/platform_preflight|capture-android-platform-preflight/);
  const race=fs.readFileSync(new URL('../scripts/android-restart-race.sh',import.meta.url),'utf8');
  assert.doesNotMatch(race,/platform_preflight|capture-android-platform-preflight/);
  assert.ok(cleanup.indexOf('> "$OUT/exit-code.txt"')<cleanup.indexOf('platform_preflight after-tests'));
});

for(const gate of [1,2,255])test(`original receipt write failure still retains exit ${gate} and tears down owned emulator`,()=>{
  const r=fixture({cleanupMode:true,gate,receiptFailure:true});
  assert.equal(r.status,gate,r.stdout+r.stderr);
  assert.equal(r.gateCode,null);
  assert.match(r.stderr,/ORIGINAL_EXIT_RECEIPT_UNAVAILABLE/);
  assert.match(r.adb,/emu kill/);
  assert.equal(r.original,'ORIGINAL DENIAL\n');
});
