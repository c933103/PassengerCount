#!/usr/bin/env node
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

// A trace classifier, not a proof of the internal system_server call stack.
// Never accept the test helper's process/notification as PassengerCount recovery.
export function analyzeRestartRace(log, services, oldPid, kind = 'race') {
  if (!/^\d+$/.test(String(oldPid)) || !['race', 'valid'].includes(kind))
    throw new Error('Expected a numeric old PID and a supported fixture kind');
  const lines = log.split(/\r?\n/);
  const find = (pattern, after = -1) => lines.findIndex((line, index) => index > after && pattern.test(line));
  const marker = find(new RegExp(`PassengerJournalTest: SIGKILL_AFTER_DETACH prepare-${kind} pid=${oldPid}(?:\\s|$)`));
  const death = marker < 0 ? -1 : find(new RegExp(`ActivityManager: Process app\\.passengercount \\(pid ${oldPid}\\) has died:`), marker);
  const scheduled = death < 0 ? -1 : find(/ActivityManager: Scheduling restart of crashed service app\.passengercount\/\.TrackService /, death);
  const start = scheduled < 0 ? -1 : find(/ActivityManager: Start proc (\d+):app\.passengercount\/.*for service \{app\.passengercount\/app\.passengercount\.TrackService\}/, scheduled);
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
  const foreground = own.some(block => new RegExp(`app=ProcessRecord\\{[^\\n]* ${newPid}:app\\.passengercount/`).test(block)
    && /^\s*isForeground=true(?:\s|$)/m.test(block));
  let outcome = 'inconclusive';
  if (!invalid && denied >= 0) outcome = 'automatic-restart-denied';
  else if (!invalid && foreground) outcome = 'foreground-restored';
  if (kind === 'race' && !interleaved) outcome = 'interleaving-unverified';
  return {outcome, oldPid: String(oldPid), newPid, interleaved,
    cleanupDuringAbsence: reset > death && reset < start,
    triggerBeforeCleanup: entering > death && entering < reset && reset < start,
    foreground, lines: {marker, death, scheduled, entering, promoted, reset, start, denied}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , logPath, servicesPath, oldPid, kind = 'race'] = process.argv;
  const result = analyzeRestartRace(fs.readFileSync(logPath, 'utf8'), fs.readFileSync(servicesPath, 'utf8'), oldPid, kind);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.outcome === 'foreground-restored' ? 0 : result.outcome === 'automatic-restart-denied' ? 1 : 2;
}
