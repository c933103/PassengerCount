#!/usr/bin/env python3
"""Framework text/host filesystem regressions, not Android policy simulations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/analyze-android-foreground-observation.py'
spec = importlib.util.spec_from_file_location('foreground_observation', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def service(token='48f66dc', package='app.passengercount', user=0, listing='', foreground=False):
    # Compact labels from actual run116 TrackService snapshots; no policy logic.
    return (f'  * {listing}ServiceRecord{{{token} u{user} {package}/.TrackService c:{package}}}\n'
            f'    app={"ProcessRecord{a2b2fe5 222:app.passengercount:tracking/u0a209}" if foreground else "null"}\n'
            '    startForegroundCount=1\n'
            f'    isForeground={str(foreground).lower()} foregroundId=19 types={"0x00000008" if foreground else "0x00000000"}\n'
            '    startRequested=true delayedStop=false stopIfKilled=false callStart=true lastStartId=1\n'
            ' startCommandResult=1\n' +
            ''.join('    ' + name + '=DENIED\n' for name in module.REASONS))


def apps(package='app.passengercount', user=0, number=0):
    # Exact labels/order in captured ServiceDumper.dumpRemainsLocked bytecode.
    return (f'Active foreground apps - user {user}:\n  #0: {package}\n'
            f'    mNumActive={number} mAppOnTop=false mShownWhileTop=true mShownWhileScreenOn=true\n'
            '    mStartTime=-5s834ms mStartVisibleTime=-5s834ms\n')


def dump(content=None):
    return (module.HEADER + '\n' + (service() + apps() if content is None else content)).encode()


def capture(filename, raw=None, code=b'0\n', stderr=b'', scope=module.SCOPE):
    filename.parent.mkdir(parents=True, exist_ok=True)
    for suffix, data in [('', dump() if raw is None else raw), ('.exit-code.txt', code),
                         ('.stderr', stderr), ('.scope.txt', scope)]:
        Path(str(filename) + suffix).write_bytes(data)


def file_hashes(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


class ParserTests(unittest.TestCase):
    def parse(self, raw=None, complete=True, unfiltered=True):
        return module.summarize_services(dump() if raw is None else raw,
                                        command_complete=complete, unfiltered=unfiltered)

    def test_exact_target_and_user_only_and_all_six_reasons_count_sticky(self):
        result = self.parse(dump(service(package='app.passengercount.tests') +
            service(user=10) + service() + apps('app.passengercount.tests') +
            apps().split('\n', 1)[1].replace('  #0:', '  #1:') + apps(user=10)))
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(len(result['activeForegroundApps']), 1)
        self.assertEqual(len(result['trackServices']), 1)
        app = result['activeForegroundApps'][0]
        self.assertEqual(app['mNumActive'], 0)
        self.assertFalse(app['mAppOnTop'])
        record = result['trackServices'][0]
        self.assertEqual(record['token'], '48f66dc')
        self.assertEqual(record['startForegroundCount'], 1)
        self.assertEqual(record['startCommandResult'], 1)
        self.assertTrue(record['startRequested'])
        self.assertTrue(record['callStart'])
        self.assertFalse(record['stopIfKilled'])
        self.assertTrue(record['appIsNull'])
        self.assertFalse(record['isForeground'])
        self.assertEqual(record['foregroundServiceType'], '0x00000000')
        self.assertEqual(record['reasons'], dict.fromkeys(module.REASONS, 'DENIED'))
        self.assertGreater(record['lineEnd'], record['lineStart'])
        self.assertNotIn('passed', result)
        self.assertNotIn('allProcessesAbsent', result)

    def test_pending_restarting_and_destroy_listings_not_collapsed(self):
        result = self.parse(dump(''.join(service(listing=x) for x in ['Pending ', 'Restarting ', 'Destroy '])))
        self.assertEqual(result['status'], 'complete')
        self.assertEqual([r['listing'] for r in result['trackServices']], ['pending', 'restarting', 'destroy'])

    def test_full_component_and_negative_bookkeeping_are_preserved(self):
        text = (service().replace('app.passengercount/.TrackService',
            'app.passengercount/app.passengercount.TrackService') + apps(number=-1))
        result = self.parse(dump(text))
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['activeForegroundApps'][0]['mNumActive'], -1)

    def test_end_time_is_optional_relative_text_not_an_invented_zero(self):
        result = self.parse()
        app = result['activeForegroundApps'][0]
        self.assertEqual(app['mStartTime'], '-5s834ms')
        self.assertEqual(app['mStartVisibleTime'], '-5s834ms')
        self.assertIsNone(app['mEndTime'])
        self.assertEqual(app['mEndTimeStatus'], 'not-printed')
        for printed in ['-23ms', '0', '+1s2ms']:
            result = self.parse(dump(service() + apps() + '    mEndTime=' + printed + '\n'))
            self.assertEqual(result['status'], 'complete')
            app = result['activeForegroundApps'][0]
            self.assertEqual(app['mEndTimeStatus'], 'printed')
            self.assertEqual(app['mEndTime'], printed)
        malformed = self.parse(dump(service() + apps() + '    mEndTime=\n'))
        self.assertEqual(malformed['status'], 'incomplete')
        self.assertEqual(malformed['activeForegroundApps'][0]['mEndTimeStatus'], 'malformed')

    def test_foreground_section_stops_before_handler_fields(self):
        result = self.parse(dump(service() + apps() + '  Handler - user 0:\n    mEndTime=-1ms\n'))
        self.assertEqual(result['status'], 'complete')
        self.assertIsNone(result['activeForegroundApps'][0]['mEndTime'])

    def test_missing_section_entry_and_transport_failure_are_distinct(self):
        no_section = self.parse(dump(service()))
        no_entry = self.parse(dump(service() + apps('another.package')))
        no_service = self.parse(dump(apps()))
        self.assertEqual(no_section['activeForegroundAppsStatus'], 'section-not-listed')
        self.assertEqual(no_entry['activeForegroundAppsStatus'], 'target-not-listed')
        self.assertEqual(no_service['trackServicesStatus'], 'target-not-listed')
        for result in [no_section, no_entry, no_service]:
            self.assertEqual(result['status'], 'complete')
            self.assertNotIn('outcome', result)
        self.assertEqual(self.parse(dump(''), complete=False)['activeForegroundAppsStatus'], 'inconclusive')
        self.assertEqual(self.parse(dump(''), unfiltered=False)['activeForegroundAppsStatus'], 'inconclusive')

    def test_format_errors_and_partial_records_remain_incomplete(self):
        for raw in [b'', b'Permission Denial\n', dump() + b'\xff\n', dump()[:-1],
                    dump(service().replace('    startForegroundCount=1\n', '')),
                    dump(service().replace('    app=null\n', '    app=unknown\n')),
                    dump(service() + apps().replace('    mStartTime=-5s834ms mStartVisibleTime=-5s834ms\n', '')),
                    dump(service() + 'Active foreground apps - user 0:\n  #0: app.passengercount\n    mNumActive=\n'),
                    dump() + b'Exception in dumpServicesLocked\n', dump() + dump(),
                    dump(service() + apps() + apps()),
                    dump(service().replace('    app=null\n', '    app=null\n    app=null\n'))]:
            with self.subTest(raw=raw[:80]):
                result = self.parse(raw)
                self.assertEqual(result['status'], 'incomplete')
                self.assertEqual(result['activeForegroundAppsStatus'], 'inconclusive')

    def test_unknown_other_service_cannot_supply_target_missing_fields(self):
        incomplete = service().replace('    startForegroundCount=1\n', '')
        unknown = '  * Other ServiceRecord{abc u0 unrelated/.Thing}\n    startForegroundCount=1\n'
        result = self.parse(dump(incomplete + unknown))
        self.assertEqual(result['status'], 'incomplete')
        self.assertIsNone(result['trackServices'][0]['startForegroundCount'])


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.before = self.root / 'race-before-services.txt'
        capture(self.before)
        self.raw = self.root / 'race-observation.Z9z' / 'services.txt'
        capture(self.raw, dump(service(listing='Pending ') + apps()))

    def analyze(self):
        outcome = module.analyze_directory(self.root)
        report = json.loads(Path(outcome['reportPath']).read_text())
        return outcome, report

    def test_complete_publication_source_hashes_native_scope_and_identity(self):
        originals = file_hashes(self.root)
        outcome, report = self.analyze()
        self.assertEqual(outcome['exitCode'], 0)
        self.assertTrue(outcome['published'])
        self.assertEqual((self.root / 'foreground-observation.json').read_bytes(),
                         Path(outcome['reportPath']).read_bytes())
        self.assertEqual(report['status'], 'complete')
        self.assertEqual([x['captureAttempt'] for x in report['observations']], [None, 'race-observation.Z9z'])
        self.assertIn('do not establish chronology', report['ordering'])
        for source in report['observations']:
            self.assertEqual(source['nativeExitCode'], 0)
            self.assertTrue(source['scopeVerified'])
            for evidence in source['evidence'].values():
                raw = (self.root / evidence['path']).read_bytes()
                self.assertEqual(evidence['sha256'], hashlib.sha256(raw).hexdigest())
                self.assertEqual(evidence['bytes'], len(raw))
        for filename, digest in originals.items():
            self.assertEqual(file_hashes(self.root)[filename], digest)

    def test_success_then_partial_new_source_keeps_root_and_all_older_attempt_bytes(self):
        first, _ = self.analyze()
        old = file_hashes(self.root)
        partial = self.root / 'race-observation.A1a' / 'services.txt'
        capture(partial, raw=b'ACTIVITY MANAGER SERVICES', code=b'124\n', stderr=b'timeout\n')
        second, report = self.analyze()
        self.assertEqual(second['exitCode'], 2)
        self.assertFalse(second['published'])
        self.assertNotEqual(first['reportPath'], second['reportPath'])
        self.assertEqual(report['status'], 'incomplete')
        source = next(o for o in report['observations'] if o['captureAttempt'] == 'race-observation.A1a')
        self.assertEqual(source['nativeExitCode'], 124)
        self.assertEqual(source['evidence']['stdout']['sha256'], hashlib.sha256(partial.read_bytes()).hexdigest())
        for filename, digest in old.items():
            self.assertEqual(file_hashes(self.root)[filename], digest)

    def test_success_then_parse_failure_keeps_last_complete(self):
        self.analyze()
        old = (self.root / 'foreground-observation.json').read_bytes()
        capture(self.root / 'race-observation.bad' / 'services.txt', raw=dump(service() + apps() + apps()))
        outcome, report = self.analyze()
        self.assertEqual(outcome['exitCode'], 2)
        self.assertEqual(report['status'], 'incomplete')
        self.assertEqual((self.root / 'foreground-observation.json').read_bytes(), old)

    def test_log_only_attempt_is_not_silently_skipped(self):
        partial = self.root / 'race-observation.logonly'
        partial.mkdir()
        (partial / 'logcat.txt').write_text('partial log')
        outcome, report = self.analyze()
        self.assertEqual(outcome['exitCode'], 2)
        source = next(o for o in report['observations'] if o['captureAttempt'] == partial.name)
        self.assertIsNone(source['fields'])
        self.assertEqual(source['evidence']['stdout']['readStatus'], 'incomplete')

    def test_nonzero_stderr_missing_or_wrong_scope_and_missing_status_never_publish(self):
        for suffix, content in [('.exit-code.txt', b'1\n'), ('.exit-code.txt', b'unknown\n'),
                                ('.stderr', b'warning\n'), ('.scope.txt', b'PACKAGE_FILTERED\n'),
                                ('.scope.txt', module.SCOPE + b'extra\n'), ('.exit-code.txt', None)]:
            with self.subTest(suffix=suffix, content=content):
                capture(self.raw)
                filename = Path(str(self.raw) + suffix)
                if content is None: filename.unlink()
                else: filename.write_bytes(content)
                outcome, report = self.analyze()
                self.assertEqual(outcome['exitCode'], 2)
                self.assertEqual(report['status'], 'incomplete')
                self.assertFalse((self.root / 'foreground-observation.json').exists())

    def test_missing_before_is_an_explicit_incomplete_source(self):
        self.before.unlink()
        outcome, report = self.analyze()
        self.assertEqual(outcome['exitCode'], 2)
        self.assertEqual(report['observations'][0]['phase'], 'before')
        self.assertIsNone(report['observations'][0]['fields'])

    def test_symlink_source_and_directory_rejected_without_reading_target(self):
        external = self.root / 'outside'
        external.write_text('unrelated data')
        self.raw.unlink()
        self.raw.symlink_to(external)
        (self.root / 'race-observation.link').symlink_to(self.raw.parent, target_is_directory=True)
        outcome, report = self.analyze()
        self.assertEqual(outcome['exitCode'], 2)
        source = next(o for o in report['observations'] if o['captureAttempt'] == self.raw.parent.name)
        self.assertIsNone(source['evidence']['stdout']['sha256'])
        self.assertIn('invalid-observation-directory: race-observation.link', report['errors'])
        self.assertEqual(external.read_text(), 'unrelated data')

    def test_source_total_and_count_caps_are_incomplete_not_truncated_success(self):
        for setting, value in [('MAX_SOURCE_BYTES', 32), ('MAX_TOTAL_BYTES', 32), ('MAX_OBSERVATIONS', 0)]:
            with self.subTest(setting=setting), mock.patch.object(module, setting, value):
                outcome, report = self.analyze()
                self.assertEqual(outcome['exitCode'], 2)
                self.assertEqual(report['status'], 'incomplete')
                self.assertFalse((self.root / 'foreground-observation.json').exists())

    def test_publication_failure_preserves_prior_root_and_completed_attempt(self):
        self.analyze()
        old = (self.root / 'foreground-observation.json').read_bytes()
        with mock.patch.object(module.os, 'replace', side_effect=OSError('fixture rename failure')):
            outcome, report = self.analyze()
        self.assertEqual(outcome['exitCode'], 2)
        self.assertFalse(outcome['published'])
        self.assertEqual(report['status'], 'complete')
        self.assertEqual(outcome['status'], 'incomplete')
        self.assertEqual(outcome['summaryStatus'], 'complete')
        self.assertEqual((self.root / 'foreground-observation.json').read_bytes(), old)
        self.assertIn('fixture rename failure', (Path(outcome['reportPath']).parent / 'publication-error.txt').read_text())

    def test_actual_cli_status_and_attempt_path(self):
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.root)], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        complete = json.loads(result.stdout)
        self.assertTrue(Path(complete['reportPath']).is_file())
        capture(self.root / 'race-observation.partial' / 'services.txt', code=b'2\n')
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.root)], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 2, result.stderr)
        incomplete = json.loads(result.stdout)
        self.assertEqual(incomplete['status'], 'incomplete')
        self.assertFalse(incomplete['published'])
        self.assertTrue(Path(incomplete['reportPath']).is_file())
        bad = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, timeout=10)
        self.assertEqual(bad.returncode, 2)


if __name__ == '__main__':
    unittest.main()
