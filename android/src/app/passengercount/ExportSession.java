package app.passengercount;

/** Process-local ownership of permission waits and writes, with a visible observer. */
final class ExportSession {
    private boolean busy;
    private Runnable observer;
    private Runnable permissionOwner;
    synchronized boolean busy() { return busy || permissionOwner != null; }
    synchronized boolean waitForPermission(Runnable owner) {
        if (busy || permissionOwner != null) return false;
        permissionOwner = owner;
        return true;
    }
    synchronized boolean cancelPermission(Runnable owner) {
        if (permissionOwner != owner) return false;
        permissionOwner = null;
        return true;
    }
    synchronized boolean begin(Runnable owner) {
        if (busy || (permissionOwner != null && permissionOwner != owner)) return false;
        permissionOwner = null;
        busy = true;
        return true;
    }
    synchronized void attach(Runnable next) { observer = next; }
    synchronized void detach(Runnable old) { if (observer == old) observer = null; }
    void finish() {
        synchronized (this) { busy = false; }
        changed();
    }
    void changed() {
        Runnable notify;
        synchronized (this) { notify = observer; }
        if (notify != null) notify.run();
    }
}
