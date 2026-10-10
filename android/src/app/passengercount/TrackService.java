package app.passengercount;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import org.json.JSONObject;

public final class TrackService extends Service {
    static final String ACTION_START = "app.passengercount.START_TRACK";
    static final String ACTION_STOP = "app.passengercount.STOP_TRACK";
    static final String EXTRA_ID = "survey_id";
    static final String EXTRA_TOKEN = "session_token";
    private static final String CHANNEL = "passengercount_track";
    private LocationManager manager;
    private LocationListener listener;
    private TrackSession.Request recording;
    private static TrackSession session;
    private static TrackService running;

    static synchronized TrackSession session(Context context) {
        if (session == null) {
            final SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences("tracking", MODE_PRIVATE);
            session = new TrackSession(new TrackSession.Store() {
                public TrackSession.Request read() {
                    return new TrackSession.Request(prefs.getString("pending_id", ""),
                        prefs.getString(EXTRA_TOKEN, ""));
                }
                public boolean write(TrackSession.Request request) {
                    SharedPreferences.Editor edit = prefs.edit().remove("active_id");
                    if (request.valid()) edit.putString("pending_id", request.id)
                        .putString(EXTRA_TOKEN, request.token);
                    else edit.remove("pending_id").remove(EXTRA_TOKEN);
                    return edit.commit();
                }
            });
        }
        return session;
    }

    // Called on the main thread only after the synchronous append barrier.
    static void finishStop() {
        TrackService service = running;
        if (service == null || session(service).request().valid()) return;
        service.recording = null;
        try { service.manager.removeUpdates(service.listener); } catch (Exception ignored) {}
        service.stopSelf();
    }

    static String safeId(String id) {
        return id == null ? "" : id.replaceAll("[^A-Za-z0-9_-]", "");
    }
    static File trackFile(Context context, String id) {
        return new File(context.getFilesDir(), "track-" + safeId(id) + ".jsonl");
    }

    @Override public void onCreate() {
        super.onCreate();
        running = this;
        manager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL, "Passenger survey location recording",
                NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Records the active survey route while counting.");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        TrackSession control = session(this);
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            control.stop(safeId(intent.getStringExtra(EXTRA_ID)));
            finishStop();
            return control.request().valid() ? START_STICKY : START_NOT_STICKY;
        }
        TrackSession.Request requested = intent == null ? control.request()
            : new TrackSession.Request(safeId(intent.getStringExtra(EXTRA_ID)),
                intent.getStringExtra(EXTRA_TOKEN));
        // Queued starts and permission replies must match the current durable
        // intent, including its generation after stop/restart of the same ID.
        if (!hasLocation()) { recording = null; stopSelf(startId); return START_NOT_STICKY; }
        if (!control.accepts(requested)) {
            if (!control.request().valid()) { recording = null; stopSelf(startId); }
            return control.request().valid() ? START_STICKY : START_NOT_STICKY;
        }
        recording = requested;
        startForeground(19, notification());
        beginUpdates();
        return START_STICKY;
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("MissingPermission")
    private void beginUpdates() {
        if (listener != null) manager.removeUpdates(listener);
        if (!hasLocation()) return;
        final TrackSession.Request target = recording;
        listener = new LocationListener() {
            @Override public void onLocationChanged(Location location) { recordLocation(target, location); }
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
        };
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000, 2f, listener, Looper.getMainLooper());
        } catch (Exception ignored) {}
        try {
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 5f, listener, Looper.getMainLooper());
        } catch (Exception ignored) {}
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("PassengerCount")
            .setContentText("Recording active survey location")
            .setContentIntent(pending)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    private void recordLocation(TrackSession.Request target, Location location) {
        session(this).append(target, () -> {
        try {
            JSONObject p = new JSONObject();
            p.put("nativeId", java.util.UUID.randomUUID().toString());
            p.put("lat", location.getLatitude());
            p.put("lng", location.getLongitude());
            p.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            p.put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
            p.put("heading", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
            long measured = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
            p.put("timestamp", measured);
            p.put("time", ZonedDateTime.ofInstant(Instant.ofEpochMilli(measured),
                ZoneId.of("Asia/Hong_Kong")).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
            p.put("source", "gps");
            try (FileOutputStream out = new FileOutputStream(trackFile(this, target.id), true)) {
                out.write((p.toString() + "\n").getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
        } catch (Exception ignored) {}
        });
    }

    @Override public void onDestroy() {
        if (running == this) running = null;
        recording = null;
        try { manager.removeUpdates(listener); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
