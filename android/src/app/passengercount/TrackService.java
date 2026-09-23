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

public final class TrackService extends Service implements LocationListener {
    static final String ACTION_START = "app.passengercount.START_TRACK";
    static final String ACTION_STOP = "app.passengercount.STOP_TRACK";
    static final String EXTRA_ID = "survey_id";
    private static final String CHANNEL = "passengercount_track";
    private LocationManager manager;
    private String surveyId;

    static String safeId(String id) {
        return id == null ? "" : id.replaceAll("[^A-Za-z0-9_-]", "");
    }
    static File trackFile(Context context, String id) {
        return new File(context.getFilesDir(), "track-" + safeId(id) + ".jsonl");
    }

    @Override public void onCreate() {
        super.onCreate();
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
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            getSharedPreferences("tracking", MODE_PRIVATE).edit().remove("active_id").commit();
            stopSelf();
            return START_NOT_STICKY;
        }
        String requested = intent == null ? null : intent.getStringExtra(EXTRA_ID);
        if (requested == null)
            requested = getSharedPreferences("tracking", MODE_PRIVATE).getString("active_id", null);
        surveyId = safeId(requested);
        if (surveyId.isEmpty() || !hasLocation()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        getSharedPreferences("tracking", MODE_PRIVATE).edit().putString("active_id", surveyId).commit();
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
        manager.removeUpdates(this);
        if (!hasLocation()) return;
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000, 2f, this, Looper.getMainLooper());
        } catch (Exception ignored) {}
        try {
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 5f, this, Looper.getMainLooper());
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

    @Override public void onLocationChanged(Location location) {
        if (surveyId == null || surveyId.isEmpty()) return;
        try {
            JSONObject p = new JSONObject();
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
            try (FileOutputStream out = new FileOutputStream(trackFile(this, surveyId), true)) {
                out.write((p.toString() + "\n").getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
        } catch (Exception ignored) {}
    }

    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override public void onDestroy() {
        try { manager.removeUpdates(this); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
