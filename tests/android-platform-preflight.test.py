"""Collector transport/archive regressions, not a model of Android policy.

All subprocess calls are mocked. No test invokes adb or contacts a device.
"""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "capture-android-platform-preflight.py"
spec = importlib.util.spec_from_file_location("platform_preflight", SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


PROPERTIES = (
    "ro.build.fingerprint", "ro.build.id", "ro.build.version.incremental",
    "ro.build.version.sdk", "ro.build.version.security_patch", "ro.build.type",
    "ro.debuggable", "ro.product.cpu.abi", "persist.debug.dalvik.vm.jdwp.enabled",
)
EXPECTED_QUERIES = [
    ("transport", ["get-state"]),
    *((name, ["shell", "getprop", name]) for name in PROPERTIES),
    ("system-server-pid", ["shell", "pidof", "system_server"]),
    ("jdwp-pids", ["jdwp"]),
    ("package", ["shell", "dumpsys", "package", "app.passengercount"]),
    ("appops", ["shell", "cmd", "appops", "get", "app.passengercount"]),
    ("services", ["shell", "dumpsys", "activity", "services", "app.passengercount"]),
    ("services.jar-sha256", ["shell", "sha256sum", "/system/framework/services.jar"]),
    ("framework.jar-sha256", ["shell", "sha256sum", "/system/framework/framework.jar"]),
    ("framework-test-packages", ["shell", "pm", "list", "packages", "com.android.frameworks.mockingservicestests"]),
]
QUERY_NAMES = dict((tuple(args), name) for name, args in EXPECTED_QUERIES)
PARTIAL_OUT = b"partial\x00\xff\n"
PARTIAL_ERR = "transport error: 部分\n".encode()


class CollectorTests(unittest.TestCase):
    def run_fake(self, output, fail=None, mode="nonzero", *, sdk_image_dir=None,
                 serial="owned-test-target", adb="adb", transport_output=b"device\n"):
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            self.assertEqual(command[:3], [adb, "-s", serial])
            # Exact fixed query allowlist, rather than allowing arbitrary shell subcommands.
            self.assertIn(tuple(command[3:]), QUERY_NAMES)
            name = QUERY_NAMES[tuple(command[3:])]
            self.assertTrue(kwargs.get("capture_output"))
            self.assertGreater(kwargs.get("timeout", 0), 0)
            self.assertNotIn("shell", kwargs)
            if name == fail:
                if mode == "timeout":
                    raise subprocess.TimeoutExpired(command, kwargs["timeout"],
                                                    output=PARTIAL_OUT, stderr=PARTIAL_ERR)
                if mode == "launch-error":
                    raise OSError("adb unavailable")
                if mode == "stderr":
                    stdout = transport_output if name == "transport" else PARTIAL_OUT
                    return subprocess.CompletedProcess(command, 0, stdout, PARTIAL_ERR)
                return subprocess.CompletedProcess(command, 7, PARTIAL_OUT, PARTIAL_ERR)
            stdout = transport_output if name == "transport" else b"123\n"
            return subprocess.CompletedProcess(command, 0, stdout, b"")

        with mock.patch.object(preflight.subprocess, "run", side_effect=run):
            dest, code = preflight.collect(serial, output, adb, sdk_image_dir)
        return dest, code, calls

    @staticmethod
    def receipt(dest):
        return json.loads((dest / "receipt.json").read_text())

    def assert_entry_bytes(self, dest, entry, stdout=None, stderr=None):
        for stream, expected in (("stdout", stdout), ("stderr", stderr)):
            data = (dest / (entry["name"] + "." + stream)).read_bytes()
            if expected is not None:
                self.assertEqual(data, expected)
            self.assertEqual(entry[stream + "Bytes"], len(data))
            self.assertEqual(entry[stream + "Sha256"], hashlib.sha256(data).hexdigest())

    def test_read_only_commands_and_finite_jdwp_snapshot_are_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, calls = self.run_fake(tmp)
            self.assertEqual(code, 0)
            receipt = self.receipt(dest)
            self.assertEqual(calls, [["adb", "-s", "owned-test-target", *args]
                                     for _, args in EXPECTED_QUERIES])
            self.assertEqual([entry["name"] for entry in receipt["commands"]],
                             [name for name, _ in EXPECTED_QUERIES])
            jdwp = next(entry for entry in receipt["commands"] if entry["name"] == "jdwp-pids")
            self.assertEqual(jdwp["status"], 0)
            self.assert_entry_bytes(dest, jdwp, b"123\n", b"")
            self.assertEqual(receipt["kind"], "capability-observation-not-acceptance")
            self.assertFalse(receipt["deviceStateChangedByCollector"])

    def test_jdwp_timeout_preserves_partial_bytes_but_is_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, _ = self.run_fake(tmp, fail="jdwp-pids", mode="timeout")
            self.assertEqual(code, 2)
            entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == "jdwp-pids")
            self.assertEqual(entry["status"], "timeout")
            self.assert_entry_bytes(dest, entry, PARTIAL_OUT, PARTIAL_ERR)

    def test_success_then_partial_failure_preserves_previous_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, code, _ = self.run_fake(tmp)
            self.assertEqual(code, 0)
            original = {p.name: p.read_bytes() for p in first.iterdir()}
            second, code, _ = self.run_fake(tmp, fail="services.jar-sha256")
            self.assertNotEqual(first, second)
            self.assertEqual(code, 2)
            self.assertEqual(original, {p.name: p.read_bytes() for p in first.iterdir()})
            entry = next(c for c in self.receipt(second)["commands"] if c["name"] == "services.jar-sha256")
            self.assertEqual(entry["status"], 7)
            self.assert_entry_bytes(second, entry, PARTIAL_OUT, PARTIAL_ERR)

    def test_blank_serial_never_falls_back_to_implicit_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(preflight.subprocess, "run") as run:
                for serial in ("", " ", "\t\n"):
                    with self.subTest(serial=repr(serial)), self.assertRaises(ValueError):
                        preflight.collect(serial, tmp)
                run.assert_not_called()
            self.assertEqual(list(pathlib.Path(tmp).iterdir()), [])

    def test_unavailable_transport_stops_before_device_queries(self):
        for mode in ("nonzero", "timeout", "launch-error"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                dest, code, calls = self.run_fake(tmp, fail="transport", mode=mode)
                self.assertEqual(code, 2)
                self.assertEqual(len(calls), 1)
                self.assertEqual(len(self.receipt(dest)["commands"]), 1)
        for state in (b"offline\n", b"unauthorized\n", b"", b"bootloader\n"):
            with self.subTest(state=state), tempfile.TemporaryDirectory() as tmp:
                _, code, calls = self.run_fake(tmp, transport_output=state)
                self.assertEqual(code, 2)
                self.assertEqual(len(calls), 1)

    def test_every_query_nonzero_preserves_partial_stdout_and_stderr(self):
        for name, _ in EXPECTED_QUERIES:
            with self.subTest(query=name), tempfile.TemporaryDirectory() as tmp:
                dest, code, calls = self.run_fake(tmp, fail=name)
                self.assertEqual(code, 2)
                receipt = self.receipt(dest)
                entry = next(c for c in receipt["commands"] if c["name"] == name)
                self.assertEqual(entry["status"], 7)
                self.assert_entry_bytes(dest, entry, PARTIAL_OUT, PARTIAL_ERR)
                self.assertEqual(len(calls), 1 if name == "transport" else len(EXPECTED_QUERIES))
                for observed in receipt["commands"]:
                    self.assert_entry_bytes(dest, observed)

    def test_every_query_launch_failure_is_recorded_as_incomplete(self):
        for name, _ in EXPECTED_QUERIES:
            with self.subTest(query=name), tempfile.TemporaryDirectory() as tmp:
                dest, code, _ = self.run_fake(tmp, fail=name, mode="launch-error")
                self.assertEqual(code, 2)
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == name)
                self.assertEqual(entry["status"], "launch-error")
                self.assert_entry_bytes(dest, entry, b"", b"adb unavailable")

    def test_every_query_stderr_with_zero_exit_remains_incomplete(self):
        for name, _ in EXPECTED_QUERIES:
            with self.subTest(query=name), tempfile.TemporaryDirectory() as tmp:
                dest, code, _ = self.run_fake(tmp, fail=name, mode="stderr")
                self.assertEqual(code, 2)
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == name)
                self.assertEqual(entry["status"], 0)
                self.assert_entry_bytes(dest, entry,
                                        b"device\n" if name == "transport" else PARTIAL_OUT,
                                        PARTIAL_ERR)

    def test_ordinary_query_timeout_retains_partial_bytes_and_is_incomplete(self):
        for name, _ in EXPECTED_QUERIES:
            if name == "jdwp-pids":
                continue
            with self.subTest(query=name), tempfile.TemporaryDirectory() as tmp:
                dest, code, _ = self.run_fake(tmp, fail=name, mode="timeout")
                self.assertEqual(code, 2)
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == name)
                self.assertEqual(entry["status"], "timeout")
                self.assert_entry_bytes(dest, entry, PARTIAL_OUT, PARTIAL_ERR)

    def test_receipt_binds_all_bytes_and_explicit_target_to_actual_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, calls = self.run_fake(tmp, serial="emulator-5584", adb="/selected/sdk/adb")
            self.assertEqual(code, 0)
            receipt = self.receipt(dest)
            self.assertEqual(receipt["serial"], "emulator-5584")
            self.assertEqual([c["command"] for c in receipt["commands"]], calls)
            for entry in receipt["commands"]:
                self.assertEqual(entry["status"], 0)
                self.assertIsInstance(entry["startNs"], int)
                self.assertIsInstance(entry["endNs"], int)
                self.assert_entry_bytes(dest, entry)

    def test_sdk_metadata_copies_are_byte_exact_and_digest_bound(self):
        with tempfile.TemporaryDirectory() as tmp:
            sdk = pathlib.Path(tmp) / "sdk-image"
            sdk.mkdir()
            contents = {"source.properties": b"Pkg.Revision=9\r\n",
                        "package.xml": "<package>測試</package>\n".encode()}
            for name, data in contents.items():
                (sdk / name).write_bytes(data)
            dest, code, _ = self.run_fake(pathlib.Path(tmp) / "out", sdk_image_dir=sdk)
            self.assertEqual(code, 0)
            receipt = self.receipt(dest)
            self.assertEqual(len(receipt["sdkFiles"]), 2)
            for entry in receipt["sdkFiles"]:
                data = contents[entry["name"]]
                self.assertEqual((dest / ("sdk-" + entry["name"])).read_bytes(), data)
                self.assertEqual(entry["bytes"], len(data))
                self.assertEqual(entry["sha256"], hashlib.sha256(data).hexdigest())

    def test_each_sdk_metadata_read_failure_is_retained_without_losing_other_file(self):
        for failed in ("source.properties", "package.xml"):
            with self.subTest(file=failed), tempfile.TemporaryDirectory() as tmp:
                sdk = pathlib.Path(tmp) / "sdk-image"
                sdk.mkdir()
                other = "package.xml" if failed == "source.properties" else "source.properties"
                (sdk / other).write_bytes(b"valid sdk metadata\n")
                dest, code, _ = self.run_fake(pathlib.Path(tmp) / "out", sdk_image_dir=sdk)
                self.assertEqual(code, 2)
                entries = {e["name"]: e for e in self.receipt(dest)["sdkFiles"]}
                self.assertIn("error", entries[failed])
                self.assertNotIn("sha256", entries[failed])
                self.assertFalse((dest / ("sdk-" + failed)).exists())
                self.assertEqual((dest / ("sdk-" + other)).read_bytes(), b"valid sdk metadata\n")
                self.assertEqual(entries[other]["sha256"], hashlib.sha256(b"valid sdk metadata\n").hexdigest())


if __name__ == "__main__":
    unittest.main()
