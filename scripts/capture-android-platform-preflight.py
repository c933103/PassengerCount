#!/usr/bin/env python3
"""Diagnostic only: query one already-running, owned ephemeral target.

No install, reboot, root, setprop, app start/stop, permission change, port forward,
debugger attachment, or acceptance classification. Never auto-select a target.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import time

from android_jdwp_snapshot import capture_initial_frame


def collect(serial, output_root, adb="adb", sdk_image_dir=None):
    if not serial or not serial.strip():
        raise ValueError("An explicit non-empty owned target serial is required")
    root = pathlib.Path(output_root)
    root.mkdir(parents=True, exist_ok=True)
    dest = pathlib.Path(tempfile.mkdtemp(prefix="platform-preflight-", dir=root))
    entries = []
    jdwp_observation = {"status": "inconclusive", "reason": "transport unavailable"}

    def query(name, args, timeout=8):
        command = [adb, "-s", serial, *args]
        start = time.time_ns()
        try:
            result = subprocess.run(command, capture_output=True, timeout=timeout)
            stdout, stderr, status = result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired as error:
            stdout, stderr, status = error.stdout or b"", error.stderr or b"", "timeout"
        except OSError as error:
            stdout, stderr, status = b"", str(error).encode(), "launch-error"
        (dest / (name + ".stdout")).write_bytes(stdout)
        (dest / (name + ".stderr")).write_bytes(stderr)
        entries.append({"name": name, "command": command, "startNs": start,
                        "endNs": time.time_ns(), "status": status,
                        "stdoutBytes": len(stdout), "stderrBytes": len(stderr),
                        "stdoutSha256": hashlib.sha256(stdout).hexdigest(),
                        "stderrSha256": hashlib.sha256(stderr).hexdigest()})
        return status, stdout

    state, out = query("transport", ["get-state"])
    if state == 0 and out.strip() == b"device":
        for prop in ("ro.build.fingerprint", "ro.build.id", "ro.build.version.incremental",
                     "ro.build.version.sdk", "ro.build.version.security_patch", "ro.build.type",
                     "ro.debuggable", "ro.product.cpu.abi", "persist.debug.dalvik.vm.jdwp.enabled"):
            query(prop, ["shell", "getprop", prop])
        before_status, before_pid = query("system-server-pid", ["shell", "pidof", "system_server"])
        before_stderr = entries[-1]["stderrBytes"]
        # A protocol-complete initial tracker frame distinguishes an empty list
        # from the silent adb jdwp timeouts retained in run114. Never attach to a PID.
        command = [adb, "-s", serial, "track-jdwp"]
        start, monotonic_start = time.time_ns(), time.monotonic_ns()
        captured = capture_initial_frame(command, timeout=3.0)
        stdout, stderr = captured.pop("stdout"), captured.pop("stderr")
        (dest / "jdwp-initial-frame.stdout").write_bytes(stdout)
        (dest / "jdwp-initial-frame.stderr").write_bytes(stderr)
        entries.append({"name": "jdwp-initial-frame", "command": command,
                        "startNs": start, "endNs": time.time_ns(),
                        "monotonicStartNs": monotonic_start, "monotonicEndNs": time.monotonic_ns(),
                        "stdoutBytes": len(stdout), "stderrBytes": len(stderr),
                        "stdoutSha256": hashlib.sha256(stdout).hexdigest(),
                        "stderrSha256": hashlib.sha256(stderr).hexdigest(), **captured})
        after_status, after_pid = query("system-server-pid-after", ["shell", "pidof", "system_server"])
        stable = (before_status == after_status == 0 and before_stderr == 0
                  and entries[-1]["stderrBytes"] == 0 and before_pid.strip() == after_pid.strip()
                  and re.fullmatch(rb"[1-9][0-9]*", before_pid.strip()) is not None)
        frame = captured.get("frame")
        if captured["status"] == "complete-frame" and not stderr and frame is not None and stable:
            pid = int(before_pid.strip())
            status = ("complete-empty" if frame["emptyRegistrySnapshot"] else
                      "observed-present" if pid in frame["pids"] else "not-listed-in-reported-frame")
            jdwp_observation = {"status": status, "systemServerPid": pid,
                                "pids": frame["pids"], "stablePidBracket": True,
                                "scope": "initial advertised snapshot only; no attach permission claim",
                                "nonemptyListMayBeTruncated": frame["nonemptyListMayBeTruncated"]}
        else:
            jdwp_observation = {"status": "inconclusive", "frameStatus": captured["status"],
                                "stablePidBracket": stable}
        query("package", ["shell", "dumpsys", "package", "app.passengercount"])
        query("appops", ["shell", "cmd", "appops", "get", "app.passengercount"])
        query("services", ["shell", "dumpsys", "activity", "services", "app.passengercount"])
        for name in ("services.jar", "framework.jar"):
            query(name + "-sha256", ["shell", "sha256sum", "/system/framework/" + name])
        query("framework-test-packages", ["shell", "pm", "list", "packages", "com.android.frameworks.mockingservicestests"])
    sdk_files = []
    if sdk_image_dir is not None:
        for name in ("source.properties", "package.xml"):
            path = pathlib.Path(sdk_image_dir) / name
            try:
                data = path.read_bytes()
                (dest / ("sdk-" + name)).write_bytes(data)
                sdk_files.append({"name": name, "bytes": len(data),
                                  "sha256": hashlib.sha256(data).hexdigest()})
            except OSError as error:
                sdk_files.append({"name": name, "error": str(error)})
    receipt = {"kind": "capability-observation-not-acceptance", "serial": serial,
               "commands": entries, "sdkFiles": sdk_files, "jdwpObservation": jdwp_observation,
               "deviceStateChangedByCollector": False,
               "limitations": ["Sequential observations, not an atomic snapshot.",
                               "A listed JDWP PID does not by itself prove attach permissions or field-event support.",
                               "A missing PID in a nonempty frame is not global absence proof; daemon lists may be truncated.",
                               "No full-restart test or debugger attachment performed."]}
    (dest / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    # No unavailable/failed query becomes a pass. This status is NOT the original gate's status.
    valid = state == 0 and out.strip() == b"device"
    valid = valid and all((e["status"] == 0 or
                           (e["name"] == "jdwp-initial-frame" and e["status"] == "complete-frame"))
                          and e["stderrBytes"] == 0 for e in entries)
    valid = valid and jdwp_observation["status"] != "inconclusive"
    valid = valid and all("error" not in f for f in sdk_files)
    return dest, 0 if valid else 2


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--sdk-image-dir")
    parser.add_argument("--adb", default="adb")
    args = parser.parse_args()
    directory, status = collect(args.serial, args.output_root, args.adb, args.sdk_image_dir)
    print(directory)
    raise SystemExit(status)
