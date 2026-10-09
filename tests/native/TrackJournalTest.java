package app.passengercount;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Arrays;

public final class TrackJournalTest {
    static int checks;
    static void check(boolean ok, String message) { checks++; if (!ok) throw new AssertionError(message); }
    static void write(Path path, String text) throws Exception { Files.write(path, text.getBytes(StandardCharsets.UTF_8)); }
    static void append(Path path, String text) throws Exception { Files.write(path, text.getBytes(StandardCharsets.UTF_8), StandardOpenOption.APPEND); }
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("track-journal-test");
        Path a = directory.resolve("one.jsonl"), b = directory.resolve("two.jsonl");
        try {
            String first = "{\"lat\":22,\"label\":\"甲\"}", second = "{\"lat\":23}";
            write(a, first + "\n" + second + "\n");
            byte[] original = Files.readAllBytes(a);
            TrackJournal.Page page = TrackJournal.read(a.toFile(), "");
            check(page.entries.size() == 2 && !page.more, "initial full read");
            check(page.entries.get(0).json.equals(first), "UTF-8 byte offsets");
            String cursor = page.cursor;
            check(TrackJournal.read(a.toFile(), cursor).entries.isEmpty(), "same cursor reads no duplicates");
            check(Arrays.equals(original, Files.readAllBytes(a)), "read preserves journal bytes");
            append(a, "{\"lat\":24}");
            page = TrackJournal.read(a.toFile(), cursor);
            check(page.entries.isEmpty() && page.cursor.equals(cursor), "partial line not acknowledged");
            append(a, "\n");
            page = TrackJournal.read(a.toFile(), cursor);
            check(page.entries.size() == 1 && page.entries.get(0).json.equals("{\"lat\":24}"), "completed partial row read once");
            check(TrackJournal.read(a.toFile(), page.cursor).entries.isEmpty(), "cold-restart opaque cursor reuse");
            write(a, first + "\n");
            page = TrackJournal.read(a.toFile(), page.cursor);
            check(page.entries.size() == 1, "truncation resets cursor");
            String priorId = page.entries.get(0).legacyId;
            write(a, first.replace("22", "99") + "\n");
            page = TrackJournal.read(a.toFile(), page.cursor);
            check(page.entries.size() == 1 && !page.entries.get(0).legacyId.equals(priorId), "same-size rewrite changes anchor and identity");
            write(a, first + "\n" + first + "\n");
            page = TrackJournal.read(a.toFile(), "");
            check(!page.entries.get(0).legacyId.equals(page.entries.get(1).legacyId), "identical legacy records remain distinct occurrences");
            write(b, second + "\n");
            check(TrackJournal.read(b.toFile(), "").entries.get(0).json.equals(second), "per-survey journal isolation");
            check(TrackJournal.read(a.toFile(), "malformed").entries.size() == 2, "invalid cursor safely restarts");
            StringBuilder longJournal = new StringBuilder();
            for (int i = 0; i < 20003; i++) longJournal.append("{\"n\":").append(i).append("}\n");
            write(a, longJournal.toString());
            int count = 0, pages = 0; cursor = "";
            do {
                page = TrackJournal.read(a.toFile(), cursor);
                check(page.entries.size() <= TrackJournal.PAGE_RECORDS, "bounded response page");
                count += page.entries.size(); pages++; cursor = page.cursor;
            } while (page.more);
            check(count == 20003 && pages > 1, "all points beyond old first-20,000 cutoff consumed");
            check(TrackJournal.read(a.toFile(), cursor).entries.isEmpty(), "long journal repeated read is empty");
            append(a, "{\"n\":20003}\n");
            page = TrackJournal.read(a.toFile(), cursor);
            check(page.entries.size() == 1 && page.entries.get(0).json.contains("20003"), "new tail remains reachable");
            write(a, "");
            check(TrackJournal.read(a.toFile(), cursor).cursor.isEmpty(), "empty truncation clears cursor");
            System.out.println("TrackJournal: " + checks + " assertions passed (12 fixture scenarios)");
        } finally {
            Files.deleteIfExists(a); Files.deleteIfExists(b); Files.deleteIfExists(directory);
        }
    }
}
