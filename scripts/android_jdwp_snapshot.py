"""Read one framed track-jdwp observation, never attach to a process.

ADB services.md and daemon/jdwp_service.cpp specify a four-ASCII-hex length
followed by decimal PID/newline entries. commandline.cpp forwards those bytes.
https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/dev/services.md

A complete empty initial frame is different from silence, timeout, or truncated
data. A nonempty daemon list may be capacity-limited; a missing PID in it is not
proof that the process lacks a JDWP transport. This is not an Android policy test.
"""
import math
import os
import re
import selectors
import signal
import subprocess
import time


MAX_STDOUT = 2 * (4 + 0xFFFF)
MAX_STDERR = 16 * 1024
_HEADER = re.compile(br"[0-9a-fA-F]{4}\Z")
_PIDS = re.compile(br"(?:[1-9][0-9]*\n)+\Z")


def parse_initial_frame(data):
    """Return the first complete frame, None if partial, or reject malformed data."""
    if len(data) < 4:
        if any(c not in b"0123456789abcdefABCDEF" for c in data):
            raise ValueError("non-hexadecimal frame header")
        return None
    if not _HEADER.fullmatch(data[:4]):
        raise ValueError("non-hexadecimal frame header")
    length = int(data[:4], 16)
    if len(data) < 4 + length:
        return None
    payload = data[4:4 + length]
    if payload and not _PIDS.fullmatch(payload):
        raise ValueError("invalid PID/newline payload")
    pids = [int(pid) for pid in payload.splitlines()]
    if any(pid > 0x7FFFFFFF for pid in pids) or len(pids) != len(set(pids)):
        raise ValueError("invalid or duplicate PID")
    return {"pids": pids, "length": length, "frameBytes": 4 + length,
            "emptyRegistrySnapshot": not payload,
            "nonemptyListMayBeTruncated": bool(payload)}


def capture_initial_frame(command, timeout=3.0):
    """Capture a finite observation from a streaming local client.

    The caller supplies an explicit serial-scoped `adb ... track-jdwp` command.
    Only this spawned local client is terminated after a complete first frame.
    No native exit code is rewritten: intentional termination is separate from
    protocol completeness. stdout/stderr are exact retained bytes, with explicit
    output-limit flags if capture had to stop. Timeout is always incomplete.
    """
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be finite and positive")
    result = {"stdout": b"", "stderr": b"", "status": "timeout",
              "nativeReturnCode": None, "frame": None,
              "stdoutTruncated": False, "stderrTruncated": False,
              "termination": {"requested": False, "forcedKill": False,
                              "reason": None, "cleanupErrors": []}}
    try:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   bufsize=0)
    except OSError as error:
        result.update(status="launch-error", launchError=str(error))
        return result

    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    limits = {"stdout": MAX_STDOUT, "stderr": MAX_STDERR}
    selector = selectors.DefaultSelector()
    deadline = time.monotonic() + timeout
    frame_deadline = None
    reason = "timeout"
    frame = None
    error_text = None

    def consume(key):
        stream = key.data
        chunk = os.read(key.fd, min(8192, limits[stream] - len(buffers[stream]) + 1))
        if not chunk:
            selector.unregister(key.fileobj)
            return False
        space = limits[stream] - len(buffers[stream])
        buffers[stream].extend(chunk[:space])
        if len(chunk) > space:
            result[stream + "Truncated"] = True
        return True

    try:
        for name in buffers:
            pipe = getattr(process, name)
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, name)
        while selector.get_map():
            now = time.monotonic()
            end = min(deadline, frame_deadline) if frame_deadline is not None else deadline
            if now >= end:
                reason = "complete-frame" if frame is not None and frame_deadline <= deadline else "timeout"
                break
            events = selector.select(end - now)
            if time.monotonic() > deadline and frame is None:
                reason = "timeout"
                break
            for key, _ in events:
                consume(key)
            if result["stdoutTruncated"] or result["stderrTruncated"]:
                reason = "output-limit"
                break
            if buffers["stderr"]:
                reason = "stderr"
                break
            if frame is None:
                try:
                    frame = parse_initial_frame(bytes(buffers["stdout"]))
                except ValueError as error:
                    reason, error_text = "malformed-frame", str(error)
                    break
                if frame is not None:
                    # Allow immediate exit/error and buffered stderr to become visible.
                    # This is not a requirement to wait for EOF from a live tracker.
                    frame_deadline = min(deadline, time.monotonic() + 0.05)
            if not selector.get_map():
                reason = "complete-frame" if frame is not None else "eof-before-frame"
                break
    except (OSError, ValueError) as error:
        reason, error_text = "capture-error", str(error)
    finally:
        result["termination"]["reason"] = reason
        try:
            if process.poll() is None:
                result["termination"]["requested"] = True
                process.terminate()
            try:
                process.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                result["termination"]["forcedKill"] = True
                process.kill()
                process.wait(timeout=0.5)
        except (OSError, subprocess.TimeoutExpired) as error:
            result["termination"]["cleanupErrors"].append(str(error))
        # Drain only already available bytes, within the same explicit size limits.
        try:
            for _ in range(64):
                if result["stdoutTruncated"] or result["stderrTruncated"]:
                    break
                ready = selector.select(0)
                if not ready:
                    break
                for key, _ in ready:
                    consume(key)
        except (OSError, ValueError) as error:
            result["termination"]["cleanupErrors"].append(str(error))
        selector.close()
        process.stdout.close()
        process.stderr.close()

    result.update(stdout=bytes(buffers["stdout"]), stderr=bytes(buffers["stderr"]),
                  nativeReturnCode=process.returncode, frame=frame, status=reason)
    if error_text is not None:
        result["captureError"] = error_text
    if result["termination"]["cleanupErrors"] or process.returncode is None:
        result["status"] = "cleanup-error"
    elif result["stdoutTruncated"] or result["stderrTruncated"]:
        result["status"] = "output-limit"
    elif result["stderr"]:
        result["status"] = "stderr"
    else:
        allowed_codes = {0}
        if result["termination"]["requested"]:
            allowed_codes.add(-signal.SIGTERM)
            if result["termination"]["forcedKill"]:
                allowed_codes.add(-signal.SIGKILL)
        if process.returncode not in allowed_codes:
            result["status"] = "command-error"
    return result
