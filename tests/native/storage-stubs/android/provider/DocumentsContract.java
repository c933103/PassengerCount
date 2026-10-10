package android.provider;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;

public class DocumentsContract {
    public static class Document { public static final String MIME_TYPE_DIR = "vnd.android.document/directory"; }
    public static String getTreeDocumentId(Uri uri) { return uri.toString(); }
    public static String getDocumentId(Uri uri) { return uri.toString(); }
    public static Uri buildDocumentUriUsingTree(Uri uri, String id) { return uri; }
    public static Uri createDocument(ContentResolver resolver, Uri parent, String mime, String name) {
        ContentValues values = new ContentValues();
        values.put("parent", parent.toString());
        values.put("mime", mime);
        values.put("name", name);
        return resolver.insert(parent, values);
    }
    public static boolean deleteDocument(ContentResolver resolver, Uri uri) {
        return resolver.delete(uri, null, null) > 0;
    }
}
