package app.passengercount;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.Instrumentation;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.location.LocationListener;
import android.os.Bundle;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.*;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;

/** Test APK only. Loads production classes from the installed target APK, not copies. */
public final class JournalLifecycleInstrumentation extends Instrumentation {
    private static final String KEY = "passenger-count:workspace:v2";
    private static final String PREFIX = "pcit-";
    private static final String TAG = "PassengerJournalTest";
    private Bundle args;
    private Context target;
    private MainActivity bridgeHost;
    private MainActivity.DeviceStorage bridge;
    private WebView web;
    private int assertions;
    private int interceptedRequests;

    interface Work { void run() throws Exception; }
    interface Condition { boolean get() throws Exception; }

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); args = arguments; start(); }
    @Override public void onStart() {
        String phase = args.getString("phase", "bootstrap");
        Bundle result = new Bundle();
        try {
            target = getTargetContext();
            check(target.getPackageName().equals("app.passengercount"), "exact target package");
            check(android.os.Build.VERSION.SDK_INT == 35, "bounded API35 runtime");
            createBridgeAndPage();
            event("runtime", new JSONObject().put("phase", phase).put("pid", Process.myPid())
                .put("fingerprint", android.os.Build.FINGERPRINT)
                .put("separateTargetLoader", TargetAccess.class.getClassLoader()!=TrackService.class.getClassLoader())
                .put("apkSha256", hash(new File(target.getApplicationInfo().sourceDir)))
                .put("recordDeletionSha256", hash(asset("record-deletion.js")))
                .put("storageSha256", hash(asset("storage.js"))));
            if (phase.equals("bootstrap")) bootstrap();
            else if (phase.equals("basics")) basics();
            else if (phase.equals("recover")) recover();
            else if (phase.equals("prepare-valid")) prepareCrash(false);
            else if (phase.equals("verify-valid")) verifyValidRestart();
            else if (phase.equals("prepare-deleted")) prepareCrash(true);
            else if (phase.equals("verify-deleted")) verifyDeletedRestart();
            else throw new AssertionError("Unknown phase " + phase);
            check(interceptedRequests == 0, "test document made no network request");
            main(() -> { web.destroy(); web=null; });
            if (phase.startsWith("prepare-")) {
                // --no-restart completion detaches without force-stop. The shell
                // verifies that detached state before this test-only SIGKILL.
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    Log.i(TAG, "SIGKILL_AFTER_DETACH " + phase + " pid=" + Process.myPid());
                    Process.killProcess(Process.myPid());
                }, 8000);
            }
            result.putString("stream", "PHASE_PASS " + phase + " assertions=" + assertions + " pid=" + Process.myPid() + "\n");
            result.putInt("assertions", assertions);
            finish(Activity.RESULT_OK, result);
        } catch (Throwable failure) {
            Log.e(TAG, "PHASE_FAIL " + phase, failure);
            result.putString("stream", "PHASE_FAIL " + phase + ": " + Log.getStackTraceString(failure));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void createBridgeAndPage() throws Exception {
        // Do not run MainActivity.onCreate: it starts catalogue refresh. The unchanged
        // bridge is attached to the real target context; no production methods are replaced.
        main(() -> {
            bridgeHost = new MainActivity();
            Method attach = ContextWrapper.class.getDeclaredMethod("attachBaseContext", Context.class);
            attach.setAccessible(true); attach.invoke(bridgeHost, target);
            bridge = bridgeHost.new DeviceStorage();
            web = new WebView(target);
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setBlockNetworkLoads(true);
            web.addJavascriptInterface(bridge, "PassengerCountAndroid");
            web.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    interceptedRequests++;
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Test network blocked",
                        new HashMap<String,String>(), new ByteArrayInputStream(new byte[0]));
                }
            });
            String module = "const blob=s=>URL.createObjectURL(new Blob([s],{type:'text/javascript'}));"
                + "const {deleteRecords}=await import(blob(" + JSONObject.quote(asset("record-deletion.js")) + "));"
                + "const store=await import(blob(" + JSONObject.quote(asset("storage.js")) + "));"
                + "window.fixtureDelete=ids=>{const s=store.load();try{deleteRecords(s,ids,PassengerCountAndroid,store.save);return {ok:true,state:store.load()};}catch(e){return {ok:false,error:e.message,state:store.load()};}};"
                + "await store.cachePut({data:{source:{id:'hk-td-gtfs-v1',retrievedAt:new Date().toISOString(),publishedAt:new Date().toISOString()},routeList:{},stopList:{}},at:Date.now()});"
                + "window.fixtureReady=true;";
            web.loadDataWithBaseURL("https://appassets.androidplatform.net/fixture.html",
                "<!doctype html><meta charset=utf-8><script type=module>" + module + "</script>", "text/html", "UTF-8", null);
        });
        await("exact packaged modules and fresh local catalogue loaded", () -> "true".equals(js("window.fixtureReady===true")), 15000);
    }
    private void bootstrap() throws Exception {
        for (File f : target.getFilesDir().listFiles())
            check(!f.getName().startsWith("track-"), "fresh emulator contains no pre-existing journal");
        saveState(state());
        check(bridge.get(KEY) != null, "real preferences commit");
    }
    private void basics() throws Exception {
        String a = PREFIX + "stopped-A", b = PREFIX + "stopped-B";
        seed(a); seed(b); saveState(state(a,b)); String before = hash(journal(b));
        check(delete(a).getBoolean("ok"), "stopped deletion acknowledged by exact JS/native flow");
        check(!journal(a).exists(), "stopped A bytes absent after real directory sync");
        check(hash(journal(b)).equals(before), "unrelated stopped B bytes unchanged");
        check(bridge.deleteTrack(a), "repeat native deletion succeeds");
        check(new JSONObject(bridge.get(KEY)).getJSONArray("surveys").length() == 1, "workspace filtered durably");
        evidence("stopped", a, b);

        a = PREFIX + "active-A"; seed(a); saveState(state(a,b)); start(a);
        final String activeId = a;
        await("real LocationManager callback appends emulator GPS", () -> lines(journal(activeId)) > 1, 25000);
        TrackService service = service();
        LocationListener late = (LocationListener) TargetAccess.field(service, "listener");
        Object control = session(); Object request = TargetAccess.call(control, "request");
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicReference<Throwable> writerFailure = new AtomicReference<>();
        Thread writer = new Thread(() -> { try { TargetAccess.call(control, "append", request, (Runnable) () -> {
            entered.countDown();
            try { if (!release.await(10, TimeUnit.SECONDS)) throw new AssertionError("drain release timeout"); seed(activeId); }
            catch (Throwable e) { writerFailure.set(e); }
        }); } catch (Throwable e) { writerFailure.set(e); } });
        writer.start(); check(entered.await(2, TimeUnit.SECONDS), "accepted writer holds actual production barrier");
        AtomicReference<Boolean> nativeDeletion = new AtomicReference<>(); AtomicReference<Throwable> error = new AtomicReference<>();
        CountDownLatch deletionInvoked = new CountDownLatch(1);
        Thread deleting = new Thread(() -> {
            deletionInvoked.countDown();
            try { nativeDeletion.set(bridge.deleteTrack(activeId)); } catch (Throwable e) { error.set(e); }
        });
        deleting.start();
        try {
            check(deletionInvoked.await(2, TimeUnit.SECONDS), "native bridge deletion invoked");
            // A real GPS callback may itself block the main Looper on this lock.
            // Do not depend on evaluateJavascript or mere worker liveness here.
            await("native deletion reached the actual session monitor", () -> blockedInDeletion(deleting), 3000);
            check(nativeDeletion.get()==null && error.get()==null, "native cleanup cannot acknowledge before append drain");
        } finally { release.countDown(); }
        writer.join(3000); deleting.join(5000);
        check(!writer.isAlive() && writerFailure.get()==null, "accepted writer completed without hidden fixture failure");
        check(!deleting.isAlive() && error.get()==null && Boolean.TRUE.equals(nativeDeletion.get()), "drained native bridge deletion completes");
        // Independently execute the exact JS coordinator over that real bridge.
        // Native cleanup is now idempotent; this checks its durable final workspace phase.
        check(delete(activeId).getBoolean("ok"), "exact JS coordinator completes the already-drained native deletion");
        await("deleted active service stops", () -> service() == null, 5000);
        main(() -> late.onLocationChanged(location()));
        SystemClock.sleep(4000);
        check(!journal(a).exists(), "late callback and further emulator fixes cannot recreate journal");
        check(!accepts(control, request), "deleted generation invalidated");
        evidence("active-drain", a, b);

        a = PREFIX + "other-A"; String live = PREFIX + "live-B"; seed(a); seed(live); saveState(state(a,live)); start(live);
        Object liveRequest = TargetAccess.call(session(), "request"); final int initial = lines(journal(live));
        check(delete(a).getBoolean("ok"), "delete unrelated A while B active");
        check(accepts(session(), liveRequest), "B accepted session survives");
        await("B keeps receiving actual location callbacks", () -> lines(journal(live)) > initial, 20000);
        check(foreground(), "unrelated B stays foreground");
        before = hash(journal(live));
        for (String id : new String[]{null,"","../"+live,live+"/",live+".","bad id",new String(new char[129]).replace('\0','x')})
            check(!bridge.deleteTrack(id), "invalid ID refused: " + id);
        check(accepts(session(), liveRequest), "invalid IDs preserve active session");
        check(bridge.stopTrackingAndDrain(live), "stop B after unrelated-session test");
        await("B stopped", () -> service()==null, 5000);
        // Hash only after stopping, so legitimate GPS callbacks cannot race the control.
        before = hash(journal(live));
        android.system.Os.symlink(journal(live).getPath(), journal(PREFIX+"link").getPath());
        check(!bridge.deleteTrack(PREFIX+"link"), "symlink journal refused");
        check(hash(journal(live)).equals(before), "path validation preserves B bytes");
        check(journal(PREFIX+"link").delete(), "remove only synthetic symlink fixture");

        String blocked = PREFIX+"blocked-A", keep = PREFIX+"blocked-B";
        check(journal(blocked).mkdir(), "synthetic journal-path obstruction created"); seed(keep); saveState(state(blocked,keep));
        JSONObject failed = delete(blocked);
        check(!failed.getBoolean("ok") && failed.getString("error").contains("incomplete"), "real cleanup rejection is explicit incomplete");
        check(failed.getJSONObject("state").getJSONArray("deletingIds").getString(0).equals(blocked), "pending selection durably retained");
        fixtures().edit().putInt("beforeRecoveryPid",Process.myPid()).putString("keepHash",hash(journal(keep))).commit();
        evidence("pending-before-restart", blocked, keep);
    }
    private void recover() throws Exception {
        check(fixtures().getInt("beforeRecoveryPid",0)!=Process.myPid(), "recovery uses a new Android process");
        String a=PREFIX+"blocked-A", b=PREFIX+"blocked-B";
        check(!delete().getBoolean("ok"), "restart still reports real obstruction");
        check(hash(journal(b)).equals(fixtures().getString("keepHash","")), "restart preserves unrelated journal");
        check(journal(a).delete(), "remove only empty synthetic obstruction");
        check(delete().getBoolean("ok"), "cold-start pending cleanup retry completes");
        check(new JSONObject(bridge.get(KEY)).getJSONArray("deletingIds").length()==0, "final workspace clears pending selection");
        check(!journal(a).exists() && bridge.getTrack(a).equals("[]"), "real native read cannot replay deleted ID");
        // Construct post-unlink/pre-final-workspace-save boundary, then reload exact coordinator state.
        String unlinked=PREFIX+"unlinked-A"; seed(unlinked); saveState(state(unlinked,b).put("deletingIds",new JSONArray().put(unlinked)));
        check(bridge.deleteTrack(unlinked), "native phase finishes before simulated final-save interruption");
        check(delete().getBoolean("ok"), "already-unlinked native cleanup is retryable from persisted pending state");
        evidence("recovered",a,b); saveState(state());
    }
    private void prepareCrash(boolean deleted) throws Exception {
        String id=PREFIX+(deleted?"crash-deleted-A":"crash-valid-B"); seed(id); start(id);
        await("crash control receives real GPS",()->lines(journal(id))>1,25000);
        Object current=TargetAccess.call(session(), "request");
        if(deleted) {
            saveState(state(id).put("deletingIds",new JSONArray().put(id)));
            check(target.getSharedPreferences("tracking",0).edit().putBoolean("deleted:"+id,true).commit(), "construct durable tombstone-before-stop state");
            check(!accepts(session(), current), "tombstone rejects live generation before process death");
        } else saveState(state());
        check(fixtures().edit().putInt("crashPid",Process.myPid()).putString("crashId",id)
            .putString("crashToken",(String) TargetAccess.field(current, "token")).putString("crashHash",hash(journal(id))).commit(), "durable crash evidence");
        check(service()!=null && foreground(), "real service remains foreground before instrumentation detaches");
        evidence(deleted?"crash-deleted-prepared":"crash-valid-prepared",id,null);
        // Shell verifies --no-restart finish/detach before the scheduled SIGKILL.
    }
    private void verifyValidRestart() throws Exception {
        String id=fixtures().getString("crashId","");
        check(Process.myPid()!=fixtures().getInt("crashPid",0), "system restarted a different process");
        Object request=TargetAccess.call(session(), "request");
        check(TargetAccess.field(request, "id").equals(id) && TargetAccess.field(request, "token").equals(fixtures().getString("crashToken","")), "durable valid session/token survives actual death");
        check(accepts(session(), request) && service()!=null && foreground(), "positive control resumes real foreground service");
        String stale=PREFIX+"stale-A";
        check(target.getSharedPreferences("tracking",0).edit().putBoolean("deleted:"+stale,true).commit(), "stale-A fixture marker");
        main(()->target.startForegroundService(new Intent(target,TrackService.class).setAction(serviceString("ACTION_START"))
            .putExtra(serviceString("EXTRA_ID"),stale).putExtra(serviceString("EXTRA_TOKEN"),"old")));
        waitForIdleSync(); SystemClock.sleep(250);
        check(accepts(session(), request) && foreground(), "stale tombstoned A start preserves accepted B");
        int count=lines(journal(id)); await("restarted B receives GPS",()->lines(journal(id))>count,20000);
        check(bridge.stopTrackingAndDrain(id), "stop positive control"); await("positive control stops",()->service()==null,5000);
        saveState(state()); evidence("valid-system-restart",id,null);
    }
    private void verifyDeletedRestart() throws Exception {
        String id=fixtures().getString("crashId","");
        check(Process.myPid()!=fixtures().getInt("crashPid",0), "tombstone check is a cold process");
        check((Boolean) TargetAccess.callStatic(TrackService.class, "isDeleted", target, id), "tombstone survived abrupt process death");
        check(hash(journal(id)).equals(fixtures().getString("crashHash","")), "tombstoned journal gained no restart samples");
        check(bridge.getTrack(id).equals("[]"), "tombstoned bridge read blocked before cleanup retry");
        check(new JSONObject(bridge.getTrackPage(id,"")).getJSONArray("points").length()==0, "paged read blocked");
        main(()->target.startForegroundService(new Intent(target,TrackService.class).setAction(serviceString("ACTION_START"))
            .putExtra(serviceString("EXTRA_ID"),id).putExtra(serviceString("EXTRA_TOKEN"),fixtures().getString("crashToken",""))));
        waitForIdleSync(); SystemClock.sleep(500);
        await("explicit stale delivery stops rather than staying sticky",()->service()==null,5000);
        check(delete().getBoolean("ok") && !journal(id).exists(), "pending native/workspace cleanup completes after restart");
        bridge.startTracking(id); waitForIdleSync(); SystemClock.sleep(300);
        check(service()==null && !journal(id).exists(), "deleted ID cannot restart or recreate journal");
        evidence("deleted-system-restart",id,null); saveState(state());
    }

    private void start(String id) throws Exception {
        bridge.startTracking(id);
        await("real foreground service starts "+id,()->service()!=null && foreground(),10000);
        check(TargetAccess.field(TargetAccess.call(session(), "request"), "id").equals(id), "requested ID owns native session");
    }
    private TrackService service() throws Exception {
        AtomicReference<TrackService> s=new AtomicReference<>(); main(()->s.set((TrackService)TargetAccess.staticField(TrackService.class,"running"))); return s.get();
    }
    private boolean foreground() {
        ActivityManager manager=(ActivityManager)target.getSystemService(Context.ACTIVITY_SERVICE);
        for(ActivityManager.RunningServiceInfo info:manager.getRunningServices(100))
            if(info.service.getClassName().equals(TrackService.class.getName())) return info.foreground && info.pid==Process.myPid();
        return false;
    }
    private JSONObject state(String... ids) throws JSONException {
        JSONArray trips=new JSONArray(); for(String id:ids) trips.put(new JSONObject().put("id",id).put("status","paused")
            .put("route",new JSONObject().put("route","TEST").put("operator","kmb")).put("stops",new JSONArray()).put("track",new JSONArray()));
        return new JSONObject().put("version",2).put("currentId",JSONObject.NULL).put("screen","home").put("language","en")
            .put("surveys",trips).put("deletingIds",new JSONArray()).put("search",new JSONObject());
    }
    private void saveState(JSONObject s) { check(bridge.set(KEY,s.toString()), "actual workspace commit"); }
    private JSONObject delete(String... ids) throws Exception {
        String raw=js("JSON.stringify(window.fixtureDelete("+new JSONArray(Arrays.asList(ids)).toString()+"))");
        return new JSONObject(new JSONArray("["+raw+"]").getString(0));
    }
    private File journal(String id) { if(!id.startsWith(PREFIX)) throw new AssertionError("Non-fixture ID"); return new File(target.getFilesDir(),"track-"+id+".jsonl"); }
    private void seed(String id) throws IOException {
        try(FileOutputStream out=new FileOutputStream(journal(id),true)) { out.write("{\"nativeId\":\"synthetic\",\"lat\":0.123,\"lng\":0.456}\n".getBytes(StandardCharsets.UTF_8));out.getFD().sync(); }
    }
    private SharedPreferences fixtures() { return target.getSharedPreferences("journal-test-fixtures",0); }
    private int lines(File f) throws IOException { if(!f.exists()) return 0;int n=0;try(BufferedReader r=new BufferedReader(new FileReader(f))){while(r.readLine()!=null)n++;}return n; }
    private Location location() { Location l=new Location("gps");l.setLatitude(0.123);l.setLongitude(0.456);l.setTime(System.currentTimeMillis());return l; }
    private String asset(String path) throws IOException { try(InputStream in=target.getAssets().open("www/"+path)){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return new String(out.toByteArray(),StandardCharsets.UTF_8);} }
    private String hash(File file) throws Exception { try(InputStream in=new FileInputStream(file)){MessageDigest d=MessageDigest.getInstance("SHA-256");byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)d.update(b,0,n);return hex(d.digest());} }
    private String hash(String value) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    private String hex(byte[] b) { StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format(Locale.ROOT,"%02x",x&255));return s.toString(); }
    private boolean blockedInDeletion(Thread thread) {
        if (thread.getState()!=Thread.State.BLOCKED) return false;
        for (StackTraceElement frame:thread.getStackTrace())
            if (frame.getClassName().equals("app.passengercount.TrackDeletion") && frame.getMethodName().equals("delete")) return true;
        return false;
    }
    private Object session() throws Exception { return TargetAccess.callStatic(TrackService.class, "session", target); }
    private boolean accepts(Object control,Object request) throws Exception { return (Boolean) TargetAccess.call(control, "accepts", request); }
    private String serviceString(String name) throws Exception { return (String) TargetAccess.staticField(TrackService.class, name); }
    private void main(Work work) throws Exception { AtomicReference<Throwable> error=new AtomicReference<>();runOnMainSync(()->{try{work.run();}catch(Throwable e){error.set(e);}});if(error.get()!=null)throw new Exception(error.get()); }
    private String js(String script) throws Exception { CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();main(()->web.evaluateJavascript(script,v->{value.set(v);done.countDown();}));if(!done.await(10,TimeUnit.SECONDS))throw new AssertionError("WebView callback timed out");return value.get(); }
    private void await(String label,Condition condition,long ms) throws Exception { long end=SystemClock.elapsedRealtime()+ms;while(SystemClock.elapsedRealtime()<end){if(condition.get()){check(true,label);return;}SystemClock.sleep(100);}throw new AssertionError("Timed out: "+label); }
    private void check(boolean pass,String label) { if(!pass)throw new AssertionError(label);assertions++;Log.i(TAG,"PASS "+label); }
    private void event(String type,JSONObject data) { Log.i(TAG,type+" "+data);Bundle b=new Bundle();b.putString("stream",type+" "+data+"\n");sendStatus(1,b); }
    private void evidence(String scenario,String a,String b) throws Exception { event("evidence",new JSONObject().put("scenario",scenario).put("pid",Process.myPid()).put("aExists",journal(a).exists()).put("aHash",journal(a).isFile()?hash(journal(a)):JSONObject.NULL).put("bHash",b==null?JSONObject.NULL:hash(journal(b))).put("workspace",new JSONObject(bridge.get(KEY))).put("tracking",new JSONObject(target.getSharedPreferences("tracking",0).getAll()))); }
}
