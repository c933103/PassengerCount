#!/usr/bin/env python3
"""Offline, fail-closed PassengerCount 1.11 update-APK verification.

Only inspect public APKs and an already-published CI artifact. Never read or
transmit a signing key, invoke a network operation, or publish anything.
"""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
POLICY_FILE = ROOT / "verification" / "releases" / "1.11-post-merge-ci.json"
OLD_PROVENANCE_FILE = ROOT / "verification" / "releases" / "1.11-signing-provenance.json"
MAX_ZIP_FILE = 32 * 1024 * 1024
MAX_ARCHIVE_ENTRY = 32 * 1024 * 1024
MAX_EXTRACTED_TOTAL = 90 * 1024 * 1024
MAX_ENTRIES = 5000
MAX_CAPTURE = 128 * 1024
SIG_FILE = re.compile(r"META-INF/(?:MANIFEST\.MF|[A-Za-z0-9_-]+\.(?:SF|RSA|DSA|EC))\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def bounded_read_file(path, cap=MAX_ZIP_FILE):
    p = Path(path)
    require(p.is_file() and not p.is_symlink(), f"Missing or unsafe regular file: {p}")
    size = p.stat().st_size
    require(0 < size <= cap, f"File size outside trusted bounds: {p} ({size} bytes)")
    with p.open("rb") as inp:
        data = inp.read(cap + 1)
    require(len(data) == size and len(data) <= cap, f"File changed while reading: {p}")
    return data


def safe_entries(binary, label):
    """Read a ZIP without extracting paths; reject duplicates and zip bombs."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(binary), "r", allowZip64=False)
        with archive as z:
            infos = z.infolist()
            require(0 < len(infos) <= MAX_ENTRIES, f"{label}: unacceptable ZIP entry count")
            total = 0
            entries = {}
            for info in infos:
                name = info.filename
                path = PurePosixPath(name)
                require(name and not name.startswith("/") and "\\" not in name
                        and "\x00" not in name and all(x not in ("..", ".") for x in path.parts),
                        f"{label}: unsafe ZIP name {name!r}")
                require(not info.is_dir(), f"{label}: unexpected directory ZIP entry {name!r}")
                require((info.external_attr >> 16) & 0o170000 != 0o120000,
                        f"{label}: symlink ZIP entry {name!r}")
                require(name not in entries, f"{label}: duplicate ZIP entry {name!r}")
                require(0 <= info.file_size <= MAX_ARCHIVE_ENTRY,
                        f"{label}: oversized entry {name!r}")
                total += info.file_size
                require(total <= MAX_EXTRACTED_TOTAL, f"{label}: ZIP uncompressed budget exceeded")
                payload = z.read(info)
                require(len(payload) == info.file_size, f"{label}: truncated ZIP entry {name!r}")
                entries[name] = payload
            return entries
    except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, OSError, RuntimeError) as exc:
        raise VerificationError(f"{label}: malformed or unreadable ZIP: {exc}") from exc


def validate_policy(policy, provenance):
    require(policy.get("accepted_main_commit") == "ed0a10a8bd61f9be7348cf6e3b980013acdecad3",
            "Release policy does not identify the accepted main commit")
    require(policy.get("accepted_tree") == "2af449ab36a4d895ad2e8bcb2e323a596097d025",
            "Release policy tree does not match the post-merge acceptance receipt")
    require(policy.get("ci_run") == 38332107783 and policy.get("ci_artifact_id") == 11782629978,
            "Release policy is not bound to the accepted post-merge workflow artifact")
    for k in ("ci_artifact_zip_sha256", "aligned_apk_sha256", "original_certificate_sha256",
              "previous_apk_sha256"):
        require(isinstance(policy.get(k), str) and SHA256.fullmatch(policy[k]),
                f"Invalid release policy hash: {k}")
    require(policy.get("original_certificate_sha256") == provenance.get("certificate_sha256"),
            "Original certificate does not match retained 1.10 signing provenance")
    require(policy.get("previous_apk_sha256") == provenance.get("delivered_apk_sha256"),
            "Previous APK digest does not match retained 1.10 provenance")
    require(policy.get("package") == provenance.get("package") == "app.passengercount",
            "Package lineage mismatch")
    require(policy.get("version_name") == provenance.get("candidate_version") == "1.11"
            and policy.get("version_code") == provenance.get("candidate_version_code") == 12,
            "Candidate version does not match provenance")
    require(provenance.get("delivered_version") == "1.10"
            and provenance.get("delivered_code") == 11,
            "Prior version is not the known delivered v1.10/code11")
    require(policy.get("min_sdk") == 26 and policy.get("target_sdk") == 35,
            "Android compatibility metadata mismatch")


def verify_payload_identity(aligned, candidate):
    base = safe_entries(aligned, "CI aligned APK")
    signed = safe_entries(candidate, "candidate signed APK")
    for essential in ("AndroidManifest.xml", "resources.arsc", "classes.dex"):
        require(essential in base and essential in signed, f"Missing required APK payload: {essential}")
    for path in list(signed):
        if path not in base:
            require(SIG_FILE.fullmatch(path) is not None,
                    f"Unexpected file outside APK signing metadata: {path}")
            del signed[path]
    require(set(base) == set(signed),
            f"APK file list changed; missing={sorted(set(base)-set(signed))}, added={sorted(set(signed)-set(base))}")
    for path, expected in base.items():
        require(signed[path] == expected, f"APK payload changed: {path}")
    return len(base)


def parse_apksigner(output, required_certificate_sha256):
    require(output.startswith("Verifies\n"), "apksigner did not report successful verification")
    for scheme in ("v2", "v3"):
        regex = rf"^Verified using {scheme} scheme[^\n]*: true$"
        require(re.search(regex, output, re.M) is not None, f"APK lacks required {scheme} signature")
    require(re.search(r"^Number of signers: 1$", output, re.M) is not None,
            "APK is not signed by exactly one certificate")
    certs = re.findall(r"^Signer #(\d+) certificate SHA-256 digest: ([0-9a-fA-F]{64})$",
                       output, flags=re.M)
    require(len(certs) == 1 and certs[0][0] == "1", "Missing or ambiguous certificate digest")
    cert = certs[0][1].lower()
    require(cert == required_certificate_sha256,
            f"APK certificate is not the original 1.10 upgrade certificate (got {cert})")
    return cert


def parse_badging(output, expected_package, expected_code, expected_name, min_sdk, target_sdk):
    match = re.findall(r"^package:\s+name='([^']+)' versionCode='([^']+)' versionName='([^']+)'(?:\s|$)",
                       output, flags=re.M)
    require(len(match) == 1, "Cannot unambiguously parse APK manifest package/version")
    require(match[0] == (expected_package, str(expected_code), expected_name),
            f"Wrong package/code/version: {match[0]}")
    mins = re.findall(r"^sdkVersion:'([^']+)'$", output, flags=re.M)
    targets = re.findall(r"^targetSdkVersion:'([^']+)'$", output, flags=re.M)
    require(mins == [str(min_sdk)] and targets == [str(target_sdk)],
            f"Wrong Android SDK bounds: min={mins}, target={targets}")


def run_verified_tool(args, label):
    try:
        proc = subprocess.run(args, shell=False, capture_output=True, text=True,
                              timeout=35, check=False, errors="replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise VerificationError(f"{label} unavailable or timed out: {exc}") from exc
    require(len(proc.stdout) <= MAX_CAPTURE and len(proc.stderr) <= MAX_CAPTURE,
            f"{label} produced excessive output")
    require(proc.returncode == 0,
            f"{label} failed (exit {proc.returncode}): {(proc.stderr or proc.stdout)[-1400:]}")
    return proc.stdout


def private_snapshot(directory, filename, binary):
    """Pin previously read bytes to a private, exclusive file for SDK tooling."""
    path = Path(directory) / filename
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(binary)
        out.flush()
        os.fsync(out.fileno())
    require(path.stat().st_size == len(binary),
            "Private verifier snapshot was not completely persisted")
    return path


def local_sdk_tools(android_home):
    """Only independently trusted local Android SDK executables are permitted."""
    require(android_home and Path(android_home).is_dir(),
            "ANDROID_HOME must point to a trusted installed Android SDK")
    tools = Path(android_home) / "build-tools" / "35.0.0"
    aapt = tools / "aapt2"
    apksigner = tools / "apksigner"
    for executable in (aapt, apksigner):
        require(executable.is_file() and not executable.is_symlink()
                and os.access(executable, os.X_OK),
                f"Trusted Android SDK tool is missing, unsafe or not executable: {executable}")
    return aapt, apksigner


def run_verification(ci_artifact_path, candidate_path, previous_path, android_home):
    with POLICY_FILE.open(encoding="utf-8") as inp:
        policy = json.load(inp)
    with OLD_PROVENANCE_FILE.open(encoding="utf-8") as inp:
        provenance = json.load(inp)
    validate_policy(policy, provenance)

    archive = bounded_read_file(ci_artifact_path)
    require(sha256_bytes(archive) == policy["ci_artifact_zip_sha256"],
            "CI artifact ZIP differs from the accepted post-merge GitHub artifact")
    ci_files = safe_entries(archive, "CI artifact ZIP")
    require({"aligned.apk", "PassengerCount.apk"}.issubset(ci_files),
            "Accepted CI ZIP is missing signed/unsigned validation APKs")
    aligned = ci_files["aligned.apk"]
    require(sha256_bytes(aligned) == policy["aligned_apk_sha256"],
            "CI aligned unsigned APK SHA-256 differs from accepted source")
    require(sha256_bytes(ci_files["PassengerCount.apk"]) == policy["ci_ephemeral_apk_sha256"],
            "CI validation-signer APK SHA-256 differs from accepted source")

    candidate = bounded_read_file(candidate_path)
    require(sha256_bytes(candidate) != policy["ci_ephemeral_apk_sha256"],
            "CI ephemeral validation APK cannot be published as a production upgrade")
    payload_entry_count = verify_payload_identity(aligned, candidate)

    previous = bounded_read_file(previous_path)
    require(sha256_bytes(previous) == policy["previous_apk_sha256"],
            "1.10 APK bytes differ from previously delivered version")
    safe_entries(previous, "previous delivered v1.10 APK")

    # Resolve only trusted *local* SDK executables, not executable data from
    # the CI artifact. Run all tools on private copies of the exact bytes
    # already hashed/compared, never on mutable caller-provided file paths.
    aapt, apksigner = local_sdk_tools(android_home)
    with tempfile.TemporaryDirectory(prefix="passengercount-verify-") as temp_dir:
        candidate_snapshot = private_snapshot(temp_dir, "candidate.apk", candidate)
        previous_snapshot = private_snapshot(temp_dir, "previous.apk", previous)
        signer_cmd = [str(apksigner), "verify", "--verbose",
                      "--print-certs", "--min-sdk-version", "26"]
        cert = parse_apksigner(run_verified_tool(signer_cmd + [str(candidate_snapshot)],
                                                "Android 1.11 APK signature"),
                               policy["original_certificate_sha256"])
        parse_apksigner(run_verified_tool(signer_cmd + [str(previous_snapshot)],
                                           "Delivered 1.10 APK signature"), cert)
        parse_badging(run_verified_tool([str(aapt), "dump", "badging", str(candidate_snapshot)],
                                       "Android 1.11 APK manifest"),
                      policy["package"], 12, "1.11", 26, 35)
        # The 1.10 min/target SDK may differ: check only original upgrade identity.
        old_badging = run_verified_tool([str(aapt), "dump", "badging", str(previous_snapshot)],
                                        "Delivered 1.10 APK manifest")
    old_pkg = re.findall(
        r"^package:\s+name='([^']+)' versionCode='([^']+)' versionName='([^']+)'(?:\s|$)",
        old_badging, flags=re.M)
    require(old_pkg == [(policy["package"], "11", "1.10")],
            f"Previous APK identity does not match package/code11/version1.10: {old_pkg}")

    return {
        "result": "release_binary_checks_passed_only",
        "accepted_source": policy["accepted_main_commit"],
        "accepted_ci_run": policy["ci_run"],
        "ci_artifact_sha256": policy["ci_artifact_zip_sha256"],
        "original_signer_sha256": cert,
        "candidate_apk_sha256": sha256_bytes(candidate),
        "previous_apk_sha256": sha256_bytes(previous),
        "compared_non_signature_apk_entries": payload_entry_count,
        "package": policy["package"],
        "version_name": "1.11",
        "version_code": 12,
        "physical_device_upgrade_verified": False,
        "published": False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ci-artifact", type=Path, required=True,
                        help="Post-merge CI artifact ZIP from run 38332107783, not an arbitrary build")
    parser.add_argument("--candidate", type=Path, required=True,
                        help="Locally ORIGINAL-key-signed 1.11 APK; no keystore is opened")
    parser.add_argument("--previous", type=Path, required=True,
                        help="Exact previously delivered 1.10/code11 APK")
    parser.add_argument("--android-home", type=Path, default=os.environ.get("ANDROID_HOME"),
                        help="Local trusted Android SDK (requires build-tools 35.0.0)")
    args = parser.parse_args(argv)
    try:
        report = run_verification(args.ci_artifact, args.candidate, args.previous,
                                  args.android_home)
    except (VerificationError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"RELEASE_VERIFICATION_FAILED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
