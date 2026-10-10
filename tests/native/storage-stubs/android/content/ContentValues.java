package android.content;

import java.util.HashMap;

public class ContentValues extends HashMap<String, Object> {
    public ContentValues() {}
    public ContentValues(ContentValues values) { super(values); }
}
