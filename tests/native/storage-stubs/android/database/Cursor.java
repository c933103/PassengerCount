package android.database;

public interface Cursor extends AutoCloseable {
    boolean moveToFirst();
    String getString(int index);
    void close();
}
