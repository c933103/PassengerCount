package app.passengercount;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Synthetic journals only. Production bridge/service methods are inserted unchanged. */
public final class MainActivity extends Context {
    static int assertions;
    int starts, stops;
    MainActivity(File directory, SharedPreferences prefs) { super(directory, prefs); }
    void runOnUiThread(Runnable r) { r.run(); }
    void startPendingTrack() { starts++; }
    final class DeviceStorage {
        /* BRIDGE_METHODS */
    }
    static void check(boolean condition, String message) {
        assertions++; if (!condition) throw new AssertionError(message);
    }
    static void seed(File directory, String id) throws IOException {
        Files.write(new File(directory, "track-" + id + ".jsonl").toPath(),
            "{\"nativeId\":\"fixture\",\"lat\":0.123,\"lng\":0.456}\n".getBytes(StandardCharsets.UTF_8));
    }
    static int records(File directory, String id) throws IOException {
        return TrackJournal.read(new File(directory, "track-" + id + ".jsonl"), "").entries.size();
    }
    static MainActivity fresh() throws IOException {
        TrackService.session = null; TrackService.running = null;
        return new MainActivity(Files.createTempDirectory("synthetic-tracks-").toFile(), new SharedPreferences());
    }
    MainActivity restart() {
        TrackService.session = null; prefs.restart();
        return new MainActivity(directory, prefs);
    }
    public static void main(String[] args) throws Exception {
        for (boolean active : new boolean[]{false, true}) {
            MainActivity a = fresh(); DeviceStorage bridge = a.new DeviceStorage();
            seed(a.directory, "A"); seed(a.directory, "B");
            TrackSession control = TrackService.session(a);
            TrackSession.Request request = active ? control.start("A") : null;
            TrackService.running = new TrackService(a.directory, a.prefs);
            TrackService.running.recording = request;
            check(records(a.directory, "A") == 1, "synthetic journal readable before cleanup");
            check(bridge.deleteTrack("A"), "stopped/active deletion acknowledged");
            check(TrackService.running.stopCalls == 1 && TrackService.running.manager.removals == 1, "production finishStop stops callbacks after cleanup");
            check(records(a.directory, "A") == 0, "actual production journal has no deleted records");
            check(records(a.directory, "B") == 1, "unrelated journal retained");
            check(TrackService.isDeleted(a, "A"), "ID-only tombstone persists");
            check(!control.accepts(request), "old start/callback invalidated");
            control.append(request, () -> { throw new AssertionError("deleted append"); });
            check(control.start("A") == null, "deleted ID cannot be restarted");
            bridge.startTracking("A"); check(a.starts == 0, "production start bridge rejects deleted ID");
            check(bridge.getTrack("A").equals("[]"), "legacy bridge cannot replay deletion");
            check(bridge.getTrackPage("A", "").equals("{\"points\":[],\"cursor\":\"\",\"more\":false}"), "paged bridge cannot replay deletion");
            a = a.restart(); bridge = a.new DeviceStorage();
            check(TrackService.isDeleted(a, "A"), "tombstone survives process restart");
            check(bridge.deleteTrack("A"), "repeat cleanup is idempotent");
            check(TrackService.session(a).start("A") == null, "restart cannot resurrect deleted trip");
            check(records(a.directory, "B") == 1, "restart cleanup preserves unrelated journal");
        }
        for (String phase : new String[]{"mark", "stop", "sync", "close"}) {
            for (boolean throwing : new boolean[]{false, true}) {
                MainActivity a = fresh(); DeviceStorage bridge = a.new DeviceStorage();
                seed(a.directory, "A"); seed(a.directory, "B");
                TrackSession.Request old = TrackService.session(a).start("A");
                a.prefs.fail = phase; a.prefs.throwing = throwing;
                android.system.Os.failSync = phase.equals("sync");
                android.system.Os.failClose = phase.equals("close");
                check(!bridge.deleteTrack("A"), "failed " + phase + " is never acknowledged");
                check(records(a.directory, "B") == 1, "failure preserves unrelated journal");
                if (phase.equals("mark") || phase.equals("stop")) check(records(a.directory, "A") == 1, "pre-cleanup failure preserves bytes");
                if (!phase.equals("mark")) {
                    check(!TrackService.session(a).accepts(old), "durable deletion intent blocks failed-stop callback");
                    check(bridge.getTrack("A").equals("[]"), "pending cleanup cannot be replayed");
                }
                // Failed preference commits mutate memory in Android; retry must
                // commit the tombstone again, rather than trusting memory alone.
                a = a.restart(); a.prefs.fail = ""; android.system.Os.failSync = false; android.system.Os.failClose = false;
                bridge = a.new DeviceStorage();
                check(bridge.deleteTrack("A"), "restart retry completes " + phase);
                check(records(a.directory, "A") == 0, "retry removes journal bytes");
                check(TrackService.session(a).start("A") == null, "retry tombstone guards future starts");
            }
        }
        MainActivity a = fresh(); DeviceStorage bridge = a.new DeviceStorage();
        seed(a.directory, "A"); seed(a.directory, "B");
        TrackSession.Request b = TrackService.session(a).start("B");
        TrackService.running = new TrackService(a.directory, a.prefs);
        TrackService.running.recording = b;
        check(bridge.deleteTrack("A"), "delete different trip while B records");
        check(TrackService.session(a).accepts(b), "unrelated active session preserved");
        check(TrackService.running.stopCalls == 0, "deleting A does not stop B service");
        bridge.startTracking("B"); check(a.starts == 1, "unrelated start still allowed");
        for (String id : new String[]{null, "", "../B", "B/", "B.", "B B", "B\\", new String(new char[129]).replace('\0', 'B')}) {
            check(!bridge.deleteTrack(id), "malformed ID rejected without sanitization");
            check(records(a.directory, "B") == 1, "invalid ID cannot alias another trip");
            check(TrackService.session(a).accepts(b), "invalid ID cannot stop another trip");
        }
        File target = new File(a.directory, "track-B.jsonl"), link = new File(a.directory, "track-link.jsonl");
        Files.createSymbolicLink(link.toPath(), target.toPath());
        check(!bridge.deleteTrack("link"), "symlink cleanup rejected");
        check(records(a.directory, "B") == 1, "symlink target retained");
        File directoryJournal = new File(a.directory, "track-directory.jsonl"); directoryJournal.mkdir();
        check(!bridge.deleteTrack("directory"), "directory cannot be removed as a journal");
        // An actual accepted append remains inside the same production lock.
        final MainActivity concurrent = fresh(); seed(concurrent.directory, "A");
        final TrackSession gate = TrackService.session(concurrent);
        final TrackSession.Request active = gate.start("A");
        CountDownLatch writing = new CountDownLatch(1), release = new CountDownLatch(1), finished = new CountDownLatch(1);
        final boolean[] deleted = {false};
        Thread writer = new Thread(() -> gate.append(active, () -> {
            writing.countDown();
            try { release.await(); seed(concurrent.directory, "A"); } catch (Exception e) { throw new AssertionError(e); }
        }));
        Thread remover = new Thread(() -> { deleted[0] = concurrent.new DeviceStorage().deleteTrack("A"); finished.countDown(); });
        writer.start(); check(writing.await(2, TimeUnit.SECONDS), "accepted writer inside barrier");
        remover.start(); check(!finished.await(100, TimeUnit.MILLISECONDS), "cleanup waits for accepted append drain");
        release.countDown(); check(finished.await(2, TimeUnit.SECONDS), "cleanup finishes after writer");
        writer.join(); remover.join();
        check(deleted[0] && records(concurrent.directory, "A") == 0, "drained tail removed from disk");
        gate.append(active, () -> { throw new AssertionError("late writer recreated file"); });
        check(records(concurrent.directory, "A") == 0, "late callback cannot recreate journal");
        MainActivity memoryRetry = fresh(); seed(memoryRetry.directory, "A");
        memoryRetry.prefs.fail = "mark";
        check(!memoryRetry.new DeviceStorage().deleteTrack("A"), "marker failure may update preference memory");
        check(TrackService.isDeleted(memoryRetry, "A"), "fixture mirrors failed-commit memory mutation");
        memoryRetry.prefs.fail = "";
        check(memoryRetry.new DeviceStorage().deleteTrack("A"), "same-process retry recommits marker");
        memoryRetry = memoryRetry.restart();
        check(TrackService.isDeleted(memoryRetry, "A"), "retried marker really reached durable storage");
        // Direct production cleanup failure and retry, with a removal adapter that fails.
        MainActivity failed = fresh(); seed(failed.directory, "A");
        final boolean[] failRemove = {true};
        TrackDeletion.Storage storage = new TrackDeletion.Storage() {
            public boolean mark(String id) { return failed.prefs.edit().putBoolean("deleted:" + id, true).commit(); }
            public boolean remove(File file) { return !failRemove[0] && file.delete(); }
            public void syncDirectory(File directory) {}
        };
        check(!TrackDeletion.delete(failed.directory, "A", TrackService.session(failed), storage), "false unlink remains pending");
        check(records(failed.directory, "A") == 1, "failed unlink retains bytes");
        check(TrackService.session(failed).start("A") == null, "failed unlink blocks new recording");
        failRemove[0] = false;
        check(TrackDeletion.delete(failed.directory, "A", TrackService.session(failed), storage), "unlink retry succeeds");
        check(records(failed.directory, "A") == 0, "unlink retry removes exact file");
        check(android.system.Os.syncs > 0, "production bridge syncs parent directory before success");
        // Process loss between durable tombstone and stop preference commit.
        for (boolean explicit : new boolean[]{false, true}) {
            MainActivity deletedRestart = fresh();
            deletedRestart.prefs.edit().putString("pending_id", "A").putString("session_token", "old")
                .putBoolean("deleted:A", true).commit();
            deletedRestart = deletedRestart.restart();
            TrackService service = new TrackService(deletedRestart.directory, deletedRestart.prefs);
            TrackService.running = service;
            Intent stale = explicit ? new Intent(TrackService.ACTION_START, "A", "old") : null;
            check(service.onStartCommand(stale, 0, 1) == TrackService.START_NOT_STICKY, "tombstoned restart cannot stay sticky");
            check(service.stopCalls > 0 && service.foreground == 0 && service.updates == 0, "tombstoned service stops without foreground or location");
            check(service.recording == null, "tombstoned recording cleared");
        }
        for (String action : new String[]{"restart", "stale-start", "stale-stop", "old-generation"}) {
            MainActivity current = fresh();
            TrackSession.Request before = TrackService.session(current).start("A");
            TrackSession.Request wanted = TrackService.session(current).start(action.equals("old-generation") ? "A" : "B");
            if (action.equals("old-generation")) {
                TrackService.session(current).stop("A"); wanted = TrackService.session(current).start("A");
            }
            current = current.restart();
            TrackService service = new TrackService(current.directory, current.prefs); TrackService.running = service;
            Intent delivered = action.equals("restart") ? null : new Intent(action.equals("stale-stop") ? TrackService.ACTION_STOP : TrackService.ACTION_START, "A", before.token);
            check(service.onStartCommand(delivered, 0, 2) == TrackService.START_STICKY, "accepted current session survives " + action);
            check(service.foreground == 1 && service.updates == 1 && service.stopCalls == 0, "current continuation establishes foreground for " + action);
            check(service.recording.id.equals(wanted.id) && service.recording.token.equals(wanted.token), "only current generation records for " + action);
        }
        MainActivity stopping = fresh();
        TrackSession.Request pending = TrackService.session(stopping).start("A");
        TrackService service = new TrackService(stopping.directory, stopping.prefs); TrackService.running = service;
        check(service.onStartCommand(new Intent(TrackService.ACTION_STOP, "A", pending.token), 0, 3) == TrackService.START_NOT_STICKY, "matching stop is not sticky");
        check(service.foreground == 0 && service.updates == 0 && service.stopCalls > 0, "matching stop has no location restart");
        System.out.println("TrackDeletion: " + assertions + " assertions passed (production bridge/session/journal, synthetic host files)");
    }
}
class Context {
    static final int MODE_PRIVATE = 0;
    final File directory; final SharedPreferences prefs;
    Context(File directory, SharedPreferences prefs) { this.directory = directory; this.prefs = prefs; }
    Context getApplicationContext() { return this; }
    SharedPreferences getSharedPreferences(String name, int mode) { return prefs; }
    File getFilesDir() { return directory; }
}
class SharedPreferences {
    Map<String,Object> memory = new HashMap<>(), durable = new HashMap<>();
    String fail = ""; boolean throwing;
    String getString(String key, String fallback) { Object x = memory.get(key); return x instanceof String ? (String)x : fallback; }
    boolean getBoolean(String key, boolean fallback) { Object x = memory.get(key); return x instanceof Boolean ? (Boolean)x : fallback; }
    void restart() { memory = new HashMap<>(durable); }
    Editor edit() { return new Editor(); }
    class Editor {
        Map<String,Object> next = new HashMap<>(memory); boolean marker;
        Editor putString(String k, String v) { next.put(k,v); return this; }
        Editor putBoolean(String k, boolean v) { next.put(k,v); marker = true; return this; }
        Editor remove(String k) { next.remove(k); return this; }
        boolean commit() {
            memory = next;
            if ((marker && fail.equals("mark")) || (!marker && fail.equals("stop"))) {
                if (throwing) throw new IllegalStateException("Synthetic commit failure");
                return false;
            }
            durable = new HashMap<>(next); return true;
        }
    }
}
class TrackService extends Context {
    static final String EXTRA_TOKEN = "session_token", EXTRA_ID = "survey_id";
    static final String ACTION_START = "START", ACTION_STOP = "STOP";
    static final int START_STICKY = 1, START_NOT_STICKY = 2;
    int foreground, updates;
    boolean hasLocation() { return true; }
    Object notification() { return null; }
    void startForeground(int id, Object notification) { foreground++; }
    void beginUpdates() { updates++; }
    void stopSelf(int startId) { stopCalls++; }
    static TrackSession session;
    TrackService(File directory, SharedPreferences prefs) { super(directory,prefs); }
    static TrackService running;
    TrackSession.Request recording;
    Object listener;
    static class Manager { int removals; void removeUpdates(Object listener) { removals++; } }
    Manager manager = new Manager(); int stopCalls;
    void stopSelf() { stopCalls++; }
    /* SERVICE_METHODS */
}

class Intent {
    final String action, id, token;
    Intent(String action, String id, String token) { this.action = action; this.id = id; this.token = token; }
    String getAction() { return action; }
    String getStringExtra(String key) { return key.equals(TrackService.EXTRA_ID) ? id : token; }
}
