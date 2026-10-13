#!/usr/bin/env python3
"""Fail-closed local verifier for a PassengerCount 1.11 upgrade candidate.

No signing keys are read, no uploads occur, and passing does not authorize release.
The APK must already have been signed privately with the original upgrade key.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import zipfile

PACKAGE = "app.passengercount"
VERSION = "1.11"
CODE = "12"
MIN_SDK = "26"
TARGET_SDK = "35"
MAX_ASSET_BYTES = 64 * 1024 * 1024
BUILD_PACKAGED_FILES = (
    "index.html app.js native-track.js record-deletion.js core.js survey.js "
    "i18n.js charts.js data.js government.js fieldkit.js live.js export.js "
    "route-worker.js storage.js upload.js supabase-config.js style.css "
    "manifest.json icon-192.png icon-512.png"
).split()


class VerificationFailure(Exception):
    pass


def require(ok, message):
    if not ok:
        raise VerificationFailure(message)


def sha256_file(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def execute(args):
    try:
        completed = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8", errors="replace", timeout=90,
                                   check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise VerificationFailure(f"Required local verification tool failed: {args[0]}: {type(exc).__name__}") from exc
    require(completed.returncode == 0,
            f"Verification command failed (exit {completed.returncode}): {args[0]}: "
            + (completed.stderr or completed.stdout).strip()[-1200:])
    return completed.stdout


def metadata(apk, aapt2):
    out = execute([str(aapt2), "dump", "badging", str(apk)])
    package = re.search(r"(?m)^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", out)
    minimum = re.search(r"(?m)^sdkVersion:'([^']+)'\s*$", out)
    target = re.search(r"(?m)^targetSdkVersion:'([^']+)'\s*$", out)
    require(package is not None and minimum is not None and target is not None,
            "Missing/unparseable Android package, version or SDK information")
    return package.groups(), minimum.group(1), target.group(1)


def certificate(apk, apksigner, require_v2_v3):
    out = execute([str(apksigner), "verify", "--min-sdk-version", MIN_SDK,
                   "--verbose", "--print-certs", str(apk)])
    require(re.search(r"(?m)^Verifies\s*$", out) is not None, "APK signature verification did not affirm success")
    number = re.search(r"(?m)^Number of signers:\s*(\d+)\s*$", out)
    require(number is not None and number.group(1) == "1", "Exactly one signing certificate is required")
    digest = re.search(r"(?mi)^Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$", out)
    require(digest is not None, "Original signer certificate digest was not exposed")
    if require_v2_v3:
        for label in ("v2", "v3"):
            require(re.search(rf"(?m)^Verified using {label} scheme .*:\s*true\s*$", out) is not None,
                    f"Signed upgrade APK is missing Android {label} signature verification")
    return digest.group(1).lower()


def apk_members(apk):
    try:
        with zipfile.ZipFile(apk, "r", allowZip64=False) as archive:
            infos = archive.infolist()
            require(len(infos) <= 10000, "APK has too many ZIP members")
            require(sum(i.file_size for i in infos) <= 256 * 1024 * 1024,
                    "APK total uncompressed data exceeds safety bound")
            require(all(i.file_size <= 128 * 1024 * 1024 for i in infos),
                    "APK has an oversized ZIP member")
            require(archive.testzip() is None, "ZIP data failed CRC verification")
            found = {}
            for info in archive.infolist():
                path = info.filename
                require(path and not path.startswith("/") and "\\" not in path and "\x00" not in path
                        and all(p not in ("", ".", "..") for p in path.rstrip("/").split("/")),
                        "APK contains an unsafe ZIP path")
                require(path not in found, "APK contains duplicate ZIP members")
                require(not (info.flag_bits & 1), "Encrypted APK ZIP member is not permitted")
                mode = info.external_attr >> 16
                require(stat.S_IFMT(mode) != stat.S_IFLNK, "APK contains a ZIP symlink")
                found[path] = info
            return {name: info for name, info in found.items() if not info.is_dir()}
    except (OSError, zipfile.BadZipFile, EOFError, RuntimeError) as exc:
        raise VerificationFailure(f"Could not verify APK ZIP: {type(exc).__name__}") from exc


def compare_signed_payload(candidate, aligned):
    src = apk_members(aligned)
    dst = apk_members(candidate)
    require(src.keys() == dst.keys(), "Signed APK ZIP entries differ from accepted CI aligned.apk")
    with zipfile.ZipFile(aligned) as unsigned, zipfile.ZipFile(candidate) as signed:
        for name, src_info in src.items():
            dst_info = dst[name]
            require(src_info.file_size == dst_info.file_size,
                    f"Signed APK changes member size: {name}")
            with unsigned.open(name) as x, signed.open(name) as y:
                while True:
                    a, b = x.read(65536), y.read(65536)
                    require(a == b, f"Signed APK changes CI payload: {name}")
                    if not a:
                        break
    return len(dst)


def checked_source(root, expected_sha):
    require(re.fullmatch(r"[0-9a-f]{40}", expected_sha) is not None,
            "Expected source commit must be a full 40-character lowercase Git SHA")
    actual = execute(["git", "-C", str(root), "rev-parse", "--verify", "HEAD"]).strip()
    require(actual == expected_sha, "Source checkout is not the accepted CI revision")
    dirty = execute(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=normal"])
    require(not dirty.strip(), "Source checkout contains modified/untracked files")


def expected_assets(root):
    script = (root / "android" / "build.sh").read_text(encoding="utf-8")
    match = re.search(r"(?m)^for file in (.+); do$", script)
    require(match is not None and shlex.split(match.group(1)) == BUILD_PACKAGED_FILES,
            "Packaged-root source list changed: review release verifier and build.sh together")
    require('cp -R "$ROOT/vendor" "$ROOT/data" "$BUILD/assets/www/"' in script,
            "Packaged vendor/data directory copy contract changed")
    expected = {}
    for name in BUILD_PACKAGED_FILES:
        source = root / name
        require(source.is_file() and not source.is_symlink(), f"Source asset absent or symlink: {name}")
        expected[f"assets/www/{name}"] = source
    for folder in ("vendor", "data"):
        directory = root / folder
        require(directory.is_dir() and not directory.is_symlink(), f"Missing source directory: {folder}")
        for base, dirs, files in os.walk(directory, followlinks=False):
            for name in dirs + files:
                p = Path(base) / name
                require(not p.is_symlink(), f"Source asset symlink prohibited: {p}")
            for file in files:
                p = Path(base) / file
                require(p.is_file(), f"Nonregular source asset: {p}")
                name = "assets/www/" + p.relative_to(root).as_posix()
                require(name not in expected, f"Duplicate package asset: {name}")
                expected[name] = p
    return expected


def check_assets(candidate, source):
    expected = expected_assets(source)
    members = apk_members(candidate)
    actual = {name for name in members if name.startswith("assets/www/")}
    require(actual == set(expected),
            f"Packaged web assets differ (missing={sorted(set(expected) - actual)}, "
            f"unexpected={sorted(actual - set(expected))})")
    size = sum(members[k].file_size for k in actual)
    require(size <= MAX_ASSET_BYTES, "Packaged web assets exceed size safety bound")
    with zipfile.ZipFile(candidate) as z:
        for name, file in expected.items():
            require(file.stat().st_size == members[name].file_size,
                    f"Packaged web asset size differs: {name}")
            with z.open(name) as packed, file.open("rb") as plain:
                while True:
                    a, b = packed.read(65536), plain.read(65536)
                    require(a == b, f"Packaged web asset bytes differ: {name}")
                    if not a:
                        break
    return len(expected)


def check(args):
    source = args.source_dir.resolve(strict=True)
    require(source.is_dir(), "Source must be a directory")
    for p in (args.candidate, args.aligned_apk, args.previous_apk):
        require(p.is_file() and not p.is_symlink(), f"Required APK is missing or a symlink: {p}")
    require(re.fullmatch(r"[0-9a-f]{64}", args.expected_aligned_sha256),
            "Accepted CI aligned.apk SHA-256 must be a lowercase 64-character hash")
    checked_source(source, args.expected_source_commit)
    provenance = json.loads((source / "verification" / "releases" / "1.11-signing-provenance.json")
                            .read_text(encoding="utf-8"))
    require(provenance["package"] == PACKAGE and provenance["candidate_version"] == VERSION
            and provenance["candidate_version_code"] == int(CODE), "Release provenance identity mismatch")
    require(provenance["delivered_version"] == "1.10" and provenance["delivered_code"] == 11,
            "Previously delivered version identity mismatch")
    prior_hash = sha256_file(args.previous_apk)
    require(prior_hash == provenance["delivered_apk_sha256"],
            "Previous APK does not match the independently delivered 1.10 binary digest")
    aligned_hash = sha256_file(args.aligned_apk)
    require(aligned_hash == args.expected_aligned_sha256,
            "CI aligned.apk SHA-256 differs from the independently accepted CI artifact")
    tools = args.android_sdk / "build-tools" / "35.0.0"
    aapt2 = tools / "aapt2"
    apksigner = tools / "apksigner"
    require(aapt2.is_file() and apksigner.is_file(), "Android SDK 35.0.0 aapt2/apksigner required")
    candidate_cert = certificate(args.candidate, apksigner, True)
    prior_cert = certificate(args.previous_apk, apksigner, False)
    pinned = provenance["certificate_sha256"]
    require(candidate_cert == pinned and prior_cert == pinned,
            "Candidate signer does not match delivered APK and pinned original certificate")
    package, min_sdk, target_sdk = metadata(args.candidate, aapt2)
    require(package == (PACKAGE, CODE, VERSION) and min_sdk == MIN_SDK and target_sdk == TARGET_SDK,
            "Package, version, minimum or target SDK mismatch")
    previous_package, _, _ = metadata(args.previous_apk, aapt2)
    require(previous_package == (PACKAGE, "11", "1.10"), "Prior APK package/version mismatch")
    count = compare_signed_payload(args.candidate, args.aligned_apk)
    assets = check_assets(args.candidate, source)
    candidate_hash = sha256_file(args.candidate)
    require(sha256_file(args.aligned_apk) == aligned_hash and sha256_file(args.previous_apk) == prior_hash,
            "APK inputs changed during verification")
    return {"candidate_verified": True, "published": False,
            "source_commit": args.expected_source_commit,
            "candidate_apk_sha256": candidate_hash,
            "aligned_apk_sha256": aligned_hash,
            "previous_apk_sha256": prior_hash,
            "signer_certificate_sha256": pinned, "package": PACKAGE,
            "version": VERSION, "version_code": int(CODE), "min_sdk": int(MIN_SDK),
            "target_sdk": int(TARGET_SDK), "matched_apk_entries": count,
            "matched_web_assets": assets,
            "scope": "Local APK provenance/signature/assets only; not API26, field-device or publication approval"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True,
                        help="Privately signed 1.11 upgrade APK; key is never passed to this script")
    parser.add_argument("--aligned-apk", type=Path, required=True,
                        help="Exact unsigned aligned.apk from the accepted source's green CI artifact")
    parser.add_argument("--previous-apk", type=Path, required=True,
                        help="Previously delivered unmodified 1.10 APK")
    parser.add_argument("--expected-source-commit", required=True)
    parser.add_argument("--expected-aligned-sha256", required=True)
    parser.add_argument("--android-sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", "/nonexistent")))
    args = parser.parse_args()
    try:
        result = check(args)
    except (VerificationFailure, ValueError, KeyError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        print("RELEASE_CANDIDATE_REJECTED: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
