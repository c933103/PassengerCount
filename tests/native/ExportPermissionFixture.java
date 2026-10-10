package app.passengercount;

import java.util.*;

// Host fixture around the actual source-extracted Activity methods. No Android
// permissions/settings are changed; all framework calls below are test doubles.
public final class MainActivity extends Activity {
    /* PRODUCTION_FIELDS */
    /* PRODUCTION_METHODS */

    static final String FAILURE = "{\"ok\":false,\"path\":\"\"}";
    static final String UNCERTAIN = "{\"uncertain\":true}";
    static final String SUCCESS = "{\"ok\":true,\"path\":\"earlier.csv\"}";
    static int assertions, failures;
    String tree;
    boolean granted, throwPrompt;
    int requestedCode = -1, prompts, reports;
    final SharedPreferences disk;
    final List<String> saved = Collections.synchronizedList(new ArrayList<>());
    final List<Runnable> ui = new ArrayList<>();
    boolean deferUi;
    MainActivity(SharedPreferences disk) { this.disk = disk; onResume(); }
    void runOnUiThread(Runnable task) { if (deferUi) ui.add(task); else task.run(); }
    int checkSelfPermission(String permission) { return granted ? 0 : -1; }
    void requestPermissions(String[] permissions, int code) {
        check(permissions.length == 1 && permissions[0].equals(Manifest.permission.WRITE_EXTERNAL_STORAGE), "storage permission only");
        if (throwPrompt) throw new IllegalStateException("simulated permission API failure");
        requestedCode = code; prompts++;
    }
    SharedPreferences getSharedPreferences(String name, int mode) {
        check(name.equals("exports"), "export flow never changes saved-survey preferences");
        return disk;
    }
    void exportResult(boolean ok, String path) { reports++; storeExportResult(ok ? SUCCESS : FAILURE, ok); }
    final List<String> events = Collections.synchronizedList(new ArrayList<>());
    void emit(String event, String json) { if (!destroyed) events.add(json); }
    boolean hasLocation() { return false; }
    void startPendingTrack() { throw new AssertionError("export must not start location tracking"); }
    void queue(String name) { queueExport(() -> { saved.add(name); exportResult(true, name); }); }
    void reply(int code, boolean grant) {
        granted = grant;
        onRequestPermissionsResult(code, new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, new int[]{grant ? 0 : -1});
    }
    void drain() throws Exception { exports.submit(() -> {}).get(); }
    String result() { return getExportResult(); }
    static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
    interface Scenario { void run() throws Exception; }
    static void scenario(String name, Scenario task) {
        try { task.run(); System.out.println("PASS " + name); }
        catch (Throwable error) { failures++; System.out.println("FAIL " + name + ": " + error); }
    }
    static void simulateProcessLoss() throws Exception {
        // A process restart creates fresh static state. Keep the fixture's
        // durable preference snapshot but reset the actual session to its defaults.
        ExportSession fresh = new ExportSession();
        for (java.lang.reflect.Field field : ExportSession.class.getDeclaredFields()) {
            if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;
            field.setAccessible(true); field.set(exportSession, field.get(fresh));
        }
    }
    static SharedPreferences previousSuccess() {
        SharedPreferences disk = new SharedPreferences();
        disk.edit().putString("result", SUCCESS).commit(); return disk;
    }
    public static void main(String[] args) throws Exception {
        for (int api : new int[]{26, 28}) {
            Build.VERSION.SDK_INT = api;
            String label = "API " + api + " ";
            scenario(label + "grant consumes accepted export exactly once", () -> {
                MainActivity a = new MainActivity(previousSuccess());
                try {
                    a.queue("A"); int code = a.requestedCode;
                    check(a.prompts == 1 && a.saved.isEmpty(), "wait for permission");
                    a.reply(code, true); a.reply(code, true); a.drain();
                    check(a.saved.equals(Arrays.asList("A")), "duplicate callback cannot export twice");
                    a.reply(code, false);
                    check(SUCCESS.equals(a.result()), "duplicate denial cannot overwrite successful result");
                } finally { a.onDestroy(); }
            });
            scenario(label + "denial is recoverable and later request rejects stale callback", () -> {
                MainActivity a = new MainActivity(previousSuccess());
                try {
                    a.queue("A"); int old = a.requestedCode;
                    a.reply(old, false); a.drain();
                    check(a.saved.isEmpty() && FAILURE.equals(a.result()), "denial reports failure without writing");
                    a.queue("B"); int next = a.requestedCode;
                    a.reply(old, true); a.drain();
                    check(a.saved.isEmpty(), "old reply cannot consume newer pending export");
                    a.reply(next, true); a.reply(next, true); a.drain();
                    check(a.saved.equals(Arrays.asList("B")), "only newly requested export is saved");
                } finally { a.onDestroy(); }
            });
            scenario(label + "recreation reports failure and never revives old payload", () -> {
                SharedPreferences disk = previousSuccess();
                MainActivity a = new MainActivity(disk);
                a.queue("A"); int old = a.requestedCode; a.onDestroy();
                MainActivity b = new MainActivity(disk);
                try {
                    check(FAILURE.equals(b.result()), "reloaded page sees failure, not old success or an absent result");
                    b.reply(old, true); b.drain();
                    check(b.saved.isEmpty(), "grant after recreation cannot export lost payload");
                    b.queue("B"); b.drain();
                    check(b.saved.equals(Arrays.asList("B")), "explicit retry after grant succeeds once");
                    a.reply(old, true);
                    check(a.saved.isEmpty(), "callback on destroyed Activity cannot dispatch old task");
                    check(SUCCESS.equals(b.result()), "destroyed callback cannot overwrite new successful export");
                } finally { b.onDestroy(); }
            });
            scenario(label + "process loss without destroy has durable failure and unique retry code", () -> {
                SharedPreferences disk = previousSuccess();
                MainActivity a = new MainActivity(disk);
                a.queue("A"); int old = a.requestedCode;
                simulateProcessLoss();
                MainActivity b = new MainActivity(disk.restart());
                try {
                    check(FAILURE.equals(b.result()), "failure fallback committed before permission prompt");
                    b.queue("B"); int next = b.requestedCode;
                    b.reply(old, true); b.drain();
                    check(b.saved.isEmpty(), "pre-restart reply cannot consume retry");
                    b.reply(next, true); b.drain();
                    check(b.saved.equals(Arrays.asList("B")), "new request works after process loss");
                } finally { a.onDestroy(); b.onDestroy(); }
            });
            scenario(label + "repeated restoration and result delivery stay recoverable", () -> {
                SharedPreferences disk = previousSuccess();
                MainActivity first = new MainActivity(disk);
                first.queue("A"); int old = first.requestedCode; first.onDestroy();
                for (int i = 0; i < 3; i++) {
                    MainActivity restored = new MainActivity(disk.restart());
                    try {
                        restored.reply(old, true); restored.reply(old, false); restored.drain();
                        check(FAILURE.equals(restored.result()) && FAILURE.equals(restored.result()), "re-reading failure never consumes recovery feedback");
                        check(restored.prompts == 0 && restored.saved.isEmpty(), "restoring does not replay old export or prompt");
                    } finally { restored.onDestroy(); }
                }
            });
            for (boolean succeeds : new boolean[]{true, false}) {
                scenario(label + "granted in-flight write survives recreation with " + (succeeds ? "success" : "failure"), () -> {
                    SharedPreferences disk = previousSuccess();
                    MainActivity a = new MainActivity(disk);
                    java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
                    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
                    MainActivity replacement = null;
                    a.queueExport(() -> {
                        started.countDown();
                        try { release.await(); } catch (InterruptedException e) { throw new AssertionError(e); }
                        if (succeeds) a.saved.add("A");
                        a.exportResult(succeeds, "A.csv");
                    });
                    a.reply(a.requestedCode, true);
                    try {
                        check(started.await(5, java.util.concurrent.TimeUnit.SECONDS), "write held after grant");
                        a.onDestroy();
                        MainActivity b = new MainActivity(disk); b.granted = true;
                        check("{\"pending\":true}".equals(b.result()), "replacement sees pending write, not retry/failure");
                        b.queue("unexpected B"); b.drain();
                        check(b.saved.isEmpty(), "replacement cannot submit a duplicate while old write runs");
                        b.onDestroy();
                        replacement = new MainActivity(disk); replacement.granted = true;
                        a.onDestroy(); // Stale teardown must not detach the replacement's observer.
                        check("{\"pending\":true}".equals(replacement.result()), "second recreation still sees process-owned write");
                        check(UNCERTAIN.equals(disk.getString("result", null)) && !new ExportSession().busy(), "fresh process would read check-folder uncertainty, not retry or a stuck busy flag");
                        release.countDown();
                        check(a.exports.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS), "old executor finishes submitted work");
                        String expected = succeeds ? SUCCESS : FAILURE;
                        check(expected.equals(replacement.result()), "replacement reads final result");
                        check(replacement.events.contains(expected), "completion is emitted to replacement page without another reload");
                        check(a.saved.size() == (succeeds ? 1 : 0), "old task writes at most once");
                        replacement.queue("explicit C"); replacement.drain();
                        check(replacement.saved.equals(Arrays.asList("explicit C")), "later explicit export accepted after old result settles");
                    } finally {
                        release.countDown(); a.onDestroy();
                        a.exports.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS);
                        if (replacement != null) replacement.onDestroy();
                    }
                });
            }
            scenario(label + "replacement subscribing after completion reads final result", () -> {
                SharedPreferences disk = previousSuccess();
                MainActivity a = new MainActivity(disk);
                java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
                java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
                a.queueExport(() -> {
                    started.countDown();
                    try { release.await(); } catch (InterruptedException e) { throw new AssertionError(e); }
                    a.saved.add("A"); a.exportResult(true, "A.csv");
                });
                a.reply(a.requestedCode, true);
                try {
                    check(started.await(5, java.util.concurrent.TimeUnit.SECONDS), "delayed write starts");
                    a.onDestroy(); release.countDown();
                    check(a.exports.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS), "write settles with no observer");
                    MainActivity b = new MainActivity(disk); b.granted = true;
                    try {
                        check(SUCCESS.equals(b.result()), "late subscriber reads durable completion rather than stuck pending");
                        b.reply(a.requestedCode, true); b.reply(a.requestedCode, true); b.drain();
                        check(a.saved.equals(Arrays.asList("A")) && b.saved.isEmpty(), "duplicate old callbacks cannot rerun completed work");
                        b.queue("B"); b.drain();
                        check(b.saved.equals(Arrays.asList("B")), "late subscriber can explicitly export again");
                    } finally { b.onDestroy(); }
                } finally { release.countDown(); a.onDestroy(); a.exports.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS); }
            });
            scenario(label + "rejected executor cannot leave process busy forever", () -> {
                MainActivity a = new MainActivity(previousSuccess()); a.granted = true;
                a.exports.shutdown();
                try {
                    a.queue("A");
                    check(FAILURE.equals(a.result()) && !exportSession.busy(), "rejected submission clears busy and reports failure");
                } finally { a.onDestroy(); }
                MainActivity b = new MainActivity(previousSuccess()); b.granted = true;
                try { b.queue("B"); b.drain(); check(b.saved.equals(Arrays.asList("B")), "next Activity can export after rejection"); }
                finally { b.onDestroy(); }
            });
            scenario(label + "already-granted write requires durable recovery before submission", () -> {
                SharedPreferences disk = previousSuccess(); disk.fail = true;
                MainActivity a = new MainActivity(disk); a.granted = true;
                try {
                    a.queue("A"); a.drain();
                    check(a.saved.isEmpty() && !exportSession.busy() && FAILURE.equals(a.result()), "failed pre-write commit does not start a file or leave pending");
                } finally { a.onDestroy(); }
            });
            scenario(label + "queued completion cannot unlock a newer in-flight write", () -> {
                MainActivity a = new MainActivity(previousSuccess()); a.granted = true;
                java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
                java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
                a.deferUi = true;
                a.emitExportState(); // Capture a completion notification awaiting UI delivery.
                a.deferUi = false;
                a.queueExport(() -> {
                    started.countDown();
                    try { release.await(); } catch (InterruptedException e) { throw new AssertionError(e); }
                    a.exportResult(true, "new.csv");
                });
                try {
                    check(started.await(5, java.util.concurrent.TimeUnit.SECONDS), "new write held before old UI delivery");
                    a.ui.forEach(Runnable::run);
                    check("{\"pending\":true}".equals(a.events.get(a.events.size() - 1)), "delayed event reads current pending state on delivery");
                } finally { release.countDown(); a.drain(); a.onDestroy(); }
            });
            scenario(label + "failed post-grant uncertainty commit prevents file mutation", () -> {
                SharedPreferences disk = previousSuccess(); MainActivity a = new MainActivity(disk);
                try {
                    a.queue("A"); disk.fail = true; a.reply(a.requestedCode, true); a.drain();
                    check(a.saved.isEmpty() && !exportSession.busy(), "no task starts when uncertainty cannot be persisted");
                    check(FAILURE.equals(a.result()), "known no-write failure remains retry-safe in current process");
                    check(FAILURE.equals(disk.restart().getString("result", null)), "initial no-write marker remains durable");
                } finally { a.onDestroy(); }
            });
            for (boolean fileSaved : new boolean[]{true, false}) {
                scenario(label + "failed final result commit after " + (fileSaved ? "successful" : "failed") + " write", () -> {
                    SharedPreferences disk = previousSuccess(); MainActivity a = new MainActivity(disk);
                    a.queueExport(() -> {
                        if (fileSaved) a.saved.add("A");
                        disk.fail = true;
                        a.exportResult(fileSaved, "A.csv");
                    });
                    a.reply(a.requestedCode, true); a.drain(); int old = a.requestedCode;
                    try {
                        check((fileSaved ? UNCERTAIN : FAILURE).equals(a.result()), "current page never treats unconfirmed saved file as retry-safe failure");
                        check(UNCERTAIN.equals(disk.restart().getString("result", null)), "process restart keeps possible output distinct from retry-safe failure");
                        check(a.saved.size() == (fileSaved ? 1 : 0), "original file mutation occurs at most once");
                    } finally { a.onDestroy(); }
                    MainActivity b = new MainActivity(disk.restart()); b.granted = true;
                    try {
                        b.reply(old, true); b.reply(old, true); b.drain();
                        check(UNCERTAIN.equals(b.result()) && b.saved.isEmpty(), "recreated process neither replays nor hides uncertain outcome");
                        b.queue("explicit export after folder check"); b.drain();
                        check(b.saved.equals(Arrays.asList("explicit export after folder check")), "a later explicit action works after outcome inspection");
                    } finally { b.onDestroy(); }
                });
            }
            for (boolean uncertain : new boolean[]{true, false}) for (boolean failResult : new boolean[]{true, false}) {
                scenario(label + "writer rollback outcome uncertain=" + uncertain + " resultCommitFails=" + failResult, () -> {
                    SharedPreferences disk = previousSuccess(); MainActivity a = new MainActivity(disk); a.granted = true;
                    a.queueExport(() -> {
                        if (uncertain) a.saved.add("partial companion");
                        disk.fail = failResult;
                        a.exportFailure(uncertain ? new ExportStorage.UncertainExportException(new java.io.IOException("cleanup failed"))
                            : new java.io.IOException("rollback confirmed"));
                    });
                    a.drain();
                    try {
                        check((uncertain ? UNCERTAIN : FAILURE).equals(a.result()), "actual outcome mapper preserves check-folder versus retry-safe guidance");
                        check(!exportSession.busy(), "failure settles export controls");
                        check((uncertain || failResult ? UNCERTAIN : FAILURE).equals(disk.restart().getString("result", null)), "restart never downgrades unknown output to retry-safe failure");
                        check(a.saved.size() == (uncertain ? 1 : 0), "outcome mapping never retries the write");
                    } finally { a.onDestroy(); }
                    MainActivity b = new MainActivity(disk.restart()); b.granted = true;
                    try {
                        check(b.saved.isEmpty(), "recreation does not replay partial output");
                        b.queue("explicit export after folder check"); b.drain();
                        check(b.saved.equals(Arrays.asList("explicit export after folder check")), "explicit user retry remains possible");
                    } finally { b.onDestroy(); }
                });
            }
            String[][] eventOrders = {
                {"resume", "destroy", "finish"}, {"resume", "finish", "destroy"},
                {"destroy", "resume", "finish"}, {"destroy", "finish", "resume"},
                {"finish", "resume", "destroy"}, {"finish", "destroy", "resume"},
            };
            for (boolean returnToOlder : new boolean[]{true, false}) for (String[] order : eventOrders) {
                scenario(label + "two-Activity matrix target=" + (returnToOlder ? "older" : "newer") + " order=" + Arrays.toString(order), () -> {
                    SharedPreferences disk = previousSuccess(); MainActivity a = new MainActivity(disk);
                    java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
                    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
                    a.queueExport(() -> {
                        started.countDown();
                        try { release.await(); } catch (InterruptedException e) { throw new AssertionError(e); }
                        a.saved.add("original"); a.exportResult(true, "original.csv");
                    });
                    int oldCode = a.requestedCode; a.reply(oldCode, true); a.onPause();
                    MainActivity b = new MainActivity(disk); b.granted = true;
                    MainActivity target = returnToOlder ? a : b, stale = returnToOlder ? b : a;
                    try {
                        check(started.await(5, java.util.concurrent.TimeUnit.SECONDS), "write held with two alive Activities");
                        target.events.clear();
                        for (String event : order) {
                            if (event.equals("resume")) { target.onResume(); target.onResume(); }
                            else if (event.equals("destroy")) { stale.onPause(); stale.onDestroy(); }
                            else {
                                release.countDown();
                                if (a.exports.isShutdown()) check(a.exports.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS), "destroyed writer settles");
                                else a.drain();
                            }
                        }
                        check(target.events.contains(SUCCESS), "last eligible resumed Activity receives completion or resume snapshot");
                        check(SUCCESS.equals(target.result()) && SUCCESS.equals(target.result()), "repeated result acknowledgement is not destructive");
                        target.reply(oldCode, true); target.reply(oldCode, true); target.drain();
                        check(a.saved.equals(Arrays.asList("original")) && b.saved.isEmpty(), "stale permission owner cannot duplicate original write");
                        target.events.clear(); stale.onPause(); stale.onDestroy(); stale.onResume();
                        target.queue("later explicit"); target.drain();
                        check(target.events.contains(SUCCESS), "stale teardown/resume cannot steal eligible observer for next result");
                        check(target.saved.contains("later explicit"), "target can export again after its acknowledged result");
                    } finally {
                        release.countDown();
                        if (a.exports.isShutdown()) a.exports.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS); else a.drain();
                        a.onDestroy(); b.onDestroy();
                    }
                });
            }
            scenario(label + "resume while original permission prompt is pending stays pending", () -> {
                MainActivity a = new MainActivity(previousSuccess());
                try {
                    a.queue("A"); a.onResume(); a.onResume();
                    check("{\"pending\":true}".equals(a.result()), "live permission waiter must not show its restart-only failure marker");
                    check(a.events.contains("{\"pending\":true}"), "resume snapshot retains pending feedback");
                    check(a.prompts == 1 && a.saved.isEmpty(), "resume does not repeat permission request or write");
                    a.reply(a.requestedCode, false);
                    check(FAILURE.equals(a.result()), "denial still exits pending state");
                } finally { a.onDestroy(); }
            });
            for (String resolution : new String[]{"grant", "deny", "destroy"}) {
                scenario(label + "two alive Activities during permission wait: " + resolution, () -> {
                    SharedPreferences disk = previousSuccess(); MainActivity a = new MainActivity(disk);
                    a.queue("A"); int old = a.requestedCode; a.onPause();
                    MainActivity b = new MainActivity(disk);
                    try {
                        check("{\"pending\":true}".equals(b.result()), "second Activity sees the existing live permission request");
                        b.queue("unexpected duplicate B");
                        check(b.prompts == 0 && b.saved.isEmpty(), "second Activity cannot replace or duplicate pending permission work");
                        if (resolution.equals("destroy")) {
                            a.onDestroy();
                            check(FAILURE.equals(b.result()) && b.events.contains(FAILURE), "destroying waiter delivers retry-safe cancellation to visible Activity");
                            b.queue("explicit B"); int next = b.requestedCode;
                            b.reply(old, true); b.drain();
                            check(b.saved.isEmpty(), "old permission reply cannot consume the replacement request");
                            b.reply(next, true); b.drain();
                            check(b.saved.equals(Arrays.asList("explicit B")), "visible Activity can explicitly retry cancelled wait");
                        } else if (resolution.equals("deny")) {
                            a.reply(old, false); a.drain();
                            check(a.saved.isEmpty() && b.saved.isEmpty(), "denied owner performs no writes");
                            check(FAILURE.equals(b.result()) && b.events.contains(FAILURE), "denial refreshes the currently resumed page");
                            b.queue("explicit B after denial"); b.reply(b.requestedCode, true); b.drain();
                            check(b.saved.equals(Arrays.asList("explicit B after denial")), "denied reservation is released for a later request");
                        } else {
                            a.reply(old, true); a.drain();
                            check(a.saved.equals(Arrays.asList("A")) && b.saved.isEmpty(), "only original permission owner exports");
                            check(b.events.contains(SUCCESS), "result goes to the currently resumed Activity");
                        }
                    } finally { a.onDestroy(); b.onDestroy(); }
                });
            }
            scenario(label + "repeated taps retain original pending request", () -> {
                MainActivity a = new MainActivity(previousSuccess());
                try {
                    a.queue("A"); int code = a.requestedCode; a.queue("B");
                    check(a.prompts == 1, "only one permission prompt");
                    a.reply(code, true); a.drain();
                    check(a.saved.equals(Arrays.asList("A")), "second tap never replaces first payload");
                } finally { a.onDestroy(); }
            });
            scenario(label + "failed durable marker never opens permission prompt", () -> {
                SharedPreferences disk = previousSuccess(); disk.fail = true;
                MainActivity a = new MainActivity(disk);
                try {
                    a.queue("A"); a.drain();
                    check(a.prompts == 0 && a.saved.isEmpty() && a.reports == 1, "storage failure blocks request and reports failure");
                } finally { a.onDestroy(); }
            });
            scenario(label + "permission API error clears request for retry", () -> {
                MainActivity a = new MainActivity(previousSuccess()); a.throwPrompt = true;
                try {
                    a.queue("A");
                    check(FAILURE.equals(a.result()), "launch failure is recoverable");
                    a.throwPrompt = false; a.queue("B"); a.reply(a.requestedCode, true); a.drain();
                    check(a.saved.equals(Arrays.asList("B")), "launch failure does not block explicit retry");
                } finally { a.onDestroy(); }
            });
            scenario(label + "request code exhaustion fails safely without code reuse", () -> {
                SharedPreferences disk = previousSuccess();
                disk.edit().putInt("legacyPermissionRequest", 65534).commit();
                MainActivity a = new MainActivity(disk);
                try {
                    a.queue("A"); check(a.requestedCode == 65535, "last valid 16-bit code allowed");
                    a.reply(a.requestedCode, false); a.queue("B"); a.drain();
                    check(a.prompts == 1 && a.saved.isEmpty() && FAILURE.equals(a.result()), "exhausted code space never wraps to stale request");
                } finally { a.onDestroy(); }
            });
            scenario(label + "queued UI callback after destroy cannot launch prompt", () -> {
                MainActivity a = new MainActivity(previousSuccess()); a.deferUi = true;
                a.queue("A"); a.onDestroy(); a.ui.forEach(Runnable::run);
                check(a.prompts == 0 && a.saved.isEmpty(), "destroyed Activity drops queued export request");
            });
            for (boolean useTree : new boolean[]{false, true}) {
                scenario(label + (useTree ? "SAF" : "already granted") + " keeps immediate export path", () -> {
                    MainActivity a = new MainActivity(previousSuccess());
                    a.tree = useTree ? "content://fixture/tree" : null; a.granted = !useTree;
                    try {
                        a.queue("A"); a.drain();
                        check(a.prompts == 0 && a.saved.equals(Arrays.asList("A")), "no legacy prompt needed");
                    } finally { a.onDestroy(); }
                });
            }
        }
        for (int api : new int[]{29, 35}) {
            Build.VERSION.SDK_INT = api;
            scenario("API " + api + " default folder never requests legacy permission", () -> {
                MainActivity a = new MainActivity(previousSuccess());
                try {
                    a.queue("A"); a.drain();
                    check(a.prompts == 0 && a.saved.equals(Arrays.asList("A")), "MediaStore path unchanged");
                } finally { a.onDestroy(); }
            });
        }
        System.out.println(assertions + " assertions; " + failures + " failing scenarios");
        if (failures > 0) System.exit(1);
    }
    static final class Build { static final class VERSION { static int SDK_INT; } }
    static final class Manifest { static final class permission {
        static final String WRITE_EXTERNAL_STORAGE = "android.permission.WRITE_EXTERNAL_STORAGE";
    } }
    static final class PackageManager { static final int PERMISSION_GRANTED = 0; }
    static final class ExportStorage {
        static final class UncertainExportException extends java.io.IOException {
            UncertainExportException(Throwable cause) { super(cause); }
        }
        final MainActivity activity;
        ExportStorage(MainActivity activity) { this.activity = activity; }
        String tree() { return activity.tree; }
    }
    static final class WebView {
        void removeJavascriptInterface(String name) {} void destroy() {} void onResume() {} void onPause() {}
    }
    static final class GeolocationPermissions {
        interface Callback { void invoke(String origin, boolean allowed, boolean retain); }
    }
    static final class SharedPreferences {
        final Map<String, Object> values = new HashMap<>(), durable = new HashMap<>();
        boolean fail;
        String getString(String key, String fallback) { return (String) values.getOrDefault(key, fallback); }
        int getInt(String key, int fallback) { return (Integer) values.getOrDefault(key, fallback); }
        Editor edit() { return new Editor(); }
        SharedPreferences restart() {
            SharedPreferences copy = new SharedPreferences();
            copy.values.putAll(durable); copy.durable.putAll(durable); return copy;
        }
        final class Editor {
            final Map<String, Object> changes = new HashMap<>();
            Editor putString(String key, String value) { changes.put(key, value); return this; }
            Editor putInt(String key, int value) { changes.put(key, value); return this; }
            void apply() {
                values.putAll(changes);
                if (!fail) durable.putAll(changes);
            }
            boolean commit() {
                values.putAll(changes);
                if (fail) return false;
                durable.putAll(changes); return true;
            }
        }
    }
}
class Activity {
    static final int MODE_PRIVATE = 0;
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {}
    protected void onDestroy() {}
    protected void onResume() {}
    protected void onPause() {}
}
