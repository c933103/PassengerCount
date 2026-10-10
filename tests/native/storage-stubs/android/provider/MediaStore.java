package android.provider;

import android.net.Uri;

public class MediaStore {
    public static final String VOLUME_EXTERNAL_PRIMARY = "external_primary";
    public static class MediaColumns {
        public static final String DISPLAY_NAME = "name", RELATIVE_PATH = "relative",
            MIME_TYPE = "mime", IS_PENDING = "pending";
    }
    public static class Downloads {
        public static Uri getContentUri(String volume) { return Uri.parse("content://downloads/" + volume); }
    }
}
