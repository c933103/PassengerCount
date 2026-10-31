#!/usr/bin/env python3
"""Offline patch checks only. Never compiles Java or claims Android acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

SOURCE = Path('services/core/java/com/android/server/am/ActiveServices.java')
TEST = Path('services/tests/mockingservicestests/src/com/android/server/am/PendingForegroundRestartTest.java')
PATCHES = ['0001-regression-and-selection-seam.patch',
           '0002-preserve-eligible-pending-sticky-fgs.patch']

def verify(data, expected):
    assert len(data) == expected['bytes'], 'byte count mismatch'
    assert hashlib.sha256(data).hexdigest() == expected['sha256'], 'SHA256 mismatch'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--framework-root', required=True, type=Path)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    manifest = json.loads((here / 'manifest.json').read_text())
    original = (args.framework_root / SOURCE).read_bytes()
    verify(original, manifest['files']['original_ActiveServices'])
    for key, name in zip(['patch1', 'patch2'], PATCHES):
        verify((here / name).read_bytes(), manifest['files'][key])
    checks = ['pinned source and patch hashes']
    with tempfile.TemporaryDirectory(prefix='pr19-framework-patch-') as directory:
        root = Path(directory)
        (root / SOURCE).parent.mkdir(parents=True)
        (root / SOURCE).write_bytes(original)
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        for key, name in zip(['prepared_ActiveServices', 'candidate_ActiveServices'], PATCHES):
            subprocess.run(['git', 'apply', '--check', str(here / name)], cwd=root, check=True)
            subprocess.run(['git', 'apply', str(here / name)], cwd=root, check=True)
            verify((root / SOURCE).read_bytes(), manifest['files'][key])
            checks.append(name + ' exact application')
        verify((root / TEST).read_bytes(), manifest['files']['test'])
        assert (root / TEST).read_text().count('@Test ') == 13
        checks.append('exact 13-case fixture')
        for name in reversed(PATCHES):
            subprocess.run(['git', 'apply', '-R', str(here / name)], cwd=root, check=True)
        assert (root / SOURCE).read_bytes() == original
        assert not (root / TEST).exists()
        checks.append('exact reverse to original')
    print(json.dumps({'status': 'SOURCE_AND_PATCH_CHECKS_ONLY', 'passed': checks,
        'java_compilation': 'NOT_RUN', 'android_runtime_tests': 'NOT_RUN',
        'full_apk_acceptance': 'NOT_RUN; original run122 failure remains binding'}, indent=2))

if __name__ == '__main__':
    main()
