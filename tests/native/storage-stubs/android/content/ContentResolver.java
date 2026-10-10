package android.content;

import android.net.Uri;
import android.database.Cursor;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Host-only provider fixture; never compiled into the Android app. */
public class ContentResolver {
    public final Map<Uri, ContentValues> entries = new LinkedHashMap<>();
    public final Map<Uri, byte[]> bytes = new LinkedHashMap<>();
    public int next = 0, opens = 0, failOpen = -1, failPublish = -1, publishes = 0;
    public int queries = 0, deletes = 0;
    public String metadataFailure = "none";
    public boolean failDelete = false;

    public Uri insert(Uri collection, ContentValues values) {
        Uri uri = Uri.parse("content://provider/" + (++next));
        entries.put(uri, new ContentValues(values));
        return uri;
    }

    public OutputStream openOutputStream(final Uri uri, String mode) throws IOException {
        if (++opens == failOpen) throw new IOException("controlled open failure");
        return new ByteArrayOutputStream() {
            @Override public void close() throws IOException {
                bytes.put(uri, toByteArray());
                super.close();
            }
        };
    }

    public int update(Uri uri, ContentValues values, String where, String[] args) {
        if (++publishes == failPublish) return 0;
        entries.get(uri).putAll(values);
        return 1;
    }

    public int delete(Uri uri, String where, String[] args) {
        deletes++;
        if (failDelete) throw new SecurityException("controlled revoked permission");
        List<Uri> children = new ArrayList<>();
        for (Map.Entry<Uri, ContentValues> entry : entries.entrySet())
            if (uri.toString().equals(entry.getValue().get("parent"))) children.add(entry.getKey());
        for (Uri child : children) delete(child, where, args);
        entries.remove(uri);
        bytes.remove(uri);
        return 1;
    }

    private void failMetadata(String phase) {
        if (phase.equals(metadataFailure))
            throw new IllegalStateException("controlled post-write " + phase + " failure");
    }

    public Cursor query(Uri uri, String[] columns, String selection, String[] args, String sort) {
        queries++;
        final ContentValues values = entries.get(uri);
        if (!Integer.valueOf(0).equals(values.get("pending")))
            throw new AssertionError("metadata query must happen after file publication");
        failMetadata("query");
        if (metadataFailure.equals("null-cursor")) return null;
        return new Cursor() {
            public boolean moveToFirst() {
                failMetadata("move");
                return !metadataFailure.equals("empty-cursor");
            }
            public String getString(int index) {
                failMetadata(index == 0 ? "name" : "relative");
                if (metadataFailure.equals(index == 0 ? "null-name" : "null-relative")) return null;
                return (String) values.get(columns[index]);
            }
            public void close() { failMetadata("close"); }
        };
    }
}
