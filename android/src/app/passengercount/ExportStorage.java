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
import java.util.ArrayList;
import java.util.List;

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

    private static String safeName(String requested, int max) throws IOException {
        String name = requested == null ? "" : requested.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (name.isEmpty() || name.length() > max || name.startsWith("."))
            throw new IOException("Invalid filename");
        return name;
    }

    private String documentPath(Uri uri, boolean tree) {
        if ("com.android.externalstorage.documents".equals(uri.getAuthority())) {
            String id = tree ? DocumentsContract.getTreeDocumentId(uri) : DocumentsContract.getDocumentId(uri);
            if (id.startsWith("primary:"))
                return new File(Environment.getExternalStorageDirectory(), id.substring(8)).getAbsolutePath();
        }
        return uri.toString();
    }

    String save(byte[] bytes, String requestedName, String mime) throws IOException {
        String name = safeName(requestedName, 200);
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
        if (Build.VERSION.SDK_INT >= 29)
            return saveMedia(bytes, Environment.DIRECTORY_DOWNLOADS + "/PaxCountRecord/", name, mime);

        File directory = defaultDirectory();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create export folder");
        File file = uniqueFile(directory, name);
        writeFile(file, bytes);
        return file.getAbsolutePath();
    }

    String saveBundle(
            String requestedFolder,
            String requestedBase,
            byte[] csv,
            byte[] json,
            byte[] gpx,
            byte[] png) throws IOException {
        String folder = safeName(requestedFolder, 180);
        String base = safeName(requestedBase, 160);
        String[] names = {
            base + ".csv",
            base + ".json",
            base + ".gpx",
            base + ".png"
        };
        String[] mimes = {
            "text/csv",
            "application/json",
            "application/gpx+xml",
            "image/png"
        };
        byte[][] data = {csv, json, gpx, png};

        String tree = tree();
        if (tree != null) return saveTreeBundle(Uri.parse(tree), folder, names, mimes, data);

        if (Build.VERSION.SDK_INT >= 29) {
            String relative = Environment.DIRECTORY_DOWNLOADS + "/PaxCountRecord/" + folder + "/";
            List<Uri> created = new ArrayList<>();
            try {
                for (int i = 0; i < names.length; i++) {
                    if (data[i] == null || data[i].length == 0) continue;
                    created.add(saveMediaUri(data[i], relative, names[i], mimes[i]));
                }
                return new File(defaultDirectory(), folder).getAbsolutePath();
            } catch (IOException | RuntimeException e) {
                for (Uri uri : created)
                    try { context.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
                throw e;
            }
        }

        File root = defaultDirectory();
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create export folder");
        File directory = new File(root, folder);
        if (!directory.mkdir()) throw new IOException("Cannot create trip export folder");
        try {
            for (int i = 0; i < names.length; i++) {
                if (data[i] == null || data[i].length == 0) continue;
                File file = new File(directory, names[i]);
                if (!file.createNewFile()) throw new IOException("Cannot create export file");
                writeFile(file, data[i]);
            }
            return directory.getAbsolutePath();
        } catch (IOException | RuntimeException e) {
            deleteRecursively(directory);
            throw e;
        }
    }

    private String saveTreeBundle(
            Uri root,
            String folder,
            String[] names,
            String[] mimes,
            byte[][] data) throws IOException {
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(root, DocumentsContract.getTreeDocumentId(root));
        Uri directory = DocumentsContract.createDocument(
            context.getContentResolver(),
            parent,
            DocumentsContract.Document.MIME_TYPE_DIR,
            folder);
        if (directory == null) throw new IOException("Cannot create trip export folder");
        try {
            for (int i = 0; i < names.length; i++) {
                if (data[i] == null || data[i].length == 0) continue;
                Uri file = DocumentsContract.createDocument(
                    context.getContentResolver(), directory, mimes[i], names[i]);
                if (file == null) throw new IOException("Cannot create export file");
                write(file, data[i]);
            }
            return documentPath(directory, false);
        } catch (IOException | RuntimeException e) {
            try { DocumentsContract.deleteDocument(context.getContentResolver(), directory); } catch (Exception ignored) {}
            throw e;
        }
    }

    private String saveMedia(byte[] bytes, String relative, String name, String mime) throws IOException {
        Uri file = saveMediaUri(bytes, relative, name, mime);
        try (Cursor cursor = context.getContentResolver().query(file,
                new String[]{MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH},
                null, null, null)) {
            if (cursor != null && cursor.moveToFirst())
                return new File(Environment.getExternalStorageDirectory(),
                    cursor.getString(1) + cursor.getString(0)).getAbsolutePath();
        }
        return file.toString();
    }

    private Uri saveMediaUri(byte[] bytes, String relative, String name, String mime) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relative);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri file = context.getContentResolver().insert(
            MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
        if (file == null) throw new IOException("Cannot create export");
        try {
            write(file, bytes);
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (context.getContentResolver().update(file, values, null, null) != 1)
                throw new IOException("Cannot publish export");
            return file;
        } catch (IOException | RuntimeException e) {
            try { context.getContentResolver().delete(file, null, null); } catch (Exception ignored) {}
            throw e;
        }
    }

    private static File uniqueFile(File directory, String name) throws IOException {
        File file = new File(directory, name);
        if (file.createNewFile()) return file;
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String suffix = dot > 0 ? name.substring(dot) : "";
        file = new File(directory, stem + "-" + java.util.UUID.randomUUID() + suffix);
        if (!file.createNewFile()) throw new IOException("Cannot create export");
        return file;
    }

    private static void writeFile(File file, byte[] bytes) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
            output.getFD().sync();
        } catch (IOException e) {
            file.delete();
            throw e;
        }
    }

    private void write(Uri file, byte[] bytes) throws IOException {
        try (OutputStream output = context.getContentResolver().openOutputStream(file, "w")) {
            if (output == null) throw new IOException("No output stream");
            output.write(bytes);
            output.flush();
        }
    }

    private static void deleteRecursively(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }
}
