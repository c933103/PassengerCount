package app.passengercount;

import java.util.UUID;

/** Durable recording intent and an acknowledged barrier around journal writes. */
final class TrackSession {
    static final class Request {
        final String id, token;
        Request(String id, String token) { this.id = id; this.token = token; }
        boolean valid() { return id != null && !id.isEmpty() && token != null && !token.isEmpty(); }
    }
    interface Store {
        Request read();
        boolean write(Request request);
    }
    private final Store store;
    TrackSession(Store store) { this.store = store; }

    synchronized Request request() { return store.read(); }
    synchronized Request start(String id) {
        Request previous = store.read();
        if (previous.valid() && previous.id.equals(id)) return previous;
        Request next = new Request(id, UUID.randomUUID().toString());
        return next.valid() && store.write(next) ? next : null;
    }
    synchronized boolean accepts(Request request) {
        Request wanted = store.read();
        return request != null && request.valid() && wanted.valid()
            && wanted.id.equals(request.id) && wanted.token.equals(request.token);
    }
    synchronized boolean stop(String id) {
        Request wanted = store.read();
        // A late stop for A must never cancel an explicit start for B.
        if (!id.isEmpty() && wanted.id != null && !id.equals(wanted.id)) return true;
        return store.write(new Request("", ""));
    }
    synchronized void append(Request request, Runnable write) {
        if (accepts(request)) write.run();
    }
}
