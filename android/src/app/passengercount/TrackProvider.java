package app.passengercount;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Private synchronous IPC. Only :tracking owns session preferences and journal locks. */
public final class TrackProvider extends ContentProvider {
    static final String AUTHORITY = "app.passengercount.tracking";
    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String id, Bundle extras) {
        // Defense in depth: call() has no URI-level read/write permission checks.
        if (Binder.getCallingUid() != android.os.Process.myUid()) throw new SecurityException("Private tracking owner");
        Context context = getContext();
        TrackSession control = TrackService.session(context);
        Bundle result = new Bundle();
        synchronized (control) {
            if ("start".equals(method) || "request".equals(method)) {
                TrackSession.Request request = "start".equals(method)
                    ? (TrackDeletion.validId(id) ? control.start(id) : null) : control.request();
                if (control.accepts(request)) {
                    result.putString("id", request.id);
                    result.putString("token", request.token);
                    result.putBoolean("ok", true);
                }
            } else if ("stop".equals(method)) {
                boolean stopped = control.stop(TrackService.safeId(id));
                result.putBoolean("ok", stopped);
                if (stopped) finishStop();
            } else if ("delete".equals(method)) {
                result.putBoolean("ok", TrackService.deleteTrack(context, id));
                finishStop();
            } else if ("page".equals(method)) {
                if (!TrackDeletion.validId(id)) return result;
                try {
                    TrackJournal.Page page = TrackService.isDeleted(context, id)
                        ? new TrackJournal.Page() : TrackJournal.read(TrackService.trackFile(context, id),
                            extras == null ? "" : extras.getString("cursor", ""),
                            extras == null ? TrackJournal.PAGE_RECORDS : extras.getInt("limit", TrackJournal.PAGE_RECORDS));
                    JSONArray points = new JSONArray();
                    for (TrackJournal.Entry entry : page.entries) {
                        try {
                            JSONObject point = new JSONObject(entry.json);
                            if (!(point.opt("nativeId") instanceof String) || point.optString("nativeId").isEmpty())
                                point.put("nativeId", entry.legacyId);
                            point.put("nativeOrder", entry.offset);
                            points.put(point);
                        } catch (JSONException ignored) {}
                    }
                    JSONObject payload = new JSONObject().put("points", points)
                        .put("cursor", page.cursor).put("more", page.more);
                    result.putString("page", payload.toString());
                    result.putInt("records", page.entries.size());
                    result.putBoolean("ok", true);
                } catch (Exception failedRead) { /* No successful empty snapshot on failure. */ }
            } else throw new IllegalArgumentException("Unknown tracking operation");
        }
        // Acknowledgement follows commit/fsync and release of the same append barrier.
        return result;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (Binder.getCallingUid() != android.os.Process.myUid()) throw new SecurityException("Private tracking owner");
        if (!"r".equals(mode) || !AUTHORITY.equals(uri.getAuthority()) || uri.getPathSegments().size() != 1)
            throw new FileNotFoundException("Read-only tracking snapshot");
        String id = uri.getLastPathSegment();
        Context context = getContext();
        TrackSession control = TrackService.session(context);
        ParcelFileDescriptor[] pipe = null;
        try {
            pipe = ParcelFileDescriptor.createReliablePipe();
            final ParcelFileDescriptor output = pipe[1];
            new Thread(() -> legacySnapshot(context, id, control, output), "track-snapshot").start();
            // openFile's dedicated Binder return transfers this descriptor. Do not
            // hide it in a Bundle, which may retain an extra provider-side reader
            // and prevent broken-pipe cancellation when the UI dies.
            return pipe[0];
        } catch (IOException | RuntimeException failedRead) {
            if (pipe != null) for (ParcelFileDescriptor descriptor : pipe)
                try { descriptor.close(); } catch (IOException ignored) {}
            throw new FileNotFoundException("Tracking snapshot unavailable");
        }
    }
    private static void legacySnapshot(Context context, String id, TrackSession control, ParcelFileDescriptor output) {
        OutputStream stream = new ParcelFileDescriptor.AutoCloseOutputStream(output);
        try {
            synchronized (control) {
                JSONArray points = new JSONArray();
                if (TrackDeletion.validId(id) && !TrackService.isDeleted(context, id)) {
                    File file = TrackService.trackFile(context, id);
                    if (file.isFile()) {
                        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                                new FileInputStream(file), StandardCharsets.UTF_8))) {
                            String line; int count = 0;
                            while ((line = reader.readLine()) != null && count++ < 20000) {
                                try { points.put(new JSONObject(line)); } catch (JSONException ignored) {}
                            }
                        }
                    }
                }
                stream.write(points.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (IOException failure) {
            try { output.closeWithError("Tracking snapshot unavailable"); } catch (IOException ignored) {}
        } finally {
            try { stream.close(); } catch (IOException ignored) {}
        }
    }
    private static void finishStop() {
        new Handler(Looper.getMainLooper()).post(TrackService::finishStop);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) { throw new UnsupportedOperationException(); }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
