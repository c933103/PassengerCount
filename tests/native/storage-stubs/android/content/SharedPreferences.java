package android.content;

import java.util.HashMap;
import java.util.Map;

public class SharedPreferences {
    private final Map<String, String> data = new HashMap<>();
    public String getString(String key, String fallback) { return data.getOrDefault(key, fallback); }
    public Editor edit() { return new Editor(); }
    public class Editor {
        private final Map<String, String> writes = new HashMap<>();
        public Editor putString(String key, String value) { writes.put(key, value); return this; }
        public boolean commit() { data.putAll(writes); return true; }
    }
}
