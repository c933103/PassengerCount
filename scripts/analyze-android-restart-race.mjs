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
  const blocks = services.split(/(?=^\s*\* ServiceRecord\{)/m);
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

// Each observation has unique inputs. Publish only one complete, hash-bound
// result, never independently replace its log and service snapshot. Earlier
// observations (including failed captures) remain available in the artifact.
export function publishRestartRace(logPath, servicesPath, oldPid, kind, targetProcess, outputPath) {
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
  const result = {...analyzeRestartRace(inputs.log, inputs.services, oldPid, kind, targetProcess), evidence};
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
  const [, , logPath, servicesPath, oldPid, kind = 'race', targetProcess = 'app.passengercount', mode, outputPath] = process.argv;
  try {
    if (mode !== undefined && (mode !== '--publish' || !outputPath)) throw new Error('Expected --publish outputPath');
    const result = mode === '--publish'
      ? publishRestartRace(logPath, servicesPath, oldPid, kind, targetProcess, outputPath)
      : analyzeRestartRace(fs.readFileSync(logPath, 'utf8'), fs.readFileSync(servicesPath, 'utf8'), oldPid, kind, targetProcess);
    if (mode !== '--publish') console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.outcome === 'foreground-restored' ? 0 : result.outcome === 'automatic-restart-denied' ? 1 : 2;
  } catch (error) {
    console.error('RACE_CLASSIFICATION_UNVERIFIED: ' + error.message);
    // Internal observation/publication errors are distinct from product denial.
    // The owned shell maps this internal code to its existing inconclusive 2.
    if (error.automaticRestartDenied) console.error('RACE_AUTOMATIC_RESTART_DENIED: complete inputs record denial; result publication failed');
    process.exitCode = error.automaticRestartDenied ? 1 : 3;
  }
}
