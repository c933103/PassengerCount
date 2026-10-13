"""Offline release acceptance negative controls; no key material or network."""
import importlib.util
import io
import os
import stat
import tempfile
from pathlib import Path
import re
import unittest
import zipfile

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "verify-release-1.11.py"
SPEC = importlib.util.spec_from_file_location("release_verifier", MODULE)
rv = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rv)

ORIGINAL_CERT = "ce0a702a8515a3e5cfa03ba55ce2bd6279eb060cebcab9ac9aa4a4614a8667c8"


def zipped(entries):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, payload in entries:
            z.writestr(name, payload)
    return b.getvalue()


ALIGNED = zipped([
    ("AndroidManifest.xml", b"manifest-original"),
    ("resources.arsc", b"resources-original"),
    ("classes.dex", b"dex-original"),
    ("assets/www/storage.js", b"store-original"),
    ("assets/www/record-deletion.js", b"delete-original"),
])


class ReleaseVerifierTests(unittest.TestCase):
    def test_identical_payload_allows_signature_entries_only(self):
        candidate = zipped([
            ("AndroidManifest.xml", b"manifest-original"),
            ("resources.arsc", b"resources-original"),
            ("classes.dex", b"dex-original"),
            ("assets/www/storage.js", b"store-original"),
            ("assets/www/record-deletion.js", b"delete-original"),
            ("META-INF/MANIFEST.MF", b"v1 signature metadata"),
            ("META-INF/ORIGINAL.SF", b"v1 .SF"),
            ("META-INF/ORIGINAL.RSA", b"v1 .RSA"),
        ])
        self.assertEqual(rv.verify_payload_identity(ALIGNED, candidate), 5)

    def test_detect_changed_dex(self):
        modified = ALIGNED.replace(b"dex-original", b"dex-modified")
        # ZIP deflate means a raw-byte edit may corrupt CRC; build a new valid APK.
        modified = zipped([
            ("AndroidManifest.xml", b"manifest-original"),
            ("resources.arsc", b"resources-original"),
            ("classes.dex", b"dex-modified"),
            ("assets/www/storage.js", b"store-original"),
            ("assets/www/record-deletion.js", b"delete-original"),
        ])
        with self.assertRaisesRegex(rv.VerificationError, "APK payload changed: classes.dex"):
            rv.verify_payload_identity(ALIGNED, modified)

    def test_detect_missing_asset(self):
        modified = zipped([
            ("AndroidManifest.xml", b"manifest-original"),
            ("resources.arsc", b"resources-original"),
            ("classes.dex", b"dex-original"),
            ("assets/www/storage.js", b"store-original"),
        ])
        with self.assertRaisesRegex(rv.VerificationError, "APK file list changed"):
            rv.verify_payload_identity(ALIGNED, modified)

    def test_detect_unexpected_added_asset(self):
        with zipfile.ZipFile(io.BytesIO(ALIGNED)) as source:
            entries = [(name, source.read(name)) for name in source.namelist()]
        entries.append(("assets/www/injected.js", b"unsafe"))
        with self.assertRaisesRegex(rv.VerificationError, "Unexpected file"):
            rv.verify_payload_identity(ALIGNED, zipped(entries))

    def test_detect_unexpected_signing_metadata_path(self):
        with zipfile.ZipFile(io.BytesIO(ALIGNED)) as source:
            entries = [(name, source.read(name)) for name in source.namelist()]
        entries.append(("META-INF/additional.data", b"untrusted extra"))
        with self.assertRaisesRegex(rv.VerificationError, "Unexpected file"):
            rv.verify_payload_identity(ALIGNED, zipped(entries))

    def test_reject_zip_path_traversal(self):
        with self.assertRaisesRegex(rv.VerificationError, "unsafe ZIP name"):
            rv.safe_entries(zipped([("../bad", b"unsafe")]), "fixture")

    def test_reject_zip_absolute_path(self):
        with self.assertRaisesRegex(rv.VerificationError, "unsafe ZIP name"):
            rv.safe_entries(zipped([("/bad", b"unsafe")]), "fixture")

    def test_reject_zip_duplicate_name(self):
        with self.assertWarns(UserWarning):
            duplicate = zipped([("classes.dex", b"old"), ("classes.dex", b"new")])
        with self.assertRaisesRegex(rv.VerificationError, "duplicate ZIP entry"):
            rv.safe_entries(duplicate, "fixture")

    def test_reject_bad_zip(self):
        with self.assertRaisesRegex(rv.VerificationError, "malformed or unreadable ZIP"):
            rv.safe_entries(b"not a ZIP", "fixture")

    def test_reject_missing_required_dex(self):
        with self.assertRaisesRegex(rv.VerificationError, "Missing required APK payload: classes.dex"):
            rv.verify_payload_identity(zipped([("AndroidManifest.xml", b"manifest"),
                                               ("resources.arsc", b"resources")]),
                                       zipped([("AndroidManifest.xml", b"manifest"),
                                               ("resources.arsc", b"resources")]))

    def fake_apksigner(self, sha=ORIGINAL_CERT, v2=True, v3=True, signers=1):
        return "\n".join([
            "Verifies",
            f"Verified using v2 scheme (APK Signature Scheme v2): {str(v2).lower()}",
            f"Verified using v3 scheme (APK Signature Scheme v3): {str(v3).lower()}",
            f"Number of signers: {signers}",
            f"Signer #1 certificate SHA-256 digest: {sha}",
            "",
        ])

    def test_original_certificate_accepted(self):
        self.assertEqual(rv.parse_apksigner(self.fake_apksigner(), ORIGINAL_CERT), ORIGINAL_CERT)

    def test_wrong_certificate_rejected(self):
        with self.assertRaisesRegex(rv.VerificationError, "not the original"):
            rv.parse_apksigner(self.fake_apksigner("a"*64), ORIGINAL_CERT)

    def test_missing_v2_rejected(self):
        with self.assertRaisesRegex(rv.VerificationError, "required v2"):
            rv.parse_apksigner(self.fake_apksigner(v2=False), ORIGINAL_CERT)

    def test_missing_v3_rejected(self):
        with self.assertRaisesRegex(rv.VerificationError, "required v3"):
            rv.parse_apksigner(self.fake_apksigner(v3=False), ORIGINAL_CERT)

    def test_multiple_signers_rejected(self):
        with self.assertRaisesRegex(rv.VerificationError, "exactly one"):
            rv.parse_apksigner(self.fake_apksigner(signers=2), ORIGINAL_CERT)

    def test_unverified_apk_rejected(self):
        with self.assertRaisesRegex(rv.VerificationError, "did not report"):
            rv.parse_apksigner(self.fake_apksigner().replace("Verifies", "DOES NOT VERIFY"), ORIGINAL_CERT)

    def test_valid_manifest_accepted(self):
        badging = """package: name='app.passengercount' versionCode='12' versionName='1.11' platformBuildVersionName='15'
sdkVersion:'26'
targetSdkVersion:'35'
"""
        rv.parse_badging(badging, "app.passengercount", 12, "1.11", 26, 35)

    def test_wrong_code_rejected(self):
        badging = "package: name='app.passengercount' versionCode='11' versionName='1.11'\nsdkVersion:'26'\ntargetSdkVersion:'35'\n"
        with self.assertRaisesRegex(rv.VerificationError, "Wrong package/code/version"):
            rv.parse_badging(badging, "app.passengercount", 12, "1.11", 26, 35)

    def test_wrong_minimum_sdk_rejected(self):
        badging = "package: name='app.passengercount' versionCode='12' versionName='1.11'\nsdkVersion:'28'\ntargetSdkVersion:'35'\n"
        with self.assertRaisesRegex(rv.VerificationError, "Wrong Android SDK bounds"):
            rv.parse_badging(badging, "app.passengercount", 12, "1.11", 26, 35)

    def test_private_snapshot_is_unaffected_by_mutable_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            external = root / "external.apk"
            external.write_bytes(b"captured-bytes")
            with tempfile.TemporaryDirectory(dir=root) as private_dir:
                captured = rv.private_snapshot(private_dir, "candidate.apk", external.read_bytes())
                external.write_bytes(b"mutated-after-capture")
                self.assertEqual(captured.read_bytes(), b"captured-bytes")
                self.assertEqual(stat.S_IMODE(captured.stat().st_mode), 0o600)
                with self.assertRaises(FileExistsError):
                    rv.private_snapshot(private_dir, "candidate.apk", b"overwrite")

    def test_trusted_local_sdk_tools_and_no_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sdk = root / "build-tools" / "35.0.0"
            sdk.mkdir(parents=True)
            aapt = sdk / "aapt2"
            signer = sdk / "apksigner"
            for path in (aapt, signer):
                path.write_bytes(b"fixture")
                path.chmod(0o700)
            self.assertEqual(rv.local_sdk_tools(root), (aapt, signer))
            signer.unlink()
            signer.symlink_to(aapt)
            with self.assertRaisesRegex(rv.VerificationError, "Trusted Android SDK"):
                rv.local_sdk_tools(root)

    def test_policy_is_bound_to_current_provenance(self):
        import json
        with rv.POLICY_FILE.open() as file:
            policy = json.load(file)
        # Worktree test uses the earlier tracked public signing provenance.
        provenance = {
            "certificate_sha256": ORIGINAL_CERT,
            "delivered_apk_sha256": policy["previous_apk_sha256"],
            "package": "app.passengercount",
            "candidate_version": "1.11",
            "candidate_version_code": 12,
            "delivered_version": "1.10",
            "delivered_code": 11,
        }
        rv.validate_policy(policy, provenance)
        policy["accepted_tree"] = "0" * 40
        with self.assertRaisesRegex(rv.VerificationError, "tree does not match"):
            rv.validate_policy(policy, provenance)


if __name__ == "__main__":
    unittest.main()
