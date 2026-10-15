"""Offline release acceptance negative controls; no key material or network."""
import importlib.util
import io
import os
import stat
import struct
import tempfile
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
import hashlib
import json
import zipfile

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "verify-release-1.11.py"
SPEC = importlib.util.spec_from_file_location("release_verifier", MODULE)
rv = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rv)

ORIGINAL_CERT = "ce0a702a8515a3e5cfa03ba55ce2bd6279eb060cebcab9ac9aa4a4614a8667c8"


def zipped(entries, resource_compression=zipfile.ZIP_STORED, resource_misalignment=0):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, payload in entries:
            if name == "resources.arsc":
                info = zipfile.ZipInfo(name)
                info.compress_type = resource_compression
                offset = b.tell() + 30 + len(name.encode("utf-8"))
                padding = (-offset + resource_misalignment) % 4
                info.extra = struct.pack("<HH", 0xcafe, padding) + b"\x00" * padding
                z.writestr(info, payload)
            else:
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
    def test_resource_layout_accepts_stored_aligned_data(self):
        offset = rv.verify_candidate_resource_layout(ALIGNED)
        self.assertEqual(offset % 4, 0)
        self.assertEqual(ALIGNED[offset:offset + len(b"resources-original")], b"resources-original")

    def test_resource_layout_rejects_recompressed_identical_payload(self):
        with zipfile.ZipFile(io.BytesIO(ALIGNED)) as archive:
            entries = [(name, archive.read(name)) for name in archive.namelist()]
        candidate = zipped(entries, resource_compression=zipfile.ZIP_DEFLATED)
        self.assertEqual(rv.verify_payload_identity(ALIGNED, candidate), 5)
        with self.assertRaisesRegex(rv.VerificationError, "stored uncompressed"):
            rv.verify_candidate_resource_layout(candidate)

    def test_resource_layout_rejects_all_three_misaligned_offsets(self):
        with zipfile.ZipFile(io.BytesIO(ALIGNED)) as archive:
            entries = [(name, archive.read(name)) for name in archive.namelist()]
        for remainder in (1, 2, 3):
            with self.subTest(remainder=remainder):
                candidate = zipped(entries, resource_misalignment=remainder)
                self.assertEqual(rv.verify_payload_identity(ALIGNED, candidate), 5)
                with self.assertRaisesRegex(rv.VerificationError, "4-byte boundary"):
                    rv.verify_candidate_resource_layout(candidate)

    def test_resource_layout_rejects_local_compression_disagreement(self):
        candidate = bytearray(ALIGNED)
        with zipfile.ZipFile(io.BytesIO(candidate)) as archive:
            offset = archive.getinfo("resources.arsc").header_offset
        struct.pack_into("<H", candidate, offset + 8, zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(rv.VerificationError, "compression metadata"):
            rv.verify_candidate_resource_layout(candidate)

    def test_resource_layout_uses_local_extra_length_not_central_extra(self):
        with zipfile.ZipFile(io.BytesIO(ALIGNED)) as archive:
            entries = [(name, archive.read(name)) for name in archive.namelist()]
        for remainder in (0, 1):
            with self.subTest(remainder=remainder):
                candidate = bytearray(zipped(entries, resource_misalignment=remainder))
                with zipfile.ZipFile(io.BytesIO(candidate)) as archive:
                    central = candidate.index(b"resources.arsc", archive.start_dir) - 46
                    local = archive.getinfo("resources.arsc").header_offset
                name_size, extra_size = struct.unpack_from("<HH", candidate, central + 28)
                start = central + 46 + name_size
                del candidate[start:start + extra_size]
                struct.pack_into("<H", candidate, central + 30, 0)
                end = candidate.rindex(b"PK\x05\x06")
                old_size = struct.unpack_from("<I", candidate, end + 12)[0]
                struct.pack_into("<I", candidate, end + 12, old_size - extra_size)
                # Local padding remains, although the central-directory extra
                # field is now empty. Both APKs retain exactly the same payload.
                self.assertGreater(struct.unpack_from("<H", candidate, local + 28)[0], 0)
                self.assertEqual(rv.verify_payload_identity(ALIGNED, candidate), 5)
                if remainder == 0:
                    offset = rv.verify_candidate_resource_layout(candidate)
                    self.assertEqual(candidate[offset:offset + 18], b"resources-original")
                else:
                    with self.assertRaisesRegex(rv.VerificationError, "4-byte boundary"):
                        rv.verify_candidate_resource_layout(candidate)

    def test_resource_layout_rejects_malformed_local_header_fields(self):
        with zipfile.ZipFile(io.BytesIO(ALIGNED)) as archive:
            local = archive.getinfo("resources.arsc").header_offset
        for position, value, expected in (
                (0, b"BAD!", "compression metadata"),
                (26, struct.pack("<H", 1), "local data layout"),
                (26, struct.pack("<H", 65535), "local data layout"),
                (28, struct.pack("<H", 65535), "local data layout")):
            with self.subTest(position=position, value=value):
                candidate = bytearray(ALIGNED)
                candidate[local + position:local + position + len(value)] = value
                with self.assertRaisesRegex(rv.VerificationError, expected):
                    rv.verify_candidate_resource_layout(candidate)

    def test_resource_layout_rejects_truncated_local_header(self):
        candidate = bytearray(ALIGNED)
        with zipfile.ZipFile(io.BytesIO(candidate)) as archive:
            central = candidate.index(b"resources.arsc", archive.start_dir) - 46
        struct.pack_into("<I", candidate, central + 42, len(candidate) - 20)
        with self.assertRaisesRegex(rv.VerificationError, "local header is truncated"):
            rv.verify_candidate_resource_layout(candidate)

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


# The copied CLI is byte-for-byte the production source. Only adjacent policy
# files and SDK executables are synthetic; no production bypass flags exist.
STUB_SOURCE = r'''import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time

sdk = Path(__file__).resolve().parents[2]
config = json.loads((sdk / "stub-config.json").read_text())
tool = Path(__file__).name
snapshot = Path(sys.argv[-1])
kind = snapshot.stem
stage = tool + ":" + kind
expected_args = (["verify", "--verbose", "--print-certs", "--min-sdk-version", "26"]
                 if tool == "apksigner" else ["dump", "badging"])
assert sys.argv[1:-1] == expected_args, "incorrect SDK invocation"
assert kind in ("candidate", "previous"), "incorrect snapshot name"
assert snapshot != Path(config[kind + "_path"]), "mutable caller path used"
assert stat.S_IMODE(snapshot.stat().st_mode) == 0o600, "snapshot is not private"
assert stat.S_IMODE(snapshot.parent.stat().st_mode) == 0o700, "directory is not private"
assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == config[kind + "_sha"], "snapshot changed"
assert set(os.environ) <= {"PATH", "JAVA_HOME", "LANG", "LC_ALL"}, "unexpected inherited environment"
assert os.environ["PATH"] == config["path"], "runtime PATH missing"
assert os.environ["JAVA_HOME"] == config["java_home"], "runtime JAVA_HOME missing"
assert os.environ["LANG"] == os.environ["LC_ALL"] == "C", "non-deterministic locale"
with (sdk / "calls.jsonl").open("a") as log:
    log.write(json.dumps({"stage": stage}) + "\n")
if config.get("mutate") and stage == "apksigner:candidate":
    for name in ("candidate", "previous"):
        Path(config[name + "_path"]).write_bytes(b"synthetic caller mutation")
if config.get("stage") == stage:
    mode = config["mode"]
    if mode == "exit":
        print("synthetic SDK failure", file=sys.stderr)
        sys.exit(7)
    if mode == "invalid":
        print("synthetic malformed transcript")
        sys.exit(0)
    if mode in ("stdout", "stderr"):
        print("x" * (128 * 1024 + 1), file=getattr(sys, mode))
        sys.exit(0)
    if mode == "timeout":
        time.sleep(60)
if tool == "apksigner":
    print("Verifies")
    print("Verified using v2 scheme (APK Signature Scheme v2): true")
    print("Verified using v3 scheme (APK Signature Scheme v3): true")
    print("Number of signers: 1")
    print("Signer #1 certificate SHA-256 digest: " + config["certificate"])
else:
    code, version = (12, "1.11") if kind == "candidate" else (11, "1.10")
    print(f"package: name='app.passengercount' versionCode='{code}' versionName='{version}'")
    print("sdkVersion:'26'")
    print("targetSdkVersion:'35'")
'''


class ReleaseVerifierCliTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.cli = self.root / "scripts" / MODULE.name
        self.cli.parent.mkdir()
        shutil.copyfile(MODULE, self.cli)
        self.assertEqual(self.cli.read_bytes(), MODULE.read_bytes())
        releases = self.root / "verification" / "releases"
        releases.mkdir(parents=True)
        with zipfile.ZipFile(io.BytesIO(ALIGNED)) as archive:
            self.entries = [(name, archive.read(name)) for name in archive.namelist()]
        self.candidate_bytes = zipped(self.entries + [
            ("META-INF/MANIFEST.MF", b"synthetic manifest"),
            ("META-INF/ORIGINAL.SF", b"synthetic signature"),
            ("META-INF/ORIGINAL.RSA", b"synthetic certificate")])
        previous_bytes = zipped([("AndroidManifest.xml", b"1.10"),
                                 ("classes.dex", b"old-dex")])
        # This artifact contains a tripwire executable. The CLI must never run it.
        self.artifact = self.root / "accepted-ci.zip"
        self.artifact.write_bytes(zipped([
            ("aligned.apk", ALIGNED), ("PassengerCount.apk", ALIGNED),
            ("signing-tools/apksigner", b"untrusted artifact tool; never execute")]))
        self.candidate = self.root / "candidate.apk"
        self.previous = self.root / "previous.apk"
        self.candidate.write_bytes(self.candidate_bytes)
        self.previous.write_bytes(previous_bytes)
        digest = lambda data: hashlib.sha256(data).hexdigest()
        policy = json.loads(rv.POLICY_FILE.read_text())
        policy.update(ci_artifact_zip_sha256=digest(self.artifact.read_bytes()),
                      aligned_apk_sha256=digest(ALIGNED),
                      ci_ephemeral_apk_sha256=digest(ALIGNED),
                      previous_apk_sha256=digest(previous_bytes),
                      original_certificate_sha256="7" * 64)
        provenance = json.loads(rv.OLD_PROVENANCE_FILE.read_text())
        provenance.update(certificate_sha256=policy["original_certificate_sha256"],
                          delivered_apk_sha256=policy["previous_apk_sha256"])
        (releases / rv.POLICY_FILE.name).write_text(json.dumps(policy))
        (releases / rv.OLD_PROVENANCE_FILE.name).write_text(json.dumps(provenance))
        self.sdk = self.root / "sdk"
        self.tools = self.sdk / "build-tools" / "35.0.0"
        self.tools.mkdir(parents=True)
        for name in ("apksigner", "aapt2"):
            executable = self.tools / name
            executable.write_text("#!" + sys.executable + "\n" + STUB_SOURCE)
            executable.chmod(0o700)
        self.config = {
            "candidate_path": str(self.candidate), "previous_path": str(self.previous),
            "candidate_sha": digest(self.candidate_bytes),
            "previous_sha": digest(previous_bytes),
            "certificate": policy["original_certificate_sha256"],
            "path": os.defpath, "java_home": str(self.root / "synthetic-jdk"),
        }
        # Build a fresh environment. Never copy real credentials into a fixture.
        self.environment = {"PATH": self.config["path"],
                            "JAVA_HOME": self.config["java_home"]}
        for name in ("LOCAL_SIGNING_STORE_PASSWORD", "LOCAL_SIGNING_KEY_PASSWORD",
                     "SIGNING_STORE_PASSWORD", "SIGNING_KEY_PASSWORD", "SIGNING_KEYSTORE",
                     "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID", "JAVA_TOOL_OPTIONS",
                     "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "PYTHONPATH", "BASH_ENV"):
            self.environment[name] = "synthetic-test-only"

    def run_cli(self, **settings):
        config = dict(self.config, **settings)
        (self.sdk / "stub-config.json").write_text(json.dumps(config))
        self.log = self.sdk / "calls.jsonl"
        self.log.unlink(missing_ok=True)
        return subprocess.run([
            sys.executable, "-I", str(self.cli),
            "--ci-artifact", str(self.artifact), "--candidate", str(self.candidate),
            "--previous", str(self.previous), "--android-home", str(self.sdk),
        ], capture_output=True, text=True, check=False, timeout=50,
            env=self.environment, cwd=self.root)

    def calls(self):
        return ([json.loads(line)["stage"] for line in self.log.read_text().splitlines()]
                if self.log.exists() else [])

    def assert_failed(self, result, message):
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("RELEASE_VERIFICATION_FAILED:", result.stderr)
        self.assertIn(message, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_cli_accepts_synthetic_gate_with_sanitized_environment(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        report = json.loads(result.stdout)
        self.assertEqual(report["candidate_apk_sha256"], self.config["candidate_sha"])
        self.assertEqual(report["compared_non_signature_apk_entries"], len(self.entries))
        self.assertEqual(report["result"], "release_binary_checks_passed_only")
        self.assertFalse(report["published"])
        self.assertFalse(report["physical_device_upgrade_verified"])
        self.assertTrue(report["resources_arsc_stored_and_4_byte_aligned"])
        self.assertEqual(report["resources_arsc_data_offset"] % 4, 0)
        self.assertEqual(self.calls(), ["apksigner:candidate", "apksigner:previous",
                                       "aapt2:candidate", "aapt2:previous"])

    def test_cli_uses_snapshots_after_mutation_of_both_caller_files(self):
        result = self.run_cli(mutate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["candidate_apk_sha256"], self.config["candidate_sha"])
        self.assertEqual(report["previous_apk_sha256"], self.config["previous_sha"])
        self.assertEqual(self.candidate.read_bytes(), b"synthetic caller mutation")
        self.assertEqual(self.previous.read_bytes(), b"synthetic caller mutation")
        self.assertEqual(len(self.calls()), 4)

    def test_cli_rejects_real_nonzero_tool_exits_at_each_stage(self):
        stages = ["apksigner:candidate", "apksigner:previous", "aapt2:candidate", "aapt2:previous"]
        for index, stage in enumerate(stages):
            with self.subTest(stage=stage):
                self.assert_failed(self.run_cli(stage=stage, mode="exit"), "failed (exit 7)")
                self.assertEqual(self.calls(), stages[:index + 1])

    def test_cli_rejects_real_invalid_signer_transcripts(self):
        for kind in ("candidate", "previous"):
            with self.subTest(kind=kind):
                self.assert_failed(self.run_cli(stage="apksigner:" + kind, mode="invalid"),
                                   "did not report successful verification")

    def test_cli_rejects_real_invalid_manifest_transcripts(self):
        for kind, expected in (("candidate", "Cannot unambiguously parse"),
                               ("previous", "Previous APK identity does not match")):
            with self.subTest(kind=kind):
                self.assert_failed(self.run_cli(stage="aapt2:" + kind, mode="invalid"), expected)

    def test_cli_rejects_excessive_stdout_and_stderr(self):
        for stream in ("stdout", "stderr"):
            with self.subTest(stream=stream):
                self.assert_failed(self.run_cli(stage="apksigner:candidate", mode=stream),
                                   "produced excessive output")

    def test_cli_enforces_real_production_timeout(self):
        # Exercise the unchanged 35-second production timeout; no patched clock,
        # subprocess helper, or test-only CLI override can satisfy this control.
        self.assert_failed(self.run_cli(stage="apksigner:candidate", mode="timeout"),
                           "unavailable or timed out")
        self.assertEqual(self.calls(), ["apksigner:candidate"])

    def test_cli_rejects_unusable_executables(self):
        signer = self.tools / "apksigner"
        signer.chmod(0o600)
        self.assert_failed(self.run_cli(), "not executable")
        self.assertEqual(self.calls(), [])
        signer.chmod(0o700)
        signer.write_text("synthetic invalid executable format\n")
        self.assert_failed(self.run_cli(), "unavailable or timed out")
        self.assertEqual(self.calls(), [])

    def test_cli_rejects_tampered_ci_before_any_sdk_execution(self):
        self.artifact.write_bytes(self.artifact.read_bytes() + b"tampered")
        self.assert_failed(self.run_cli(), "CI artifact ZIP differs")
        self.assertEqual(self.calls(), [])

    def test_cli_rejects_changed_payload_before_any_sdk_execution(self):
        self.candidate.write_bytes(zipped([
            (name, b"changed-dex" if name == "classes.dex" else data)
            for name, data in self.entries]))
        self.assert_failed(self.run_cli(), "APK payload changed: classes.dex")
        self.assertEqual(self.calls(), [])

    def test_cli_rejects_recompressed_resource_before_any_sdk_execution(self):
        self.candidate.write_bytes(zipped(self.entries, resource_compression=zipfile.ZIP_DEFLATED))
        self.assertEqual(rv.verify_payload_identity(ALIGNED, self.candidate.read_bytes()), len(self.entries))
        self.assert_failed(self.run_cli(), "stored uncompressed")
        self.assertEqual(self.calls(), [])

    def test_cli_rejects_misaligned_resource_before_any_sdk_execution(self):
        for remainder in (1, 2, 3):
            with self.subTest(remainder=remainder):
                self.candidate.write_bytes(zipped(self.entries, resource_misalignment=remainder))
                self.assertEqual(rv.verify_payload_identity(ALIGNED, self.candidate.read_bytes()), len(self.entries))
                self.assert_failed(self.run_cli(), "4-byte boundary")
                self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
