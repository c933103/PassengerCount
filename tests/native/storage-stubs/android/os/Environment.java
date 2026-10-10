package android.os;

import java.io.File;

public class Environment {
    public static final String DIRECTORY_DOWNLOADS = "Download";
    public static File root;
    public static File getExternalStorageDirectory() { return root; }
    public static File getExternalStoragePublicDirectory(String directory) { return new File(root, directory); }
}
