"""Real local fake subprocess/ZIP tests; no Android device or policy emulation."""
from dataclasses import replace
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
import warnings
import zipfile
import zlib


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/capture-android-framework.py"
spec = importlib.util.spec_from_file_location("framework_capture", SCRIPT)
capture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = capture
spec.loader.exec_module(capture)


def dex_bytes(version=b"039"):
    """Header-only format fixture; fake disassembler tests orchestration, not ART."""
    data = bytearray(112)
    data[:8] = b"dex\n" + version + b"\x00"
    struct.pack_into("<III", data, 32, len(data), 112, 0x12345678)
    data[12:32] = hashlib.sha1(data[32:]).digest()
    struct.pack_into("<I", data, 8, zlib.adler32(data[12:]) & 0xFFFFFFFF)
    return bytes(data)


class FrameworkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.fixture = self.root / "fixture.jar"
        self.archive()
        self.mode = self.root / "mode.json"
        self.mode.write_text("{}")
        self.calls = self.root / "calls.jsonl"
        self.adb = self.root / "adb"
        self.adb.write_text(f"#!{sys.executable}\n" + f"""
import hashlib,json,pathlib,shutil,sys,time
fixture=pathlib.Path({str(self.fixture)!r})
mode=json.loads(pathlib.Path({str(self.mode)!r}).read_text())
args=sys.argv[1:]
with pathlib.Path({str(self.calls)!r}).open('a') as out: out.write(json.dumps(args)+'\\n')
assert args[:2]==['-s','owned-emulator']
if args[2:]==['shell','sha256sum','/system/framework/services.jar']:
 count_path=pathlib.Path({str(self.root / 'hash-count')!r})
 count=int(count_path.read_text())+1 if count_path.exists() else 1
 count_path.write_text(str(count))
 if mode.get('hashFailure'): sys.stderr.write('hash error');sys.exit(7)
 digest=hashlib.sha256(fixture.read_bytes()).hexdigest()
 if mode.get('afterMismatch') and count%2==0: digest='0'*64
 print(digest+'  /system/framework/services.jar')
elif args[2:4]==['pull','/system/framework/services.jar']:
 target=pathlib.Path(args[4])
 if mode.get('partial'):
  target.write_bytes(fixture.read_bytes()[:17]);sys.stdout.write('partial');sys.stderr.write('pull failed');sys.exit(5)
 shutil.copyfile(fixture,target)
 if mode.get('localMismatch'): target.write_bytes(b'corrupted local bytes')
 if mode.get('pullSleep'): time.sleep(30)
 print('1 file pulled')
else: raise AssertionError(args)
""")
        self.adb.chmod(0o755)
        self.tool_dir = self.root / "35.0.0"
        self.tool_dir.mkdir()
        self.tool = self.tool_dir / "dexdump"
        self.tool.write_text(f"#!{sys.executable}\n" + f"""
import json,os,pathlib,signal,sys,time
mode=json.loads(pathlib.Path({str(self.mode)!r}).read_text())
assert sys.argv[1]=='-d'
if mode.get('resistTerm'):
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 pathlib.Path({str(self.root / 'native-pid')!r}).write_text(str(os.getpid()))
 os.write(1,b'partial native output before interruption\\n')
 os.write(2,b'partial native stderr\\n')
 time.sleep(30)
if mode.get('dumpSleep'): time.sleep(30)
if mode.get('dumpFail'): sys.stderr.write('malformed dex according to fake tool');sys.exit(9)
if mode.get('dumpStderr'): sys.stderr.write('tool warning')
if mode.get('stderrFlood'): sys.stderr.write('x'*20000)
if mode.get('dumpFlood'): sys.stdout.write('x'*20000)
elif not mode.get('emptyDump'): print('FAKE DISASSEMBLY '+pathlib.Path(sys.argv[2]).name)
if mode.get('changeTool'): pathlib.Path(__file__).write_text('# changed')
""")
        self.tool.chmod(0o755)
        self.metadata = self.tool_dir / "source.properties"
        self.metadata.write_bytes(b"Pkg.Desc=Android SDK Build-Tools 35\r\nPkg.Revision=35.0.0\r\n")
        self.out = self.root / "out"
        self.limits = replace(capture.Limits(), total_seconds=15, hash_seconds=2,
                              pull_seconds=2, dex_seconds=2)

    def archive(self, entries=None):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.fixture, "w", zipfile.ZIP_DEFLATED) as archive:
                for name, data in entries or [("classes.dex", dex_bytes()), ("classes2.dex", dex_bytes())]:
                    archive.writestr(name, data)

    def run_capture(self, mode=None, limits=None):
        self.mode.write_text(json.dumps(mode or {}))
        dest, code = capture.collect("owned-emulator", self.out, str(self.tool), str(self.adb),
                                     limits or self.limits)
        return dest, code, json.loads((dest / "receipt.json").read_text())

    def assert_failure(self, result, status):
        dest, code, receipt = result
        self.assertEqual(code, 2, receipt)
        self.assertEqual(receipt["status"], "incomplete")
        self.assertEqual(receipt["failure"]["status"], status, receipt)
        return dest, receipt

    def test_success_binds_exact_archive_all_dex_outputs_and_existing_tool(self):
        dest, code, receipt = self.run_capture()
        self.assertEqual(code, 0, receipt)
        self.assertEqual(receipt["status"], "complete-static-analysis")
        self.assertFalse(receipt["deviceStateChangedByCollector"])
        self.assertEqual((dest / "services.jar").read_bytes(), self.fixture.read_bytes())
        expected_hash = hashlib.sha256(self.fixture.read_bytes()).hexdigest()
        self.assertEqual(receipt["deviceHashBefore"], expected_hash)
        self.assertEqual(receipt["deviceHashAfter"], expected_hash)
        self.assertEqual(receipt["archive"]["sha256"], expected_hash)
        self.assertEqual(receipt["hostTool"]["resolvedPath"], str(self.tool.resolve()))
        self.assertEqual(receipt["hostTool"]["packageRevision"], "35.0.0")
        self.assertEqual((dest / "dexdump-source.properties").read_bytes(), self.metadata.read_bytes())
        self.assertEqual([dex["entry"] for dex in receipt["dexFiles"]], ["classes.dex", "classes2.dex"])
        for dex in receipt["dexFiles"]:
            self.assertEqual(dex["status"], "disassembled")
            self.assertEqual((dest / dex["disassembly"]["file"]).read_bytes(),
                             ("FAKE DISASSEMBLY " + dex["entry"] + "\n").encode())
        for command in receipt["commands"]:
            self.assertEqual(command["nativeReturnCode"], 0)
            for stream in ("stdout", "stderr"):
                data = (dest / command[stream]["file"]).read_bytes()
                self.assertEqual(command[stream]["bytes"], len(data))
                self.assertEqual(command[stream]["sha256"], hashlib.sha256(data).hexdigest())
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        self.assertEqual(calls, [
            ["-s", "owned-emulator", "shell", "sha256sum", capture.REMOTE],
            ["-s", "owned-emulator", "pull", capture.REMOTE, str(dest / "services.jar")],
            ["-s", "owned-emulator", "shell", "sha256sum", capture.REMOTE]])

    def test_success_then_partial_pull_preserves_prior_attempt_and_native_failure(self):
        first, code, _ = self.run_capture()
        self.assertEqual(code, 0)
        original = {p.name: p.read_bytes() for p in first.iterdir()}
        second, receipt = self.assert_failure(self.run_capture({"partial": True}), "nonzero-exit")
        self.assertNotEqual(first, second)
        self.assertEqual(original, {p.name: p.read_bytes() for p in first.iterdir()})
        self.assertEqual((second / "services.jar").read_bytes(), self.fixture.read_bytes()[:17])
        self.assertEqual(receipt["archive"]["sha256"], hashlib.sha256(self.fixture.read_bytes()[:17]).hexdigest())
        self.assertFalse(receipt["archive"]["captureComplete"])
        self.assertEqual(receipt["commands"][-1]["nativeReturnCode"], 5)
        self.assertEqual((second / "pull-services.stderr").read_bytes(), b"pull failed")

    def test_device_or_local_hash_mismatch_never_disassembles(self):
        for mode in ({"afterMismatch": True}, {"localMismatch": True}):
            with self.subTest(mode=mode):
                _, receipt = self.assert_failure(self.run_capture(mode), "hash-mismatch")
                self.assertEqual(receipt["dexFiles"], [])

    def test_missing_nonexecutable_or_wrong_named_tool_stops_before_device(self):
        self.tool.unlink()
        self.assert_failure(self.run_capture(), "tool-unavailable")
        self.tool.write_text("not executable")
        self.assert_failure(self.run_capture(), "tool-unavailable")
        self.assertFalse(self.calls.exists())

    def test_metadata_absence_and_wrong_version_are_distinct_from_tool_absence(self):
        self.metadata.unlink()
        self.assert_failure(self.run_capture(), "tool-metadata-unavailable")
        self.metadata.write_text("Pkg.Revision=36.0.0\n")
        self.assert_failure(self.run_capture(), "unsupported-tool-version")
        self.assertFalse(self.calls.exists())

    def test_invalid_zip_and_missing_dex_are_incomplete(self):
        self.fixture.write_bytes(b"not a zip")
        self.assert_failure(self.run_capture(), "capture-or-format-error")
        self.archive([("META-INF/MANIFEST.MF", b"metadata")])
        self.assert_failure(self.run_capture(), "dex-unavailable")

    def test_unsafe_and_duplicate_entries_are_never_extracted(self):
        for name in ("../escape", "/absolute", "a\\b", "a//b", "a/./b", "bad\x00suffix"):
            with self.subTest(name=name):
                # zipfile itself strips NUL on write, so use a central-directory
                # replacement to exercise orig_filename preservation on read.
                if "\x00" in name:
                    self.archive([("badXsuffix", b"x"), ("classes.dex", dex_bytes())])
                    self.fixture.write_bytes(self.fixture.read_bytes().replace(b"badXsuffix", b"bad\x00suffix"))
                else:
                    self.archive([(name, b"x"), ("classes.dex", dex_bytes())])
                self.assert_failure(self.run_capture(), "unsafe-zip-entry")
        self.archive([("classes.dex", dex_bytes()), ("classes.dex", dex_bytes())])
        self.assert_failure(self.run_capture(), "duplicate-zip-entry")

    def test_noncanonical_or_missing_multidex_entry_is_not_skipped(self):
        for name, expected in (("sub/classes.dex", "unsupported-dex-entry"),
                               ("classes.DEX", "unsupported-dex-entry"),
                               ("classes1.dex", "unsupported-dex-entry"),
                               ("classes3.dex", "unsupported-dex-layout")):
            with self.subTest(name=name):
                self.archive([("classes.dex", dex_bytes()), (name, dex_bytes())])
                self.assert_failure(self.run_capture(), expected)

    def test_malformed_dex_header_hash_and_checksum_are_rejected(self):
        wrong_size = bytearray(dex_bytes());wrong_size[32] ^= 1
        wrong_sha = bytearray(dex_bytes());wrong_sha[12] ^= 1
        wrong_checksum = bytearray(dex_bytes());wrong_checksum[8] ^= 1
        for data in (b"not a dex", b"dex\n039\x00", bytes(wrong_size), bytes(wrong_sha), bytes(wrong_checksum)):
            with self.subTest(data=data[:16]):
                self.archive([("classes.dex", data)])
                self.assert_failure(self.run_capture(), "malformed-dex")

    def test_newer_container_compact_and_swapped_dex_are_unsupported_not_malformed(self):
        swapped = bytearray(dex_bytes());struct.pack_into("<I", swapped, 40, 0x78563412)
        for data in (b"dex\n041\x00", b"cdex001\x00", bytes(swapped)):
            with self.subTest(data=data[:8]):
                self.archive([("classes.dex", data)])
                self.assert_failure(self.run_capture(), "unsupported-dex-format")

    def test_archive_and_disassembly_output_caps_remain_incomplete(self):
        _, receipt = self.assert_failure(self.run_capture(limits=replace(self.limits, jar_bytes=8)), "file-limit")
        self.assertEqual(receipt["commands"][-1]["name"], "pull-services")
        self.assert_failure(self.run_capture(limits=replace(self.limits, dex_bytes=8)), "archive-limit")
        self.assert_failure(self.run_capture(limits=replace(self.limits, expanded_bytes=8)), "archive-limit")
        self.assert_failure(self.run_capture(limits=replace(self.limits, zip_entries=1)), "archive-limit")
        self.assert_failure(self.run_capture(limits=replace(self.limits, dex_count=1)), "unsupported-dex-layout")
        dest, receipt = self.assert_failure(self.run_capture({"dumpFlood": True},
            replace(self.limits, disassembly_bytes=1024)), "output-limit")
        command = receipt["commands"][-1]
        self.assertEqual(command["stdout"]["bytes"], 1024)
        self.assertTrue(command["stdout"]["truncated"])
        self.assertEqual(len((dest / command["stdout"]["file"]).read_bytes()), 1024)
        self.assert_failure(self.run_capture(limits=replace(self.limits, total_disassembly_bytes=35)), "output-limit")
        dest, receipt = self.assert_failure(self.run_capture({"stderrFlood": True},
            replace(self.limits, stderr_bytes=1024)), "output-limit")
        command = receipt["commands"][-1]
        self.assertEqual(command["stderr"]["bytes"], 1024)
        self.assertTrue(command["stderr"]["truncated"])
        self.assertEqual((dest / command["stderr"]["file"]).read_bytes(), b"x" * 1024)

    def test_failed_hash_query_is_not_followed_by_pull(self):
        _, receipt = self.assert_failure(self.run_capture({"hashFailure": True}), "nonzero-exit")
        self.assertEqual(len(receipt["commands"]), 1)
        self.assertEqual(receipt["commands"][0]["nativeReturnCode"], 7)

    def test_symlink_archive_entries_and_bad_crc_are_rejected(self):
        entry = zipfile.ZipInfo("classes.dex")
        entry.create_system = 3
        entry.external_attr = 0o120777 << 16
        self.archive([(entry, b"target")])
        self.assert_failure(self.run_capture(), "unsafe-zip-entry")
        with zipfile.ZipFile(self.fixture, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("classes.dex", dex_bytes())
        contents = self.fixture.read_bytes()
        self.fixture.write_bytes(contents.replace(b"dex\n039\x00", b"dex\n038\x00", 1))
        self.assert_failure(self.run_capture(), "capture-or-format-error")

    def test_success_then_invalid_deflate_keeps_incomplete_receipt_and_prior_attempt(self):
        first, code, _ = self.run_capture()
        self.assertEqual(code, 0)
        original = {path.name: path.read_bytes() for path in first.iterdir()}
        with zipfile.ZipFile(self.fixture) as archive:
            entry = archive.getinfo("classes2.dex")
            self.assertEqual(entry.compress_type, zipfile.ZIP_DEFLATED)
            header_offset = entry.header_offset
        data = bytearray(self.fixture.read_bytes())
        name_bytes, extra_bytes = struct.unpack_from("<HH", data, header_offset + 26)
        compressed_offset = header_offset + 30 + name_bytes + extra_bytes
        # A genuine invalid DEFLATE block: BFINAL=1 and reserved BTYPE=3. The ZIP
        # central directory remains valid; this raises zlib.error, not BadZipFile.
        data[compressed_offset] = 0x07
        self.fixture.write_bytes(data)
        with zipfile.ZipFile(self.fixture) as archive, self.assertRaises(zlib.error):
            archive.read("classes2.dex")
        second, receipt = self.assert_failure(self.run_capture(), "capture-or-format-error")
        self.assertNotEqual(first, second)
        self.assertEqual(original, {path.name: path.read_bytes() for path in first.iterdir()})
        self.assertEqual((second / "services.jar").read_bytes(), data)
        self.assertTrue(receipt["hashAgreement"])
        self.assertEqual(receipt["archive"]["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(receipt["deviceHashBefore"], receipt["deviceHashAfter"])
        self.assertEqual(receipt["dexFiles"][0]["status"], "disassembled")
        self.assertEqual(receipt["dexFiles"][1]["entry"], "classes2.dex")
        self.assertEqual(receipt["dexFiles"][1]["status"], "incomplete")
        self.assertNotIn("file", receipt["dexFiles"][1])
        self.assertFalse((second / "classes2.dex").exists())
        self.assertEqual(receipt["commands"][-1]["name"], "classes.dex-dexdump")
        for command in receipt["commands"]:
            self.assertEqual(command["nativeReturnCode"], 0)

    def test_failed_empty_or_stderr_disassembler_never_completes(self):
        for mode, expected in (({"dumpFail": True}, "nonzero-exit"),
                               ({"emptyDump": True}, "dexdump-output-incomplete"),
                               ({"dumpStderr": True}, "dexdump-output-incomplete")):
            with self.subTest(mode=mode):
                _, receipt = self.assert_failure(self.run_capture(mode), expected)
                if mode.get("dumpFail"):
                    self.assertEqual(receipt["commands"][-1]["nativeReturnCode"], 9)

    def test_pull_and_disassembler_timeouts_keep_native_cleanup_status(self):
        for mode in ({"pullSleep": True}, {"dumpSleep": True}):
            with self.subTest(mode=mode):
                started = time.monotonic()
                _, receipt = self.assert_failure(self.run_capture(mode,
                    replace(self.limits, pull_seconds=0.5, dex_seconds=0.5)), "timeout")
                self.assertLess(time.monotonic() - started, 4)
                self.assertTrue(receipt["commands"][-1]["termination"]["requested"])
                self.assertNotEqual(receipt["commands"][-1]["nativeReturnCode"], 0)

    def test_tool_change_is_detected_and_no_result_is_complete(self):
        self.assert_failure(self.run_capture({"changeTool": True}), "tool-changed")

    def test_blank_serial_launches_nothing_and_creates_no_attempt(self):
        for serial in ("", " \t\n"):
            with self.subTest(serial=serial), self.assertRaises(ValueError):
                capture.collect(serial, self.out, str(self.tool), str(self.adb))
        self.assertFalse(self.out.exists())
        self.assertFalse(self.calls.exists())

    def test_native_launch_failure_and_total_budget_remain_explicit(self):
        self.adb.unlink()
        self.assert_failure(self.run_capture(), "launch-error")
        self.assert_failure(self.run_capture(limits=replace(self.limits, total_seconds=0)), "total-timeout")

    def test_outer_timeout_reaps_term_resistant_native_child_and_preserves_receipt(self):
        timeout_tool = shutil.which("timeout")
        self.assertIsNotNone(timeout_tool, "Host regression requires GNU timeout")
        self.mode.write_text(json.dumps({"resistTerm": True}))
        # This launches the real collector as a fresh Python CLI with the default
        # parent signal disposition. The fake native tool alone ignores SIGTERM.
        result = subprocess.run([timeout_tool, "--kill-after=5s", "2s", sys.executable,
            str(SCRIPT), "--serial", "owned-emulator", "--output-root", str(self.out),
            "--adb", str(self.adb), "--dexdump", str(self.tool)],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 124, result.stdout + result.stderr)
        pid_path = self.root / "native-pid"
        self.assertTrue(pid_path.exists(), "Native child must start before the outer timeout")
        pid = int(pid_path.read_text())
        try:
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        finally:
            # Failed regressions must not leak their own fake native subprocess.
            proc = pathlib.Path(f"/proc/{pid}/cmdline")
            if proc.exists() and str(self.tool).encode() in proc.read_bytes():
                os.kill(pid, signal.SIGKILL)
        dest = pathlib.Path(result.stdout.strip())
        receipt = json.loads((dest / "receipt.json").read_text())
        self.assertEqual(receipt["status"], "incomplete")
        self.assertEqual(receipt["failure"]["status"], "interrupted")
        self.assertEqual(receipt["interruptedSignal"], signal.SIGTERM)
        command = receipt["commands"][-1]
        self.assertEqual(command["status"], "interrupted")
        self.assertEqual(command["nativeReturnCode"], -signal.SIGKILL)
        self.assertTrue(command["termination"]["requested"])
        self.assertTrue(command["termination"]["forcedKill"])
        self.assertEqual((dest / command["stdout"]["file"]).read_bytes(),
                         b"partial native output before interruption\n")
        self.assertEqual((dest / command["stderr"]["file"]).read_bytes(), b"partial native stderr\n")

    def test_sigterm_handler_is_restored_after_success_failure_and_invalid_input(self):
        def original(_signum, _frame):
            pass
        previous = signal.signal(signal.SIGTERM, original)
        try:
            self.run_capture()
            self.assertIs(signal.getsignal(signal.SIGTERM), original)
            self.run_capture({"partial": True})
            self.assertIs(signal.getsignal(signal.SIGTERM), original)
            with self.assertRaises(ValueError):
                capture.collect("", self.out, str(self.tool), str(self.adb))
            self.assertIs(signal.getsignal(signal.SIGTERM), original)
        finally:
            signal.signal(signal.SIGTERM, previous)

    def test_sigterm_just_after_last_command_still_returns_incomplete(self):
        run = capture.bounded_command

        def interrupt_after_last(*args, **kwargs):
            result = run(*args, **kwargs)
            if args[2] == "classes2.dex-dexdump":
                os.kill(os.getpid(), signal.SIGTERM)
            return result

        with mock.patch.object(capture, "bounded_command", side_effect=interrupt_after_last):
            _, receipt = self.assert_failure(self.run_capture(), "interrupted")
        self.assertEqual(receipt["commands"][-1]["nativeReturnCode"], 0)
        self.assertEqual(receipt["interruptedSignal"], signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
