#!/usr/bin/env python3
"""Read-only exact installed services.jar capture and bounded host disassembly.

No Android policy model, runtime stack observation, debugger connection, install,
or device setting change. A complete static capture is not restart acceptance.
DEX header/checksums: https://source.android.com/docs/core/runtime/dex-format
"""
import argparse
from dataclasses import dataclass
import hashlib
import json
import math
import os
import pathlib
import re
import selectors
import signal
import stat
import struct
import subprocess
import tempfile
import time
import zipfile
import zlib


REMOTE = "/system/framework/services.jar"
MIB = 1024 * 1024


@dataclass(frozen=True)
class Limits:
    # Services contains many framework classes. Permit a large real archive and
    # verbose disassembly, but never accept clipped output as complete evidence.
    total_seconds: float = 90.0
    hash_seconds: float = 8.0
    pull_seconds: float = 20.0
    dex_seconds: float = 30.0
    jar_bytes: int = 256 * MIB
    tool_bytes: int = 128 * MIB
    expanded_bytes: int = 512 * MIB
    dex_bytes: int = 128 * MIB
    dex_count: int = 64
    zip_entries: int = 4096
    stdout_bytes: int = MIB
    stderr_bytes: int = MIB
    disassembly_bytes: int = 256 * MIB
    total_disassembly_bytes: int = 1024 * MIB


class Incomplete(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def check_interrupted(interruption):
    if interruption is not None and interruption["signal"] is not None:
        raise Incomplete("interrupted", "Collector received SIGTERM")


def identity(path, limit):
    digest, count = hashlib.sha256(), 0
    with pathlib.Path(path).open("rb") as source:
        while chunk := source.read(MIB):
            count += len(chunk)
            if count > limit:
                raise Incomplete("file-limit", f"{pathlib.Path(path).name} exceeds byte limit")
            digest.update(chunk)
    return {"bytes": count, "sha256": digest.hexdigest()}


def bounded_command(command, directory, name, timeout, stdout_limit, stderr_limit,
                    watched_file=None, watched_limit=None, interruption=None):
    """Save bounded exact pipe bytes, retaining native exit and cleanup separately."""
    if not math.isfinite(timeout) or timeout <= 0:
        raise Incomplete("total-timeout", "No command time remains")
    paths = {stream: pathlib.Path(directory) / (name + "." + stream)
             for stream in ("stdout", "stderr")}
    record = {"name": name, "command": command, "startNs": time.time_ns(),
              "status": "launch-error", "nativeReturnCode": None,
              "termination": {"requested": False, "forcedKill": False, "errors": []}}
    streams = {key: path.open("wb") for key, path in paths.items()}
    counts = {key: 0 for key in streams}
    caps = {"stdout": stdout_limit, "stderr": stderr_limit}
    clipped = {key: False for key in streams}
    selector = selectors.DefaultSelector()
    process = None
    deadline = time.monotonic() + timeout

    def consume(key):
        stream = key.data
        data = os.read(key.fd, min(65536, caps[stream] - counts[stream] + 1))
        if not data:
            selector.unregister(key.fileobj)
            return
        retained = data[:caps[stream] - counts[stream]]
        streams[stream].write(retained)
        counts[stream] += len(retained)
        clipped[stream] |= len(retained) != len(data)

    try:
        check_interrupted(interruption)
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        for name_ in streams:
            pipe = getattr(process, name_)
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, name_)
        record["status"] = "completed"
        while selector.get_map() or process.poll() is None:
            check_interrupted(interruption)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                record["status"] = "timeout"
                break
            if watched_file is not None and watched_file.exists() and watched_file.stat().st_size > watched_limit:
                record["status"] = "file-limit"
                break
            for key, _ in selector.select(min(remaining, 0.05)):
                consume(key)
            if any(clipped.values()):
                record["status"] = "output-limit"
                break
        check_interrupted(interruption)
    except Incomplete as error:
        # Keep the command receipt, partial pipe bytes, and actual native exit;
        # propagating through finally alone would lose this command record.
        record["status"], record["error"] = error.status, str(error)
    except OSError as error:
        record["status"] = "launch-error" if process is None else "capture-error"
        record["error"] = str(error)
    finally:
        if process is not None:
            try:
                if process.poll() is None:
                    record["termination"]["requested"] = True
                    process.terminate()
                try:
                    process.wait(timeout=0.5)
                except subprocess.TimeoutExpired:
                    record["termination"]["forcedKill"] = True
                    process.kill()
                    process.wait(timeout=0.5)
            except (OSError, subprocess.TimeoutExpired) as error:
                record["termination"]["errors"].append(str(error))
            try:
                # Drain only bytes already available; never wait for descendants.
                for _ in range(64):
                    ready = selector.select(0)
                    if not ready or any(clipped.values()):
                        break
                    for key, _ in ready:
                        consume(key)
            except OSError as error:
                record["termination"]["errors"].append(str(error))
            record["nativeReturnCode"] = process.returncode
            process.stdout.close()
            process.stderr.close()
        selector.close()
        for output in streams.values():
            output.close()
    if record["termination"]["errors"]:
        record["status"] = "cleanup-error"
    elif any(clipped.values()):
        record["status"] = "output-limit"
    elif record["status"] == "completed" and record["nativeReturnCode"] != 0:
        record["status"] = "nonzero-exit"
    if watched_file is not None and watched_file.exists() and watched_file.stat().st_size > watched_limit:
        record["status"] = "file-limit"
    if interruption is not None and interruption["signal"] is not None:
        record["status"] = "interrupted"
        record["interruptedSignal"] = interruption["signal"]
    for stream, path in paths.items():
        record[stream] = {"file": path.name, **identity(path, caps[stream]),
                          "truncated": clipped[stream]}
    record["endNs"] = time.time_ns()
    return record


def dex_header(data):
    if data.startswith(b"cdex"):
        raise Incomplete("unsupported-dex-format", "Compact DEX is not supported by this collector")
    if len(data) < 8 or not re.fullmatch(rb"dex\n[0-9]{3}\x00", data[:8]):
        raise Incomplete("malformed-dex", "Invalid DEX magic")
    version = data[4:7].decode("ascii")
    if version not in ("035", "037", "038", "039", "040"):
        raise Incomplete("unsupported-dex-format", f"DEX {version} is unsupported; no malformed claim")
    if len(data) < 112:
        raise Incomplete("malformed-dex", "Truncated DEX header")
    size, header_size, endian = struct.unpack_from("<III", data, 32)
    if endian == 0x78563412:
        raise Incomplete("unsupported-dex-format", "Byte-swapped DEX is unsupported")
    if size != len(data) or header_size != 112 or endian != 0x12345678:
        raise Incomplete("malformed-dex", "DEX header size/endian mismatch")
    if hashlib.sha1(data[32:]).digest() != data[12:32]:
        raise Incomplete("malformed-dex", "DEX SHA-1 mismatch")
    if zlib.adler32(data[12:]) & 0xFFFFFFFF != struct.unpack_from("<I", data, 8)[0]:
        raise Incomplete("malformed-dex", "DEX Adler-32 mismatch")
    # The existing SDK dexdump must still parse/disassemble this DEX. These local
    # checks do not reimplement ART verification or foreground-service policy.
    return {"version": version, "headerBytes": header_size,
            "headerAndChecksumsValid": True, "requiredHostAnalysis": "SDK dexdump -d"}


def archive_dex_entries(archive, limits):
    entries, names, dexes, expanded = archive.infolist(), set(), [], 0
    if len(entries) > limits.zip_entries:
        raise Incomplete("archive-limit", "Too many ZIP entries")
    for entry in entries:
        name = entry.filename
        parts = name.rstrip("/").split("/")
        mode = (entry.external_attr >> 16) & 0xFFFF
        if (not name or name != entry.orig_filename or name.startswith("/") or "\\" in name
                or any(part in ("", ".", "..") for part in parts)
                or any(ord(char) < 32 or ord(char) == 127 for char in name)
                or (mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))):
            raise Incomplete("unsafe-zip-entry", f"Unsafe ZIP entry: {name!r}")
        if name in names:
            raise Incomplete("duplicate-zip-entry", f"Duplicate ZIP entry: {name}")
        names.add(name)
        if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise Incomplete("unsupported-zip-entry", "Encrypted or unsupported compressed entry")
        expanded += entry.file_size
        if expanded > limits.expanded_bytes:
            raise Incomplete("archive-limit", "Expanded ZIP exceeds byte limit")
        if name.lower().endswith(".dex"):
            match = re.fullmatch(r"classes(?:(2|[3-9]|[1-9][0-9]+))?\.dex", name)
            if not match or entry.is_dir():
                raise Incomplete("unsupported-dex-entry", f"Noncanonical DEX entry: {name}")
            if entry.file_size > limits.dex_bytes:
                raise Incomplete("archive-limit", "DEX exceeds byte limit")
            dexes.append((int(match[1] or 1), entry))
    dexes.sort(key=lambda pair: pair[0])
    if not dexes:
        raise Incomplete("dex-unavailable", "Archive contains no classes*.dex; no static analysis possible")
    if len(dexes) > limits.dex_count or [index for index, _ in dexes] != list(range(1, len(dexes) + 1)):
        raise Incomplete("unsupported-dex-layout", "DEX count or contiguous multidex layout unsupported")
    return [entry for _, entry in dexes]


def _collect(serial, output_root, dexdump, adb, limits, interruption):
    if not isinstance(serial, str) or not serial.strip():
        raise ValueError("An explicit non-empty owned target serial is required")
    limits = limits or Limits()
    root = pathlib.Path(output_root)
    root.mkdir(parents=True, exist_ok=True)
    dest = pathlib.Path(tempfile.mkdtemp(prefix="framework-binary-", dir=root))
    deadline = time.monotonic() + limits.total_seconds
    receipt = {"kind": "exact-framework-static-analysis-not-acceptance", "serial": serial,
               "remotePath": REMOTE, "status": "incomplete", "commands": [], "dexFiles": [],
               "limits": vars(limits), "deviceStateChangedByCollector": False,
               "limitations": ["Static disassembly is not a runtime transition, caller stack or cause.",
                               "No full-restart acceptance, debugger attachment or device mutation.",
                               "SDK tool provenance is local path, bytes and package metadata; not a vendor signature."]}

    def remaining():
        check_interrupted(interruption)
        budget = deadline - time.monotonic()
        if budget <= 0:
            raise Incomplete("total-timeout", "Total collection/analysis time exceeded")
        return budget

    def command(name, args, seconds, stdout_cap=None, watched=None):
        result = bounded_command(args, dest, name, min(seconds, remaining()),
                                 limits.stdout_bytes if stdout_cap is None else stdout_cap,
                                 limits.stderr_bytes, watched, limits.jar_bytes if watched else None,
                                 interruption)
        receipt["commands"].append(result)
        check_interrupted(interruption)
        if result["status"] != "completed":
            raise Incomplete(result["status"], f"{name} did not complete")
        return result

    def device_hash(name):
        result = command(name, [adb, "-s", serial, "shell", "sha256sum", REMOTE], limits.hash_seconds)
        data = (dest / result["stdout"]["file"]).read_bytes()
        match = re.fullmatch(rb"([0-9a-fA-F]{64})  /system/framework/services\.jar\r?\n?", data)
        if result["stderr"]["bytes"] or match is None:
            raise Incomplete("invalid-device-hash", f"{name} returned noncanonical hash evidence")
        return match[1].decode("ascii").lower()

    try:
        # Inspect only the existing explicitly selected host tool; do not search
        # PATH, install another SDK, or execute a help command as a version test.
        supplied = pathlib.Path(dexdump)
        receipt["hostTool"] = {"suppliedPath": str(supplied)}
        try:
            tool = supplied.resolve(strict=True)
        except OSError as error:
            raise Incomplete("tool-unavailable", str(error)) from error
        if tool.name != "dexdump" or not tool.is_file() or not os.access(tool, os.X_OK):
            raise Incomplete("tool-unavailable", "Selected dexdump is not a regular executable")
        tool_id = identity(tool, limits.tool_bytes)
        receipt["hostTool"].update(resolvedPath=str(tool), **tool_id)
        metadata = tool.parent / "source.properties"
        try:
            with metadata.open("rb") as source:
                metadata_bytes = source.read(MIB + 1)
        except OSError as error:
            raise Incomplete("tool-metadata-unavailable", str(error)) from error
        if len(metadata_bytes) > MIB:
            raise Incomplete("tool-metadata-limit", "Host package metadata exceeds byte limit")
        metadata_id = {"bytes": len(metadata_bytes),
                       "sha256": hashlib.sha256(metadata_bytes).hexdigest()}
        (dest / "dexdump-source.properties").write_bytes(metadata_bytes)
        receipt["hostTool"]["packageMetadata"] = {"file": "dexdump-source.properties", **metadata_id}
        revision = re.findall(rb"(?m)^Pkg\.Revision\s*=\s*([^\r\n]+)", metadata_bytes)
        if len(revision) != 1 or not re.fullmatch(rb"35\.[0-9]+\.[0-9]+", revision[0].strip()):
            raise Incomplete("unsupported-tool-version", "Selected tool metadata is not SDK Build Tools 35")
        receipt["hostTool"]["packageRevision"] = revision[0].strip().decode("ascii")
        before = device_hash("device-hash-before")
        receipt["deviceHashBefore"] = before
        jar = dest / "services.jar"
        command("pull-services", [adb, "-s", serial, "pull", REMOTE, str(jar)],
                limits.pull_seconds, watched=jar)
        after = device_hash("device-hash-after")
        receipt["deviceHashAfter"] = after
        receipt["archive"] = {"file": jar.name, **identity(jar, limits.jar_bytes)}
        if before != after or before != receipt["archive"]["sha256"]:
            raise Incomplete("hash-mismatch", "Before/after device and local archive hashes do not agree")
        receipt["hashAgreement"] = True
        remaining()
        with zipfile.ZipFile(jar) as archive:
            dexes = archive_dex_entries(archive, limits)
            receipt["dexEntryCount"] = len(dexes)
            disassembly_bytes = 0
            for entry in dexes:
                remaining()
                with archive.open(entry) as source:
                    data = source.read(limits.dex_bytes + 1)
                if len(data) != entry.file_size or len(data) > limits.dex_bytes:
                    raise Incomplete("archive-limit", "Expanded DEX size mismatch or limit exceeded")
                path = dest / entry.filename  # Only validated canonical root DEX names.
                path.write_bytes(data)
                dex = {"entry": entry.filename, "file": path.name,
                       "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                       "status": "incomplete"}
                receipt["dexFiles"].append(dex)
                dex["header"] = dex_header(data)
                if identity(tool, limits.tool_bytes) != tool_id:
                    raise Incomplete("tool-changed", "dexdump bytes changed before execution")
                cap = min(limits.disassembly_bytes, limits.total_disassembly_bytes - disassembly_bytes)
                if cap <= 0:
                    raise Incomplete("output-limit", "Aggregate disassembly byte limit exhausted")
                dex["disassemblyCommand"] = entry.filename + "-dexdump"
                result = command(dex["disassemblyCommand"], [str(tool), "-d", str(path)],
                                 limits.dex_seconds, stdout_cap=cap)
                dex["disassembly"] = result["stdout"]
                disassembly_bytes += result["stdout"]["bytes"]
                if result["stderr"]["bytes"] or not result["stdout"]["bytes"]:
                    raise Incomplete("dexdump-output-incomplete", "dexdump stderr or empty output prevents complete analysis")
                if identity(tool, limits.tool_bytes) != tool_id:
                    raise Incomplete("tool-changed", "dexdump bytes changed during execution")
                dex["status"] = "disassembled"
        remaining()
        receipt["status"] = "complete-static-analysis"
    except Incomplete as error:
        receipt.update(failure={"status": error.status, "message": str(error)})
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        receipt.update(failure={"status": "capture-or-format-error", "message": str(error)})
    # A failed pull can leave useful partial bytes. Bind them too, without
    # claiming hash agreement or rewriting any earlier attempt's evidence.
    partial_jar = dest / "services.jar"
    if partial_jar.exists() and "archive" not in receipt:
        try:
            receipt["archive"] = {"file": partial_jar.name, **identity(partial_jar, limits.jar_bytes),
                                  "captureComplete": False}
        except (OSError, Incomplete) as error:
            receipt["partialArchiveIdentityError"] = str(error)
    if interruption["signal"] is not None:
        receipt.update(status="incomplete", interruptedSignal=interruption["signal"],
                       failure={"status": "interrupted", "message": "Collector received SIGTERM"})
    (dest / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return dest, 0 if receipt["status"] == "complete-static-analysis" else 2


def collect(serial, output_root, dexdump, adb="adb", limits=None):
    """Collect on the main thread with scoped, cleanup-safe SIGTERM handling.

    A signal latches rather than raising asynchronously during Popen assignment
    or finally cleanup. The bounded command loop notices it within 50ms, raises
    inside its protected try, and terminates/reaps only its own local client.
    The caller's previous handler is restored even on an unrelated exception.
    """
    interruption = {"signal": None}

    def on_term(signum, _frame):
        interruption["signal"] = signum

    previous = signal.signal(signal.SIGTERM, on_term)
    try:
        return _collect(serial, output_root, dexdump, adb, limits, interruption)
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--dexdump", required=True)
    parser.add_argument("--adb", default="adb")
    args = parser.parse_args()
    directory, status = collect(args.serial, args.output_root, args.dexdump, args.adb)
    print(directory)
    raise SystemExit(status)
