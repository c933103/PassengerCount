package app.passengercount;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Actual production recording gate, without an Android framework/device. */
public final class TrackSessionTest {
    static int assertions;
    static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
    static final class Memory implements TrackSession.Store {
        TrackSession.Request saved = new TrackSession.Request("", "");
        boolean fail;
        public TrackSession.Request read() { return saved; }
        public boolean write(TrackSession.Request next) {
            if (fail) return false;
            saved = next; return true;
        }
    }
    public static void main(String[] args) throws Exception {
        Memory disk = new Memory();
        TrackSession gate = new TrackSession(disk);
        List<String> journal = new ArrayList<>();
        TrackSession.Request a = gate.start("A");
        check(gate.accepts(a), "explicit start accepted");
        check(gate.start("A").token.equals(a.token), "screen changes reuse active generation");
        gate.append(a, () -> journal.add("A1"));
        check(journal.size() == 1, "active location accepted");
        check(gate.stop("A"), "stop acknowledged");
        check(!gate.request().valid(), "durable pending intent removed");
        check(!new TrackSession(disk).request().valid(), "sticky process restart cannot resurrect stop");
        check(!gate.accepts(a), "queued start and permission reply rejected");
        gate.append(a, () -> journal.add("late A"));
        check(journal.size() == 1, "late location cannot write after acknowledgement");
        TrackSession.Request a2 = gate.start("A");
        check(!a.token.equals(a2.token), "explicit same-survey resume uses new generation");
        check(!gate.accepts(a), "old same-survey start invalid after resume");
        gate.append(a, () -> journal.add("old generation"));
        gate.append(a2, () -> journal.add("A2"));
        check(journal.size() == 2, "only resumed generation appends");
        TrackSession.Request b = gate.start("B");
        check(gate.stop("A"), "stale stop is harmless");
        check(gate.accepts(b), "stale A stop preserves B intent");
        gate.append(a2, () -> journal.add("A assigned to B"));
        gate.append(b, () -> journal.add("B1"));
        check(journal.toString().equals("[A1, A2, B1]"), "per-survey immutable callback identity");
        check(new TrackSession(disk).accepts(b), "sticky restart resumes only durable intended session");
        check(gate.stop(""), "home can stop orphan native session");
        check(!gate.accepts(b), "orphan invalidated");
        disk.saved = new TrackSession.Request("legacy", "");
        check(!gate.request().valid(), "legacy stale IDs without intent token never resume implicitly");
        disk.fail = true;
        check(gate.start("failure") == null, "failed durable start not acknowledged");
        check(!gate.stop(""), "failed durable stop not acknowledged");
        disk.fail = false;
        TrackSession.Request active = gate.start("drain");
        CountDownLatch writing = new CountDownLatch(1), release = new CountDownLatch(1);
        CountDownLatch stopping = new CountDownLatch(1), stopped = new CountDownLatch(1);
        Thread writer = new Thread(() -> gate.append(active, () -> {
            writing.countDown();
            try { release.await(); } catch (InterruptedException e) { throw new AssertionError(e); }
            journal.add("durable tail");
        }));
        Thread stopper = new Thread(() -> {
            stopping.countDown();
            gate.stop("drain");
            stopped.countDown();
        });
        writer.start();
        check(writing.await(2, TimeUnit.SECONDS), "writer entered append barrier");
        stopper.start();
        check(stopping.await(2, TimeUnit.SECONDS), "stop requested during write");
        check(!stopped.await(100, TimeUnit.MILLISECONDS), "stop waits until accepted write completes");
        release.countDown();
        check(stopped.await(2, TimeUnit.SECONDS), "stop acknowledges after writer exits");
        writer.join(); stopper.join();
        check(journal.get(journal.size() - 1).equals("durable tail"), "tail is available at acknowledgement");
        gate.append(active, () -> { throw new AssertionError("post-stop write"); });
        check(!gate.accepts(active), "subsequent callbacks stay rejected");
        System.out.println("TrackSessionTest: " + assertions + " assertions passed");
    }
}
