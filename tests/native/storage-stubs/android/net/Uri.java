package android.net;

public class Uri {
    private final String value;
    private Uri(String value) { this.value = value; }
    public static Uri parse(String value) { return new Uri(value); }
    public String getAuthority() {
        String hostAndPath = value.substring(value.indexOf("://") + 3);
        return hostAndPath.split("/", 2)[0];
    }
    @Override public String toString() { return value; }
    @Override public boolean equals(Object other) {
        return other instanceof Uri && value.equals(other.toString());
    }
    @Override public int hashCode() { return value.hashCode(); }
}
