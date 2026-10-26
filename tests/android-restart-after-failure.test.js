import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const runner=fs.readFileSync(new URL('../scripts/test-android-restart-after-failure.sh',import.meta.url),'utf8');
function run({original=1,diagnostic=0,optIn='1',missing=false,mutate=false,kvmExit=0,observation=0,diagnosticReceiptFailure=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pc-post-failure-'));
  try {
    const originalDir=path.join(root,'android/build/lifecycle-evidence');
    fs.mkdirSync(originalDir,{recursive:true});fs.mkdirSync(path.join(root,'scripts'));
    if(!missing)fs.writeFileSync(path.join(originalDir,'exit-code.txt'),`${original}\n`);
    fs.writeFileSync(path.join(originalDir,'source.txt'),'original-commit\noriginal-tree\n');
    fs.writeFileSync(path.join(originalDir,'logcat-final.txt'),'ORIGINAL FAILURE TRACE\n');
    fs.writeFileSync(path.join(root,'scripts/test-android-restart-after-failure.sh'),runner);
    fs.writeFileSync(path.join(root,'scripts/analyze-android-foreground-observation.py'),`import sys\nprint('host observation fixture')\nraise SystemExit(${observation})\n`);
    fs.writeFileSync(path.join(root,'scripts/ensure-android-kvm.sh'),`#!/bin/bash
[[ "$1" == diagnostic ]] || exit 9
printf 'KVM fixture check\\n'
exit ${kvmExit}
`);
    fs.writeFileSync(path.join(root,'scripts/test-android-installed.sh'),`#!/bin/bash
set -euo pipefail
[[ "$PASSENGER_RESTART_RACE_ONLY" == 1 && "$PASSENGER_RESTART_RACE" == 1 ]]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
printf 'separate diagnostic executed\\n' > "$ROOT/android/build/restart-race-evidence/fixture-executed.txt"
${diagnosticReceiptFailure?'mkdir "$ROOT/android/build/restart-race-evidence/diagnostic-step-exit-code.txt"':''}
${mutate?'printf corrupted > "$ROOT/android/build/lifecycle-evidence/logcat-final.txt"':''}
exit ${diagnostic}
`);
    const r=spawnSync('bash',[path.join(root,'scripts/test-android-restart-after-failure.sh')],{encoding:'utf8',env:{...process.env,CI:'true',PASSENGER_RESTART_RACE:optIn}});
    const diag=path.join(root,'android/build/restart-race-evidence');
    return {...r,observationCode:fs.existsSync(path.join(diag,'foreground-observation-exit-code.txt'))?fs.readFileSync(path.join(diag,'foreground-observation-exit-code.txt'),'utf8'):null,originalCode:missing?null:fs.readFileSync(path.join(originalDir,'exit-code.txt'),'utf8'),originalLog:fs.readFileSync(path.join(originalDir,'logcat-final.txt'),'utf8'),ran:fs.existsSync(path.join(diag,'fixture-executed.txt')),diagnosticCode:fs.existsSync(path.join(diag,'diagnostic-step-exit-code.txt'))&&fs.statSync(path.join(diag,'diagnostic-step-exit-code.txt')).isFile()?fs.readFileSync(path.join(diag,'diagnostic-step-exit-code.txt'),'utf8'):null,retainedCode:fs.existsSync(path.join(diag,'original-validation-exit-code.txt'))?fs.readFileSync(path.join(diag,'original-validation-exit-code.txt'),'utf8'):null};
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
 assert.match(s,/0\) OUT="\$ROOT\/android\/build\/lifecycle-evidence"/);
 assert.match(s,/OUT="\$ROOT\/android\/build\/restart-race-evidence"/);
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
