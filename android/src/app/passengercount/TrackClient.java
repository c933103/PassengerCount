package app.passengercount;

import android.content.*;
import android.os.*;
import android.net.Uri;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** One short-lived, unstable provider reference per acknowledged operation. */
final class TrackClient {
    private TrackClient() {}
    private static Bundle call(Context context, String method, String id, Bundle extras) {
        // An unstable reference prevents provider death from killing the UI too.
        // Do not cache a binding, retry a possibly-committed mutation, or start a service here.
        try (ContentProviderClient owner = context.getContentResolver()
                .acquireUnstableContentProviderClient(TrackProvider.AUTHORITY)) {
            return owner == null ? null : owner.call(method, id, extras);
        } catch (RemoteException | RuntimeException unavailable) { return null; }
    }
    private static boolean acknowledged(Bundle result) {
        return result != null && result.getBoolean("ok", false);
    }
    static boolean start(Context context, String id) { return acknowledged(call(context, "start", id, null)); }
    static TrackSession.Request request(Context context) {
        Bundle result = call(context, "request", null, null);
        if (!acknowledged(result)) return null;
        TrackSession.Request request = new TrackSession.Request(result.getString("id"), result.getString("token"));
        return request.valid() ? request : null;
    }
    static boolean stop(Context context, String id) { return acknowledged(call(context, "stop", id, null)); }
    static boolean delete(Context context, String id) { return acknowledged(call(context, "delete", id, null)); }
    static String page(Context context, String id, String cursor) {
        Bundle extras = new Bundle(); extras.putString("cursor", cursor);
        Bundle result = call(context, "page", id, extras);
        return acknowledged(result) ? result.getString("page", "") : "";
    }
    static String legacy(Context context, String id) {
        // Stream the complete legacy snapshot across IPC while the owner holds its
        // journal barrier, preserving its old atomic read and 20,000-record cap.
        if (!TrackDeletion.validId(id)) return "[]";
        Uri uri = new Uri.Builder().scheme("content").authority(TrackProvider.AUTHORITY)
            .appendPath(id == null ? "" : id).build();
        try (ContentProviderClient owner = context.getContentResolver()
                .acquireUnstableContentProviderClient(TrackProvider.AUTHORITY)) {
            if (owner == null) return "";
            ParcelFileDescriptor snapshot = owner.openFile(uri, "r");
            if (snapshot == null) return "";
            try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(snapshot)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] block = new byte[8192]; int count;
            while ((count = in.read(block)) != -1) bytes.write(block, 0, count);
            snapshot.checkError();
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            }
        } catch (IOException | RemoteException | RuntimeException failedRead) { return ""; }
    }
}
