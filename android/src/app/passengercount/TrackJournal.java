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
    // Bound IPC payloads as well as record count; a page always fits at least one line.
    static final int PAGE_BYTES = 131072;
    static final class Entry {
        final String json, legacyId;
        final long offset;
        Entry(String json, String legacyId, long offset) {
            this.json = json; this.legacyId = legacyId; this.offset = offset;
        }
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
        return read(path, cursor, PAGE_RECORDS);
    }
    static Page read(File path, String cursor, int limit) throws IOException {
        if (limit < 1 || limit > PAGE_RECORDS) throw new IOException("Invalid page limit");
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
            int consumed = 0;
            boolean byteLimit = false;
            while (page.entries.size() < limit) {
                long start = file.getFilePointer();
                byte[] bytes = line(file);
                if (bytes == null) break;
                long end = file.getFilePointer();
                if (!page.entries.isEmpty() && consumed + bytes.length > PAGE_BYTES) {
                    file.seek(start); byteLimit = true; break;
                }
                consumed += bytes.length;
                String hash = digest(bytes);
                page.entries.add(new Entry(new String(bytes, StandardCharsets.UTF_8), "legacy:" + start + ":" + hash, start));
                page.cursor = end + ":" + start + ":" + hash;
            }
            page.more = (page.entries.size() == limit || byteLimit) && file.getFilePointer() < file.length();
        }
        return page;
    }
}
