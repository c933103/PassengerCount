package app.passengercount;

import java.util.*;

// Host fixture around the actual source-extracted Activity methods. No Android
// permissions/settings are changed; all framework calls below are test doubles.
public final class MainActivity extends Activity {
    /* PRODUCTION_FIELDS */
    /* PRODUCTION_METHODS */

    static final String FAILURE = "{\"ok\":false,\"path\":\"\"}";
    static final String SUCCESS = "{\"ok\":true,\"path\":\"earlier.csv\"}";
    static int assertions, failures;
    String tree;
    boolean granted, throwPrompt;
    int requestedCode = -1, prompts, reports;
    final SharedPreferences disk;
    final List<String> saved = Collections.synchronizedList(new ArrayList<>());
    final List<Runnable> ui = new ArrayList<>();
    boolean deferUi;
    MainActivity(SharedPreferences disk) { this.disk = disk; }
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
    void exportResult(boolean ok, String path) { reports++; disk.edit().putString("result", ok ? SUCCESS : FAILURE).commit(); }
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
        final MainActivity activity;
        ExportStorage(MainActivity activity) { this.activity = activity; }
        String tree() { return activity.tree; }
    }
    static final class WebView {
        void removeJavascriptInterface(String name) {} void destroy() {}
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
}
