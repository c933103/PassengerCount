#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// A trace classifier, not a proof of the internal system_server call stack.
// Never accept the test helper's process/notification as PassengerCount recovery.
export function analyzeRestartRace(log, services, oldPid, kind = 'race', process = 'app.passengercount') {
  if (!/^\d+$/.test(String(oldPid)) || !['race', 'split', 'valid'].includes(kind) || !['app.passengercount', 'app.passengercount:tracking'].includes(process))
    throw new Error('Expected a numeric old PID and a supported fixture kind');
  const processPattern = process.replaceAll('.', '\\.');
  const lines = log.split(/\r?\n/);
  const find = (pattern, after = -1) => lines.findIndex((line, index) => index > after && pattern.test(line));
  const marker = find(new RegExp(`PassengerJournalTest: SIGKILL_AFTER_DETACH prepare-${kind} pid=${oldPid}(?:\\s|$)`));
  const death = marker < 0 ? -1 : find(new RegExp(`ActivityManager: Process ${processPattern} \\(pid ${oldPid}\\) has died:`), marker);
  const scheduled = death < 0 ? -1 : find(/ActivityManager: Scheduling restart of crashed service app\.passengercount\/\.TrackService /, death);
  const start = scheduled < 0 ? -1 : find(new RegExp(`ActivityManager: Start proc (\\d+):${processPattern}/.*for service \\{app\\.passengercount/app\\.passengercount\\.TrackService\\}`), scheduled);
  const newPid = start < 0 ? null : lines[start].match(/Start proc (\d+):/)[1];
  const entering = death < 0 ? -1 : find(/PassengerRaceTrigger: RACE_TRIGGER_ENTER(?:\s|$)/, death);
  const promoted = entering < 0 ? -1 : find(/PassengerRaceTrigger: RACE_TRIGGER_FOREGROUND(?:\s|$)/, entering);
  const reset = death < 0 ? -1 : find(/AppOps\s*: Operation not started: uid=\d+ pkg=app\.passengercount\(null\) op=START_FOREGROUND(?:\s|$)/, death);
  const denied = start < 0 ? -1 : find(/(?:ActivityManager: Service\.startForeground\(\) not allowed due to mAllowStartForeground false: service app\.passengercount\/\.TrackService|PassengerTrack: Background tracking restart denied; interruption saved)/, start);
  const invalid = marker < 0 || death < 0 || scheduled < 0 || start < 0 || newPid === String(oldPid);
  const interleaved = !invalid && entering > scheduled && promoted > entering && promoted < start;
  // A service dump may include other service records, so scope every field to
  // TrackService's own block instead of independently grepping the whole dump.
  const blocks = services.split(/(?=^\s*\* (?:(?:Pending|Restarting|Destroy) )?ServiceRecord\{)/m);
  const own = blocks.filter(block => /^\s*\* ServiceRecord\{[^\n]* app\.passengercount\/\.TrackService(?:[ }])/m.test(block));
  const foreground = own.some(block => new RegExp(`app=ProcessRecord\\{[^\\n]* ${newPid}:${processPattern}/`).test(block)
    && /^\s*isForeground=true(?:\s|$)/m.test(block));
  let outcome = 'inconclusive';
  if (!invalid && denied >= 0) outcome = 'automatic-restart-denied';
  else if (!invalid && foreground) outcome = 'foreground-restored';
  // A missed trigger window cannot erase an independently observed target denial.
  if (kind !== 'valid' && !interleaved && outcome !== 'automatic-restart-denied')
    outcome = 'interleaving-unverified';
  return {outcome, process, oldPid: String(oldPid), newPid, interleaved,
    cleanupDuringAbsence: reset > death && reset < start,
    triggerBeforeCleanup: entering > death && entering < reset && reset < start,
    foreground, lines: {marker, death, scheduled, entering, promoted, reset, start, denied}};
}

// A separate observational control, never a replacement for the strict trigger
// classifier above or the installed acceptance gates. Warmup is permitted; an
// unexpected trigger anywhere in this fresh-emulator capture contaminates the contrast.
export function analyzeNoTriggerControl(log, services, oldPid, process = 'app.passengercount:tracking') {
  if (process !== 'app.passengercount:tracking') throw new Error('Control requires the full-absence tracking fixture');
  const measured = analyzeRestartRace(log, services, oldPid, 'race', process);
  const lines = log.split(/\r?\n/);
  const unexpectedTrigger = lines.findIndex(line => /PassengerRaceTrigger: RACE_TRIGGER_(?:ENTER|FOREGROUND)(?:\s|$)/.test(line));
  const lifecycleVerified = ['marker', 'death', 'scheduled', 'start'].every(name => measured.lines[name] >= 0)
    && measured.newPid !== String(oldPid);
  const comparisonEligible = lifecycleVerified && unexpectedTrigger < 0;
  const denied = measured.outcome === 'automatic-restart-denied';
  return {...measured, kind: 'independent-no-trigger-observation-not-acceptance',
    outcome: denied ? 'automatic-restart-denied'
      : comparisonEligible && measured.foreground ? 'foreground-observed-no-trigger' : 'control-comparison-unverified',
    comparisonEligible, lifecycleVerified, unexpectedTrigger,
    comparisonStatus: unexpectedTrigger >= 0 ? 'unexpected-trigger' : lifecycleVerified ? 'observable' : 'lifecycle-unverified',
    limitations: ['No acceptance or GPS/session-continuity verdict; no helper reattachment.',
      'Full process absence and host timing require the paired shell receipts.',
      'Separate fresh emulators, warmup and runtime memory-pressure scheduling can differ; not a causal proof.']};
}

// Each observation has unique inputs. Publish only one complete, hash-bound
// result, never independently replace its log and service snapshot. Earlier
// observations (including failed captures) remain available in the artifact.
export function publishRestartRace(logPath, servicesPath, oldPid, kind, targetProcess, outputPath, noTriggerControl = false) {
  if (noTriggerControl && kind !== 'race') throw new Error('Control requires the full-absence race fixture');
  const inputs = {};
  const evidence = {};
  const outputDirectory = path.dirname(outputPath);
  if (path.dirname(logPath) !== path.dirname(servicesPath))
    throw new Error('Observation inputs must share one attempt directory');
  for (const [name, filename] of Object.entries({log: logPath, services: servicesPath})) {
    if (fs.readFileSync(filename + '.exit-code.txt', 'utf8').trim() !== '0'
        || fs.statSync(filename + '.stderr').size !== 0)
      throw new Error('Incomplete ' + name + ' capture');
    const bytes = fs.readFileSync(filename);
    inputs[name] = bytes.toString('utf8');
    evidence[name] = {path: path.relative(outputDirectory, filename), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')};
  }
  const result = {...(noTriggerControl
    ? analyzeNoTriggerControl(inputs.log, inputs.services, oldPid, targetProcess)
    : analyzeRestartRace(inputs.log, inputs.services, oldPid, kind, targetProcess)), evidence};
  if (noTriggerControl) {
    const errors = [];
    result.fullAbsenceReceiptVerified = false;
    result.comparisonTiming = {status: 'unverified', timingEqualityEstablished: false};
    result.pairProvenance = {status: 'unverified', wholeImageOrRuntimeEquivalenceEstablished: false};
    const read = (name, filename) => {
      if (fs.statSync(filename).size > 65536) throw new Error('Oversized control metadata: ' + name);
      const bytes = fs.readFileSync(filename);
      evidence[name] = {path: path.relative(outputDirectory, filename), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')};
      return bytes.toString('utf8');
    };
    // Missing contrast metadata cannot erase a denial in the already verified
    // log/service pair. It makes only the comparison ineligible.
    try {
      if (read('absenceScope', path.join(outputDirectory, 'race-process-scope.txt')) !== 'ALL_PACKAGE_PROCESSES_ABSENT before_control_idle=true\n'
          || read('absenceExit', path.join(outputDirectory, 'race-absent-pids.exit-code.txt')) !== '1\n'
          || read('absenceStdout', path.join(outputDirectory, 'race-absent-pids.txt')) !== ''
          || read('absenceStderr', path.join(outputDirectory, 'race-absent-pids.stderr')) !== '')
        throw new Error('Full process-absence receipt is incomplete');
      result.fullAbsenceReceiptVerified = true;
      const provenance = {};
      for (const [name, filename] of Object.entries({apkHashes: 'apk-sha256.txt', fingerprint: 'device-fingerprint.txt', source: 'source.txt'})) {
        const controlText = read('control' + name, path.join(outputDirectory, filename));
        const triggeredText = read('triggered' + name, path.join(outputDirectory, '..', filename));
        const controlIdentity = evidence['control' + name], triggeredIdentity = evidence['triggered' + name];
        if (controlIdentity.bytes !== triggeredIdentity.bytes || controlIdentity.sha256 !== triggeredIdentity.sha256)
          throw new Error('Control/triggered ' + filename + ' receipts differ');
        if (name === 'apkHashes') {
          const entries = controlText.trim().split('\n').map(line => line.match(/^([a-f0-9]{64}) {2}(.+)$/));
          if (entries.length !== 2 || entries.some(entry => !entry)
              || path.basename(entries[0][2]) !== 'PassengerCount.apk'
              || path.basename(entries[1][2]) !== 'PassengerCount-lifecycle-tests.apk')
            throw new Error('APK hash provenance is incomplete');
          provenance.apkSha256 = {target: entries[0][1], fixture: entries[1][1]};
        } else if (name === 'source') {
          if (!/^[a-f0-9]{40}\n[a-f0-9]{40}\n$/.test(controlText)) throw new Error('Source head/tree provenance is incomplete');
          const [head, tree] = controlText.trim().split('\n'); provenance.source = {head, tree};
        } else {
          if (!/^[^/\s]+\/[^/\s]+\/[^:\s]+:[^/\s]+\/[^/\s]+\/[^:\s]+:[^/\s]+\/[^\s]+\r?\n?$/.test(controlText)) throw new Error('Installed build fingerprint is incomplete');
          provenance.installedFingerprint = triggeredText.trim();
        }
      }
      result.pairProvenance = {status: 'matching-exact-receipts', ...provenance,
        wholeImageOrRuntimeEquivalenceEstablished: false,
        limitations: ['Equal APK hashes, source head/tree and installed fingerprint receipts do not prove whole-image byte identity.',
          'Runtime grants, process state, warmup and memory pressure are separate observations, not inferred equal.']};
      const slot = JSON.parse(read('controlSlotTiming', path.join(outputDirectory, 'race-trigger-slot.json')));
      const first = JSON.parse(read('firstServicesTiming', path.join(outputDirectory, 'race-first-services-timing.json')));
      const triggered = JSON.parse(read('triggeredSlotTiming', path.join(outputDirectory, '..', 'race-trigger-slot.json')));
      const triggeredFirst = JSON.parse(read('triggeredFirstServicesTiming', path.join(outputDirectory, '..', 'race-first-services-timing.json')));
      const integers = (object, keys) => keys.every(key => Number.isSafeInteger(object[key]) && object[key] >= 0);
      const identityMatches = (reference, actual) => reference?.bytes === actual.bytes && reference?.sha256 === actual.sha256;
      const validSlot = (value, mode) => value.mode === mode && value.status === 'measured'
        && value.kind === 'host-timing-observation-not-acceptance' && value.clock === 'time.monotonic_ns'
        && integers(value, ['verifiedAbsenceNs', 'slotStartNs', 'slotEndNs', 'elapsedNs'])
        && value.verifiedAbsenceNs > 0 && value.verifiedAbsenceNs <= value.slotStartNs
        && value.slotStartNs <= value.slotEndNs && value.elapsedNs === value.slotEndNs - value.slotStartNs;
      const validFirst = (value, ownSlot, ownIdentity) => value.mode === ownSlot.mode && value.status === 'measured'
        && value.kind === 'host-timing-observation-not-acceptance' && value.clock === ownSlot.clock
        && integers(value, ['verifiedAbsenceNs', 'firstServicesStartNs', 'firstServicesEndNs',
          'servicesElapsedNs', 'gapAfterSlotNs', 'elapsedFromAbsenceNs'])
        && value.verifiedAbsenceNs === ownSlot.verifiedAbsenceNs
        && ownSlot.slotEndNs <= value.firstServicesStartNs && value.firstServicesStartNs <= value.firstServicesEndNs
        && value.servicesElapsedNs === value.firstServicesEndNs - value.firstServicesStartNs
        && value.gapAfterSlotNs === value.firstServicesStartNs - ownSlot.slotEndNs
        && value.elapsedFromAbsenceNs === value.firstServicesStartNs - ownSlot.verifiedAbsenceNs
        && identityMatches(value.slotEvidence, ownIdentity);
      if (!validSlot(triggered, 'triggered') || triggered.captureExitCode !== 0 || triggered.elapsedNs > 10_000_000_000
          || !validSlot(slot, 'no-trigger-control')
          || !integers(slot, ['requestedReplayNs', 'replayDifferenceNs'])
          || slot.requestedReplayNs !== triggered.elapsedNs
          || slot.elapsedNs < slot.requestedReplayNs || slot.replayDifferenceNs !== slot.elapsedNs - slot.requestedReplayNs
          || !identityMatches(slot.reference, evidence.triggeredSlotTiming)
          || !validFirst(first, slot, evidence.controlSlotTiming)
          || !validFirst(triggeredFirst, triggered, evidence.triggeredSlotTiming))
        throw new Error('Control/triggered host timing structure or exact-byte pairing is incomplete');
      result.comparisonEligibilityScope = 'Verified lifecycle and retained evidence only; not timing equivalence or causality.';
      result.comparisonTiming = {
        status: 'measured-differences-not-matched', clock: slot.clock, timingEqualityEstablished: false,
        triggered: {slotElapsedNs: triggered.elapsedNs, firstServicesFromAbsenceNs: triggeredFirst.elapsedFromAbsenceNs,
          firstServicesAfterSlotNs: triggeredFirst.gapAfterSlotNs, servicesElapsedNs: triggeredFirst.servicesElapsedNs},
        control: {slotElapsedNs: slot.elapsedNs, firstServicesFromAbsenceNs: first.elapsedFromAbsenceNs,
          firstServicesAfterSlotNs: first.gapAfterSlotNs, servicesElapsedNs: first.servicesElapsedNs},
        controlMinusTriggered: {slotElapsedNs: slot.elapsedNs-triggered.elapsedNs,
          firstServicesFromAbsenceNs: first.elapsedFromAbsenceNs-triggeredFirst.elapsedFromAbsenceNs,
          firstServicesAfterSlotNs: first.gapAfterSlotNs-triggeredFirst.gapAfterSlotNs,
          servicesElapsedNs: first.servicesElapsedNs-triggeredFirst.servicesElapsedNs},
        requestedReplayNs: slot.requestedReplayNs, replayDifferenceNs: slot.replayDifferenceNs,
        limitations: ['Host-bracket measurements do not establish device-event timing equivalence.',
          'Separate fresh emulators, warmup and memory-pressure restart rescheduling remain confounds.']
      };
    } catch (error) { errors.push(error.message); }
    result.controlEvidenceErrors = errors;
    if (errors.length) {
      result.comparisonEligible = false;
      result.comparisonStatus = 'shell-or-timing-evidence-unverified';
      if (result.outcome !== 'automatic-restart-denied') result.outcome = 'control-comparison-unverified';
    }
  }
  const serialized = JSON.stringify(result, null, 2) + '\n';
  try {
    // Exclusive creation also prevents accidentally reusing an old attempt.
    fs.writeFileSync(path.join(path.dirname(logPath), 'result.json'), serialized, {flag: 'wx'});
    const pending = fs.mkdtempSync(path.join(outputDirectory, '.race-result-'));
    try {
      const filename = path.join(pending, 'result.json');
      fs.writeFileSync(filename, serialized, {flag: 'wx'});
      fs.renameSync(filename, outputPath);
    } finally {
      fs.rmSync(pending, {recursive: true, force: true});
    }
  } catch (error) {
    // A storage failure cannot demote a denial already observed in complete
    // inputs. Do not manufacture this flag for missing/unverified captures.
    error.automaticRestartDenied = result.outcome === 'automatic-restart-denied';
    throw error;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , logPath, servicesPath, oldPid, kind = 'race', targetProcess = 'app.passengercount', mode, outputPath, controlFlag] = process.argv;
  try {
    if (mode !== undefined && (mode !== '--publish' || !outputPath)) throw new Error('Expected --publish outputPath');
    if (controlFlag !== undefined && controlFlag !== '--no-trigger-control') throw new Error('Unknown observation mode');
    const control = controlFlag === '--no-trigger-control';
    if (control && kind !== 'race') throw new Error('Control requires the original full-absence race fixture');
    const result = mode === '--publish'
      ? publishRestartRace(logPath, servicesPath, oldPid, kind, targetProcess, outputPath, control)
      : analyzeRestartRace(fs.readFileSync(logPath, 'utf8'), fs.readFileSync(servicesPath, 'utf8'), oldPid, kind, targetProcess);
    if (mode !== '--publish') console.log(JSON.stringify(result, null, 2));
    // Publish-mode 10 is an explicit classified denial, unlike Node/shell's
    // generic launch-error 1. The runner maps only this signal to product 1.
    // Preserve the standalone classifier's established 0/1/2 interface.
    process.exitCode = ['foreground-restored', 'foreground-observed-no-trigger'].includes(result.outcome) ? 0
      : result.outcome === 'automatic-restart-denied' ? (mode === '--publish' ? 10 : 1) : 2;
  } catch (error) {
    console.error('RACE_CLASSIFICATION_UNVERIFIED: ' + error.message);
    // Internal observation/publication errors are distinct from product denial.
    // The owned shell maps this internal code to its existing inconclusive 2.
    if (error.automaticRestartDenied) console.error('RACE_AUTOMATIC_RESTART_DENIED: complete inputs record denial; result publication failed');
    process.exitCode = error.automaticRestartDenied ? 10 : 3;
  }
}
