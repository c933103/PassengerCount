# PassengerCount

An Android app and web app for bus passenger surveys.

## Use on Android

1. Download **PassengerCount-1.7.apk** to your phone and open it.
2. If Android asks, allow this download source to install the app, then tap **Install**.
3. Open **PassengerCount** from your home screen. Enter your name once, find a route, and choose a direction / variation.
4. Allow location access to get a suggested starting stop. Confirm it or choose another stop. The app opens counting with a live map, selected stop, boarding / alighting fields and a large 0–9 keypad. Cantonese (Hong Kong, Traditional Chinese) is the default; the header switches to English and remembers your choice.

The Android package identifier is `app.passengercount`.

No terminal, Python, npm or local server is needed to use the Android app. Requires Android 8 or newer and an up-to-date Android System WebView.

The app bundles its interface and map library. Every edit, selected route, confirmed start and active stop is committed immediately to app-private device storage, so it survives Android stopping the app or discarding its WebView. **Save & return home** marks the record completed and returns to the saved-record list; open a record to view its passenger charts. No export or network connection is needed to keep a record. **Export CSV** writes an independent copy directly to internal shared storage at `Download/PaxCountRecord` by default. **Save chart (PNG)** uses the same folder. Home → **Settings** lets you select a different folder once or restore the default; Android remembers that folder permission, so individual exports do not open a picker. The saved-file message includes the full exported path (or the document URI for providers without a filesystem path). Filenames include the journey ID and timestamp, and previous exports are never overwritten. Android 8–9 request storage permission once for the default folder; Android 10 and newer need no storage permission for it. Android restricts automatic writes to the storage root, but you can select a root-level `PaxCountRecord` folder using Settings. A revoked or unavailable destination reports failure so you can reselect it; it does not silently change folders. Uninstalling the app or clearing its app data removes local surveys; exported CSV files are independent copies. Surveys in a browser are separate from those in the Android app.

Government routes, stops and timetables are bundled, so route selection and counting work on the first launch offline. Internet is needed for map tiles, timetable refreshes and database uploads. The Android app refreshes government data in the background once the saved catalogue is 14 days old; **Time filter & government data → Update government data** also refreshes it manually. Downloads are processed in a worker so the counting screen stays responsive. Failed updates retain the bundled or saved government catalogue. GPS permission is optional, and start stops can always be chosen manually.

## Survey features

- Remembered surveyor and a home screen listing draft, counting, paused, aborted and completed records. Pause or abort returns home without deleting observations; records can be resumed or reviewed. Use **Delete records** on the home screen to enable trip checkboxes. Select trips, tap **OK**, then review the route/trip list in the confirmation before deleting. The selection controls remain pinned at the bottom; the confirmation list scrolls independently above fixed Cancel/Delete buttons, including with long lists and larger text. The selection is removed in one save; a storage failure retains every record. Exported files and uploaded copies are independent.
- Hong Kong time and published schedules prioritize route variants running or departing within a fixed 10-minute early allowance. The early and late allowances are hardcoded; there is no time-window selector. A departure remains suggested through its journey duration plus a 10-minute delay allowance, inclusive of the end time (12:00 + 120 minutes + 10 minutes remains available at 14:10). Frequency-based windows (GTFS `exact_times` absent or zero) remain suggested through the end of their departure window plus journey time and 10 minutes; they are not treated as exact departure lists. Exact frequency schedules (`exact_times=1`) retain their actual last departure. This corrects N8 and every other frequency-based route, including existing cached catalogues. The calculation also covers previous-day departures crossing midnight; other variants can be expanded. This is timetable guidance, not live bus tracking.
- KMB, Long Win, Citybus, New Lantao Bus, MTR Bus, green minibuses, Discovery Bay, Park Island and cross-boundary coaches, from the Transport Department government GTFS feed.
- GPS suggestions, manual starting stops, the map stop picker and the counting stop picker update the same active row. Confirming the start opens counting mode; saved surveys reopen in counting mode.
- Passenger counts accept non-negative whole numbers only. The built-in keypad has digits, backspace and clear; hardware digits and valid numeric paste are supported. Letters, signs, decimals and exponent notation are rejected.
- Street-level map with numbered, named stops, current location and location accuracy. It follows every GPS fix by default, with a highlighted active button. Following is restored when entering setup/counting, resuming a journey, revealing the map, or returning to the app. Dragging the map, inspecting a selected stop or viewing the whole route pauses following; **Follow GPS** resumes it. GPS never silently changes a confirmed entry stop; **Use nearest stop** changes it explicitly.
- Skip boarding or alighting independently when not applicable. **No passenger change** explicitly records both counts as zero, including at the final stop. Unobserved, skipped and recorded stops remain distinguishable.
- Onboard is calculated rather than required on every stop. Optional known counts can anchor the trip immediately before the starting stop, after the ending stop, or after any individual stop. A trip starting at the route origin assumes an empty vehicle unless a known initial count is entered. Completing at the actual last stop assumes an empty vehicle there unless a known final count is entered. Both assumptions can be disabled for through services or split circular routes.
- **Backward calculation is intentional:** a known onboard count calculates unobserved earlier stops. Unknown changes are temporarily treated as zero, with inferred values marked as estimates where that assumption affects the calculation. Without an anchor, absolute onboard counts remain unknown. Negative counts, incompatible manual counts and conflicting empty-endpoint assumptions are shown for correction; the app does not silently force totals to match.
- The current stop selector, boarding/alighting fields, digit keypad and save/pause/abort controls stay pinned to the bottom of the counting screen. The map and table scroll above them, with reserved space so controls are never hidden behind the panel. Short screens use a compact layout. After the final stop is recorded, its action changes to **Save & return home**; the next tap completes the record and opens the main screen. This also works after a no-change final stop or resuming an already recorded final stop.
- Expand the full editable stop table at any time while counting. Select a numeric cell and use the keypad to correct it; time, notes and recorded status can also be edited. The live map and selected stop stay above the table.
- Completed records are saved internally and show boarding / alighting bars and an onboard trend line fitted to the screen width, including long routes. Rotate the screen and the chart reflows; unknown onboard values leave gaps in the line. Save a labelled PNG image with the route number, date and legend. **Edit table** opens the editable table without changing completed status. **Continue recording** reopens the same journey at the next stop, retaining all observations and removing its completed boundary. An explicitly known final count stays attached to its former stop. Conflicting entered final counts must be corrected before reopening; no entered observation is discarded.
- Add missing stops before or after any stop, optionally using current GPS coordinates. Edit incorrect stop names or locations. Corrections apply to the survey snapshot and retain existing counts and sequence alignment.
- Join another government route section into the same survey. The app suggests matching suffix/prefix overlap and previews exactly which stops will be appended. Override the overlap or keep all stops for another lap. Later repeat visits to the same stop are retained; observations are never globally deduplicated. Joining clears the old final boundary and retains an explicitly known previous final count as an observation at that stop.
- CSV export and the existing Supabase database upload.

## Government data and attribution

All new route searches use the [Transport Department headway dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_11-pt-headway-en), fetched from the government’s [English GTFS archive](https://static.data.gov.hk/td/pt-headway-en/gtfs.zip) and [Traditional Chinese GTFS archive](https://static.data.gov.hk/td/pt-headway-tc/gtfs.zip). There is no HK Bus Crawling or operator API dependency. Stops, their sequence, directions, route variations, journey times, calendars and holiday exceptions all come from those archives.

Route, stop and timetable data © Government of the Hong Kong SAR. Source: Transport Department / DATA.GOV.HK. Reuse is governed by the [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions), including source and ownership attribution. Government data is not public domain. Attribution is included in the interface, bundled catalogue and CSV exports. Existing surveys keep their original stop snapshots and entered records, so an app or catalogue update cannot rewrite recorded observations.

`government.js` is the shared converter for the app and build script. It groups trips by government route ID, bound and ordered stop sequence, preserving shortened / alternate variants and repeated stops. Timetable filtering uses validity dates, weekday calendars, exceptions, overnight times, headways and published journey durations. The shipped catalogue was downloaded on 2026-09-16 from the government feed published on 2026-09-11 (3,511 variants / 9,250 stops).

Regenerate the bundled catalogue with `node scripts/build-government-data.mjs [english.zip] [traditional-chinese.zip]`. Without arguments, the script downloads the official archives. The native wrapper proxies only those two fixed government URLs to its own HTTPS origin because the government file host does not provide browser CORS headers. A plain static website uses the bundled catalogue; direct refresh is subject to that browser restriction.

## Developer build

The Android wrapper uses the platform WebView with packaged assets on a restricted HTTPS origin. It has no native third-party dependencies and requests internet and foreground location permissions, plus export storage permission limited to Android 8–9. Third-party pages open in a separate browser; the app blocks frames, remote scripts, file access and cleartext traffic. The JavaScript bridge exposes the two survey storage keys, a restricted language preference, CSV/PNG export and the export-folder setting.

Install JDK 17, Android SDK Platform 35 and Build Tools 35.0.0. Keep the signing keystore outside this repository and retain it for future updates. Set these environment variables, then run `bash android/build.sh`:

- `ANDROID_HOME`: SDK directory
- `SIGNING_KEYSTORE`: private keystore path
- `SIGNING_STORE_PASSWORD`: keystore password
- `SIGNING_KEY_PASSWORD`: defaults to the store password
- `SIGNING_KEY_ALIAS`: defaults to `passengercount`

The output is `android/build/PassengerCount.apk`. Increment the manifest's `versionCode` for updates and sign with the same key to preserve existing installed surveys. Signing keys and build outputs are excluded from Git.

Calculation and storage tests: `npm test` (Node 18 or newer). Browser smoke tests: `npm run test:browser` after installing Playwright, with `CHROME_PATH` if using a separately installed Chromium. The smoke test uses mock GPS, route data, tiles and the native bridge; it does not write to the live database.

For web development only, serve this directory with any static web server. Deploy the browser version over HTTPS for geolocation and service workers.

## Validation and device checklist

The build checks the APK signature. Automated tests cover government feed conversion and timetables, stop synchronization, live map following, numeric input rejection, skipped fields, zero-change final stops, boundary deductions and inconsistencies, in-progress table editing, missing stops and overlapping circular sections, pause/abort/resume, completion and charts, both languages, CSV export, fixed-panel visibility while scrolling and rotating, record deletion/cancellation, storage failures and restoration into a fresh browser context. Version 1.6 adds regression coverage for the bundled N8 timetable at 05:32, fixed early/late boundaries, exact versus frequency-based timetables, legacy saved settings, and an 80-trip deletion list at phone/landscape sizes with enlarged text. Version 1.7 adds GPS-follow reset, completed-journey reopening, table correction, responsive chart/PNG generation, and remembered export-folder/path/error feedback checks with a mock native bridge. Native MediaStore and document-provider writes compile but require physical Android validation. These tests do not replace Android device testing.

Before wider distribution, install on a phone and check precise/approximate/denied location, CSV/PNG saved paths, default/custom export folders and permission denial/revocation, screen rotation, keyboard/system bar insets, offline restart and force-stop recovery. No physical Android device or emulator was available during the initial build.

fflate 0.8.3 is bundled under its MIT license in `vendor/fflate/LICENSE`. Leaflet 1.9.4 is bundled under its BSD-2-Clause license in `vendor/leaflet/LICENSE`. Map tiles are provided by OpenStreetMap; route data attribution appears in the app.
