package app.passengercount;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/** Read-only, resumable journal access. The writer always terminates records with LF. */
final class TrackJournal {
    static final int PAGE_RECORDS = 256;
    static final int MAX_LINE_BYTES = 65536;
    static final class Entry {
        final String json, legacyId;
        Entry(String json, String legacyId) { this.json = json; this.legacyId = legacyId; }
    }
    static final class Page {
        final List<Entry> entries = new ArrayList<>();
        String cursor = "";
        boolean more;
    }
    private static String digest(byte[] bytes) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder out = new StringBuilder();
            for (byte b : hash) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return out.toString();
        } catch (java.security.NoSuchAlgorithmException e) { throw new AssertionError(e); }
    }
    private static byte[] line(RandomAccessFile file) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int b;
        while ((b = file.read()) != -1) {
            if (b == '\n') return out.toByteArray();
            if (out.size() >= MAX_LINE_BYTES) throw new IOException("Oversized track record");
            out.write(b);
        }
        return null; // A concurrent/partial append must be retried, never consumed.
    }
    static Page read(File path, String cursor) throws IOException {
        Page page = new Page();
        if (!path.isFile()) return page;
        try (RandomAccessFile file = new RandomAccessFile(path, "r")) {
            long offset = 0;
            try {
                String[] parts = cursor.split(":", -1);
                long end = Long.parseLong(parts[0]), start = Long.parseLong(parts[1]);
                if (start >= 0 && end > start && end <= file.length() && end - start <= MAX_LINE_BYTES + 1) {
                    file.seek(start);
                    byte[] anchor = line(file);
                    if (anchor != null && file.getFilePointer() == end && digest(anchor).equals(parts[2])) {
                        offset = end;
                        page.cursor = cursor;
                    }
                }
            } catch (RuntimeException ignored) { /* absent/invalid cursor: replay safely by ID */ }
            file.seek(offset);
            while (page.entries.size() < PAGE_RECORDS) {
                long start = file.getFilePointer();
                byte[] bytes = line(file);
                if (bytes == null) break;
                long end = file.getFilePointer();
                String hash = digest(bytes);
                page.entries.add(new Entry(new String(bytes, StandardCharsets.UTF_8), "legacy:" + start + ":" + hash));
                page.cursor = end + ":" + start + ":" + hash;
            }
            page.more = page.entries.size() == PAGE_RECORDS && file.getFilePointer() < file.length();
        }
        return page;
    }
}
