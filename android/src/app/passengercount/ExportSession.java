package app.passengercount;

/** Process-local ownership of a submitted export, independent of its Activity. */
final class ExportSession {
    private boolean busy;
    private Runnable observer;
    synchronized boolean busy() { return busy; }
    synchronized boolean begin() {
        if (busy) return false;
        busy = true;
        return true;
    }
    synchronized void attach(Runnable next) { observer = next; }
    synchronized void detach(Runnable old) { if (observer == old) observer = null; }
    void finish() {
        Runnable notify;
        synchronized (this) { busy = false; notify = observer; }
        if (notify != null) notify.run();
    }
}
