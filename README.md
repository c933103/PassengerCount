# PassengerCount

A static field-survey web app for recording bus boarding, alighting and onboard counts.

The surveyor name is remembered. Every edit, selected route variant, confirmed start stop and active stop is saved synchronously in the browser. Saved surveys can be reopened after Android removes the browser from memory. The service worker stores the app shell for offline reopening; the route catalogue is cached separately. Clearing browser data still removes local surveys, so CSV exports remain the portable backup.

Route search supports KMB/Long Win, Citybus, New Lantao Bus, MTR Bus and green minibuses using [HK Bus Crawling](https://github.com/hkbus/hk-bus-crawling). Variants scheduled to be running or starting soon are shown first; other variants stay under an expandable section. The filter uses Hong Kong time, service-day calendars, holidays and published journey times. It is schedule guidance rather than live vehicle tracking.

After variant selection, GPS suggests the nearest stop on that exact stop sequence. The user must confirm or change it. The street-level OpenStreetMap view pins and permanently labels every stop; repeated stops on circular routes retain separate sequence numbers.

Run locally with `python -m http.server 8765`, then open `http://localhost:8765`. Run calculation tests with `npm test`.

Browser storage and geolocation require a normal HTTPS deployment (localhost is also accepted by browsers). Map tiles and initial/refresh route downloads require network access.
