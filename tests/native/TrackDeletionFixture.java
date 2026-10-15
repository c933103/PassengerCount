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
    static final Set<MainActivity> resumedActivities = new HashSet<>();
    boolean destroyed, locationAllowed = true;
    boolean hasLocation() { return locationAllowed; }
    void startForegroundService(Intent intent) { starts++; }
    void startService(Intent intent) { starts++; }
    /* START_PENDING */
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
        MainActivity activity = new MainActivity(Files.createTempDirectory("synthetic-tracks-").toFile(), new SharedPreferences());
        resumedActivities.clear(); resumedActivities.add(activity);
        return activity;
    }
    MainActivity restart() {
        TrackService.session = null; prefs.restart();
        MainActivity activity = new MainActivity(directory, prefs);
        resumedActivities.clear(); resumedActivities.add(activity);
        return activity;
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
        for (String phase : new String[]{"mark", "stop", "open", "stat", "not-directory", "sync", "close"}) {
            for (boolean throwing : new boolean[]{false, true}) {
                MainActivity a = fresh(); DeviceStorage bridge = a.new DeviceStorage();
                seed(a.directory, "A"); seed(a.directory, "B");
                TrackSession.Request old = TrackService.session(a).start("A");
                a.prefs.fail = phase; a.prefs.throwing = throwing;
                android.system.Os.failOpen = phase.equals("open");
                android.system.Os.failStat = phase.equals("stat");
                android.system.Os.notDirectory = phase.equals("not-directory");
                android.system.Os.failSync = phase.equals("sync");
                android.system.Os.failClose = phase.equals("close");
                int syncsBefore = android.system.Os.syncs, closesBefore = android.system.Os.closes;
                check(!bridge.deleteTrack("A"), "failed " + phase + " is never acknowledged");
                check(android.system.Os.openDescriptors() == 0, "opened descriptor is closed after " + phase);
                if (phase.equals("open") || phase.equals("stat") || phase.equals("not-directory"))
                    check(android.system.Os.syncs == syncsBefore, "cannot sync an unchecked descriptor after " + phase);
                if (phase.equals("stat") || phase.equals("not-directory"))
                    check(android.system.Os.closes == closesBefore + 1, "failed descriptor validation still closes once");
                check(records(a.directory, "B") == 1, "failure preserves unrelated journal");
                if (phase.equals("mark") || phase.equals("stop")) check(records(a.directory, "A") == 1, "pre-cleanup failure preserves bytes");
                if (!phase.equals("mark")) {
                    check(!TrackService.session(a).accepts(old), "durable deletion intent blocks failed-stop callback");
                    check(bridge.getTrack("A").equals("[]"), "pending cleanup cannot be replayed");
                }
                // Failed preference commits mutate memory in Android; retry must
                // commit the tombstone again, rather than trusting memory alone.
                a = a.restart(); a.prefs.fail = "";
                android.system.Os.failOpen = false; android.system.Os.failStat = false; android.system.Os.notDirectory = false;
                android.system.Os.failSync = false; android.system.Os.failClose = false;
                bridge = a.new DeviceStorage();
                check(bridge.deleteTrack("A"), "restart retry completes " + phase);
                check(android.system.Os.openDescriptors() == 0, "successful retry closes directory descriptor");
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
            service.foregroundRequired = explicit;
            TrackService.running = service;
            Intent stale = explicit ? new Intent(TrackService.ACTION_START, "A", "old") : null;
            check(service.onStartCommand(stale, 0, 1) == TrackService.START_NOT_STICKY, "tombstoned restart cannot stay sticky");
            check(service.stopCalls > 0 && service.updates == 0, "tombstoned service stops without location");
            check(service.foreground == (explicit ? 1 : 0), "only explicit foreground delivery is acknowledged before stop");
            check(service.recording == null && !service.foregroundActive, "tombstoned recording and transient foreground state cleared");
            check(TrackService.isDeleted(deletedRestart, "A"), "foreground acknowledgement preserves durable tombstone");
            check(TrackService.session(deletedRestart).start("A") == null && records(deletedRestart.directory,"A") == 0,
                "foreground acknowledgement cannot revive deleted session or journal");
        }
        MainActivity cancelled = fresh();
        TrackSession.Request cancelledRequest = TrackService.session(cancelled).start("A");
        TrackService.session(cancelled).stop("A");
        TrackService cancelledService = new TrackService(cancelled.directory,cancelled.prefs);
        TrackService.running = cancelledService; cancelledService.foregroundRequired = true;
        check(cancelledService.onStartCommand(new Intent(TrackService.ACTION_START,"A",cancelledRequest.token),0,4)
            == TrackService.START_NOT_STICKY, "cancelled foreground delivery is not sticky");
        check(cancelledService.foreground == 1 && cancelledService.stopCalls > 0 && cancelledService.updates == 0,
            "cancelled foreground delivery acknowledges before stop without location callbacks");
        check(cancelledService.recording == null && !TrackService.session(cancelled).request().valid(),
            "cancelled foreground acknowledgement cannot recreate a durable session");
        for (RuntimeException denial : new RuntimeException[]{
                new SecurityException("permission revoked"), new IllegalStateException("foreground start denied")}) {
            MainActivity denied = fresh();
            denied.prefs.edit().putString("pending_id","A").putString("session_token","old")
                .putBoolean("deleted:A",true).commit();
            TrackService rejected = new TrackService(denied.directory,denied.prefs);
            TrackService.running = rejected; rejected.foregroundRequired = true;
            rejected.foregroundDenial = denial; rejected.listener = new Object();
            boolean propagated = false;
            try { rejected.onStartCommand(new Intent(TrackService.ACTION_START,"A","old"),0,5); }
            catch (RuntimeException e) { propagated = e == denial; }
            check(propagated, "foreground denial propagates instead of claiming accepted runtime");
            check(rejected.stopCalls > 0 && rejected.manager.removals > 0 && !rejected.foregroundActive,
                "foreground denial always stops rejected service and removes listener");
            check(rejected.recording == null && rejected.updates == 0 && rejected.foreground == 0,
                "foreground denial cannot record or activate GPS");
            check(TrackService.isDeleted(denied,"A") && TrackService.session(denied).start("A") == null
                && records(denied.directory,"A") == 0, "foreground denial preserves tombstone and empty journal");
        }
        // This covers data safety for a null sticky restart after permission
        // revocation. Explicit foreground-delivery timing is an installed-device
        // limitation of the separate early !hasLocation branch, not modeled here.
        MainActivity revoked = fresh();
        revoked.prefs.edit().putString("pending_id","A").putString("session_token","old")
            .putBoolean("deleted:A",true).commit();
        TrackService withoutLocation = new TrackService(revoked.directory,revoked.prefs);
        TrackService.running = withoutLocation; withoutLocation.locationAllowed = false;
        check(withoutLocation.onStartCommand(null,0,6) == TrackService.START_NOT_STICKY
            && withoutLocation.stopCalls > 0 && withoutLocation.foreground == 0 && withoutLocation.updates == 0,
            "permission-revoked null restart stops without GPS or promotion");
        check(withoutLocation.recording == null && TrackService.session(revoked).start("A") == null
            && records(revoked.directory,"A") == 0, "permission-revoked restart cannot resurrect tombstone");
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
        for (boolean brokenReceipt : new boolean[]{false, true}) {
            MainActivity interrupted = fresh();
            TrackSession.Request wanted = TrackService.session(interrupted).start("A");
            if (brokenReceipt) new File(interrupted.directory, "track-A.jsonl").mkdir();
            else seed(interrupted.directory, "A");
            TrackService denied = new TrackService(interrupted.directory, interrupted.prefs);
            TrackService.running = denied; denied.listener = new Object();
            denied.foregroundDenial = new ForegroundServiceStartNotAllowedException();
            boolean receiptFailed = false;
            try {
                check(denied.onStartCommand(null, 0, 7) == TrackService.START_NOT_STICKY,
                    "known null restart denial stops rather than crash-looping");
            } catch (IllegalStateException expected) {
                receiptFailed = expected.getCause() instanceof IOException && brokenReceipt;
            }
            check(receiptFailed == brokenReceipt, "failed interruption write remains an explicit failure");
            check(denied.stopCalls == 1 && denied.manager.removals == 1 && denied.updates == 0 && denied.recording == null,
                "denied restart stops without location updates even if evidence write fails");
            check(TrackService.session(interrupted).accepts(wanted), "denial retains durable session/generation");
            if (!brokenReceipt) {
                String evidence = new String(Files.readAllBytes(new File(interrupted.directory,"track-A.jsonl").toPath()), StandardCharsets.UTF_8);
                check(evidence.startsWith("{\"nativeId\":\"fixture\""), "existing GPS bytes retained");
                check(evidence.contains("foreground_start_denied") && records(interrupted.directory,"A") == 2,
                    "denial is a durable distinct journal entry");
                interrupted = interrupted.restart();
                check(TrackService.session(interrupted).accepts(wanted), "cold restart still retains intended survey");
                resumedActivities.clear(); interrupted.new DeviceStorage().startTracking("A");
                check(interrupted.starts == 0, "background bridge cannot retry forbidden start");
                check(TrackService.session(interrupted).accepts(wanted), "deferred start keeps same generation");
                resumedActivities.add(interrupted); interrupted.startPendingTrack();
                check(interrupted.starts == 1, "foreground Activity can request normal recovery");
                TrackService recovered = new TrackService(interrupted.directory,interrupted.prefs);
                TrackService.running = recovered;
                check(recovered.onStartCommand(new Intent(TrackService.ACTION_START,"A",wanted.token),0,8) == TrackService.START_STICKY
                    && recovered.updates == 1, "permitted explicit recovery starts real update path");
                check(records(interrupted.directory,"A") == 2, "recovery does not erase or manufacture journal fixes");
                check(interrupted.new DeviceStorage().deleteTrack("A") && records(interrupted.directory,"A") == 0,
                    "ordinary deletion removes interruption and fixes together");
            }
        }
        for (boolean explicit : new boolean[]{false, true}) {
            MainActivity unexpected = fresh(); TrackSession.Request wanted = TrackService.session(unexpected).start("A");
            TrackService unexpectedService = new TrackService(unexpected.directory, unexpected.prefs);
            RuntimeException exception = explicit ? new ForegroundServiceStartNotAllowedException() : new IllegalStateException("other failure");
            unexpectedService.foregroundDenial = exception;
            boolean propagated = false;
            try { unexpectedService.onStartCommand(explicit ? new Intent(TrackService.ACTION_START,"A",wanted.token) : null,0,9); }
            catch (RuntimeException expected) { propagated = expected == exception; }
            check(propagated && records(unexpected.directory,"A") == 0,
                "explicit/unrelated failures are not mislabeled as recovered sticky denials");
        }
        MainActivity invisible = fresh(); resumedActivities.clear();
        invisible.new DeviceStorage().startTracking("A");
        check(invisible.starts == 0 && TrackService.session(invisible).request().valid(), "invisible start remains pending");
        resumedActivities.add(invisible); invisible.destroyed = true; invisible.startPendingTrack();
        check(invisible.starts == 0, "destroyed bridge host cannot launch service");
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
    boolean foregroundRequired, foregroundActive, locationAllowed = true;
    RuntimeException foregroundDenial;
    boolean hasLocation() { return locationAllowed; }
    Object notification() { return null; }
    void startForeground(int id, Object notification) {
        // Android 15 acknowledges the delivery before its runtime allow/type
        // checks; a denial must still propagate through production cleanup.
        foregroundRequired = false;
        if (foregroundDenial != null) throw foregroundDenial;
        foreground++; foregroundActive = true;
    }
    void beginUpdates() { updates++; }
    void stopSelf(int startId) { stopSelf(); }
    static TrackSession session;
    TrackService(File directory, SharedPreferences prefs) { super(directory,prefs); }
    static TrackService running;
    TrackSession.Request recording;
    Object listener;
    static class Manager { int removals; void removeUpdates(Object listener) { removals++; } }
    Manager manager = new Manager(); int stopCalls;
    void stopSelf() {
        if (foregroundRequired)
            throw new AssertionError("foreground delivery stopped before acknowledgement");
        stopCalls++; foregroundActive = false;
    }
    /* SERVICE_METHODS */
}

class Intent {
    String action, id, token;
    Intent(Context context, Class<?> service) {}
    Intent setAction(String value) { action=value; return this; }
    Intent putExtra(String key, String value) { if (key.equals(TrackService.EXTRA_ID)) id=value; else token=value; return this; }
    Intent(String action, String id, String token) { this.action = action; this.id = id; this.token = token; }
    String getAction() { return action; }
    String getStringExtra(String key) { return key.equals(TrackService.EXTRA_ID) ? id : token; }
}


class Build { static class VERSION { static int SDK_INT = 35; } }
class ForegroundServiceStartNotAllowedException extends IllegalStateException {}
