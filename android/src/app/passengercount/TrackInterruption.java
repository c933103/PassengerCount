package app.passengercount;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Durable observation of a denied restart, not an invented gap start/end or GPS fix. */
final class TrackInterruption {
    private TrackInterruption() {}
    // Caller holds the TrackSession append/deletion monitor and checks ownership.
    static void append(File journal, long observedAt) throws IOException {
        if (observedAt <= 0) throw new IOException("Invalid interruption observation time");
        String record = "{\"nativeId\":\"" + UUID.randomUUID() + "\","
            + "\"event\":\"foreground_start_denied\",\"timestamp\":" + observedAt + "}\n";
        try (RandomAccessFile out = new RandomAccessFile(journal, "rw")) {
            long end = out.length();
            if (end > 0) {
                out.seek(end - 1);
                if (out.read() != '\n') out.write('\n');
            }
            out.seek(out.length());
            out.write(record.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
    }
}
