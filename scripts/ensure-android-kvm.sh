#!/usr/bin/env bash
# Reuse the existing narrowly scoped runner-only ACL check before each owned emulator.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in
  lifecycle) OUT="$ROOT/android/build/lifecycle-evidence" ;;
  diagnostic) OUT="$ROOT/android/build/restart-race-evidence" ;;
  *) echo 'Specify lifecycle or diagnostic evidence destination'; exit 2 ;;
esac
mkdir -p "$OUT"
{
  printf 'Runner OS=%s arch=%s environment=%s\n' "${RUNNER_OS:-unset}" "${RUNNER_ARCH:-unset}" "${RUNNER_ENVIRONMENT:-unset}"
  id
  if [[ "${CI:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${RUNNER_OS:-}" != Linux || "${RUNNER_ARCH:-}" != X64 ]]; then
    echo 'KVM_RUNNER_UNSUPPORTED: expected disposable GitHub-hosted Linux x64 VM'
    exit 2
  fi
  if [[ ! -e /dev/kvm ]]; then
    echo 'KVM_DEVICE_MISSING: this runner has no /dev/kvm'
    exit 2
  fi
  if [[ ! -c /dev/kvm ]]; then
    echo 'KVM_NOT_CHARACTER_DEVICE: refusing to change the device'
    exit 2
  fi
  stat -c 'KVM before: type=%F owner=%U group=%G mode=%a' /dev/kvm
  if [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
    if ! command -v setfacl >/dev/null 2>&1; then
      echo 'KVM_ACL_TOOL_MISSING: runner image lacks setfacl'
      exit 2
    fi
    if ! sudo -n setfacl -m "u:$(id -un):rw" /dev/kvm; then
      echo 'KVM_ACL_GRANT_FAILED: could not grant only the runner user rw'
      exit 2
    fi
  fi
  stat -c 'KVM after: type=%F owner=%U group=%G mode=%a' /dev/kvm
  if command -v getfacl >/dev/null 2>&1; then getfacl -cp /dev/kvm; fi
  if [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
    echo 'KVM_ACCESS_DENIED: access still absent after attempted grant'
    exit 2
  fi
  echo 'KVM_ACCESS_READY: device is readable/writable; emulator -accel-check still required'
} 2>&1 | tee "$OUT/kvm-access.txt"
