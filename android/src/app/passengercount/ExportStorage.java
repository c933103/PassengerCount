package app.passengercount;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/** Public exports, with an optional persistently authorised document tree. */
final class ExportStorage {
    private final Context context;
    private final SharedPreferences prefs;
    ExportStorage(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences("exports", Context.MODE_PRIVATE);
    }
    String tree() { return prefs.getString("tree", null); }
    boolean setTree(String tree) { return prefs.edit().putString("tree", tree).commit(); }
    String directory() {
        String tree = tree();
        return tree == null ? defaultDirectory().getAbsolutePath() : documentPath(Uri.parse(tree), true);
    }
    private File defaultDirectory() {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "PaxCountRecord");
    }
    private String documentPath(Uri uri, boolean tree) {
        if ("com.android.externalstorage.documents".equals(uri.getAuthority())) {
            String id = tree ? DocumentsContract.getTreeDocumentId(uri) : DocumentsContract.getDocumentId(uri);
            if (id.startsWith("primary:"))
                return new File(Environment.getExternalStorageDirectory(), id.substring(8)).getAbsolutePath();
        }
        // Other providers may not have a filesystem path; report the actual URI.
        return uri.toString();
    }
    String save(byte[] bytes, String requestedName, String mime) throws IOException {
        String name = requestedName.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (name.isEmpty() || name.length() > 200 || name.startsWith(".")) throw new IOException("Invalid filename");
        String tree = tree();
        if (tree != null) {
            Uri root = Uri.parse(tree);
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(root, DocumentsContract.getTreeDocumentId(root));
            Uri file = DocumentsContract.createDocument(context.getContentResolver(), parent, mime, name);
            if (file == null) throw new IOException("Cannot create export");
            try {
                write(file, bytes);
                return documentPath(file, false);
            } catch (IOException | RuntimeException e) {
                try { DocumentsContract.deleteDocument(context.getContentResolver(), file); } catch (Exception ignored) {}
                throw e;
            }
        }
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PaxCountRecord/");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri file = context.getContentResolver().insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            if (file == null) throw new IOException("Cannot create export");
            try {
                write(file, bytes);
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                if (context.getContentResolver().update(file, values, null, null) != 1)
                    throw new IOException("Cannot publish export");
                try (Cursor cursor = context.getContentResolver().query(file,
                        new String[]{MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst())
                        return new File(Environment.getExternalStorageDirectory(), cursor.getString(1) + cursor.getString(0)).getAbsolutePath();
                }
                return file.toString();
            } catch (IOException | RuntimeException e) {
                try { context.getContentResolver().delete(file, null, null); } catch (Exception ignored) {}
                throw e;
            }
        }
        File directory = defaultDirectory();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create export folder");
        File file = new File(directory, name);
        // Never overwrite an earlier export, including repeated taps in the same millisecond.
        if (!file.createNewFile()) {
            int dot = name.lastIndexOf('.');
            String unique = name.substring(0, dot) + "-" + java.util.UUID.randomUUID() + name.substring(dot);
            file = new File(directory, unique);
            if (!file.createNewFile()) throw new IOException("Cannot create export");
        }
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
            output.getFD().sync();
        } catch (IOException e) { file.delete(); throw e; }
        return file.getAbsolutePath();
    }
    private void write(Uri file, byte[] bytes) throws IOException {
        try (OutputStream output = context.getContentResolver().openOutputStream(file, "w")) {
            if (output == null) throw new IOException("No output stream");
            output.write(bytes);
            output.flush();
        }
    }
}
