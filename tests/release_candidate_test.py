"""Offline contract and negative-control tests for the local 1.11 release verifier.

SDK tools are fixtures here: these tests do NOT certify a real production signer.
Real release acceptance requires actual Android SDK binaries and original APKs.
"""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify-release-candidate.py"
ROOT_FILES = (
    "index.html app.js native-track.js record-deletion.js core.js survey.js "
    "i18n.js charts.js data.js government.js fieldkit.js live.js export.js "
    "route-worker.js storage.js upload.js supabase-config.js style.css "
    "manifest.json icon-192.png icon-512.png"
).split()
CERT = "a" * 64
OTHER_CERT = "b" * 64


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def zipwrite(path, entries):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, content in entries.items():
            z.writestr(name, content)


class ReleaseCandidateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="passenger-release-gate-")
        self.addCleanup(self.temp.cleanup)
        self.top = Path(self.temp.name)
        self.src = self.top / "source"
        self.src.mkdir()
        self.sdk = self.top / "sdk" / "build-tools" / "35.0.0"
        self.sdk.mkdir(parents=True)
        self.aligned = self.top / "aligned.apk"
        self.candidate = self.top / "candidate.apk"
        self.previous = self.top / "previous.apk"
        (self.src / "android").mkdir()
        (self.src / "verification" / "releases").mkdir(parents=True)
        (self.src / "android" / "build.sh").write_text(
            '#!/bin/sh\nfor file in ' + ' '.join(ROOT_FILES) + '; do\n  :\ndone\n'
            'cp -R "$ROOT/vendor" "$ROOT/data" "$BUILD/assets/www/"\n')
        for name in ROOT_FILES:
            (self.src / name).write_bytes(("source-" + name).encode())
        for name in ("vendor/leaflet/LICENSE", "data/catalogue.json"):
            path = self.src / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(("source-" + name).encode())
        self.entries = {"AndroidManifest.xml": b"manifest", "classes.dex": b"dex"}
        for name in ROOT_FILES + ["vendor/leaflet/LICENSE", "data/catalogue.json"]:
            self.entries["assets/www/" + name] = (self.src / name).read_bytes()
        zipwrite(self.previous, {"AndroidManifest.xml": b"prior", "classes.dex": b"prior-dex"})
        zipwrite(self.aligned, self.entries)
        zipwrite(self.candidate, self.entries)
        provenance = {
            "package": "app.passengercount", "candidate_version": "1.11", "candidate_version_code": 12,
            "delivered_version": "1.10", "delivered_code": 11,
            "delivered_apk_sha256": digest(self.previous), "certificate_sha256": CERT,
        }
        (self.src / "verification" / "releases" / "1.11-signing-provenance.json").write_text(json.dumps(provenance))
        (self.sdk / "aapt2").write_text("""#!/usr/bin/env python3
import os, sys
is_old = sys.argv[-1].endswith('previous.apk')
code, version = ('11','1.10') if is_old else ('12', os.getenv('MOCK_VERSION', '1.11'))
print(f"package: name='app.passengercount' versionCode='{code}' versionName='{version}'")
print("sdkVersion:'26'")
print("targetSdkVersion:'35'")
""")
        (self.sdk / "apksigner").write_text("""#!/usr/bin/env python3
import os, sys
prior = sys.argv[-1].endswith('previous.apk')
cert = os.getenv('MOCK_PREVIOUS_CERT' if prior else 'MOCK_CANDIDATE_CERT', 'a' * 64)
print('Verifies')
print('Verified using v2 scheme (APK Signature Scheme v2): ' + os.getenv('MOCK_V2', 'true'))
print('Verified using v3 scheme (APK Signature Scheme v3): true')
print('Number of signers: 1')
print('Signer #1 certificate SHA-256 digest: ' + cert)
""")
        for name in ("aapt2", "apksigner"):
            (self.sdk / name).chmod(0o755)
        subprocess.run(["git", "init", "-q", str(self.src)], check=True)
        subprocess.run(["git", "-C", str(self.src), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.src), "-c", "user.name=Test", "-c",
                        "user.email=test@example.invalid", "commit", "-qm", "fixture"], check=True)
        self.commit = subprocess.check_output(["git", "-C", str(self.src), "rev-parse", "HEAD"], text=True).strip()
        self.env = os.environ.copy()

    def invoke(self, *extra, expected=None):
        cmd = [sys.executable, str(SCRIPT), "--source-dir", str(self.src), "--candidate", str(self.candidate),
               "--aligned-apk", str(self.aligned), "--previous-apk", str(self.previous),
               "--expected-source-commit", self.commit,
               "--expected-aligned-sha256", digest(self.aligned),
               "--android-sdk", str(self.top / "sdk"), *extra]
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=self.env)
        if expected is not None:
            self.assertEqual(completed.returncode, expected, completed.stdout + completed.stderr)
        return completed

    def test_positive_parser_and_payload_fixture_only(self):
        result = json.loads(self.invoke(expected=0).stdout)
        self.assertTrue(result["candidate_verified"])
        self.assertFalse(result["published"])
        self.assertEqual(result["matched_web_assets"], len(ROOT_FILES) + 2)
        self.assertEqual(result["signer_certificate_sha256"], CERT)

    def test_wrong_signer_rejected(self):
        self.env["MOCK_CANDIDATE_CERT"] = OTHER_CERT
        self.assertIn("Candidate signer", self.invoke(expected=1).stderr)

    def test_signature_scheme_required(self):
        self.env["MOCK_V2"] = "false"
        self.assertIn("missing Android v2", self.invoke(expected=1).stderr)

    def test_wrong_version_rejected(self):
        self.env["MOCK_VERSION"] = "1.10"
        self.assertIn("Package, version", self.invoke(expected=1).stderr)

    def test_changed_dex_rejected_even_with_matching_signer(self):
        altered = dict(self.entries, **{"classes.dex": b"malicious"})
        zipwrite(self.candidate, altered)
        self.assertIn("changes member size: classes.dex", self.invoke(expected=1).stderr)

    def test_bundled_asset_can_not_differ_from_source(self):
        altered = dict(self.entries, **{"assets/www/app.js": b"unexpected-web-content"})
        zipwrite(self.candidate, altered)
        zipwrite(self.aligned, altered)
        self.assertIn("Packaged web asset", self.invoke(expected=1).stderr)

    def test_extra_asset_rejected(self):
        altered = dict(self.entries, **{"assets/www/unknown.js": b"unexpected"})
        zipwrite(self.candidate, altered)
        zipwrite(self.aligned, altered)
        self.assertIn("Packaged web assets differ", self.invoke(expected=1).stderr)

    def test_wrong_aligned_digest_rejected(self):
        self.assertIn("CI aligned.apk SHA-256", self.invoke("--expected-aligned-sha256", "0"*64,
                                                            expected=1).stderr)

    def test_wrong_previous_binary_rejected(self):
        self.previous.write_bytes(self.previous.read_bytes() + b"altered")
        self.assertIn("Previous APK does not match", self.invoke(expected=1).stderr)

    def test_dirty_source_rejected(self):
        (self.src / "app.js").write_text("unsaved")
        self.assertIn("modified/untracked", self.invoke(expected=1).stderr)

    def test_wrong_source_revision_rejected(self):
        self.assertIn("not the accepted CI revision", self.invoke("--expected-source-commit", "0"*40,
                                                                     expected=1).stderr)

    def test_duplicate_member_rejected(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.candidate, "a") as z:
                z.writestr("classes.dex", b"dup")
        self.assertIn("duplicate ZIP members", self.invoke(expected=1).stderr)


if __name__ == "__main__":
    unittest.main()
