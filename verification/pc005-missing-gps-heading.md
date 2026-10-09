# Momentum input validation (PC-005)

## Reproduced behavior

The original source was checked at main `0b3e10a4083bb471e2b393e9bbf90cfad5d7d4ae`.
This patch is based on main `a4834b378f2edd1aaf343fc28fea5651de8383b8`,
which also contains the subsequently merged standalone PNG fix from PR #6.
The two bases have identical `projectMomentum` implementations. No code from
the separate feature PR #3 is incorporated.

With a measured GPS fix at latitude 22.3, longitude 114.17, speed 10 m/s and
age 20 seconds, `Number(null)` and `Number("")` supplied heading zero. The
result was latitude 22.301796622349983, unchanged longitude, accuracy 125 m,
and `source: "estimated"`: a false 200 m northward projection. Whitespace
and other coercible nonnumeric values could also pass validation.

Undefined/nonnumeric headings were rejected already. Null, undefined, empty
or nonnumeric speed did not generate movement because the speed threshold
blocked them. A genuine numeric heading zero correctly means north; speed
zero correctly produces no moving estimate. These distinctions are retained.

The new focused tests were run against the original function before the
production edit: **5 of 9 failed, 4 passed**. The failures include the actual
geolocation error handler appending a second, estimated track point when
the measured fix had no heading. Invalid timestamp/projection-time values
could also produce a NaN-valued estimate because NaN bypasses both age bounds.
This is controlled ordinary-usage correctness evidence, not an observed
incident involving a user's saved track or a claim of a security exploit.

## Bounded fix and regression coverage

Require finite numeric speed, heading, measured timestamp and projection time
before arithmetic. Browser geolocation supplies motion as numbers or null;
empty strings, booleans, arrays and numeric strings are not measurements.
The shared function rejects these rather than inferring a heading or speed.

Retain the inclusive 12–120 second age window, minimum moving speed 0.5 m/s,
45 m/s displacement cap, expanding accuracy, numeric-zero heading and timestamp,
stationary numeric-zero speed, and the prohibition on chaining estimates.
Measured points remain untouched and accepted projections remain explicitly
labelled `estimated`, including in GPX exports. No recording lifecycle,
native journal, import cursor, export identity or storage protocol changes.

`tests/momentum.test.js` covers null, undefined, empty, whitespace, nonnumeric,
coercible and nonfinite values; exact time/speed boundaries; future timestamps;
zero heading/speed/timestamp; speed capping; and immutable measured evidence.
It executes the actual `locate`/`appendTrackPoint` functions with fixture browser
dependencies and a deterministic clock, confirming that missing heading does
not append an estimate, valid north does, GPX labels remain distinct, and denied
location permission never triggers prediction. This is handler-level testing,
not physical GPS or browser rendering validation.

The service-worker cache advances from v14 (PNG identity) to v15 (momentum
validation) so existing browser installs can refresh the cached shared module.

## Local checks, 9 October 2026

- `npm ci --ignore-scripts --offline`: passed using the existing lockfile/cache.
- `npm test`: **98/98 passed**, including all nine new momentum tests and the
  previous journal/lifecycle and standalone PNG regressions.
- `npm run test:native`: **97 TrackJournal** and **26 TrackSession** assertions
  passed. Existing Java 8 target deprecation/bootstrap warnings remain.
- `node --check fieldkit.js`, `node --check sw.js`, `git diff --check`: passed.
- `npm run test:browser`: **blocked before browser startup** by local Chromium
  socket creation (`Operation not permitted` in `process_singleton_posix.cc`).
  No local browser pass is claimed.
- Local Android APK build/signature check: **not run**, no configured Android
  SDK on this host. Exact-head normal PR CI must supply browser/APK validation.

Exact-head Codex Code/Security review and normal CI remain acceptance gates.
Real weak-GPS/tunnel transitions and physical Android devices are outside these
deterministic fixtures and require separate device validation.
