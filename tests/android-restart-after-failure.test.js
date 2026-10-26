import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const runner=fs.readFileSync(new URL('../scripts/test-android-restart-after-failure.sh',import.meta.url),'utf8');
function run({original=1,diagnostic=0,optIn='1',missing=false,mutate=false,kvmExit=0,
  observation=0,diagnosticReceiptFailure=false,control=0,timingMissing=false,
  controlReceiptFailure=false,mutateTriggered=false,controlKvmExit=0,
  controlDirectoryFailure=false,staleControlFiles=null,ambientNoTrigger='0',
  controlBody='',runnerTransform=s=>s}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pc-post-failure-'));
  try {
    const originalDir=path.join(root,'android/build/lifecycle-evidence');
    const diag=path.join(root,'android/build/restart-race-evidence');
    const controlDir=path.join(diag,'no-trigger-control');
    fs.mkdirSync(originalDir,{recursive:true});fs.mkdirSync(path.join(root,'scripts'));
    if(!missing)fs.writeFileSync(path.join(originalDir,'exit-code.txt'),`${original}\n`);
    fs.writeFileSync(path.join(originalDir,'source.txt'),'original-commit\noriginal-tree\n');
    fs.writeFileSync(path.join(originalDir,'logcat-final.txt'),'ORIGINAL FAILURE TRACE\n');
    for(const [relative,bytes] of Object.entries(staleControlFiles??{})) {
      const filename=path.join(controlDir,relative);
      fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes);
    }
    fs.writeFileSync(path.join(root,'scripts/test-android-restart-after-failure.sh'),runnerTransform(runner));
    fs.writeFileSync(path.join(root,'scripts/analyze-android-foreground-observation.py'),`import sys\nprint('host observation fixture')\nraise SystemExit(${observation})\n`);
    fs.writeFileSync(path.join(root,'scripts/ensure-android-kvm.sh'),`#!/bin/bash
[[ "$1" == diagnostic ]] || exit 9
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
printf 'kvm\\n' >> "$ROOT/fixture-order.txt"
printf 'KVM fixture check\\n'
if [[ -f "$ROOT/fixture-kvm-ran.txt" ]]; then exit ${controlKvmExit}; fi
printf 'first\\n' > "$ROOT/fixture-kvm-ran.txt"
exit ${kvmExit}
`);
    const timing={kind:'host-timing-observation-not-acceptance',mode:'triggered',status:'measured',
      clock:'time.monotonic_ns',verifiedAbsenceNs:999000000,
      slotStartNs:1000000000,slotEndNs:1010000000,elapsedNs:10000000,captureExitCode:0};
    fs.writeFileSync(path.join(root,'scripts/test-android-installed.sh'),`#!/bin/bash
set -euo pipefail
[[ "$PASSENGER_RESTART_RACE_ONLY" == 1 && "$PASSENGER_RESTART_RACE" == 1 ]]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIAG="$ROOT/android/build/restart-race-evidence"
if [[ "\${PASSENGER_RESTART_NO_TRIGGER:-0}" == 1 ]]; then
  OUT="$DIAG/no-trigger-control"
  mkdir -p "$OUT"
  printf 'control\\n' >> "$ROOT/fixture-order.txt"
  printf 'no-trigger control executed\\n' > "$OUT/fixture-executed.txt"
  if [[ -f "$DIAG/diagnostic-step-exit-code.txt" ]]; then
    cat "$DIAG/diagnostic-step-exit-code.txt" > "$OUT/triggered-receipt-before-control.txt"
  else
    printf 'MISSING\\n' > "$OUT/triggered-receipt-before-control.txt"
  fi
  printf 'CONTROL PARTIAL TRACE\\n' > "$OUT/logcat-partial.txt"
  ${controlReceiptFailure?'mkdir -p "$OUT/control-exit-code.txt"':''}
  ${mutateTriggered?'printf corrupted > "$DIAG/logcat-final.txt"':''}
  ${controlBody}
  exit ${control}
fi
printf 'triggered\\n' >> "$ROOT/fixture-order.txt"
printf 'separate diagnostic executed\\n' > "$DIAG/fixture-executed.txt"
printf 'TRIGGERED RAW TRACE\\n' > "$DIAG/logcat-final.txt"
printf '${diagnostic}\\n' > "$DIAG/exit-code.txt"
${timingMissing?'':`printf '%s\\n' '${JSON.stringify(timing)}' > "$DIAG/race-trigger-slot.json"`}
${diagnosticReceiptFailure?'mkdir "$DIAG/diagnostic-step-exit-code.txt"':''}
${controlDirectoryFailure?'printf unavailable > "$DIAG/no-trigger-control"':''}
${mutate?'printf corrupted > "$ROOT/android/build/lifecycle-evidence/logcat-final.txt"':''}
exit ${diagnostic}
`);
    const r=spawnSync('bash',[path.join(root,'scripts/test-android-restart-after-failure.sh')],
      {encoding:'utf8',timeout:15000,env:{...process.env,CI:'true',PASSENGER_RESTART_RACE:optIn,
        PASSENGER_RESTART_NO_TRIGGER:ambientNoTrigger}});
    const read=filename=>fs.existsSync(filename)&&fs.statSync(filename).isFile()?fs.readFileSync(filename,'utf8'):null;
    const files={},fileHashes={};
    const visit=(directory,prefix='')=>{
      if(!fs.existsSync(directory))return;
      for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
        const filename=path.join(directory,entry.name),relative=prefix+entry.name;
        if(entry.isDirectory())visit(filename,relative+'/');
        else if(entry.isFile()) {
          const bytes=fs.readFileSync(filename);files[relative]=bytes.toString('utf8');
          fileHashes[relative]=createHash('sha256').update(bytes).digest('hex');
        }
      }
    };
    visit(diag);
    return {...r,files,fileHashes,order:read(path.join(root,'fixture-order.txt')),
      observationCode:read(path.join(diag,'foreground-observation-exit-code.txt')),
      originalCode:missing?null:read(path.join(originalDir,'exit-code.txt')),
      originalLog:read(path.join(originalDir,'logcat-final.txt')),
      ran:fs.existsSync(path.join(diag,'fixture-executed.txt')),
      controlRan:fs.existsSync(path.join(controlDir,'fixture-executed.txt')),
      diagnosticCode:read(path.join(diag,'diagnostic-step-exit-code.txt')),
      retainedCode:read(path.join(diag,'original-validation-exit-code.txt')),
      triggeredLog:read(path.join(diag,'logcat-final.txt'))};
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}

for(const diagnostic of [0,1,2])test(`original failure remains retained when independent diagnostic exits ${diagnostic}`,()=>{
  const r=run({diagnostic});assert.equal(r.status,diagnostic,r.stdout+r.stderr);assert.equal(r.ran,true);
  assert.equal(r.originalCode,'1\n');assert.equal(r.retainedCode,'1\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');assert.equal(r.diagnosticCode,`${diagnostic}\n`);
  assert.match(r.stdout,/Original lifecycle remains FAILED \(exit=1\)/);
});
for(const [diagnostic,observation] of [[1,0],[1,2],[1,7],[2,0],[255,2]])
test(`host observation ${observation} cannot replace diagnostic ${diagnostic} or original failure`,()=>{
 const r=run({diagnostic,observation});assert.equal(r.status,diagnostic,r.stdout+r.stderr);
 assert.equal(r.observationCode,`${observation}\n`);assert.equal(r.diagnosticCode,`${diagnostic}\n`);
 assert.equal(r.originalCode,'1\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
});
for(const diagnostic of [1,2,255])test(`diagnostic receipt write failure retains process exit ${diagnostic}`,()=>{
 const r=run({diagnostic,diagnosticReceiptFailure:true});
 assert.equal(r.status,diagnostic,r.stdout+r.stderr);assert.equal(r.diagnosticCode,null);
 assert.equal(r.originalCode,'1\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
 assert.match(r.stderr,/DIAGNOSTIC_EXIT_RECEIPT_UNAVAILABLE/);
});

for(const diagnostic of [1,2,255])for(const control of [0,1,2,124,137,255])
test(`no-trigger control ${control} cannot replace committed triggered exit ${diagnostic}`,()=>{
 const r=run({diagnostic,control});assert.equal(r.status,diagnostic,r.stdout+r.stderr);
 assert.equal(r.controlRan,true);assert.equal(r.order,'kvm\ntriggered\nkvm\ncontrol\n');
 assert.equal(r.files['no-trigger-control/triggered-receipt-before-control.txt'],`${diagnostic}\n`);
 assert.equal(r.diagnosticCode,`${diagnostic}\n`);assert.equal(r.files['exit-code.txt'],`${diagnostic}\n`);
 assert.equal(r.files['no-trigger-control/triggered-native-exit-code.txt'],`${diagnostic}\n`);
 assert.equal(r.files['no-trigger-control/paired-wrapper-exit-code.txt'],`${diagnostic}\n`);
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],`${control}\n`);
 const status=control===124?'incomplete-timeout':control===137?'incomplete-forced-kill':'process-exited-not-acceptance';
 assert.equal(r.files['no-trigger-control/control-status.txt'],`${status}\n`);
 assert.equal(r.files['no-trigger-control/triggered-evidence-status.txt'],'verified-unchanged\n');
 assert.equal(r.files['no-trigger-control/logcat-partial.txt'],'CONTROL PARTIAL TRACE\n');
 assert.equal(r.triggeredLog,'TRIGGERED RAW TRACE\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
 assert.equal(r.originalCode,'1\n');assert.equal(r.retainedCode,'1\n');
});
test('control success is explicitly an observation and cannot substitute even for triggered success after original failure',()=>{
 const r=run({diagnostic:0,control:0});assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(r.files['no-trigger-control/control-status.txt'],'process-exited-not-acceptance\n');
 assert.equal(r.originalCode,'1\n');assert.equal(r.retainedCode,'1\n');
 assert.match(r.stdout,/Original lifecycle remains FAILED \(exit=1\)/);
});
for(const control of [0,1,2,124,137,255])test(`triggered success retains native0 but cannot hide no-trigger control ${control}`,()=>{
 const r=run({diagnostic:0,control});assert.equal(r.status,control,r.stdout+r.stderr);
 assert.equal(r.diagnosticCode,'0\n');assert.equal(r.files['exit-code.txt'],'0\n');
 assert.equal(r.files['no-trigger-control/triggered-native-exit-code.txt'],'0\n');
 assert.equal(r.files['no-trigger-control/triggered-receipt-before-control.txt'],'0\n');
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],`${control}\n`);
 assert.equal(r.files['no-trigger-control/paired-wrapper-exit-code.txt'],`${control}\n`);
 assert.equal(r.files['no-trigger-control/triggered-evidence-status.txt'],'verified-unchanged\n');
 assert.equal(r.originalCode,'1\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
});
test('triggered input hashes include committed receipts and raw evidence but not the child control subtree',()=>{
 const r=run({diagnostic:1});const hashes=r.files['no-trigger-control/triggered-input-hashes.txt'];
 const digest=createHash('sha256').update('TRIGGERED RAW TRACE\n').digest('hex');
 assert.match(hashes,new RegExp(`${digest}  .*\\/logcat-final\\.txt\\n`));
 assert.match(hashes,/\/diagnostic-step-exit-code\.txt\n/);
 assert.match(hashes,/\/foreground-observation-exit-code\.txt\n/);
 assert.doesNotMatch(hashes,/no-trigger-control\//);
 assert.equal(r.files['no-trigger-control/triggered-evidence-status.txt'],'verified-unchanged\n');
});
for(const diagnostic of [0,1,2,255])test(`missing timing keeps triggered native ${diagnostic} and incomplete paired status`,()=>{
 const r=run({diagnostic,timingMissing:true});assert.equal(r.status,diagnostic||2,r.stdout+r.stderr);
 assert.equal(r.controlRan,false);assert.equal(r.order,'kvm\ntriggered\n');
 assert.equal(r.files['no-trigger-control/control-status.txt'],'not-run-timing-input-unavailable\n');
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],'2\n');
 assert.equal(r.files['no-trigger-control/paired-wrapper-exit-code.txt'],`${diagnostic||2}\n`);
 assert.equal(r.files['no-trigger-control/triggered-evidence-status.txt'],'verified-unchanged\n');
 assert.equal(r.diagnosticCode,`${diagnostic}\n`);assert.equal(r.originalCode,'1\n');
});
for(const diagnostic of [0,1])test(`exhausted existing step budget skips control and retains triggered native ${diagnostic}`,()=>{
 const r=run({diagnostic,runnerTransform:s=>s.replace('step_started=$SECONDS','step_started=$((SECONDS-441))')});
 assert.equal(r.status,diagnostic||2,r.stdout+r.stderr);assert.equal(r.controlRan,false);
 assert.equal(r.files['no-trigger-control/control-status.txt'],'not-run-step-budget-exhausted\n');
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],'2\n');
 assert.equal(r.diagnosticCode,`${diagnostic}\n`);assert.equal(r.originalCode,'1\n');
});
for(const diagnostic of [1,2,255])test(`unwritable child control receipt preserves triggered ${diagnostic}`,()=>{
 const r=run({diagnostic,control:124,controlReceiptFailure:true});assert.equal(r.status,diagnostic,r.stdout+r.stderr);
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],undefined);
 assert.equal(r.files['no-trigger-control/control-status.txt'],'incomplete-timeout\n');
 assert.match(r.stderr,/CONTROL_EXIT_RECEIPT_UNAVAILABLE/);
 assert.equal(r.diagnosticCode,`${diagnostic}\n`);assert.equal(r.originalCode,'1\n');
 assert.equal(r.triggeredLog,'TRIGGERED RAW TRACE\n');
});
test('unavailable control directory does not replace committed triggered denial',()=>{
 const r=run({diagnostic:1,controlDirectoryFailure:true});assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.controlRan,false);assert.equal(r.diagnosticCode,'1\n');assert.equal(r.originalCode,'1\n');
 assert.match(r.stderr,/CONTROL_NOT_RUN: output directory unavailable/);
});
for(const diagnostic of [0,1])test(`existing control directory is refused without changing stale bytes or triggered native ${diagnostic}`,()=>{
 const staleControlFiles={
   'control-exit-code.txt':Buffer.from('124\n'),
   'control-status.txt':Buffer.from('incomplete-timeout\n'),
   'triggered-input-hashes.txt':Buffer.from('OLD HASH RECEIPT\n'),
   'runner.stdout':Buffer.from('OLD PARTIAL TRACE\0\r\n'),
   'nested/raw.bin':Buffer.from([0,0xff,0x80,0x0d,0x0a,0x41])
 };
 const expected=Object.fromEntries(Object.entries(staleControlFiles).map(([name,bytes])=>
   [`no-trigger-control/${name}`,createHash('sha256').update(bytes).digest('hex')]));
 const r=run({diagnostic,staleControlFiles});assert.equal(r.status,diagnostic||2,r.stdout+r.stderr);
 assert.equal(r.controlRan,false);assert.equal(r.order,'kvm\ntriggered\n');
 assert.deepEqual(Object.fromEntries(Object.entries(r.fileHashes).filter(([name])=>name.startsWith('no-trigger-control/'))),expected);
 assert.equal(r.diagnosticCode,`${diagnostic}\n`);assert.equal(r.files['exit-code.txt'],`${diagnostic}\n`);
 assert.equal(r.triggeredLog,'TRIGGERED RAW TRACE\n');assert.equal(r.originalCode,'1\n');
 assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');assert.match(r.stderr,/CONTROL_NOT_RUN/);
});
test('ambient no-trigger request cannot replace the root triggered diagnostic',()=>{
 const r=run({diagnostic:1,control:2,ambientNoTrigger:'1'});assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.ran,true);assert.equal(r.controlRan,true);assert.equal(r.order,'kvm\ntriggered\nkvm\ncontrol\n');
 assert.equal(r.diagnosticCode,'1\n');assert.equal(r.triggeredLog,'TRIGGERED RAW TRACE\n');
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],'2\n');
 assert.equal(r.files['no-trigger-control/triggered-receipt-before-control.txt'],'1\n');
 assert.equal(r.originalCode,'1\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
});
test('control mutation of root triggered evidence invalidates comparison without erasing denial',()=>{
 const r=run({diagnostic:1,control:0,mutateTriggered:true});assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.files['no-trigger-control/triggered-evidence-status.txt'],'changed-or-unverified\n');
 assert.match(r.stderr,/CONTROL_COMPARISON_INVALID: triggered evidence changed/);
 assert.equal(r.triggeredLog,'corrupted');assert.equal(r.diagnosticCode,'1\n');
 assert.equal(r.files['no-trigger-control/triggered-native-exit-code.txt'],'1\n');assert.equal(r.originalCode,'1\n');
});
test('control mutation of original evidence is separately flagged without replacing either native failure',()=>{
 const r=run({diagnostic:1,controlBody:'printf corrupted > "$ROOT/android/build/lifecycle-evidence/logcat-final.txt"'});
 assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.originalLog,'corrupted');
 assert.equal(r.files['no-trigger-control/original-evidence-status.txt'],'changed-or-unverified\n');
 assert.match(r.stderr,/CONTROL_COMPARISON_INVALID: original evidence changed/);
 assert.equal(r.diagnosticCode,'1\n');assert.equal(r.originalCode,'1\n');
});
for(const target of ['triggered','original'])test(`paired native success fails closed if control changes ${target} evidence`,()=>{
 const args=target==='triggered'?{mutateTriggered:true}:
   {controlBody:'printf corrupted > "$ROOT/android/build/lifecycle-evidence/logcat-final.txt"'};
 const r=run({diagnostic:0,control:0,...args});assert.equal(r.status,2,r.stdout+r.stderr);
 assert.equal(r.diagnosticCode,'0\n');assert.equal(r.files['exit-code.txt'],'0\n');
 assert.equal(r.files['no-trigger-control/triggered-native-exit-code.txt'],'0\n');
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],'0\n');
 assert.equal(r.files['no-trigger-control/paired-wrapper-exit-code.txt'],'2\n');
 assert.equal(r.files[`no-trigger-control/${target}-evidence-status.txt`],'changed-or-unverified\n');
 assert.match(r.stderr,new RegExp(`CONTROL_COMPARISON_INVALID: ${target} evidence changed`));
 assert.equal(r.originalCode,'1\n');
});
test('control KVM failure does not run the third emulator or replace triggered denial',()=>{
 const r=run({diagnostic:1,controlKvmExit:7});assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.controlRan,false);assert.equal(r.order,'kvm\ntriggered\nkvm\n');
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],'7\n');
 assert.equal(r.files['no-trigger-control/control-status.txt'],'process-exited-not-acceptance\n');
 assert.equal(r.diagnosticCode,'1\n');assert.equal(r.originalCode,'1\n');
});

function readyControlTimeout(source) {
 const command='timeout --kill-after=5s "${control_budget}s"';
 assert.equal(source.split(command).length,2,'inject only the control timeout in the fixture copy');
 // Keep real GNU timeout/TERM/KILL handling, but trigger its alarm only after
 // the Python fixture has installed its handler and published readiness.
 // A short wall deadline incorrectly tested interpreter startup latency.
 const helper=`
fixture_ready_timeout() {
  local watchdog code ready=false
  command timeout --kill-after=1s 10s "$@" &
  watchdog=$!
  for ((attempt=0; attempt<800; attempt++)); do
    if [[ -f "$CONTROL/timeout-fixture-ready" ]]; then ready=true; break; fi
    kill -0 "$watchdog" 2>/dev/null || break
    sleep 0.01
  done
  if [[ "$ready" != true ]]; then
    echo 'TIMEOUT_FIXTURE_NEVER_READY: no signal-handling conclusion' >&2
    kill -ALRM "$watchdog" 2>/dev/null || true
    wait "$watchdog" || true
    return 98
  fi
  printf 'ready-before-timeout-alarm\\n' > "$CONTROL/timeout-readiness-observed.txt"
  kill -ALRM "$watchdog" || return 99
  if wait "$watchdog"; then code=0; else code=$?; fi
  return "$code"
}
`;
 return source.replace(command,'fixture_ready_timeout').replace('CONTROL_MAX_SECONDS=180','CONTROL_MAX_SECONDS=180\n'+helper);
}
for(const resistant of [false,true])for(const startupDelay of [0,0.75])
test(`real host ready-synchronized control timeout${resistant?' with forced kill':''}, startup delay ${startupDelay}s retains partial bytes and triggered denial`,()=>{
 const body=resistant?
   `sleep ${startupDelay}; exec python3 -u -c 'import pathlib,signal,sys,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("CONTROL READY",flush=True); pathlib.Path(sys.argv[1]).write_text("ready\\n"); time.sleep(60)' "$OUT/timeout-fixture-ready"`:
   `sleep ${startupDelay}; exec python3 -u -c 'import pathlib,sys,time; print("CONTROL READY",flush=True); pathlib.Path(sys.argv[1]).write_text("ready\\n"); time.sleep(60)' "$OUT/timeout-fixture-ready"`;
 const r=run({diagnostic:1,controlBody:body,runnerTransform:readyControlTimeout});
 assert.equal(r.error,undefined,r.stderr);assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.files['no-trigger-control/timeout-fixture-ready'],'ready\n');
 assert.equal(r.files['no-trigger-control/timeout-readiness-observed.txt'],'ready-before-timeout-alarm\n');
 assert.equal(r.files['no-trigger-control/control-exit-code.txt'],resistant?'137\n':'124\n');
 assert.equal(r.files['no-trigger-control/control-status.txt'],resistant?'incomplete-forced-kill\n':'incomplete-timeout\n');
 assert.match(r.files['no-trigger-control/runner.stdout'],/CONTROL READY/);
 assert.equal(r.files['no-trigger-control/logcat-partial.txt'],'CONTROL PARTIAL TRACE\n');
 assert.equal(r.files['no-trigger-control/triggered-receipt-before-control.txt'],'1\n');
 assert.equal(r.files['no-trigger-control/triggered-evidence-status.txt'],'verified-unchanged\n');
 assert.equal(r.diagnosticCode,'1\n');assert.equal(r.originalCode,'1\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
});
for(const [label,args] of [['no opt-in',{optIn:'0'}],['original passed',{original:0}],['missing receipt',{missing:true}]])test('post-failure diagnostic refuses '+label,()=>{
 const r=run(args);assert.equal(r.status,2);assert.equal(r.ran,false);assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
});
test('unexpected original-evidence mutation is detected',()=>{const r=run({mutate:true});assert.equal(r.status,3);assert.match(r.stderr,/Original evidence unexpectedly changed/);});
test('workflow keeps original failing step binding and separately labels diagnostic and evidence',()=>{
 const s=fs.readFileSync(new URL('../.github/workflows/v19-validate.yml',import.meta.url),'utf8');
 const original=s.slice(s.indexOf('      - name: Validate installed journal lifecycle'),s.indexOf('      # Keep the failed original step binding.'));
 const diagnostic=s.slice(s.indexOf('      - name: Diagnostic only - probe after original failure'),s.indexOf('      - name: Preserve installed lifecycle evidence'));
 assert.match(original,/id: installed/);assert.match(original,/run: bash scripts\/test-android-installed.sh/);
 assert.doesNotMatch(s,/continue-on-error:/);
 assert.match(diagnostic,/!cancelled\(\) && steps\.installed\.outcome == 'failure'/);
 assert.match(diagnostic,/run: bash scripts\/test-android-restart-after-failure.sh/);
 assert.match(diagnostic,/path: android\/build\/restart-race-evidence/);
 assert.match(s,/path: android\/build\/lifecycle-evidence/);
});
test('diagnostic mode bootstraps fresh data, uses separate evidence, then exits before ordinary gates',()=>{
 const s=fs.readFileSync(new URL('../scripts/test-android-installed.sh',import.meta.url),'utf8');
 const original=s.slice(s.indexOf('case "${PASSENGER_RESTART_RACE_ONLY:-0}"'),s.indexOf('\n  1)'));
 assert.match(original,/OUT="\$ROOT\/android\/build\/lifecycle-evidence"/);
 assert.match(original,/\[\[ "\$\{PASSENGER_RESTART_NO_TRIGGER:-0\}" == 0 \]\]/);
 assert.match(s,/OUT="\$ROOT\/android\/build\/restart-race-evidence"/);
 assert.match(s,/1\) OUT="\$OUT\/no-trigger-control"/);
 const dispatch=s.slice(s.indexOf('\nphase bootstrap\n'),s.indexOf('\nphase basics attached\n'));
 assert.match(dispatch,/phase bootstrap\nif \[\[ "\$\{PASSENGER_RESTART_RACE_ONLY:-0\}" == 1 \]\]/);
 assert.match(dispatch,/restart_race\n  exit 0\nfi\nlaunch_home/);
});

test('second-emulator KVM preflight failure stays separate and preserves original failure',()=>{
 const r=run({kvmExit:2});assert.equal(r.status,2);assert.equal(r.ran,false);
 assert.equal(r.originalCode,'1\n');assert.equal(r.originalLog,'ORIGINAL FAILURE TRACE\n');
 assert.equal(r.diagnosticCode,'2\n');assert.match(r.stdout,/KVM fixture check/);
});
test('both emulator paths reuse the narrowly scoped existing KVM preflight',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/v19-validate.yml',import.meta.url),'utf8');
 const kvm=fs.readFileSync(new URL('../scripts/ensure-android-kvm.sh',import.meta.url),'utf8');
 assert.match(workflow,/run: bash scripts\/ensure-android-kvm.sh lifecycle/);
 assert.match(runner,/bash "\$ROOT\/scripts\/ensure-android-kvm.sh" diagnostic/);
 assert.match(kvm,/RUNNER_ENVIRONMENT:-.*github-hosted/);
 assert.match(kvm,/sudo -n setfacl -m "u:\$\(id -un\):rw" \/dev\/kvm/);
 assert.doesNotMatch(kvm,/chmod|udev|0666/);
});
