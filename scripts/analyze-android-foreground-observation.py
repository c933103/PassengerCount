#!/usr/bin/env python3
"""Host-only framework dump parsing; not an Android policy model or acceptance gate.

Plain `dumpsys activity services` forces dumpAll, leaves ItemMatcher.all true,
and uses dumpLocked (no application dump callbacks). A positional package hides
ActiveForegroundApps, while -p enables client callbacks. These paths/labels were
checked in run116 services.jar and frameworks/base android-15.0.0_r1 source:
ActivityManagerService.doDump/ItemMatcher and ActiveServices.ServiceDumper.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

PACKAGE = 'app.passengercount'
COMPONENTS = {PACKAGE + '/.TrackService', PACKAGE + '/' + PACKAGE + '.TrackService'}
REASONS = ('mAllowWiu_noBinding', 'mAllowWiu_inBindService', 'mAllowWiu_byBindings',
           'mAllowStart_noBinding', 'mAllowStart_inBindService', 'mAllowStart_byBindings')
HEADER = 'ACTIVITY MANAGER SERVICES (dumpsys activity services)'
SERVICE = re.compile(r'^\s*\* (?:(Pending|Restarting|Destroy) )?ServiceRecord\{([0-9a-fA-F]+) u(\d+) (\S+?)(?:\s|\})')
APP_HEADER = re.compile(r'^Active foreground apps - user (\d+):\s*$')
APP_ENTRY = re.compile(r'^  #(\d+): (\S+)\s*$')
SCOPE = b'ALL_SERVICES_NO_CLIENTS_DIAGNOSTIC_ONLY\n'
# Full services output is larger than a package dump. Bound it generously,
# independently of the wrapper's deadline; never truncate and call it complete.
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 128 * 1024 * 1024
MAX_OBSERVATIONS = 512


def summarize_services(raw, *, command_complete, unfiltered, user_id=0):
    """Caller must bind both flags to actual native status/command, never output guesses.

    Complete means a bounded, nontruncated successful framework-only command
    `dumpsys activity services`, with no -p/-c and no positional service matcher.
    Missing records mean not listed in that dump only; never process absence.
    """
    try:
        text = raw.decode('utf-8')
        replacement = False
    except UnicodeDecodeError:
        text = raw.decode('utf-8', errors='replace')
        replacement = True
    lines = text.splitlines()
    header_present = bool(lines) and lines[0] == HEADER and lines.count(HEADER) == 1
    errors = []
    if not header_present: errors.append('missing-or-duplicate-services-header')
    if replacement: errors.append('invalid-utf8')
    if not raw.endswith(b'\n'): errors.append('unterminated-dump-output')
    if re.search(r'(?im)^\s*(?:Error|Exception|Permission Denial|DUMP TIMEOUT|Failure dumping)', text):
        errors.append('dump-error-output')
    result = {'kind': 'framework-bookkeeping-observation-not-acceptance',
              'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
              'package': PACKAGE, 'userId': user_id,
              'commandComplete': command_complete, 'unfilteredFrameworkDump': unfiltered,
              'headerPresent': header_present, 'decodedWithReplacement': replacement,
              'activeForegroundApps': [], 'trackServices': [], 'parseErrors': errors,
              'targetUserForegroundSectionCount': 0,
              'limitations': ['Not atomic with other commands; dump takes AMS locks and can affect timing.',
                              'No runtime caller/stack, causation, UID/process absence or acceptance claim.',
                              'Not-listed means not printed in this capture, not runtime absence.']}
    mode_user = None
    current_app = None
    for number, line in enumerate(lines, 1):
        header = APP_HEADER.fullmatch(line)
        if header:
            mode_user = int(header[1]); current_app = None
            if mode_user == user_id: result['targetUserForegroundSectionCount'] += 1
            continue
        if mode_user is None:
            continue
        entry = APP_ENTRY.fullmatch(line)
        if entry:
            current_app = None
            if int(mode_user) == user_id and entry[2] == PACKAGE:
                current_app = {'userId': mode_user, 'packageName': entry[2],
                               'index': int(entry[1]), 'lineStart': number,
                               'mNumActive': None, 'mAppOnTop': None,
                               'mShownWhileTop': None, 'mShownWhileScreenOn': None,
                               'mStartTime': None, 'mStartVisibleTime': None,
                               'mEndTime': None, 'mEndTimeStatus': 'not-printed',
                               'timeEncoding': 'Relative durations as printed, not absolute timestamps; no value assigned to omission.'}
                result['activeForegroundApps'].append(current_app)
            continue
        if (line and not line[0].isspace()) or line.startswith('  Handler - user '):
            mode_user = None; current_app = None
            continue
        if current_app is not None:
            match = re.fullmatch(r'\s+mNumActive=(-?\d+) mAppOnTop=(true|false) mShownWhileTop=(true|false) mShownWhileScreenOn=(true|false)\s*', line)
            if match:
                if current_app['mNumActive'] is not None: errors.append('duplicate-target-foreground-fields')
                current_app.update(mNumActive=int(match[1]), mAppOnTop=match[2]=='true', lineEnd=number)
                current_app.update(mShownWhileTop=match[3]=='true', mShownWhileScreenOn=match[4]=='true')
            if match := re.fullmatch(r'\s+mStartTime=(\S+) mStartVisibleTime=(\S+)\s*', line):
                if current_app['mStartTime'] is not None: errors.append('duplicate-target-start-time')
                current_app.update(mStartTime=match[1], mStartVisibleTime=match[2], lineEnd=number)
            if match := re.fullmatch(r'\s+mEndTime=(\S+)\s*', line):
                if current_app['mEndTimeStatus'] != 'not-printed': errors.append('duplicate-target-end-time')
                current_app.update(mEndTime=match[1], mEndTimeStatus='printed', lineEnd=number)
            elif re.match(r'\s+mEndTime=', line):
                current_app['mEndTimeStatus'] = 'malformed'
                errors.append('malformed-target-end-time')
    # Any service delimiter bounds the preceding block, including unknown
    # non-target formats; never borrow another service's missing target fields.
    headers = [(i, SERVICE.match(line)) for i, line in enumerate(lines)
               if re.match(r'^\s*\* .*ServiceRecord\{', line)]
    for index, (start, match) in enumerate(headers):
        if match is None:
            if PACKAGE + '/' in lines[start]: errors.append('unrecognized-target-service-header')
            continue
        if int(match[3]) != user_id or match[4] not in COMPONENTS:
            continue
        end = headers[index+1][0] if index+1 < len(headers) else len(lines)
        # Stop at an unindented global section, not inside the next unrelated dump.
        for at in range(start+1, end):
            if lines[at] and not lines[at][0].isspace():end=at;break
        block = lines[start+1:end]
        rec = {'token': match[2], 'userId': int(match[3]), 'component': match[4],
               'listing': (match[1] or 'active').lower(), 'lineStart': start+1, 'lineEnd': end,
               'app': None, 'appIsNull': None, 'startForegroundCount': None,
               'isForeground': None, 'foregroundServiceType': None, 'foregroundId': None,
               'startRequested': None, 'stopIfKilled': None, 'callStart': None,
               'startCommandResult': None, 'reasons': {name: None for name in REASONS}}
        field_labels = set()
        for line in block:
            label = re.match(r'\s*(app|startForegroundCount|isForeground|startRequested|startCommandResult|mAllow(?:Wiu|Start)_(?:noBinding|inBindService|byBindings))=', line)
            if label:
                if label[1] in field_labels: errors.append('duplicate-target-service-field:' + label[1])
                field_labels.add(label[1])
            if m := re.fullmatch(r'\s+app=(.+)', line):
                rec.update(app=m[1], appIsNull=m[1]=='null' if
                           (m[1] == 'null' or re.fullmatch(r'ProcessRecord\{[^\n]+\}', m[1])) else None)
            if m := re.fullmatch(r'\s+startForegroundCount=(-?\d+)\s*', line):rec['startForegroundCount']=int(m[1])
            if m := re.match(r'\s+isForeground=(true|false) foregroundId=(-?\d+) types=(0x[0-9a-fA-F]+)(?:\s|$)', line):
                rec.update(isForeground=m[1]=='true', foregroundId=int(m[2]), foregroundServiceType=m[3])
            if m := re.match(r'\s+startRequested=(true|false) delayedStop=(?:true|false) stopIfKilled=(true|false) callStart=(true|false)(?:\s|$)', line):
                rec.update(startRequested=m[1]=='true',stopIfKilled=m[2]=='true',callStart=m[3]=='true')
            if m := re.fullmatch(r'\s*startCommandResult=(-?\d+)\s*',line):rec['startCommandResult']=int(m[1])
            if m := re.fullmatch(r'\s+(mAllow(?:Wiu|Start)_(?:noBinding|inBindService|byBindings))=(\S+)\s*',line):rec['reasons'][m[1]]=m[2]
        rec['fieldsComplete'] = all(rec[k] is not None for k in ('app','appIsNull','startForegroundCount','isForeground','foregroundServiceType','startRequested','stopIfKilled','callStart','startCommandResult')) and all(v is not None for v in rec['reasons'].values())
        result['trackServices'].append(rec)
    apps = result['activeForegroundApps']; services = result['trackServices']
    # Duplicate map entries for the exact package/user are ambiguous, not silently collapsed.
    if len(apps) > 1 or result['targetUserForegroundSectionCount'] > 1:
        errors.append('duplicate-target-foreground-section-or-entry')
    if any(any(a[key] is None for key in ('mNumActive', 'mAppOnTop', 'mStartTime', 'mStartVisibleTime')) for a in apps):
        errors.append('incomplete-target-foreground-fields')
    if any(not r['fieldsComplete'] for r in services): errors.append('incomplete-target-service-fields')
    eligible = command_complete and unfiltered and not errors
    result['status'] = 'complete' if eligible else 'incomplete'
    result['activeForegroundAppsStatus'] = ('inconclusive' if not eligible else 'observed' if apps else
        'target-not-listed' if result['targetUserForegroundSectionCount'] else 'section-not-listed')
    result['trackServicesStatus'] = ('inconclusive' if not eligible else 'observed' if services else 'target-not-listed')
    return result


def read_evidence(filename, root, budget, limit=MAX_SOURCE_BYTES):
    """Read without changing raw files; hash the exact bytes actually parsed."""
    evidence = {'path': str(filename.relative_to(root)), 'bytes': None, 'sha256': None,
                'readStatus': 'incomplete'}
    try:
        info = filename.lstat()
        evidence['bytes'] = info.st_size
        if not stat.S_ISREG(info.st_mode): raise ValueError('not-a-regular-file')
        if info.st_size > limit or budget[0] + info.st_size > MAX_TOTAL_BYTES:
            raise ValueError('input-size-limit')
        fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as source:
            raw = source.read(min(limit, MAX_TOTAL_BYTES - budget[0]) + 1)
            after = os.fstat(source.fileno())
        if len(raw) > limit or budget[0] + len(raw) > MAX_TOTAL_BYTES:
            raise ValueError('input-size-limit')
        budget[0] += len(raw)
        evidence.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError('input-changed-during-read')
        evidence['readStatus'] = 'complete'
        return raw, evidence
    except (OSError, ValueError) as error:
        evidence['error'] = str(error)
        return None, evidence


def analyze_directory(output):
    """Write a unique report; publish root atomically only for complete inputs."""
    root = Path(output).resolve(strict=True)
    if not root.is_dir(): raise ValueError('OUT must be an existing directory')
    attempt = Path(tempfile.mkdtemp(prefix='foreground-observation-analysis.', dir=root))
    report_path = attempt / 'report.json'
    report = {'schemaVersion': 1, 'kind': 'framework-bookkeeping-observation-not-acceptance',
              'analysisAttempt': attempt.name, 'status': 'incomplete',
              'target': {'package': PACKAGE, 'userId': 0, 'service': PACKAGE + '/.TrackService'},
              'limits': {'maxSourceBytes': MAX_SOURCE_BYTES, 'maxTotalBytes': MAX_TOTAL_BYTES,
                         'maxObservations': MAX_OBSERVATIONS},
              'errors': [], 'observations': [],
              'ordering': 'Presentation only: random attempt names do not establish chronology.',
              'limitations': ['Sampled fields, not runtime caller/stack, cause or policy emulation.',
                              'Dump takes AMS locks and can affect timing; not atomic with other commands.',
                              'No UID/process absence, recovery or acceptance verdict.']}
    budget = [0]
    try:
        directories = sorted(p for p in root.iterdir() if p.name.startswith('race-observation.'))
        if len(directories) > MAX_OBSERVATIONS: raise ValueError('observation-count-limit')
        sources = [('before', None, root / 'race-before-services.txt')]
        for directory in directories:
            if directory.is_symlink() or not directory.is_dir():
                report['errors'].append('invalid-observation-directory: ' + directory.name)
            else:
                # A log-only failed attempt must not disappear from the report.
                sources.append(('attempt', directory.name, directory / 'services.txt'))
        for phase, identity, filename in sources:
            observation = {'phase': phase, 'captureAttempt': identity,
                           'status': 'incomplete', 'evidence': {}}
            report['observations'].append(observation)
            values = {}
            for kind, suffix in [('stdout', ''), ('stderr', '.stderr'),
                                 ('exitCode', '.exit-code.txt'), ('scope', '.scope.txt')]:
                values[kind], observation['evidence'][kind] = read_evidence(
                    Path(str(filename) + suffix), root, budget,
                    MAX_SOURCE_BYTES if kind == 'stdout' else 65536)
            code = values['exitCode']
            native_code = int(code.strip()) if code is not None and re.fullmatch(rb'\d{1,3}\s*', code) else None
            observation['nativeExitCode'] = native_code
            command_complete = (native_code == 0 and values['stderr'] == b'' and
                                all(e['readStatus'] == 'complete' for e in observation['evidence'].values()))
            unfiltered = values['scope'] == SCOPE
            observation['captureStatus'] = 'complete' if command_complete else 'incomplete'
            observation['scopeVerified'] = unfiltered
            observation['command'] = ['adb', 'shell', 'dumpsys', 'activity', 'services'] if unfiltered else None
            if values['stdout'] is not None:
                observation['fields'] = summarize_services(values['stdout'],
                    command_complete=command_complete, unfiltered=unfiltered)
                observation['status'] = observation['fields']['status']
            else:
                observation['fields'] = None
        if not report['errors'] and all(o['status'] == 'complete' for o in report['observations']):
            report['status'] = 'complete'
    except (OSError, ValueError, UnicodeError) as error:
        report['errors'].append(str(error))
    serialized = json.dumps(report, indent=2) + '\n'
    with report_path.open('x', encoding='utf-8') as stream: stream.write(serialized)
    published = False
    if report['status'] == 'complete':
        pending = attempt / 'publication.pending'
        try:
            with pending.open('x', encoding='utf-8') as stream: stream.write(serialized)
            os.replace(pending, root / 'foreground-observation.json')
            published = True
        except OSError as error:
            # Completed parsing is immutable; storage/publication failure is separate.
            with (attempt / 'publication-error.txt').open('x', encoding='utf-8') as stream:
                stream.write(str(error) + '\n')
    return {'status': 'complete' if published else 'incomplete',
            'summaryStatus': report['status'], 'published': published,
            'reportPath': str(report_path), 'exitCode': 0 if published else 2}


def main():
    try:
        if len(sys.argv) != 2: raise ValueError('Usage: analyze-android-foreground-observation.py OUT')
        outcome = analyze_directory(sys.argv[1])
        print(json.dumps(outcome))
        return outcome['exitCode']
    except (OSError, ValueError) as error:
        print(json.dumps({'status': 'incomplete', 'published': False, 'error': str(error)}))
        return 2


if __name__ == '__main__': sys.exit(main())
