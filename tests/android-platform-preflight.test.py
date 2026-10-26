"""Collector transport/archive regressions, not a model of Android policy.

All subprocess calls are mocked. No test invokes adb or contacts a device.
"""
import hashlib
import copy
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "capture-android-platform-preflight.py"
sys.path.insert(0, str(SCRIPT.parent))
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
    ("jdwp-initial-frame", ["track-jdwp"]),
    ("system-server-pid-after", ["shell", "pidof", "system_server"]),
    ("package", ["shell", "dumpsys", "package", "app.passengercount"]),
    ("appops", ["shell", "cmd", "appops", "get", "app.passengercount"]),
    ("services", ["shell", "dumpsys", "activity", "services", "app.passengercount"]),
    ("services.jar-sha256", ["shell", "sha256sum", "/system/framework/services.jar"]),
    ("framework.jar-sha256", ["shell", "sha256sum", "/system/framework/framework.jar"]),
    ("framework-test-packages", ["shell", "pm", "list", "packages", "com.android.frameworks.mockingservicestests"]),
]
ORDINARY_QUERIES = [(name, args) for name, args in EXPECTED_QUERIES if name != "jdwp-initial-frame"]
PARTIAL_OUT = b"partial\x00\xff\n"
PARTIAL_ERR = "transport error: 部分\n".encode()


def frame_observation(pids=(123,)):
    payload = b"".join(str(pid).encode() + b"\n" for pid in pids)
    return {"stdout": f"{len(payload):04x}".encode() + payload, "stderr": b"",
            "status": "complete-frame", "nativeReturnCode": -15,
            "frame": {"pids": list(pids), "length": len(payload),
                      "frameBytes": 4 + len(payload), "emptyRegistrySnapshot": not payload,
                      "nonemptyListMayBeTruncated": bool(payload)},
            "stdoutTruncated": False, "stderrTruncated": False,
            "termination": {"requested": True, "forcedKill": False,
                            "reason": "complete-frame", "cleanupErrors": []}}


class CollectorTests(unittest.TestCase):
    def run_fake(self, output, fail=None, mode="nonzero", *, sdk_image_dir=None,
                 serial="owned-test-target", adb="adb", transport_output=b"device\n",
                 frame_result=None, pid_before=b"123\n", pid_after=b"123\n"):
        calls = []

        def record(command):
            self.assertEqual(command[:3], [adb, "-s", serial])
            # Exact ordered allowlist also distinguishes before/after PID reads.
            name, args = EXPECTED_QUERIES[len(calls)]
            self.assertEqual(command[3:], args)
            calls.append(command)
            return name

        def run(command, **kwargs):
            name = record(command)
            self.assertNotEqual(name, "jdwp-initial-frame")
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
            stdout = {"transport": transport_output,
                      "system-server-pid": pid_before,
                      "system-server-pid-after": pid_after}.get(name, b"123\n")
            return subprocess.CompletedProcess(command, 0, stdout, b"")

        def snapshot(command, **kwargs):
            self.assertEqual(record(command), "jdwp-initial-frame")
            self.assertGreater(kwargs.get("timeout", 3.0), 0)
            return copy.deepcopy(frame_result if frame_result is not None else frame_observation())

        with mock.patch.object(preflight.subprocess, "run", side_effect=run), \
                mock.patch.object(preflight, "capture_initial_frame", side_effect=snapshot):
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

    def test_read_only_commands_and_complete_jdwp_frame_are_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, calls = self.run_fake(tmp)
            self.assertEqual(code, 0)
            receipt = self.receipt(dest)
            self.assertEqual(calls, [["adb", "-s", "owned-test-target", *args]
                                     for _, args in EXPECTED_QUERIES])
            self.assertEqual([entry["name"] for entry in receipt["commands"]],
                             [name for name, _ in EXPECTED_QUERIES])
            jdwp = next(entry for entry in receipt["commands"] if entry["name"] == "jdwp-initial-frame")
            self.assertEqual(jdwp["status"], "complete-frame")
            self.assertEqual(jdwp["nativeReturnCode"], -15)
            self.assertTrue(jdwp["termination"]["requested"])
            self.assert_entry_bytes(dest, jdwp, b"0004123\n", b"")
            self.assertEqual(receipt["jdwpObservation"]["status"], "observed-present")
            self.assertEqual(receipt["kind"], "capability-observation-not-acceptance")
            self.assertFalse(receipt["deviceStateChangedByCollector"])

    def test_jdwp_timeout_preserves_partial_bytes_but_is_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = frame_observation()
            result.update(status="timeout", frame=None, stdout=b"000412", stderr=b"")
            result["termination"]["reason"] = "timeout"
            dest, code, _ = self.run_fake(tmp, frame_result=result)
            self.assertEqual(code, 2)
            entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == "jdwp-initial-frame")
            self.assertEqual(entry["status"], "timeout")
            self.assertEqual(entry["nativeReturnCode"], -15)
            self.assert_entry_bytes(dest, entry, b"000412", b"")
            self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], "inconclusive")

    def test_complete_empty_frame_is_not_silence_and_requires_stable_pid(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, _ = self.run_fake(tmp, frame_result=frame_observation(()))
            self.assertEqual(code, 0)
            self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], "complete-empty")
            entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == "jdwp-initial-frame")
            self.assert_entry_bytes(dest, entry, b"0000", b"")
            self.assertEqual(entry["frame"]["pids"], [])
        with tempfile.TemporaryDirectory() as tmp:
            result = frame_observation(())
            result.update(stdout=b"", status="timeout", frame=None)
            result["termination"]["reason"] = "timeout"
            dest, code, _ = self.run_fake(tmp, frame_result=result)
            self.assertEqual(code, 2)
            self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], "inconclusive")

    def test_nonempty_missing_pid_is_only_not_listed_not_absolute_absence(self):
        for pids, expected in (((123, 456), "observed-present"),
                               ((456,), "not-listed-in-reported-frame")):
            with self.subTest(pids=pids), tempfile.TemporaryDirectory() as tmp:
                dest, code, _ = self.run_fake(tmp, frame_result=frame_observation(pids))
                self.assertEqual(code, 0)
                self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], expected)
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == "jdwp-initial-frame")
                self.assertTrue(entry["frame"]["nonemptyListMayBeTruncated"])

    def test_changed_or_invalid_system_server_pid_never_establishes_availability(self):
        for before, after in ((b"123\n", b"456\n"), (b"", b"123\n"),
                              (b"123\n", b""), (b"123 456\n", b"123 456\n"),
                              (b"invalid\n", b"invalid\n"), (b"0\n", b"0\n")):
            for pids in ((), (123,)):
                with self.subTest(before=before, after=after, pids=pids), tempfile.TemporaryDirectory() as tmp:
                    dest, code, _ = self.run_fake(tmp, pid_before=before, pid_after=after,
                                                  frame_result=frame_observation(pids))
                    self.assertEqual(code, 2)
                    self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], "inconclusive")

    def test_pid_query_failures_override_complete_empty_frame(self):
        for name in ("system-server-pid", "system-server-pid-after"):
            for mode in ("nonzero", "timeout", "launch-error", "stderr"):
                with self.subTest(query=name, mode=mode), tempfile.TemporaryDirectory() as tmp:
                    dest, code, _ = self.run_fake(tmp, fail=name, mode=mode,
                                                  frame_result=frame_observation(()))
                    self.assertEqual(code, 2)
                    self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], "inconclusive")

    def test_all_incomplete_helper_statuses_remain_inconclusive(self):
        statuses = ("timeout", "eof-before-frame", "malformed-frame", "launch-error",
                    "command-error", "cleanup-error", "capture-error", "output-limit", "stderr")
        for status in statuses:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
                result = frame_observation()
                result.update(status=status, stdout=b"000412", frame=None)
                result["termination"]["reason"] = status
                dest, code, _ = self.run_fake(tmp, frame_result=result)
                self.assertEqual(code, 2)
                self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], "inconclusive")
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == "jdwp-initial-frame")
                self.assertEqual(entry["status"], status)
                self.assert_entry_bytes(dest, entry, b"000412", b"")

    def test_complete_frame_with_stderr_remains_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = frame_observation(())
            result["stderr"] = PARTIAL_ERR
            dest, code, _ = self.run_fake(tmp, frame_result=result)
            self.assertEqual(code, 2)
            self.assertEqual(self.receipt(dest)["jdwpObservation"]["status"], "inconclusive")
            entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == "jdwp-initial-frame")
            self.assert_entry_bytes(dest, entry, b"0000", PARTIAL_ERR)

    def test_native_exit_and_termination_details_are_never_rewritten(self):
        for native, requested, forced in ((0, False, False), (-15, True, False), (-9, True, True)):
            with self.subTest(native=native), tempfile.TemporaryDirectory() as tmp:
                result = frame_observation()
                result["nativeReturnCode"] = native
                result["termination"].update(requested=requested, forcedKill=forced)
                dest, code, _ = self.run_fake(tmp, frame_result=result)
                self.assertEqual(code, 0)
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == "jdwp-initial-frame")
                self.assertEqual(entry["status"], "complete-frame")
                self.assertEqual(entry["nativeReturnCode"], native)
                self.assertEqual(entry["termination"], result["termination"])

    def test_complete_frame_then_partial_frame_failure_preserves_previous_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, code, _ = self.run_fake(tmp, frame_result=frame_observation(()))
            self.assertEqual(code, 0)
            original = {p.name: p.read_bytes() for p in first.iterdir()}
            result = frame_observation(())
            result.update(stdout=b"000", status="timeout", frame=None)
            result["termination"]["reason"] = "timeout"
            second, code, _ = self.run_fake(tmp, frame_result=result)
            self.assertEqual(code, 2)
            self.assertNotEqual(first, second)
            self.assertEqual(original, {p.name: p.read_bytes() for p in first.iterdir()})
            self.assertEqual(self.receipt(second)["jdwpObservation"]["status"], "inconclusive")

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
            with mock.patch.object(preflight.subprocess, "run") as run, \
                    mock.patch.object(preflight, "capture_initial_frame") as snapshot:
                for serial in ("", " ", "\t\n"):
                    with self.subTest(serial=repr(serial)), self.assertRaises(ValueError):
                        preflight.collect(serial, tmp)
                run.assert_not_called()
                snapshot.assert_not_called()
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
        for name, _ in ORDINARY_QUERIES:
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
        for name, _ in ORDINARY_QUERIES:
            with self.subTest(query=name), tempfile.TemporaryDirectory() as tmp:
                dest, code, _ = self.run_fake(tmp, fail=name, mode="launch-error")
                self.assertEqual(code, 2)
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == name)
                self.assertEqual(entry["status"], "launch-error")
                self.assert_entry_bytes(dest, entry, b"", b"adb unavailable")

    def test_every_query_stderr_with_zero_exit_remains_incomplete(self):
        for name, _ in ORDINARY_QUERIES:
            with self.subTest(query=name), tempfile.TemporaryDirectory() as tmp:
                dest, code, _ = self.run_fake(tmp, fail=name, mode="stderr")
                self.assertEqual(code, 2)
                entry = next(c for c in self.receipt(dest)["commands"] if c["name"] == name)
                self.assertEqual(entry["status"], 0)
                self.assert_entry_bytes(dest, entry,
                                        b"device\n" if name == "transport" else PARTIAL_OUT,
                                        PARTIAL_ERR)

    def test_ordinary_query_timeout_retains_partial_bytes_and_is_incomplete(self):
        for name, _ in ORDINARY_QUERIES:
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
                self.assertEqual(entry["status"], "complete-frame" if entry["name"] == "jdwp-initial-frame" else 0)
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
