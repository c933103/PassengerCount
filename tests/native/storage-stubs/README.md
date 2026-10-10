# ExportStorage host fixture boundary

These small Android API stubs compile only in `scripts/test-export-storage.cjs`, which compiles the actual production `ExportStorage.java` unchanged. They are outside `android/src` and are never packaged into the APK.

The fixture exercises real temporary host files for Android 8–9 paths and controlled in-memory ContentResolver/DocumentProvider behavior for later APIs. It covers bundle companions, optional PNG omission, collisions, injected write/publication failures and cleanup, plus optional metadata failures after a standalone file has been published. Delete-return-zero and deletion exceptions exercise uncertain outcomes for partial bundles and standalone writes; confirmed cleanup retains retry-safe failure. Legacy cleanup helpers also have controlled false/throw/unreadable-directory checks. It does not emulate Android permission enforcement, process death, filesystem durability, a real document provider or installed-device behavior.

The normal native test command runs it automatically. For a regression negative control, run `node scripts/test-export-storage.cjs /absolute/path/to/frozen/ExportStorage.java`; an older failing source must fail the new post-publication result oracle.
