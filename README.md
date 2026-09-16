# PassengerCount

An Android app and web app for bus passenger surveys.

## Use on Android

1. Download **PassengerCount.apk** to your phone and open it.
2. If Android asks, allow this download source to install the app, then tap **Install**.
3. Open **PassengerCount** from your home screen. Enter your name once, find a route, and choose a direction / variation.
4. Allow location access to get a suggested starting stop. Confirm it or choose another stop, then enter counts.

No terminal, Python, npm or local server is needed to use the Android app. Requires Android 8 or newer and an up-to-date Android System WebView.

The app bundles its interface and map library. Every edit, selected route, confirmed start and active stop is committed immediately to app-private device storage, so it survives Android stopping the app or discarding its WebView. **Download CSV** opens Android's file picker. Uninstalling the app or clearing its app data removes local surveys; exported CSV files are independent copies. Surveys in a browser are separate from those in the Android app.

Internet is needed for the first route download, map tiles, timetable refreshes and database uploads. Previously opened surveys and the app interface work offline; the route catalogue is cached after downloading. GPS permission is optional, and start stops can always be chosen manually.

## Survey features

- Remembered surveyor and saved surveys.
- Hong Kong time and published schedules prioritize route variants running or starting soon; other variants can be expanded. This is timetable guidance, not live bus tracking.
- KMB / Long Win, Citybus, New Lantao Bus, MTR Bus and green minibuses, using [HK Bus Crawling](https://github.com/hkbus/hk-bus-crawling).
- GPS suggests a stop on the selected variant, with manual confirmation and override.
- Street-level map with numbered, named stops, current location and location accuracy.
- **Backward calculation is intentional:** a known onboard count calculates unobserved earlier stops. Derived counts remain distinct from entered values.
- CSV export and the existing Supabase database upload.

## Developer build

The Android wrapper uses the platform WebView with packaged assets on a restricted HTTPS origin. It has no native third-party dependencies and requests only internet and foreground location permissions. Third-party pages open in a separate browser; the app blocks frames, remote scripts, file access and cleartext traffic. The JavaScript bridge only exposes the two survey storage keys and CSV export.

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

The build checks the APK signature. Automated tests cover calculations, timetable filtering, storage failures, route selection, GPS suggestion, CSV handoff and restoration into a fresh browser context. These tests do not replace Android device testing.

Before wider distribution, install on a phone and check precise/approximate/denied location, CSV save/cancel, screen rotation, keyboard/system bar insets, offline restart and force-stop recovery. No physical Android device or emulator was available during the initial build.

Leaflet 1.9.4 is bundled under its BSD-2-Clause license in `vendor/leaflet/LICENSE`. Map tiles are provided by OpenStreetMap; route data attribution appears in the app.
