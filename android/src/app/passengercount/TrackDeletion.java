package app.passengercount;

import java.io.File;
import java.io.IOException;

/** Retryable cleanup under the same gate as recording start and append/fsync. */
final class TrackDeletion {
    interface Storage {
        // Recommit on every attempt: a previous failed commit may have changed
        // SharedPreferences memory without reaching durable storage.
        boolean mark(String id);
        boolean remove(File file) throws IOException;
        void syncDirectory(File directory) throws IOException;
    }
    static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,128}");
    }
    static boolean delete(File directory, String id, TrackSession session, Storage storage) {
        if (!validId(id)) return false;
        synchronized (session) {
            try {
                File root = directory.getCanonicalFile();
                File file = new File(root, "track-" + id + ".jsonl");
                // Never sanitize into another trip's ID or follow a symlink.
                if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) return false;
                if (file.exists() && !file.isFile()) return false;
                if (!storage.mark(id) || !session.stop(id)) return false;
                if (file.exists() && !storage.remove(file)) return false;
                if (file.exists()) return false;
                // A failed directory sync is incomplete, even if unlink worked.
                storage.syncDirectory(root);
                return true;
            } catch (Exception e) { return false; }
        }
    }
}
