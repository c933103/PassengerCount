"""Transport/archival tests only. These do not model or prove Android policy."""
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("preflight", pathlib.Path(__file__).with_name("read-only-preflight.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class CollectorTests(unittest.TestCase):
    def run_fake(self, output, fail=None):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            self.assertEqual(command[:3], ["adb", "-s", "owned-test-target"])
            args = command[3:]
            self.assertTrue(args == ["get-state"] or args == ["jdwp"] or
                            (args[0] == "shell" and args[1] in
                             {"getprop", "pidof", "dumpsys", "cmd", "sha256sum", "pm"}))
            if args == ["jdwp"] and fail == "jdwp-timeout":
                raise subprocess.TimeoutExpired(command, 2, output=b"123\n")
            if fail and fail in args:
                return subprocess.CompletedProcess(command, 1, b"partial", b"transport error")
            return subprocess.CompletedProcess(command, 0, b"device\n" if args == ["get-state"] else b"123\n", b"")
        with mock.patch.object(preflight.subprocess, "run", side_effect=run):
            dest, code = preflight.collect("owned-test-target", output)
        return dest, code, calls

    def test_read_only_commands_and_finite_jdwp_snapshot_are_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, calls = self.run_fake(tmp)
            self.assertEqual(code, 0)
            receipt = json.loads((dest / "receipt.json").read_text())
            self.assertEqual(next(c for c in receipt["commands"] if c["name"] == "jdwp-pids")["status"], 0)
            self.assertEqual((dest / "jdwp-pids.stdout").read_bytes(), b"123\n")
            self.assertEqual(len(calls), 18)

    def test_jdwp_timeout_preserves_partial_bytes_but_is_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, _ = self.run_fake(tmp, fail="jdwp-timeout")
            self.assertEqual(code, 2)
            self.assertEqual((dest / "jdwp-pids.stdout").read_bytes(), b"123\n")
            receipt = json.loads((dest / "receipt.json").read_text())
            self.assertEqual(next(c for c in receipt["commands"] if c["name"] == "jdwp-pids")["status"], "timeout")

    def test_success_then_partial_failure_preserves_previous_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, code, _ = self.run_fake(tmp)
            old = {p.name: p.read_bytes() for p in first.iterdir()}
            second, code, _ = self.run_fake(tmp, fail="sha256sum")
            self.assertNotEqual(first, second)
            self.assertEqual(code, 2)
            self.assertEqual(old, {p.name: p.read_bytes() for p in first.iterdir()})
            self.assertEqual((second / "services.jar-sha256.stdout").read_bytes(), b"partial")
            receipt = json.loads((second / "receipt.json").read_text())
            self.assertEqual(next(c for c in receipt["commands"] if c["name"] == "services.jar-sha256")["status"], 1)

    def test_unavailable_transport_stops_before_device_queries(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest, code, calls = self.run_fake(tmp, fail="get-state")
            self.assertEqual(code, 2)
            self.assertEqual(len(calls), 1)
            self.assertTrue((dest / "receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
