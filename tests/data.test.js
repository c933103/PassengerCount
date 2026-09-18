import test from "node:test";
import assert from "node:assert/strict";
import { mostRecentSunday, needsRouteRefresh } from "../data.js";

test("weekly cutoff is Sunday midnight Hong Kong time, independent of device timezone", () => {
  for (const [now, boundary] of [
    ["2026-09-12T23:59:59+08:00", "2026-09-06T00:00:00+08:00"],
    ["2026-09-13T00:00:00+08:00", "2026-09-13T00:00:00+08:00"],
    ["2026-09-18T08:00:00+09:00", "2026-09-13T00:00:00+08:00"],
    ["2026-09-19T17:00:00Z", "2026-09-20T00:00:00+08:00"],
    ["2027-01-01T00:00:00+08:00", "2026-12-27T00:00:00+08:00"],
  ]) assert.equal(mostRecentSunday(new Date(now)), Date.parse(boundary), now);
});
test("only successful updates before the cutoff are stale, including invalid timestamps", () => {
  const now = Date.parse("2026-09-18T12:00:00+08:00");
  assert.equal(needsRouteRefresh("2026-09-12T23:59:59.999+08:00", now), true);
  assert.equal(needsRouteRefresh("2026-09-13T00:00:00+08:00", now), false);
  assert.equal(needsRouteRefresh("2026-09-17T12:00:00+08:00", now), false);
  for (const value of [undefined, null, "", "invalid"])
    assert.equal(needsRouteRefresh(value, now), true);
});
