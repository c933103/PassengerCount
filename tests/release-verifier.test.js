import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("offline release verifier rejects unsafe APKs and wrong upgrade lineage", () => {
  const result = spawnSync("python3", [
    "-m", "unittest", "discover", "-s", "tests", "-p", "test_release_verifier.py",
  ], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 512 * 1024,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0,
    `Release verifier regressions failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 41 tests/);
});

