package app.passengercount;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import android.util.Log;

/** Separate test-package UID only; never packaged into PassengerCount. */
public final class RestartRaceTriggerService extends Service {
    private static final String TAG = "PassengerRaceTrigger";
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        boolean warm = intent != null && "app.passengercount.tests.WARM".equals(intent.getAction());
        if (!warm && (intent == null || !"app.passengercount.tests.TRIGGER".equals(intent.getAction()))) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (!getPackageName().equals("app.passengercount.tests"))
            throw new IllegalStateException("Race trigger must run in the separate test package");
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(
            "restart-race", "Test-only restart race", NotificationManager.IMPORTANCE_LOW));
        if (!warm) Log.i(TAG, "RACE_TRIGGER_ENTER pid=" + Process.myPid() + " uid=" + Process.myUid());
        startForeground(701, new Notification.Builder(this, "restart-race")
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentTitle("PassengerCount test-only race probe")
            .setContentText("Brief independent foreground transition")
            .build());
        if (warm) {
            // A plain background startService is forbidden on API35. Warm via
            // a legitimate brief FGS, ending before the target session starts.
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf(startId);
            Log.i(TAG, "RACE_WARM_READY pid=" + Process.myPid() + " uid=" + Process.myUid());
            return START_NOT_STICKY;
        }
        Log.i(TAG, "RACE_TRIGGER_FOREGROUND pid=" + Process.myPid() + " uid=" + Process.myUid());
        // Enough time for the shared foreground-app update; no sticky helper.
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf(startId);
        }, 5000);
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
