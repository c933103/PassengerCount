"""Real local subprocess/pipe tests; no Android target or policy model."""
import importlib.util
import os
import pathlib
import signal
import sys
import time
import unittest

spec = importlib.util.spec_from_file_location(
    "snapshot", pathlib.Path(__file__).parents[1] / "scripts/android_jdwp_snapshot.py")
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotTests(unittest.TestCase):
    # npm test launches suites in parallel on the hosted 4-vCPU runner. These
    # host-only budgets include Python startup under contention; they do not
    # change the collector's production 3-second initial-frame timeout.
    def capture(self, code, timeout=2.0):
        return snapshot.capture_initial_frame(
            [sys.executable, "-u", "-c", "import os,time,signal\n" + code], timeout)

    def test_complete_empty_frame_stops_only_own_client(self):
        result = self.capture("os.write(1,b'0000');time.sleep(30)")
        self.assertEqual(result["status"], "complete-frame", result)
        self.assertEqual(result["stdout"], b"0000")
        self.assertEqual(result["frame"]["pids"], [])
        self.assertTrue(result["frame"]["emptyRegistrySnapshot"])
        self.assertTrue(result["termination"]["requested"])
        self.assertEqual(result["nativeReturnCode"], -signal.SIGTERM)

    def test_fragmented_header_and_body(self):
        result = self.capture("\nfor part in [b'0',b'00',b'8',b'123',b'\\n45',b'6\\n']:\n os.write(1,part);time.sleep(.01)\ntime.sleep(30)")
        self.assertEqual(result["status"], "complete-frame", result)
        self.assertEqual(result["stdout"], b"0008123\n456\n")
        self.assertEqual(result["frame"]["pids"], [123, 456])
        self.assertTrue(result["frame"]["nonemptyListMayBeTruncated"])

    def test_extra_frames_do_not_replace_initial_observation(self):
        result = self.capture("os.write(1,b'00000004123\\n');time.sleep(30)")
        self.assertEqual(result["status"], "complete-frame", result)
        self.assertEqual(result["frame"]["pids"], [])
        self.assertEqual(result["stdout"], b"00000004123\n")

    def test_clean_eof_after_complete_frame(self):
        result = self.capture("os.write(1,b'0004123\\n')")
        self.assertEqual(result["status"], "complete-frame", result)
        self.assertEqual(result["nativeReturnCode"], 0)

    def test_nonzero_native_exit_is_not_snapshot_success(self):
        for output in (b"", b"0000"):
            with self.subTest(output=output):
                result = self.capture(f"os.write(1,{output!r});os._exit(7)")
                self.assertEqual(result["nativeReturnCode"], 7)
                self.assertEqual(result["status"], "command-error", result)

    def test_stderr_even_with_complete_frame_is_not_success(self):
        result = self.capture("os.write(1,b'0000');os.write(2,b'transport warning');time.sleep(30)")
        self.assertEqual(result["status"], "stderr", result)
        self.assertEqual(result["stderr"], b"transport warning")

    def test_silence_partial_header_and_partial_body_timeout(self):
        for output in (b"", b"0", b"000", b"000412"):
            with self.subTest(output=output):
                result = self.capture(f"os.write(1,{output!r});time.sleep(30)", .5)
                self.assertEqual(result["status"], "timeout", result)
                self.assertIsNone(result["frame"])
                self.assertEqual(result["stdout"], output)
                self.assertTrue(result["termination"]["requested"])

    def test_early_eof_is_not_an_empty_registry(self):
        for output in (b"", b"000", b"000412"):
            with self.subTest(output=output):
                result = self.capture(f"os.write(1,{output!r})")
                self.assertEqual(result["status"], "eof-before-frame", result)
                self.assertIsNone(result["frame"])
                self.assertEqual(result["nativeReturnCode"], 0)

    def test_malformed_frames_are_rejected(self):
        invalid = (b"nope", b"0001x", b"00020\n", b"0003-1\n", b"000301\n",
                   b"0003123", b"00041\n1\n", b"000b2147483648\n")
        for data in invalid:
            with self.subTest(data=data):
                result = self.capture(f"os.write(1,{data!r});time.sleep(30)")
                self.assertEqual(result["status"], "malformed-frame", result)
                self.assertIsNone(result["frame"])

    def test_launch_failure_remains_explicit(self):
        result = snapshot.capture_initial_frame(["/nonexistent/passengercount-adb"])
        self.assertEqual(result["status"], "launch-error")
        self.assertIsNone(result["nativeReturnCode"])
        self.assertFalse(result["termination"]["requested"])
        self.assertIn("launchError", result)

    def test_output_limits_bound_actual_pipe_reads(self):
        result = self.capture("os.write(2,b'x'*20000);time.sleep(30)")
        self.assertEqual(result["status"], "output-limit", result)
        self.assertEqual(len(result["stderr"]), snapshot.MAX_STDERR)
        self.assertTrue(result["stderrTruncated"])

    def test_stdout_limit_retains_bounded_bytes_without_accepting_flood(self):
        result = self.capture("os.write(1,b'0000'+b'x'*150000);time.sleep(30)")
        self.assertEqual(result["status"], "output-limit", result)
        self.assertEqual(len(result["stdout"]), snapshot.MAX_STDOUT)
        self.assertTrue(result["stdoutTruncated"])

    def test_spawned_client_is_reaped_before_return(self):
        result = self.capture("p=(str(os.getpid())+'\\n').encode();os.write(1,('%04x'%len(p)).encode()+p);time.sleep(30)")
        self.assertEqual(result["status"], "complete-frame", result)
        pid = result["frame"]["pids"][0]
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_ignored_term_is_killed_and_reaped_within_bound(self):
        started = time.monotonic()
        result = self.capture("signal.signal(signal.SIGTERM,signal.SIG_IGN);os.write(1,b'0000');time.sleep(30)")
        self.assertLess(time.monotonic() - started, 4)
        self.assertEqual(result["status"], "complete-frame", result)
        self.assertTrue(result["termination"]["forcedKill"])
        self.assertEqual(result["nativeReturnCode"], -signal.SIGKILL)

    def test_invalid_time_budget_does_not_launch(self):
        for timeout in (0, -1, float("inf"), float("nan")):
            with self.subTest(timeout=timeout):
                with self.assertRaises(ValueError):
                    snapshot.capture_initial_frame(["/must-not-launch"], timeout)


if __name__ == "__main__":
    unittest.main()
