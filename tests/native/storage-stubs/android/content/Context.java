package android.content;

public class Context {
    public static final int MODE_PRIVATE = 0;
    public final ContentResolver resolver = new ContentResolver();
    public final SharedPreferences prefs = new SharedPreferences();
    public SharedPreferences getSharedPreferences(String name, int mode) { return prefs; }
    public ContentResolver getContentResolver() { return resolver; }
}
