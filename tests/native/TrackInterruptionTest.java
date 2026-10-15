package app.passengercount;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Real production append/fsync and journal reader, using synthetic host files. */
public final class TrackInterruptionTest {
    private static int assertions;
    private static void check(boolean pass, String message) {
        assertions++; if (!pass) throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("interruption-journal-").toFile();
        try {
            for (String prefix : new String[]{"", "{\"nativeId\":\"fix\",\"lat\":1,\"lng\":2}\n", "{\"torn\":"}) {
                File journal = new File(root, "track-A.jsonl");
                Files.write(journal.toPath(), prefix.getBytes(StandardCharsets.UTF_8));
                TrackInterruption.append(journal, 1792055383160L);
                String first = new String(Files.readAllBytes(journal.toPath()), StandardCharsets.UTF_8);
                check(first.startsWith(prefix), "append preserves all prior bytes including torn tail");
                check(first.endsWith("\"event\":\"foreground_start_denied\",\"timestamp\":1792055383160}\n"), "durable observation has exact reason and detection time");
                check(!first.substring(prefix.length()).contains("\"lat\"") && !first.contains("session_token"), "receipt invents no coordinate and exposes no session token");
                TrackJournal.Page page = TrackJournal.read(journal, "");
                check(page.entries.get(page.entries.size()-1).json.contains("foreground_start_denied"), "reader can consume receipt independently of torn prior row");
                TrackInterruption.append(journal, 1792055384000L);
                String second = new String(Files.readAllBytes(journal.toPath()), StandardCharsets.UTF_8);
                check(second.startsWith(first), "later denial cannot overwrite old receipt or fix");
                check(second.split("foreground_start_denied",-1).length == 3, "distinct denials both remain");
                boolean rejected = false;
                try { TrackInterruption.append(journal, 0); } catch (IOException expected) { rejected=true; }
                check(rejected && second.equals(new String(Files.readAllBytes(journal.toPath()),StandardCharsets.UTF_8)), "invalid time fails before modifying bytes");
            }
            boolean failed = false;
            try { TrackInterruption.append(root, 1792055383160L); } catch (IOException expected) { failed=true; }
            check(failed, "unwritable journal path never reports saved receipt");
            System.out.println("TrackInterruptionTest: " + assertions + " assertions passed");
        } finally {
            for (File child:root.listFiles()) child.delete();
            root.delete();
        }
    }
}
